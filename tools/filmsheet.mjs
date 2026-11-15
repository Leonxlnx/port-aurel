// Contact sheets from rendered shot intermediates or a finished film, to review motion/continuity.
//   node tools/filmsheet.mjs --tag=pv1 [--shots=1,2,3] [--every=20] [--cols=6] [--w=480] [--out=out/review/pv1]
//   node tools/filmsheet.mjs --file=out/film/final.mp4 --every=15 --cols=8 --rows=5
import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const opt = {}; for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) opt[m[1]] = m[2] ?? 'true'; }
const every = Number(opt.every || 20), cols = Number(opt.cols || 6), w = Number(opt.w || 480);
const font = 'arialbd.ttf';
function sheet(input, out, label, rows) {
  const vf = `select='not(mod(n\,${every}))',scale=${w}:-2,drawtext=fontfile='${font}':text='${label} %{n}':x=6:y=6:fontsize=15:fontcolor=white:box=1:boxcolor=black@0.55,tile=${cols}x${rows}:padding=2`;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', vf, '-vsync', '0', '-q:v', '3', out.replace(/\.jpg$/, rows > 0 && opt.file ? '_%02d.jpg' : '.jpg')], { encoding: 'utf8', cwd: 'C:/Windows/Fonts' });
  if (r.status !== 0) console.error(r.stderr.slice(-800));
}
if (opt.file) {
  const rows = Number(opt.rows || 5);
  const out = path.resolve(ROOT, opt.out || 'out/review/film') + '.jpg';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  sheet(path.resolve(ROOT, opt.file), out, 'f', rows); console.log('->', out);
} else {
  const dir = path.join(ROOT, 'out', 'film', opt.tag);
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const want = opt.shots ? opt.shots.split(',') : null;
  const outDir = path.resolve(ROOT, opt.out || `out/review/${opt.tag}`); fs.mkdirSync(outDir, { recursive: true });
  for (const s of man.shots) {
    if (want && !want.includes(String(s.id)) && !want.includes(s.name)) continue;
    const f = path.join(dir, s.file); if (!fs.existsSync(f)) continue;
    const n = Math.ceil(s.frames / every), rows = Math.ceil(n / cols);
    const out = path.join(outDir, `${String(s.id).padStart(2, '0')}_${s.name}.jpg`);
    sheet(f, out, `${s.id} ${s.name}`, rows); console.log('->', out);
  }
}
