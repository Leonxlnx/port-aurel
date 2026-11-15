// Headless check of the streets prop streaming (no GPU): triangle counts per prop group for film cameras.
import * as THREE from 'three';
import { LAYOUT, mulberry32, hashStr, GROUND_Y } from '../src/world/layout.js';
import { buildPlan } from '../src/world/streets/plan.js';
import { populate } from '../src/world/streets/place.js';
import { MODELS } from '../src/world/streets/props.js';
import { TileLOD } from '../src/world/streets/lod.js';
import { rtools } from '../src/world/streets/kit.js';
import { createFilm } from '../src/film/film.js';
import { TREE_SPECIES, makeTree } from '../src/world/streets/trees.js';
import { CAR_TYPES } from '../src/world/streets/cars.js';

const DIST = {
  lampCobra: 440, lampOrnate: 440, lampPost: 380, lampPendant: 380, signalPost: 400, signalMast: 440, shelter: 400, festoonPole: 420,
  stall: 1e9, kiosk: 1e9, fountain: 1e9, bulb: 1e9, parasolOpen: 380, parasolClosed: 380, bollard: 240, treeGrate: 200,
  cafeChair: 240, cafeTable: 240, bicycle: 220, bikeRack: 220,
};
const ctx = { layout: LAYOUT, GROUND_Y, rng: name => mulberry32(hashStr(String(name))), lights: { add() {} } };
const plan = buildPlan(LAYOUT);
const TR = ctx.rng('streets-trees');
const variants = TREE_SPECIES.map(sp => makeTree(TR, sp));
const pop = populate(ctx, plan, 5), sc = pop.sc;
const R = ctx.rng('streets-misc'); const { rr, pick } = rtools(R);
for (const c of pop.cables) {
  const [ax, ay, az] = c.a, [bx, by, bz] = c.b; const len = Math.hypot(bx - ax, by - ay, bz - az);
  const at = t => [ax + (bx - ax) * t, ay + (by - ay) * t - 4 * c.sag * t * (1 - t), az + (bz - az) * t];
  if (c.bulbs) {
    const n = Math.max(2, Math.floor(len / 0.8));
    for (let i = 0; i < n; i++) { const p = at((i + 0.5) / n); sc.put('bulb', p[0], p[1] - 0.055, p[2], rr(0, 6.28), 1, c.bulbs === 2 ? pick(pop.BULB_FEST) : pop.BULB_WARM, R()); }
  }
}
const lod = new TileLOD(plan.EXT, GROUND_Y, 150, { cull: 220 });
const base = {};     // original (far) triangles per prop
for (const [name, fn] of Object.entries(MODELS)) {
  if (!sc.count(name)) continue;
  const g = fn(), geo = g.build();
  base[name] = geo.userData.lods ? geo.userData.lods[geo.userData.lods.length - 1].tris : g.tris;
  lod.add(name, sc.list(name), geo, new THREE.MeshBasicMaterial(), { dist: DIST[name] || 260, tris: g.tris });
}
const lodCars = new TileLOD(plan.EXT, GROUND_Y, 24, { hi: 26, mid: 150, cull: 300 }), lodTrees = new TileLOD(plan.EXT, GROUND_Y, 32, { hi: 46, mid: 230, cull: 330 });
const M0 = new THREE.MeshBasicMaterial();
for (const t of CAR_TYPES) {
  const items = sc.list(t.name); if (!items.length) continue;
  ['hi', 'mid', 'lo'].forEach((lv, tier) => { const g = t.make(lv); lodCars.add(t.name + '_' + lv, items, g.build(), M0, { tris: g.tris, tier }); });
}
lodCars.add('carShadow', CAR_TYPES.flatMap(t => sc.list(t.name)), new THREE.PlaneGeometry(1, 1), M0, { tris: 2, dist: 150 });
{
  const per = variants.map(() => []);
  for (const t of pop.trees) per[t.v].push({ x: t.x, y: t.y, z: t.z, ry: t.ry, s: 1, tint: [1, 1, 1], w: 0 });
  variants.forEach((v, i) => {
    lodTrees.add('bark' + i, per[i], v.hi.bark, M0, { tris: v.hi.barkTris, tier: 0 });
    lodTrees.add('hi' + i, per[i], v.hi.leaf, M0, { tris: v.hi.leafTris, tier: 0 });
    lodTrees.add('mid' + i, per[i], v.mid.leaf, M0, { tris: v.mid.leafTris, tier: 1 });
    lodTrees.add('lo' + i, per[i], v.lo.leaf, M0, { tris: v.lo.leafTris, tier: 2 });
  });
}
const film = createFilm({ engine: {}, scene: {}, layout: LAYOUT, modules: {} });
const views = [[4, 1.5], [5, 1], [3, 1.5], [18, 1], [16, 2], [9, 1]];
const verbose = process.argv.includes('-v');
for (const [shot, time] of views) {
  const c = film.sample(shot, time).cam;
  const cam = new THREE.PerspectiveCamera(c.fov || 40, 16 / 9, 0.3, 60000);
  cam.position.set(...c.pos); cam.lookAt(new THREE.Vector3(...c.target)); cam.updateMatrixWorld(true);
  const total = lod.update(cam), nc = lodCars.update(cam), nt = lodTrees.update(cam);
  const cnt = [0, 0, 0]; for (const g of lodTrees.groups) if (!g.name.startsWith('bark')) cnt[g.tier] += g.mesh.count;
  console.log(`shot ${shot}: TOTAL ${Math.round((total + nc + nt + 71000) / 1000)}k = props ${Math.round(total / 1000)}k cars ${Math.round(nc / 1000)}k trees ${Math.round(nt / 1000)}k (hi/mid/lo ${cnt.join('/')}) + static 71k`);
  const per = {}; let orig = 0;
  for (const g of lod.groups) {
    const nm = g.name.replace(/_l\d$/, '');
    (per[nm] = per[nm] || { n: 0, tris: 0, lv: [] }); per[nm].n += g.mesh.count; per[nm].tris += g.mesh.count * g.tris; per[nm].lv.push(g.mesh.count);
  }
  for (const nm in per) orig += per[nm].n * base[nm];
  console.log(`shot ${shot}: props ${Math.round(total / 1000)}k  (same instances with the original models: ${Math.round(orig / 1000)}k, delta ${Math.round((total - orig) / 1000)}k)`);
  if (verbose) for (const nm of Object.keys(per).sort((a, b) => per[b].tris - per[a].tris).slice(0, 9)) console.log(`    ${nm}: ${per[nm].lv.join('/')} inst, ${Math.round(per[nm].tris / 1000)}k (orig ${Math.round(per[nm].n * base[nm] / 1000)}k)`);
}
