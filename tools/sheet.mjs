// Contact sheet: node tools/sheet.mjs --out=sheet.jpg --cols=3 --cell=640 a.jpg b.jpg ...   (paths relative to out/shots)
// --glob=prefix  : use all files in out/shots starting with prefix (sorted by name)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './server.mjs';

const dir = path.join(ROOT, 'out', 'shots');
const args = process.argv.slice(2);
const opt = {}; let files = [];
for (const a of args) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) opt[m[1]] = m[2]; else files.push(a); }
if (opt.glob) files = fs.readdirSync(dir).filter(f => f.startsWith(opt.glob) && /\.(jpg|png)$/.test(f) && !f.startsWith('sheet')).sort();
if (opt.order === 'given') { /* keep */ }
const cols = Number(opt.cols || 3), cell = Number(opt.cell || 640);
const rows = Math.ceil(files.length / cols);
const out = path.join(dir, opt.out || 'sheet.jpg');
const inputs = files.flatMap(f => ['-i', path.join(dir, f)]);
const label = opt.label !== '0';
const font = 'C\\:/Windows/Fonts/consola.ttf';
let fc = files.map((f, i) => {
  const name = f.replace(/\.(jpg|png)$/, '').replace(/[':\\]/g, '');
  return `[${i}:v]scale=${cell}:-2${label ? `,drawtext=fontfile='${font}':text='${name}':x=8:y=8:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=4` : ''}[v${i}]`;
}).join(';');
const layout = files.map((_, i) => { const c = i % cols, r = Math.floor(i / cols); return `${c === 0 ? '0' : Array.from({ length: c }, (_, k) => `w${k}`).join('+')}_${r === 0 ? '0' : Array.from({ length: r }, (_, k) => `h${k * cols}`).join('+')}`; }).join('|');
fc += ';' + files.map((_, i) => `[v${i}]`).join('') + (files.length > 1 ? `xstack=inputs=${files.length}:layout=${layout}:fill=black[o]` : 'null[o]');
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', fc, '-map', '[o]', '-q:v', '3', '-frames:v', '1', out], { stdio: 'inherit' });
if (r.status !== 0) process.exit(1);
console.log(`${files.length} images -> ${out} (${cols}x${rows})`);
