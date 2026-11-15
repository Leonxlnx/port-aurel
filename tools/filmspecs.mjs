// Write a shot-spec list for film frames: node tools/filmspecs.mjs --at=0.5[,0.05,0.95] [--shots=1,2] [--prefix=f] [--out=tools/specs_film.json]
import fs from 'node:fs';
import { createFilm } from '../src/film/film.js';
import { LAYOUT } from '../src/world/layout.js';
const opt = {}; for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=(.*)$/.exec(a); if (m) opt[m[1]] = m[2]; }
const film = createFilm({ layout: LAYOUT, modules: {} });
const ats = (opt.at || '0.5').split(',').map(Number);
const want = opt.shots ? opt.shots.split(',') : null;
const prefix = opt.prefix || 'f';
const specs = []; const names = [];
for (const s of film.shots) {
  if (want && !want.includes(String(s.id)) && !want.includes(s.name)) continue;
  for (const a of ats) { const out = `${prefix}${String(s.id).padStart(2, '0')}_${s.name}${ats.length > 1 ? '_' + Math.round(a * 100) : ''}.jpg`; specs.push({ out, shot: s.id, time: +(s.dur * a).toFixed(3) }); names.push(out); }
}
fs.writeFileSync(opt.out || 'tools/specs_film.json', JSON.stringify(specs, null, 1));
console.log(film.shots.map(s => `${s.id}:${s.name} ${s.start.toFixed(2)}-${s.end.toFixed(2)} (${Math.round(s.dur * 30)}f)`).join('\n'));
console.log('FILES ' + names.join(' '));
