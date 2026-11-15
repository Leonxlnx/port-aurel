#!/usr/bin/env node
// Music analysis for soundtrack candidates.
// Usage: node tools/audio/analyze_music.cjs <outDir> <audioFile> [<audioFile> ...]
// For every file: ffprobe facts, EBU R128 loudness, BPM + beat grid + best-guess downbeats,
// 0.25 s energy curves (full band / <150 Hz / >4 kHz), ranked 60 s windows, waveform + spectrogram PNG.
// Only ever runs ONE ffmpeg/ffprobe process at a time (spawnSync).
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SR = 22050;
const WIN_LEN = 60; // seconds

function run(cmd, args) {
  const r = spawnSync(cmd, args, { maxBuffer: 1 << 30, windowsHide: true });
  if (r.error) throw r.error;
  return r;
}

function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries',
    'format=duration,bit_rate,format_name:stream=codec_name,sample_rate,channels', '-of', 'json', file]);
  const j = JSON.parse(r.stdout.toString());
  const s = (j.streams || [])[0] || {};
  return {
    duration: +j.format.duration, bitrate: Math.round(+j.format.bit_rate / 1000), container: j.format.format_name,
    codec: s.codec_name, sampleRate: +s.sample_rate, channels: +s.channels,
  };
}

function loudness(file) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true', '-f', 'null', '-']);
  const all = r.stderr.toString();
  const s = all.slice(all.lastIndexOf('Summary:'));
  const g = (re) => { const m = s.match(re); return m ? +m[1] : null; };
  return { integratedLUFS: g(/I:\s*(-?[\d.]+) LUFS/), lraLU: g(/LRA:\s*([\d.]+) LU/), truePeakDBFS: g(/Peak:\s*(-?[\d.]+) dBFS/) };
}

function decode(file) {
  const r = run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
  const b = r.stdout;
  const n = b.length >> 2;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readFloatLE(i * 4);
  return out;
}

// ---------- DSP helpers ----------
function makeFFT(n) {
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(2 * Math.PI * i / n); sin[i] = Math.sin(2 * Math.PI * i / n); }
  const bits = Math.round(Math.log2(n));
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) { let x = i, y = 0; for (let b = 0; b < bits; b++) { y = (y << 1) | (x & 1); x >>= 1; } rev[i] = y; }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const a = i + j, b = a + half;
          const tre = re[b] * cos[k] + im[b] * sin[k];
          const tim = -re[b] * sin[k] + im[b] * cos[k];
          re[b] = re[a] - tre; im[b] = im[a] - tim; re[a] += tre; im[a] += tim;
        }
      }
    }
  };
}
function hann(n) { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; }

// 2nd-order Butterworth section (RBJ), applied twice -> 4th order
function biquad(x, type, fc) {
  const w0 = 2 * Math.PI * fc / SR, c = Math.cos(w0), s = Math.sin(w0), alpha = s / (2 * Math.SQRT1_2);
  let b0, b1, b2;
  if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = (1 - c) / 2; } else { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = (1 + c) / 2; }
  const a0 = 1 + alpha, a1 = -2 * c, a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const filt4 = (x, type, fc) => biquad(biquad(x, type, fc), type, fc);

function blockDb(x, blockSec) {
  const bl = Math.round(SR * blockSec), n = Math.floor(x.length / bl), out = new Array(n);
  for (let b = 0; b < n; b++) { let s = 0; for (let i = b * bl; i < (b + 1) * bl; i++) s += x[i] * x[i]; out[b] = Math.max(-120, 10 * Math.log10(s / bl + 1e-12)); }
  return out;
}
const mean = (a, i0, i1) => { i0 = Math.max(0, i0); i1 = Math.min(a.length, i1); if (i1 <= i0) return NaN; let s = 0; for (let i = i0; i < i1; i++) s += a[i]; return s / (i1 - i0); };
const pct = (a, p) => { const s = Array.from(a).filter(Number.isFinite).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };
const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mmss = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(1); };

