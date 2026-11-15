// A/B cost probe (old cloud shader v1 vs the current one) in ONE page, interleaved, so the shared GPU load cancels out.
// Needs the reference copy src/world/sky_v1.js + src/world/sky_v1/*.  node tools/sky2_ab.mjs [--w=1280 --h=720 --spp=12 --reps=6]
import { startServerAuto } from './server.mjs';
import { launch, openPage } from './browser.mjs';
const opt = {}; for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=([\s\S]*)$/.exec(a); if (m) opt[m[1]] = m[2]; }
const W = Number(opt.w || 960), H = Number(opt.h || 540), SPP = Number(opt.spp || 2), REPS = Number(opt.reps || 24);
const srv = await startServerAuto({ port: 5400 + Math.floor(Math.random() * 200), quiet: true });
const browser = await launch({ width: W, height: H });
try {
  const page = await openPage(browser, `http://localhost:${srv.port}/index.html?capture=1&w=${W}&h=${H}&world=city&only=sky${opt.dbg ? '&skydbg=' + opt.dbg : ''}`);
  await page.evaluate(() => window.__app.ready);
  await page.evaluate(async () => {
    window.__ab = { dbg: /skydbg=/.test(location.search) }; const app = window.__app, atm = app.engine.atmosphere, sky = app.world.modules.sky;
    const matNew = atm.dome.material; matNew.dispose = () => {};
    const m = await import('/src/world/sky_v1.js');
    const old = await m.build({ engine: app.engine, G: app.G, params: new URLSearchParams(location.search.replace(/[?&]sky=[^&]*/, '')), layout: app.world.layout });
    const matOld = atm.dome.material; matOld.dispose = () => {};
    const w = app.world, wu = w.update.bind(w); w.update = (t, e) => { wu(t, e); old.update(t); };
    const a0 = sky.applyParams; sky.applyParams = o => { a0({ ...o, ...(window.__ab.extra || {}) }); old.applyParams(o); };
    w.modules.skyOld = old;
    window.__ab.use = which => { atm.dome.material = which === 'old' ? matOld : matNew; };
  });
  const DUSK = { coverage: 0.62, east: 0.5 }, GOLD = { coverage: 0.34, east: 0.14, cumulus: 0.4 };
  const views = [
    { name: 'east 25deg e8 default', cam: { pos: [-400, 10, 300], target: [600, 480, 100], fov: 40 }, elev: 8 },
    { name: 'east 25deg e3 default', cam: { pos: [-400, 10, 300], target: [600, 480, 100], fov: 40 }, elev: 3 },
    { name: 'east 25deg e-3 DUSK  ', cam: { pos: [-400, 10, 300], target: [600, 480, 100], fov: 40 }, elev: -3, sky: DUSK },
    { name: 'west 20deg e1.5 deflt', cam: { pos: [-160, 6, 150], target: [-1200, 390, 150], fov: 40 }, elev: 1.5 },
    { name: 'east 25deg e8 GOLD   ', cam: { pos: [-400, 10, 300], target: [600, 480, 100], fov: 40 }, elev: 8, sky: GOLD },
    { name: 'zenith e8 default    ', cam: { pos: [-160, 6, 150], target: [-300, 1900, 250], fov: 60 }, elev: 8 },
    { name: 'east 25deg e8 CLEAR  ', cam: { pos: [-400, 10, 300], target: [600, 480, 100], fov: 40 }, elev: 8, sky: { coverage: -2, bars: 0, east: 0 } },
  ].filter((v, i) => !opt.views || opt.views.split(',').map(Number).includes(i));
  const variants = opt.variants ? JSON.parse(opt.variants) : [{}];
  const sums = variants.map(() => 0); let sO = 0; const rsum = []; let rcount = 0;
  for (const v of views) {
    // many short stills, finely interleaved (the load of the shared GPU changes within seconds): sums, not minima
    const r = await page.evaluate(async (v, SPP, REPS, W, H, variants) => {
      const run = async (which, sky, extra) => { window.__ab.extra = extra || {}; window.__ab.use(which); window.__app.G.aux.value = (extra && extra.__aux) ? 1 : 0; const r = await window.__app.still({ w: W, h: H, t: 20, spp: SPP, cam: v.cam, elev: v.elev, sky, set: window.__ab.dbg ? { dust: 0 } : {} }); if (!window.__ab.dbg) return r.ms; const e = window.__app.engine, rt = e.rtAccum, bw = Math.min(256, rt.width), bh = Math.min(128, rt.height), buf = new Float32Array(bw * bh * 4); e.renderer.readRenderTargetPixels(rt, (rt.width - bw) >> 1, (rt.height - bh) >> 1, bw, bh, buf); let sum = 0; for (let i = 0; i < bw * bh; i++) sum += buf[i * 4]; return sum / (bw * bh) * 64; };
      const on = v.sky || {}, off = { ...on, enabled: 0 };
      await run('old', on); await run('new', off);
      for (let k = 0; k < variants.length; k++) await run('new', on, variants[k]);
      // the GPU is shared: only keep runs that are bracketed by two "quiet" baseline (clouds off) measurements
      const O = [], Z = [], N = variants.map(() => []);
      let zmin = 1e9; for (let i = 0; i < 10; i++) zmin = Math.min(zmin, await run('new', off));
      let tries = 0;
      while (O.length < REPS && tries++ < REPS * 8) {
        const z1 = await run('new', off); zmin = Math.min(zmin, z1);
        if (z1 > zmin * 1.2) { await new Promise(r => setTimeout(r, 150)); continue; }
        const o = await run('old', on); const n = [];
        for (let k = 0; k < variants.length; k++) n.push(await run('new', on, variants[k]));
        const z2 = await run('new', off); zmin = Math.min(zmin, z2);
        if (z2 > zmin * 1.2) continue;
        O.push(o); Z.push((z1 + z2) / 2); n.forEach((x, k) => N[k].push(x));
      }
      window.__app.G.aux.value = 0;
      if (!O.length) return { rr: variants.map(() => NaN), rz: NaN, n: variants.map(() => NaN), o: NaN, z: zmin, kept: 0 };
      const q = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };   // median of the quiet runs
      // load-invariant estimate: medians of the per-triple time ratios (the load is the same within one triple)
      const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
      const rz = med(Z.map((z, i) => z / O[i]));
      const rr = N.map(n => (med(n.map((x, i) => x / O[i])) - rz) / (1 - rz));
      return { rr, rz, n: N.map(q), o: q(O), z: q(Z), kept: O.length };
    }, v, SPP, REPS, W, H, variants);
    if (!r.kept && r.kept !== undefined) { console.log(v.name + ': no quiet GPU window, skipped'); continue; }
    const co = (r.o - r.z) / SPP; sO += co;
    const cn = r.n.map(x => (x - r.z) / SPP); cn.forEach((x, k) => sums[k] += x);
    console.log(v.name + ': cloud cost new/old (median of paired ratios) ' + r.rr.map(x => x.toFixed(2)).join('  ') + '   [off/old ' + r.rz.toFixed(2) + ']'); r.rr.forEach((x, k) => { rsum[k] = (rsum[k] || 0) + x; }); rcount++;
    console.log(v.name + ': old ' + co.toFixed(1) + ' | new ' + cn.map(x => x.toFixed(1) + ' (x' + (x / co).toFixed(2) + ')').join('  ') + '   [no clouds ' + ((r.z || 0) / SPP).toFixed(1) + ' ms/sample, ' + r.kept + ' quiet runs]');
  }
  console.log('sum: old ' + sO.toFixed(1) + ' | new ' + sums.map(x => x.toFixed(1) + ' (x' + (x / sO).toFixed(2) + ')').join('  '));
  console.log('mean paired ratio new/old: ' + rsum.map(x => (x / rcount).toFixed(2)).join('  '));
  console.log('variants: ' + JSON.stringify(variants));
} catch (e) { console.error('ERROR', e); }
await browser.close(); await srv.close(); process.exit(0);
