// Final encodes from the per-shot intermediates of a render tag + the soundtrack.
//   node tools/encode.mjs --tag=f4 [--audio=out/film/mix.wav] [--name=final]
// Writes out/film/<name>.mp4       4K master, H.264 CRF 18 (large, for archiving / editing)
//        out/film/<name>_x.mp4     4K for upload to X: 2-pass, ~52 Mbit/s video (< 512 MB)
//        out/film/<name>_1080p.mp4 1080p, CRF 17
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = {}; for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) opt[m[1]] = m[2] ?? 'true'; }
const tag = opt.tag || 'final', name = opt.name || 'final';
const dir = path.join(ROOT, 'out', 'film', tag);
const audio = path.resolve(ROOT, opt.audio || 'out/film/mix.wav');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
for (const s of manifest.shots) if (!fs.existsSync(path.join(dir, s.file))) { console.error('missing', s.file); process.exit(1); }
const list = path.join(dir, 'concat.txt');
fs.writeFileSync(list, manifest.shots.map(s => `file '${path.join(dir, s.file).replace(/\\/g, '/')}'`).join('\n'));
const total = manifest.shots.reduce((a, s) => a + s.frames, 0);
console.log(`${manifest.shots.length} shots, ${total} frames, ${manifest.w}x${manifest.h} @ ${manifest.fps}`);

const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
const X264 = 'keyint=60:min-keyint=30:aq-mode=3:colorprim=bt709:transfer=bt709:colormatrix=bt709';
const IN = ['-hide_banner', '-loglevel', 'error', '-stats', '-y', '-f', 'concat', '-safe', '0', '-i', list];
const AUD = ['-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest'];
const run = (args, label) => { console.log('\n== ' + label); const r = spawnSync('ffmpeg', args, { stdio: 'inherit', cwd: dir }); if (r.status !== 0) { console.error(label + ' FAILED'); process.exit(1); } };
const out = n => path.join(ROOT, 'out', 'film', n);
// conform: a slight punch-in hides the clamped pixels the lens distortion leaves along the frame edge
const Z = Number(opt.zoom || 1.015), ev2 = n => 2 * Math.round(n / 2);
const VF4K = ['-vf', `scale=${ev2(manifest.w * Z)}:${ev2(manifest.h * Z)}:flags=lanczos,crop=${manifest.w}:${manifest.h}`];
const VFHD = ['-vf', `scale=${ev2(1920 * Z)}:${ev2(1080 * Z)}:flags=lanczos,crop=1920:1080`];
const only = opt.only ? opt.only.split(',') : ['master', 'x', '1080p'];

if (only.includes('master')) run([...IN, ...AUD, ...VF4K, '-c:v', 'libx264', '-preset', 'slow', '-crf', opt.crf || '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(manifest.fps),
  '-x264-params', X264, ...COLOR, '-movflags', '+faststart', out(`${name}.mp4`)], 'master (4K, CRF 18)');

if (only.includes('x')) {
  const br = opt.xbitrate || '52M';
  const common = ['-c:v', 'libx264', '-b:v', br, '-maxrate', '62M', '-bufsize', '90M', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-level', '5.1', '-r', String(manifest.fps), '-x264-params', X264, ...COLOR];
  run([...IN, '-map', '0:v:0', ...VF4K, ...common, '-preset', 'medium', '-pass', '1', '-passlogfile', 'x2pass', '-an', '-f', 'null', '-'], 'X version, pass 1');
  run([...IN, ...AUD.slice(0, -7), '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', ...VF4K, ...common, '-preset', 'slow', '-pass', '2', '-passlogfile', 'x2pass', '-movflags', '+faststart', out(`${name}_x.mp4`)], 'X version, pass 2');
}

if (only.includes('1080p')) run([...IN, ...AUD, ...VFHD, '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(manifest.fps),
  '-x264-params', X264, ...COLOR, '-movflags', '+faststart', out(`${name}_1080p.mp4`)], '1080p (CRF 17)');

for (const n of [`${name}.mp4`, `${name}_x.mp4`, `${name}_1080p.mp4`]) if (fs.existsSync(out(n))) console.log(n.padEnd(22), (fs.statSync(out(n)).size / 1e6).toFixed(0) + ' MB');