// ---------- onset envelope ----------
const N = 1024, HOP = 256, FPS = SR / HOP;
function onsetEnvelope(x) {
  const fft = makeFFT(N), w = hann(N), nb = N / 2 + 1;
  const frames = Math.max(0, Math.floor((x.length - N) / HOP) + 1);
  const flux = new Float64Array(frames);
  let prev = new Float64Array(nb), cur = new Float64Array(nb);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let t = 0; t < frames; t++) {
    const o = t * HOP;
    for (let i = 0; i < N; i++) { re[i] = x[o + i] * w[i]; im[i] = 0; }
    fft(re, im);
    let f = 0;
    for (let k = 1; k < nb; k++) { const m = Math.log1p(100 * Math.hypot(re[k], im[k])); cur[k] = m; const d = m - prev[k]; if (d > 0) f += d; }
    flux[t] = t === 0 ? 0 : f;
    const tmp = prev; prev = cur; cur = tmp;
  }
  // subtract local mean (+-0.4 s), half-wave rectify, normalise by std
  const half = Math.round(0.4 * FPS), env = new Float64Array(frames);
  const cs = new Float64Array(frames + 1); for (let i = 0; i < frames; i++) cs[i + 1] = cs[i] + flux[i];
  let ss = 0;
  for (let t = 0; t < frames; t++) { const a = Math.max(0, t - half), b = Math.min(frames, t + half + 1); const v = flux[t] - (cs[b] - cs[a]) / (b - a); env[t] = v > 0 ? v : 0; ss += env[t] * env[t]; }
  const sd = Math.sqrt(ss / Math.max(1, frames)) || 1;
  for (let t = 0; t < frames; t++) env[t] /= sd;
  return env;
}
function smooth(env, sigma) {
  const r = Math.ceil(sigma * 3), k = []; let ks = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-0.5 * i * i / (sigma * sigma)); k.push(v); ks += v; }
  const out = new Float64Array(env.length);
  for (let t = 0; t < env.length; t++) { let s = 0; for (let i = -r; i <= r; i++) { const u = t + i; if (u >= 0 && u < env.length) s += env[u] * k[i + r]; } out[t] = s / ks; }
  return out;
}
const lerp = (a, x) => { if (x < 0 || x >= a.length - 1) return 0; const i = Math.floor(x), f = x - i; return a[i] * (1 - f) + a[i + 1] * f; };

// ---------- tempo ----------
function estimateTempo(env) {
  const minL = Math.round(FPS * 60 / 200), maxL = Math.round(FPS * 60 / 55);
  const maxLag = maxL * 8 + 4, n = env.length;
  const acf = new Float64Array(maxLag + 1);
  for (let L = 1; L <= maxLag; L++) { let s = 0; for (let t = L; t < n; t++) s += env[t] * env[t - L]; acf[L] = s / (n - L); }
  let best = -1, bestL = minL; const cands = [];
  for (let L = minL; L <= maxL; L++) {
    const bpm = 60 * FPS / L;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 105) / 0.7, 2));
    const sc = (acf[L] + 0.5 * acf[2 * L] + 0.25 * acf[4 * L]) * prior;
    cands.push([bpm, sc]);
    if (sc > best) { best = sc; bestL = L; }
  }
  // refine period with a comb over 8 multiples
  let bp = bestL, bs = -Infinity;
  for (let P = bestL - 1; P <= bestL + 1; P += 0.01) { let s = 0; for (let m = 1; m <= 8; m++) s += lerp(acf, m * P); if (s > bs) { bs = s; bp = P; } }
  cands.sort((a, b) => b[1] - a[1]);
  const alt = []; for (const c of cands) { if (alt.every((a) => Math.abs(a - c[0]) / c[0] > 0.08) && Math.abs(c[0] - 60 * FPS / bp) / c[0] > 0.08) alt.push(r1(c[0])); if (alt.length >= 2) break; }
  return { period: bp, bpm: 60 * FPS / bp, altBpm: alt };
}

