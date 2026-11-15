// Build the soundtrack from the cue sheet (assets/audio/cues.json) with ffmpeg: music window + ambience beds + spot SFX.
// All sources are downloaded recordings (see assets/audio/CREDITS.md) — nothing is synthesized here.
//   node tools/audio/mix.mjs [--cues=assets/audio/cues.json] [--out=out/film/mix.wav] [--lufs=-14]
// Cue fields: file, at (film s), in (source s | "loudest"), dur, gain (dB) | level (target mean dBFS of the used segment) | peak (target max dBFS),
//             fadeIn, fadeOut, hp, lp, pan (-1..1), loop,  alignPeakTo (film s) + pre + post (place the loudest instant of the file at that time)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const opt = {}; for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) opt[m[1]] = m[2]; }
const sheet = JSON.parse(fs.readFileSync(path.resolve(ROOT, opt.cues || 'assets/audio/cues.json'), 'utf8'));
const out = path.resolve(ROOT, opt.out || 'out/film/mix.wav');
const DUR = sheet.duration || 60;
const target = Number(opt.lufs ?? sheet.lufs ?? -14);
fs.mkdirSync(path.dirname(out), { recursive: true });

const SR = 8000;
const pcmCache = new Map();
function pcm(file) {
  if (pcmCache.has(file)) return pcmCache.get(file);
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) { console.error('decode failed', file); process.exit(1); }
  const f = new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
  pcmCache.set(file, f); return f;
}
function stats(f, t0, dur) {
  const i0 = Math.max(0, Math.round(t0 * SR)), i1 = Math.min(f.length, Math.round((t0 + dur) * SR));
  let s = 0, mx = 0; for (let i = i0; i < i1; i++) { s += f[i] * f[i]; const a = Math.abs(f[i]); if (a > mx) mx = a; }
  return { mean: 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12), peak: 20 * Math.log10(mx + 1e-9) };
}
function loudestWindow(f, win) {
  const w = Math.round(win * SR), hop = Math.round(0.05 * SR); let best = 0, bestE = -1;
  const pre = new Float64Array(f.length + 1); for (let i = 0; i < f.length; i++) pre[i + 1] = pre[i] + f[i] * f[i];
  for (let i = 0; i + w <= f.length; i += hop) { const e = pre[i + w] - pre[i]; if (e > bestE) { bestE = e; best = i; } }
  return best / SR;
}

const inputs = []; const chains = []; const labels = []; const report = [];
sheet.cues.forEach((c, i) => {
  const file = path.resolve(ROOT, 'assets/audio', c.file);
  if (!fs.existsSync(file)) { console.error('missing', file); process.exit(1); }
  const f = pcm(file); const flen = f.length / SR;
  let at = c.at || 0, src = c.in || 0, dur = c.dur ?? flen;
  if (c.alignPeakTo != null) { const pk = loudestWindow(f, 0.12) + 0.06; const pre = Math.min(c.pre ?? 1, pk); src = pk - pre; at = c.alignPeakTo - pre; dur = pre + (c.post ?? 1); }
  else if (src === 'loudest') src = Math.max(0, loudestWindow(f, dur));
  if (at < 0) { src -= at; dur += at; at = 0; }
  dur = Math.min(dur, DUR - at, c.loop ? 1e9 : flen - src);
  const st = stats(f, src, Math.min(dur, flen - src));
  let gain = c.gain ?? 0;
  if (c.level != null) gain = c.level - st.mean;
  if (c.peak != null) gain = c.peak - st.peak;
  if (c.loop) inputs.push('-stream_loop', '-1');
  inputs.push('-ss', src.toFixed(3), '-t', (dur + 0.05).toFixed(3), '-i', file);
  const fl = [`aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`, `atrim=0:${dur.toFixed(3)}`, 'asetpts=PTS-STARTPTS'];
  if (c.hp) fl.push(`highpass=f=${c.hp}`);
  if (c.lp) fl.push(`lowpass=f=${c.lp}`);
  if (c.fadeIn) fl.push(`afade=t=in:st=0:d=${c.fadeIn}`);
  if (c.fadeOut) fl.push(`afade=t=out:st=${Math.max(0, dur - c.fadeOut).toFixed(3)}:d=${c.fadeOut}`);
  if (c.pan != null) { const l = Math.min(1, 1 - c.pan), r = Math.min(1, 1 + c.pan); fl.push(`pan=stereo|c0=${l.toFixed(2)}*c0|c1=${r.toFixed(2)}*c1`); }
  fl.push(`volume=${gain.toFixed(1)}dB`);
  if (at > 0) fl.push(`adelay=${Math.round(at * 1000)}:all=1`);
  chains.push(`[${i}:a]${fl.join(',')}[a${i}]`); labels.push(`[a${i}]`);
  report.push(`${(c.id || path.basename(c.file)).slice(0, 34).padEnd(34)} at ${at.toFixed(2).padStart(6)} src ${src.toFixed(2).padStart(7)} dur ${dur.toFixed(2).padStart(6)} gain ${gain.toFixed(1).padStart(6)} dB (seg mean ${st.mean.toFixed(1)}, peak ${st.peak.toFixed(1)})`);
});
const mixGraph = (extraGain) => chains.join(';') + `;${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad=whole_dur=${DUR},atrim=0:${DUR},volume=${extraGain.toFixed(2)}dB,alimiter=limit=0.89:attack=3:release=60:level=disabled[out]`;

function run(extraGain, dst, measure) {
  const args = ['-hide_banner', '-y', ...inputs, '-filter_complex', mixGraph(extraGain) + (measure ? ';[out]ebur128=peak=true[m]' : ''), '-map', measure ? '[m]' : '[out]'];
  if (measure) args.push('-f', 'null', '-'); else args.push('-ar', '48000', '-c:a', 'pcm_s24le', dst);
  const r = spawnSync('ffmpeg', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error(r.stderr.slice(-3000)); process.exit(1); }
  return r.stderr;
}
const log = run(0, null, true);
const I = Number((/I:\s+(-?[\d.]+) LUFS/.exec(log.slice(log.lastIndexOf('Integrated loudness'))) || [])[1]);
const gain = isFinite(I) ? target - I : 0;
run(gain, out, false);
const log2 = run(gain, null, true);
const tail = log2.slice(log2.lastIndexOf('Integrated loudness'));
console.log(report.join('\n'));
console.log(`pre-gain loudness ${I} LUFS, applied ${gain.toFixed(2)} dB`);
console.log(tail.split('\n').filter(l => /I:|LRA:|Peak:/.test(l)).map(l => l.trim()).join(' | '));
console.log('->', out);
