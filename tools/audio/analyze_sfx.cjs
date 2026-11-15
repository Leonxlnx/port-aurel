#!/usr/bin/env node
// Measures every sound effect: duration, format, EBU R128 loudness, peak, level statistics and transient times.
// Usage: node tools/audio/analyze_sfx.cjs <sfxDir> <out.json>
// Runs one ffmpeg/ffprobe process at a time.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const SR = 22050;
const run = (cmd, args) => { const r = spawnSync(cmd, args, { maxBuffer: 1 << 30, windowsHide: true }); if (r.error) throw r.error; return r; };
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10), r2 = (v) => Math.round(v * 100) / 100;

function analyze(file) {
  const pj = JSON.parse(run('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration,bit_rate,format_name:stream=codec_name,sample_rate,channels,bits_per_sample', '-of', 'json', file]).stdout.toString() || '{}');
  if (!pj.format || !pj.streams || !pj.streams.length) return { file: path.basename(file), ok: false, error: 'ffprobe found no audio stream' };
  const s = pj.streams[0];
  const lr = run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-af', 'ebur128=peak=true,volumedetect', '-f', 'null', '-']).stderr.toString();
  const sum = lr.slice(lr.lastIndexOf('Summary:'));
  const g = (txt, re) => { const m = txt.match(re); return m ? +m[1] : null; };
  let I = g(sum, /I:\s*(-?[\d.]+) LUFS/); if (I != null && I <= -69.9) I = null; // too short for a gated measurement
  const dec = run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']).stdout;
  const n = dec.length >> 2, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = dec.readFloatLE(i * 4);
  // level statistics over 0.5 s blocks
  const bl = SR / 2 | 0, blocks = []; for (let b = 0; (b + 1) * bl <= n; b++) { let q = 0; for (let i = b * bl; i < (b + 1) * bl; i++) q += x[i] * x[i]; blocks.push(10 * Math.log10(q / bl + 1e-12)); }
  const sorted = blocks.slice().sort((a, b) => a - b), pc = (p) => (sorted.length ? sorted[Math.round(p * (sorted.length - 1))] : null);
  // transients: 10 ms RMS rising >= 12 dB above the level of the preceding 150 ms, at least 250 ms apart
  const h = Math.round(SR * 0.01), m = Math.floor(n / h), e = new Float64Array(m);
  for (let i = 0; i < m; i++) { let q = 0; for (let k = i * h; k < (i + 1) * h; k++) q += x[k] * x[k]; e[i] = 10 * Math.log10(q / h + 1e-10); }
  let peakE = -Infinity; for (const v of e) if (v > peakE) peakE = v;
  const trans = []; let last = -1e9;
  for (let i = 1; i < m; i++) { let pre = 0, c = 0; for (let k = Math.max(0, i - 15); k < i; k++) { pre += e[k]; c++; } pre /= Math.max(1, c); if (e[i] - pre >= 12 && e[i] > peakE - 25 && i - last >= 25) { trans.push(r2(i * 0.01)); last = i; } }
  const dur = +pj.format.duration;
  return {
    file: path.basename(file), ok: true, category: path.basename(file).split('_')[0],
    duration: r2(dur), codec: s.codec_name, sampleRate: +s.sample_rate, channels: +s.channels, bitrateKbps: Math.round(+pj.format.bit_rate / 1000),
    integratedLUFS: I, lraLU: g(sum, /LRA:\s*([\d.]+) LU/), truePeakDBFS: g(sum, /Peak:\s*(-?[\d.]+) dBFS/),
    meanVolumeDb: g(lr, /mean_volume:\s*(-?[\d.]+) dB/), maxVolumeDb: g(lr, /max_volume:\s*(-?[\d.]+) dB/),
    levelDb: { p10: r1(pc(0.1)), p50: r1(pc(0.5)), p90: r1(pc(0.9)) },
    character: dur < 12 ? 'one-shot' : (pc(0.9) - pc(0.1) <= 6 ? 'steady bed (loop-friendly)' : pc(0.9) - pc(0.1) <= 14 ? 'bed with movement' : 'eventful (pass-by / calls / takes)'),
    transientCount: trans.length, transientsSec: trans.slice(0, 40),
  };
}

const [dir, out] = process.argv.slice(2);
const files = fs.readdirSync(dir).filter((f) => /\.(wav|mp3|ogg|flac)$/i.test(f)).sort();
const res = [];
for (const f of files) {
  try { const r = analyze(path.join(dir, f)); res.push(r); console.log(`${r.ok ? 'OK  ' : 'BAD '} ${f}  ${r.duration}s ${r.codec} ${r.sampleRate}Hz ${r.channels}ch ${r.bitrateKbps}k  I=${r.integratedLUFS} LUFS  TP=${r.truePeakDBFS}  mean=${r.meanVolumeDb} max=${r.maxVolumeDb}  ${r.character}  transients=${r.transientCount}`); }
  catch (err) { res.push({ file: f, ok: false, error: String(err.message) }); console.log('BAD  ' + f + ' ' + err.message); }
}
fs.writeFileSync(out, JSON.stringify({ generated: new Date().toISOString(), note: 'Measured with ffmpeg ebur128/volumedetect; integratedLUFS is null for clips too short for a gated measurement. transientsSec = times where the 10 ms level jumps >= 12 dB (clicks, calls, takes).', files: res }, null, 1));
console.log(`${res.filter((r) => r.ok).length}/${res.length} files decoded`);