// ---------- beat tracking ----------
function dpBeats(env, period) {
  const n = env.length, sm = smooth(env, Math.max(1, period / 32));
  const cum = new Float64Array(n), back = new Int32Array(n).fill(-1), tight = 100;
  const lo = Math.round(period / 2), hi = Math.round(period * 2);
  for (let t = 0; t < n; t++) {
    let bv = -Infinity, bi = -1;
    for (let d = lo; d <= hi; d++) { const u = t - d; if (u < 0) break; const lg = Math.log(d / period); const v = cum[u] - tight * lg * lg; if (v > bv) { bv = v; bi = u; } }
    if (bi >= 0 && bv > 0) { cum[t] = sm[t] + bv; back[t] = bi; } else cum[t] = sm[t];
  }
  let end = n - 1, ev = -Infinity; for (let t = Math.max(0, n - Math.round(period * 1.5)); t < n; t++) if (cum[t] > ev) { ev = cum[t]; end = t; }
  const beats = []; for (let t = end; t >= 0; t = back[t]) { beats.push(t); if (back[t] < 0) break; }
  beats.reverse();
  let score = 0; for (const b of beats) score += sm[b];
  return { frames: beats, score: score / beats.length };
}
function rigidGrid(env, period) {
  const sm = smooth(env, 1.5), n = env.length;
  const evalGrid = (T, ph) => { let s = 0, c = 0; for (let x = ph; x < n - 1; x += T) { s += lerp(sm, x); c++; } return s / Math.max(1, c); };
  let best = { s: -Infinity, T: period, ph: 0 };
  const search = (center, rel, step, phStep) => {
    for (let f = -rel; f <= rel + 1e-12; f += step) { const T = center * (1 + f); for (let ph = 0; ph < T; ph += phStep) { const s = evalGrid(T, ph); if (s > best.s) best = { s, T, ph }; } }
  };
  search(period, 0.012, 0.0002, 1);
  const c1 = best.T; search(c1, 0.0003, 0.00001, 0.25);
  const frames = []; for (let x = best.ph; x < n - 1; x += best.T) frames.push(x);
  return { frames, score: best.s, T: best.T };
}

// fine alignment of the grid to the actual transient attacks (time domain)
function attackOffset(x, beatTimes) {
  const h = 64, n = Math.floor(x.length / h), e = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let j = i * h; j < (i + 1) * h; j++) s += x[j] * x[j]; e[i] = Math.log10(s / h + 1e-9); }
  const d = new Float64Array(n); for (let i = 2; i < n; i++) d[i] = Math.max(0, e[i] - e[i - 2]);
  let best = 0, bs = -Infinity;
  for (let off = -0.045; off <= 0.045; off += 0.001) { let s = 0; for (const b of beatTimes) { const idx = Math.round((b + off) * SR / h); if (idx >= 0 && idx < n) s += d[idx]; } if (s > bs) { bs = s; best = off; } }
  return best;
}

