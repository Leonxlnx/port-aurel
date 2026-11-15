// Render stills through headless Chrome on the real GPU.
// Examples:
//   node tools/shot.mjs --out=a.jpg --cam=60,14,620,0,40,0 --fov=38 --elev=12 --az=205 --spp=8
//   node tools/shot.mjs --json=tools/specs.json            (array of spec objects, each with "out")
//   node tools/shot.mjs --shot=3 --time=1.5 --out=s3.jpg   (film shot index/id + seconds into the shot)
// Options: --w --h --spp --world=test|city --ev --t --shutter --meter --png
//          --set key=value (engine.settings, repeatable)  --atm key=value (atmosphere params, repeatable)
// Output goes to out/shots/<out>.
import fs from 'node:fs';
import path from 'node:path';
import { startServerAuto, ROOT } from './server.mjs';
import { launch, openPage } from './browser.mjs';

const args = process.argv.slice(2);
const opt = {}; const sets = {}; const atms = {};
const parseVal = v => { if (v === 'true') return true; if (v === 'false') return false; if (v !== '' && !isNaN(Number(v))) return Number(v); if (v.includes(',')) return v.split(',').map(Number); return v; };
for (const a of args) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (!m) continue;
  const k = m[1], v = m[2] ?? 'true';
  if (k === 'set' || k === 'atm') { const i = v.indexOf('='); (k === 'set' ? sets : atms)[v.slice(0, i)] = parseVal(v.slice(i + 1)); }
  else opt[k] = v;
}

function specFromOpts(o) {
  const s = {};
  for (const k of ['w', 'h', 'spp', 'elev', 'az', 'ev', 't', 'shutter', 'time', 'seed', 'exposure']) if (o[k] != null) s[k] = Number(o[k]);
  if (o.shot != null) s.shot = isNaN(Number(o.shot)) ? o.shot : Number(o.shot);
  if (o.cam) { const c = o.cam.split(',').map(Number); s.cam = { pos: c.slice(0, 3), target: c.slice(3, 6) }; }
  for (const k of ['fov', 'roll', 'focus', 'aperture']) if (o[k] != null) { s.cam = s.cam || {}; s.cam[k] = Number(o[k]); }
  if (o.meter) s.meter = true;
  if (Object.keys(sets).length) s.set = sets;
  if (Object.keys(atms).length) s.atm = atms;
  s.out = o.out || 'shot.jpg';
  return s;
}

let specs = [];
if (opt.json) {
  const arr = JSON.parse(fs.readFileSync(path.resolve(opt.json), 'utf8'));
  const base = specFromOpts(opt); delete base.out;
  specs = arr.map(s => ({ ...base, ...s, cam: { ...(base.cam || {}), ...(s.cam || {}) } }));
} else specs = [specFromOpts(opt)];

const W = Number(opt.w || specs[0].w || 1600), H = Number(opt.h || specs[0].h || 900);
const world = opt.world || 'city';
const t0 = Date.now();
const srv = await startServerAuto({ port: 5180 + Math.floor(Math.random() * 200), quiet: true });
const browser = await launch({ width: Math.min(W, 1920), height: Math.min(H, 1080), profile: opt.profile || null });
let code = 0;
try {
  const page = await openPage(browser, `http://localhost:${srv.port}/index.html?capture=1&w=${W}&h=${H}&world=${world}${opt.q ? '&' + opt.q : ''}`);
  await page.evaluate(() => window.__app.ready);
  console.log(`ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const s of specs) {
    const out = s.out || 'shot.jpg';
    const spec = { w: W, h: H, ...s }; delete spec.out;
    const r = await page.evaluate(async (spec, out, png) => {
      const res = await window.__app.still(spec);
      await window.__app.save('shots/' + out, png ? 'image/png' : 'image/jpeg', 0.93);
      return res;
    }, spec, out, out.endsWith('.png'));
    console.log(`${out}: ${r.ms} ms, exposure ${r.exposure.toFixed(4)}${r.meter ? `, meter avg ${r.meter.avg.toFixed(4)} clamped ${r.meter.clampedAvg.toFixed(4)} logAvg ${r.meter.logAvg.toFixed(4)}` : ''}`);
  }
} catch (e) { console.error('ERROR', e); code = 1; }
await browser.close();
await srv.close();
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${path.join(ROOT, 'out', 'shots')}`);
process.exit(code);