// ---------- chroma for downbeat guess ----------
function beatChroma(x, beatTimes) {
  const n = 4096, hop = 1024, fft = makeFFT(n), w = hann(n);
  const frames = Math.max(0, Math.floor((x.length - n) / hop) + 1);
  const pc = new Int8Array(n / 2 + 1).fill(-1);
  for (let k = 1; k <= n / 2; k++) { const f = k * SR / n; if (f >= 65 && f <= 2000) pc[k] = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12; }
  const re = new Float64Array(n), im = new Float64Array(n);
  const ch = Array.from({ length: beatTimes.length }, () => new Float64Array(12));
  let bi = 0;
  for (let t = 0; t < frames; t++) {
    const ct = (t * hop + n / 2) / SR;
    while (bi + 1 < beatTimes.length && beatTimes[bi + 1] <= ct) bi++;
    if (ct < beatTimes[0]) continue;
    const o = t * hop; for (let i = 0; i < n; i++) { re[i] = x[o + i] * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 1; k <= n / 2; k++) if (pc[k] >= 0) ch[bi][pc[k]] += Math.hypot(re[k], im[k]);
  }
  return ch;
}
function guessDownbeats(x, lowSig, beatTimes) {
  const ch = beatChroma(x, beatTimes), nb = beatTimes.length;
  const add = (a, b) => { const o = new Float64Array(12); for (let i = 0; i < 12; i++) o[i] = (a ? a[i] : 0) + (b ? b[i] : 0); return o; };
  const cosd = (a, b) => { let d = 0, na = 0, nb2 = 0; for (let i = 0; i < 12; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb2 += b[i] * b[i]; } return na && nb2 ? 1 - d / Math.sqrt(na * nb2) : 0; };
  const change = new Float64Array(nb);
  for (let i = 2; i < nb - 1; i++) change[i] = cosd(add(ch[i - 2], ch[i - 1]), add(ch[i], ch[i + 1]));
  // low-band rise at each beat (kick / bass note starts)
  const lowRise = new Float64Array(nb), wlen = Math.round(0.06 * SR);
  const en = (c) => { let s = 0; const a = Math.max(0, c), b = Math.min(lowSig.length, c + wlen); for (let i = a; i < b; i++) s += lowSig[i] * lowSig[i]; return Math.log10(s / wlen + 1e-9); };
  for (let i = 0; i < nb; i++) { const c = Math.round(beatTimes[i] * SR); lowRise[i] = Math.max(0, en(c - Math.round(0.01 * SR)) - en(c - wlen - Math.round(0.01 * SR))); }
  const z = (a) => { let m = 0, s = 0; for (const v of a) m += v; m /= a.length; for (const v of a) s += (v - m) * (v - m); s = Math.sqrt(s / a.length) || 1; return Array.from(a, (v) => (v - m) / s); };
  const zc = z(change), zl = z(lowRise);
  const scoreFor = (meter) => { const sc = new Array(meter).fill(0); for (let i = 0; i < nb; i++) sc[i % meter] += zc[i] + 0.3 * zl[i]; return sc.map((v) => v / (nb / meter)); };
  const s4 = scoreFor(4), s3 = scoreFor(3);
  const max4 = Math.max(...s4), max3 = Math.max(...s3);
  const meter = max3 > max4 * 1.15 && max3 > 0.2 ? 3 : 4;
  const sc = meter === 3 ? s3 : s4;
  return { meter, chromaScores: sc, score4: r2(max4), score3: r2(max3),
    meterNote: meter === 3 ? 'chord changes line up every 3 tracked beats better than every 4 (3/4, 6/8 or 12/8 feel, or tracker locked to a dotted value) - bars of 3 beats used, check by ear' : '4/4 assumed (bars of 4 tracked beats)' };
}

// ---------- main per-file analysis ----------
function analyze(file, outDir) {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const info = probe(file);
  const loud = loudness(file);
  const x = decode(file);
  const dur = x.length / SR;

  // energy curves @0.25 s (dBFS RMS)
  const low = filt4(x, 'lp', 150), high = filt4(x, 'hp', 4000);
  const rms025 = blockDb(x, 0.25), low025 = blockDb(low, 0.25), high025 = blockDb(high, 0.25);
  const nB = rms025.length;

  // beats
  const env = onsetEnvelope(x);
  const tempo = estimateTempo(env);
  const dp = dpBeats(env, tempo.period);
  const rg = rigidGrid(env, tempo.period);
  const smE = smooth(env, 1.5);
  let dpScoreSm = 0; for (const b of dp.frames) dpScoreSm += smE[b]; dpScoreSm /= dp.frames.length;
  const useRigid = rg.score >= 0.85 * dpScoreSm;
  const frames = useRigid ? rg.frames : dp.frames;
  let beats = frames.map((f) => (f * HOP + N / 2) / SR);
  const off = attackOffset(x, beats);
  beats = beats.map((b) => b + off).filter((b) => b >= 0 && b <= dur);
  let bpm;
  if (useRigid) bpm = 60 * FPS / rg.T; else { const k = beats.length; let sx = 0, sy = 0, sxx = 0, sxy = 0; for (let i = 0; i < k; i++) { sx += i; sy += beats[i]; sxx += i * i; sxy += i * beats[i]; } bpm = 60 / ((k * sxy - sx * sy) / (k * sxx - sx * sx)); }
  const db = guessDownbeats(x, low, beats);

  // combined smoothed loudness curve
  const comb = rms025.map((v, i) => 0.5 * v + 0.25 * low025[i] + 0.25 * high025[i]);
  const B = (sec) => Math.round(sec / 0.25);
  const p90 = pct(rms025, 0.9), p50 = pct(rms025, 0.5), lowP75 = pct(low025, 0.75), highP75 = pct(high025, 0.75);
  const FLOOR = -70;
  const meanPad = (a, i0, i1) => { let s2 = 0; for (let i = i0; i < i1; i++) s2 += i >= 0 && i < a.length ? Math.max(FLOOR, a[i]) : FLOOR; return s2 / (i1 - i0); };
  const stepAt = (i, w) => meanPad(comb, i, i + B(w)) - meanPad(comb, i - B(w), i);

  // section events over the whole track (|step| >= 2.5 dB, 4 s context), snapped to nearest downbeat
  const events = []; const st = comb.map((_, i) => stepAt(i, 4));
  for (let i = 0; i < nB; i++) {
    const v = st[i]; if (Math.abs(v) < 2.5) continue;
    let isPeak = true; for (let j = Math.max(0, i - B(5)); j < Math.min(nB, i + B(5)); j++) if (Math.abs(st[j]) > Math.abs(v)) { isPeak = false; break; }
    if (!isPeak) continue;
    events.push({ time: r2(i * 0.25), stepDb: r1(v), type: v > 0 ? 'lift' : 'drop' });
  }
  // Downbeat phase: chord-change evidence + votes from section starts (big lifts/drops begin on bar 1 in almost all produced music)
  const beatE = beats.map((b, i) => { const a = Math.round(b * SR), e2 = Math.round((i + 1 < beats.length ? beats[i + 1] : b + 60 / bpm) * SR); let q = 0; for (let k = a; k < Math.min(x.length, e2); k++) q += x[k] * x[k] + 4 * high[k] * high[k] + low[k] * low[k]; return 10 * Math.log10(q / Math.max(1, e2 - a) + 1e-10); });
  const beatStep = (i) => (i >= 2 && i + 1 < beatE.length ? (beatE[i] + beatE[i + 1]) / 2 - (beatE[i - 1] + beatE[i - 2]) / 2 : 0);
  const votes = new Array(db.meter).fill(0);
  for (const ev of events) {
    if (Math.abs(ev.stepDb) < 4.5 || ev.time < 2 || ev.time > dur - 6) continue;
    let bk = -1, bv = 0; for (let i = 0; i < beats.length; i++) { if (Math.abs(beats[i] - ev.time) > 1.25) continue; const v = beatStep(i) * Math.sign(ev.stepDb); if (v > bv) { bv = v; bk = i; } }
    if (bk >= 0) { votes[bk % db.meter] += Math.min(15, Math.abs(ev.stepDb)) * (ev.stepDb > 0 ? 1 : 0.5); ev.beatIndex = bk; ev.beatTime = r3(beats[bk]); }
  }
  const vSum = votes.reduce((a, b) => a + b, 0);
  const finalSc = db.chromaScores.map((c, i) => c + (vSum > 0 ? 0.8 * votes[i] / vSum : 0));
  const sortedSc = finalSc.slice().sort((a, b) => b - a);
  db.phase = finalSc.indexOf(sortedSc[0]); db.confidence = r2(sortedSc[0] - sortedSc[1]); db.phaseScores = finalSc.map(r2);
  const downbeats = beats.filter((_, i) => i % db.meter === db.phase);
  for (const ev of events) { let nd = ev.time, bd = Infinity; for (const d of downbeats) { const dd = Math.abs(d - ev.time); if (dd < bd) { bd = dd; nd = d; } } ev.nearestDownbeat = r2(nd); }

  // 60 s windows starting on downbeats
  const wins = [];
  for (const d of downbeats) {
    if (d + WIN_LEN > dur + 0.25) continue;
    const i0 = B(d);
    const startDb = mean(rms025, i0, i0 + B(2));
    const sStart = clamp01(1 - (p90 - startDb) / 14);
    const f0 = Math.round((d - off) * FPS - N / 2 / HOP); let on = 0; for (let f = f0 - 6; f <= f0 + 6; f++) if (f >= 0 && f < smE.length) on = Math.max(on, smE[f]);
    const sOnset = clamp01(on / (pct(Array.from(smE), 0.97) || 1));
    const lowStart = mean(low025, i0, i0 + B(4)), bassIn = lowStart >= lowP75 - 6;
    const a = 0.6 * sStart + 0.2 * sOnset + 0.2 * (bassIn ? 1 : 0);
    // biggest lift between +20 and +52 s (6 s context)
    let lt = -1, lv = -Infinity; for (let i = i0 + B(20); i <= i0 + B(52); i++) { const v = stepAt(i, 4); if (v > lv) { lv = v; lt = i; } }
    const liftRel = (lt - i0) * 0.25;
    const b = clamp01(lv / 5) * Math.exp(-Math.pow((liftRel - 40) / 6, 2));
    const climaxDb = mean(rms025, lt, Math.min(lt + B(10), i0 + B(WIN_LEN)));
    const c = clamp01(1 - (p90 - climaxDb) / 8);
    const preDb = mean(rms025, i0 + B(8), lt);
    const tailDb = mean(rms025, i0 + B(56), i0 + B(60));
    const naturalEnd = d + WIN_LEN >= dur - 4;
    let stepEnd = 0, stepEndAt = 0; for (let i = i0 + B(50); i <= i0 + B(61); i++) { const v = stepAt(i, 4); if (v < stepEnd) { stepEnd = v; stepEndAt = (i - i0) * 0.25; } }
    const boundaryAtEnd = stepEnd <= -3;
    const decay = clamp01((climaxDb - tailDb) / 8);
    const e = Math.max(naturalEnd ? 1 : 0, boundaryAtEnd ? 0.8 : 0, 0.7 * decay);
    // loudest 4 s inside the window
    let pk = i0, pv = -Infinity; for (let i = i0; i + B(4) <= i0 + B(WIN_LEN); i++) { const v = mean(rms025, i, i + B(4)); if (v > pv) { pv = v; pk = i; } }
    // bass / hi-hat entry inside the window
    const entry = (arr, thr) => { for (let i = i0 + B(2); i < i0 + B(WIN_LEN) - B(2); i++) if (mean(arr, i, i + B(2)) >= thr && mean(arr, i - B(2), i) < thr - 4) return (i - i0) * 0.25; return null; };
    const bassEntry = bassIn ? 0 : entry(low025, lowP75 - 6), hatEntry = entry(high025, highP75 - 6);
    const score = 0.25 * a + 0.45 * b + 0.1 * c + 0.2 * e;
    const evIn = events.filter((ev) => ev.time >= d - 0.5 && ev.time <= d + WIN_LEN + 0.5).map((ev) => `+${(ev.time - d).toFixed(1)}s ${ev.type} ${ev.stepDb > 0 ? '+' : ''}${ev.stepDb}dB`);
    const notes = [
      `start ${r1(startDb - p90)} dB vs loud sections (${sStart > 0.75 ? 'starts strong' : sStart > 0.45 ? 'medium start' : 'soft start'}${bassIn ? ', bass/kick present from 0 s' : bassEntry != null ? ', bass enters +' + bassEntry + ' s' : ', little bass'})`,
      `biggest lift at +${liftRel.toFixed(1)} s (abs ${mmss(lt * 0.25)}), +${r1(lv)} dB vs preceding 4 s; pre-lift avg ${r1(preDb - p90)} dB, post-lift 10 s avg ${r1(climaxDb - p90)} dB vs loud sections`,
      `loudest 4 s at +${((pk - i0) * 0.25).toFixed(1)} s`,
      hatEntry != null ? `high band (>4 kHz) steps up at +${hatEntry} s` : null,
      naturalEnd ? 'window ends at the natural end of the track' : boundaryAtEnd ? `energy drops ${r1(stepEnd)} dB at +${stepEndAt} s (outro / section end inside the tail)` : `last 4 s ${r1(tailDb - climaxDb)} dB vs post-lift level (${decay > 0.4 ? 'decaying' : 'no natural resolve - needs fade'})`,
      evIn.length ? 'section events in window: ' + evIn.join(', ') : null,
    ].filter(Boolean).join('; ');
    wins.push({ start: r3(d), end: r3(d + WIN_LEN), score: r3(score), liftAtRel: r2(liftRel), liftDb: r1(lv), startDbRelP90: r1(startDb - p90), parts: { start: r2(a), lift: r2(b), climax: r2(c), resolve: r2(e) }, notes });
  }
  wins.sort((p, q) => q.score - p.score);
  const top = []; for (const w of wins) { if (top.every((t) => Math.abs(t.start - w.start) >= 8)) top.push(w); if (top.length >= 6) break; }

  const firstSec = { rmsDbFirst2s: r1(mean(rms025, 0, 8)), relToP90: r1(mean(rms025, 0, 8) - p90), lowDbFirst4s: r1(mean(low025, 0, 16)), lowRelP75: r1(mean(low025, 0, 16) - lowP75), onsetsFirst2s: Array.from(env.slice(0, Math.round(2 * FPS))).filter((v) => v > 1.5).length };

  // PNGs (one ffmpeg at a time)
  const wavePng = path.join(outDir, base + '_waveform.png'), specPng = path.join(outDir, base + '_spectrogram.png');
  run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=1800x500:colors=0xE8A04C', '-frames:v', '1', wavePng]);
  run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-lavfi', 'showspectrumpic=s=1800x500:legend=0:scale=log:fscale=log:color=magma', '-frames:v', '1', specPng]);

  const result = {
    file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
    duration: r3(info.duration), sampleRate: info.sampleRate, channels: info.channels, codec: info.codec, bitrateKbps: info.bitrate,
    loudness: loud,
    bpm: r2(bpm), bpmAlternatives: tempo.altBpm, beatGrid: useRigid ? 'constant-tempo grid fitted to onset envelope' : 'dynamic-programming beat tracker (tempo not rigid)',
    beatGridScores: { rigid: r3(rg.score), dp: r3(dpScoreSm) },
    beatsPerBar: db.meter, downbeatPhase: db.phase, downbeatEvidence: { chordChange: db.chromaScores.map(r2), sectionStartVotes: votes.map(r1) }, meterScores: { four: db.score4, three: db.score3 }, downbeatConfidence: db.confidence, downbeatPhaseScores: db.phaseScores, meterNote: db.meterNote,
    beats: beats.map(r3), downbeats: downbeats.map(r3),
    units: { rms025: 'dBFS RMS of mono mix per 0.25 s block', low025: 'dBFS RMS of <150 Hz band (4th-order LP) per 0.25 s', high025: 'dBFS RMS of >4 kHz band (4th-order HP) per 0.25 s', times: 'seconds from file start' },
    levels: { rmsP90: r1(p90), rmsP50: r1(p50), lowP75: r1(lowP75), highP75: r1(highP75) },
    opening: firstSec,
    events,
    rms025: rms025.map(r1), low025: low025.map(r1), high025: high025.map(r1),
    windows: top,
    images: { waveform: path.basename(wavePng), spectrogram: path.basename(specPng) },
    method: 'Signal analysis only (no listening). Beats: spectral-flux onset envelope (1024/256 @22.05k) + autocorrelation tempo + grid fit; downbeats: best bar phase by chord-change (chroma) + low-band rise + votes from where big section changes start - a guess. Windows scored 0.25 start strength + 0.45 lift near +40 s + 0.10 post-lift level + 0.20 resolve.',
  };
  fs.writeFileSync(path.join(outDir, base + '.json'), JSON.stringify(result));
  return result;
}

if (require.main === module) {
  const [outDir, ...files] = process.argv.slice(2);
  if (!outDir || !files.length) { console.error('usage: node analyze_music.cjs <outDir> <file...>'); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of files) {
    const t0 = Date.now();
    try {
      const r = analyze(path.resolve(f), outDir);
      console.log(`\n== ${path.basename(f)}  ${r.duration}s  ${r.bitrateKbps}k  ${r.loudness.integratedLUFS} LUFS  TP ${r.loudness.truePeakDBFS}  BPM ${r.bpm} (alt ${r.bpmAlternatives.join('/')})  grid=${r.beatGrid.split(' ')[0]} [rigid ${r.beatGridScores.rigid} dp ${r.beatGridScores.dp}]  downbeat conf ${r.downbeatConfidence}  ${r.meterNote}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      console.log(`   opening: first 2 s ${r.opening.relToP90} dB vs loud sections, low band ${r.opening.lowRelP75} dB vs P75, ${r.opening.onsetsFirst2s} onset frames in first 2 s`);
      console.log('   events: ' + r.events.map((e) => `${mmss(e.time)} ${e.type} ${e.stepDb}`).join(' | '));
      for (const w of r.windows) console.log(`   win ${mmss(w.start)} (${w.start}) score ${w.score} [${Object.values(w.parts).join('/')}] ${w.notes}`);
    } catch (e) { console.error('FAILED ' + f + ': ' + e.stack); }
  }
}
