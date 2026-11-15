// STREETS module of Port Aurel: the ground of the city (roads, sidewalks, quays, plaza, parks) and everything that
// stands on it (lamps, signals, signs, furniture, trees, parked cars, festoon lights, café terraces).
// Helpers live in ./streets/*.js. Everything is deterministic (ctx.rng) and animated only through uTime.
import * as THREE from 'three';
import { buildPlan, CURB_H } from './streets/plan.js';
import { buildGround } from './streets/ground.js';
import { MODELS, makePropMaterial } from './streets/props.js';
import { CAR_TYPES, makeCarMaterial, makeCarShadow } from './streets/cars.js';
import { TileLOD } from './streets/lod.js';
import { TREE_SPECIES, makeTree, leafTexture, makeLeafMaterial, makeBarkMaterial } from './streets/trees.js';
import { populate } from './streets/place.js';
import { Geo, S, tube, rtools } from './streets/kit.js';

// streaming radius (m) per prop type; default 260
const DIST = {
  lampCobra: 440, lampOrnate: 440, lampPost: 380, lampPendant: 380, signalPost: 400, signalMast: 440, shelter: 400, festoonPole: 420,
  stall: 1e9, kiosk: 1e9, fountain: 1e9, bulb: 1e9, parasolOpen: 380, parasolClosed: 380, bollard: 240, treeGrate: 200,
  cafeChair: 240, cafeTable: 240, bicycle: 220, bikeRack: 220,
};
// trees and cars come in three levels of detail (see lod.js): apparent distance (m, at a 40 degree lens) below which the
// full model / the mid model is used; beyond `mid` a far stand-in generated from the same shape takes over
const TREE_LOD = { hi: 46, mid: 230, cull: 330 }, CAR_LOD = { hi: 26, mid: 150, cull: 300 };

export async function build(ctx) {
  const { GROUND_Y } = ctx;
  const group = new THREE.Group(); group.name = 'streets';
  const tally = { tris: 0, draws: 0 };
  const counts = {};

  // ---- ground ----------------------------------------------------------------------------------------
  const plan = buildPlan(ctx.layout);
  const ground = buildGround(ctx, plan);
  group.add(ground.group); tally.draws += 3; tally.tris += ground.tris;

  // ---- placement -------------------------------------------------------------------------------------
  const TR = ctx.rng('streets-trees');
  const variants = TREE_SPECIES.map(sp => makeTree(TR, sp));
  const pop = populate(ctx, plan, variants.length);
  const sc = pop.sc;
  const propMat = makePropMaterial(ctx);
  const R = ctx.rng('streets-misc'); const { rr, pick } = rtools(R);

  // every prop type is one InstancedMesh whose instances are streamed by camera distance (see lod.js)
  const lod = new TileLOD(plan.EXT, GROUND_Y, 150, { cull: 220 });
  const addLod = (name, items, geo, tris, mat, opt = {}) => {
    const m = lod.add(name, items, geo, mat, { dist: DIST[name] || 260, tris, ...opt });
    if (m) { group.add(m); tally.draws++; counts[name] = items.length; }
  };

  // ---- overhead cables + festoon bulbs -----------------------------------------------------------------
  {
    const cg = new Geo(); const rubber = S(0x0b0b0b, 0.8, 0);
    for (const c of pop.cables) {
      const [ax, ay, az] = c.a, [bx, by, bz] = c.b; const len = Math.hypot(bx - ax, by - ay, bz - az);
      const at = t => [ax + (bx - ax) * t, ay + (by - ay) * t - 4 * c.sag * t * (1 - t), az + (bz - az) * t];
      const pts = []; for (let i = 0; i <= 8; i++) pts.push(at(i / 8));
      cg.add(tube(pts, 0.011, 8, 3), rubber);
      if (c.bulbs) {
        const n = Math.max(2, Math.floor(len / 0.8));
        for (let i = 0; i < n; i++) {
          const p = at((i + 0.5) / n);
          sc.put('bulb', p[0], p[1] - 0.055, p[2], rr(0, 6.28), 1, c.bulbs === 2 ? pick(pop.BULB_FEST) : pop.BULB_WARM, R());
        }
      }
    }
    if (pop.cables.length) {
      sc.put('cables', 0, 0, 0);
      const m = sc.make('cables', cg.build(), propMat, { cast: false });
      m.frustumCulled = false; group.add(m); tally.draws++; tally.tris += cg.tris;
    }
  }

  // ---- instanced furniture ---------------------------------------------------------------------------
  const noCast = new Set(['treeGrate', 'bulb', 'lampPendant']);
  for (const [name, fn] of Object.entries(MODELS)) {
    if (!sc.count(name)) continue;
    const g = fn();
    addLod(name, sc.list(name), g.build(), g.tris, propMat, { cast: !noCast.has(name) });
  }

  // ---- parked cars: three levels of detail of every body style + a soft contact shadow on the road ---------------
  const lodCars = new TileLOD(plan.EXT, GROUND_Y, 24, CAR_LOD), lodTrees = new TileLOD(plan.EXT, GROUND_Y, 32, TREE_LOD);
  const addTier = (L, name, items, geo, tris, mat, opt) => {
    const m = L.add(name, items, geo, mat, { tris, ...opt });
    if (m) { group.add(m); tally.draws++; }
    return m;
  };
  {
    const carMat = makeCarMaterial(ctx), shadows = [];
    for (const t of CAR_TYPES) {
      const items = sc.list(t.name); if (!items.length) continue;
      counts[t.name] = items.length;
      ['hi', 'mid', 'lo'].forEach((lv, tier) => { const g = t.make(lv); addTier(lodCars, t.name + '_' + lv, items, g.build(), g.tris, carMat, { tier }); });
      for (const o of items) shadows.push({ ...o, y: o.y, s: [t.L + 0.56, 1, t.W + 0.56] });
    }
    const sh = makeCarShadow(ctx);
    const m = addTier(lodCars, 'carShadow', shadows, sh.geo, 2, sh.mat, { dist: CAR_LOD.mid, cast: false, receive: false, layer: 1 });
    if (m) m.renderOrder = 1;
  }

  // ---- trees ------------------------------------------------------------------------------------------------
  {
    const leaf = makeLeafMaterial(ctx, leafTexture(ctx.rng('streets-leaf'))), barkMat = makeBarkMaterial(ctx);
    const per = variants.map(() => []);
    for (const t of pop.trees) {
      const sp = TREE_SPECIES[t.v].tint;
      per[t.v].push({ x: t.x, y: t.y, z: t.z, ry: t.ry, s: [t.s, t.s * t.sy, t.s], tint: [t.tint[0] * sp[0], t.tint[1] * sp[1], t.tint[2] * sp[2]], w: 0 });
    }
    variants.forEach((v, i) => {
      const n = 'tree' + i, lopt = { layer: 1, depthMaterial: leaf.depth };
      addTier(lodTrees, n + '_bark', per[i], v.hi.bark, v.hi.barkTris, barkMat, { tier: 0 });
      addTier(lodTrees, n + '_hi', per[i], v.hi.leaf, v.hi.leafTris, leaf.mat, { tier: 0, ...lopt });
      addTier(lodTrees, n + '_mid', per[i], v.mid.leaf, v.mid.leafTris, leaf.mat, { tier: 1, ...lopt });
      addTier(lodTrees, n + '_lo', per[i], v.lo.leaf, v.lo.leafTris, leaf.mat, { tier: 2, ...lopt });
      counts[n] = per[i].length;
    });
  }
  const lods = [lod, lodCars, lodTrees];
  const updateLods = cam => { let n = 0; for (const L of lods) n += L.update(cam); return n; };
  const dbgStats = ctx.params && ctx.params.get && ctx.params.get('streetstats');
  let lastLog = -1; const hooked = !!(ctx.engine && ctx.engine.hooks);
  if (hooked) ctx.engine.hooks.beforeSample.push((eng, scene, camera) => {
    const n = updateLods(camera);
    if (dbgStats && n !== lastLog) { lastLog = n; console.log('[app] streets tris: props ' + Math.round(lod.rendered / 1000) + 'k cars ' + Math.round(lodCars.rendered / 1000) + 'k trees ' + Math.round(lodTrees.rendered / 1000) + 'k + static ' + Math.round(tally.tris / 1000) + 'k = ' + Math.round((n + tally.tris) / 1000) + 'k, draws ' + tally.draws); }
  });

  // ---- signs -----------------------------------------------------------------------------------------
  {
    const m = pop.signs.build(ctx);
    if (m) { group.add(m); tally.draws++; tally.tris += pop.signs.tris; }
  }

  // ---- distant lamp glints (keeps far street lights alive when the bulbs become sub-pixel) -----------------
  if (pop.sprites.length) {
    const n = pop.sprites.length; const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
    pop.sprites.forEach((s, i) => { pos.set([s[0], s[1], s[2]], i * 3); col.set([s[3], s[4], s[5]], i * 3); size[i] = s[6]; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = ctx.makeShaderMaterial({
      vertexShader: /* glsl */`
        attribute vec3 aCol; attribute float aSize; varying vec3 vCol;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 0.1);
          float px = aSize / d * (0.5 * uResolution.y * projectionMatrix[1][1]);
          float ps = max(px * 3.0, 2.6);
          gl_PointSize = ps;
          float k = clamp(px * px / (ps * ps), 0.0, 1.0) * 3.2;
          vCol = aCol * k * uNight * (1.0 - smoothstep(1.2, 3.5, px));
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vCol;
        void main() { vec2 q = gl_PointCoord * 2.0 - 1.0; float r2 = dot(q, q); if (r2 > 1.0) discard; gl_FragColor = vec4(vCol * exp(-3.5 * r2), 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
    });
    const pts = new THREE.Points(g, mat); pts.layers.set(1); pts.frustumCulled = false; pts.name = 'lampGlints';
    group.add(pts); tally.draws++;
  }

  const Y = GROUND_Y, E = Y + 1.65;
  const spots = [
    { pos: [-131, Y + 0.35, -30], target: [-400, Y + 2.6, -60], fov: 30, note: 'wet promenade from knee height toward the sunset (elev 1-3 deg): sky sheen on the pavers, bench/lamp/railing silhouettes' },
    { pos: [560, E, -22], target: [-200, Y + 5.6, -22], fov: 45, note: 'tree-lined east-west street (Lamp St) looking down the axis into the setting sun' },
    { pos: [351.5, E, -45], target: [346, Y + 7.6, -400], fov: 40, note: 'Foundry Ave at eye level from the east sidewalk looking north: bench, hydrant, trees, parked cars, bus shelter' },
    { pos: [120, Y + 1.8, 134], target: [400, Y + 4.6, 137], fov: 40, note: 'north canal quay looking east: festoon lights, terraces, cobbles (best at blue hour)' },
    { pos: [344, Y + 4.6, -10], target: [344, Y + 1.6, -600], fov: 10, note: 'telephoto down the middle of Foundry Ave: compressed rows of parked cars, trees, signals (any time of day)' },
    { pos: [630, E, 200], target: [668, Y + 58, 153], fov: 40, note: 'plaza paving sweeping up to the Lantern Tower' },
    { pos: [-8, Y + 1.5, 118], target: [-40, Y + 3.5, 80], fov: 38, note: 'market square: fountain, stalls and festoon lights under the tram station' },
    { pos: [1000, E, 153], target: [668, Y + 40, 153], fov: 32, note: 'boulevard median east of the tower, looking west along the sunset axis to the Lantern Tower' },
  ];

  const info = {
    curbH: CURB_H,
    aves: plan.aves.map(a => ({ id: a.id, name: a.name, x0: a.x0, x1: a.x1, cx: a.cx, sidewalk: a.sw, roadHalfWidth: a.hw, parkW: a.parkW, tram: a.tram, medianHalfWidth: a.medHW })),
    streets: plan.sts.map(s => ({ id: s.id, name: s.name, z0: s.z0, z1: s.z1, cz: s.cz, sidewalk: s.sw, roadHalfWidth: s.hw, parkW: s.parkW, oneWay: s.oneWay, quay: s.quay })),
    plaza: plan.PLAZA, promenade: plan.PROM, median: plan.MED,
    // traffic lights: ph = fract(t / signalPeriod + phase); the avenue (N-S) has green for ph < 0.42, amber < 0.48, then red;
    // the cross street runs the same cycle shifted by half a period
    signalPeriod: 44, signals: pop.signals,
  };
  const fixedTris = tally.tris;
  console.log(`[streets] draws ${tally.draws}, static tris ${Math.round(fixedTris / 1000)}k + streamed props, lamps ${pop.stats.lamps}, lights ${pop.stats.lights}, trees ${pop.stats.trees}, cars ${pop.stats.cars}`);

  // (the streaming is driven from the beforeSample hook, where the camera of the sample is final)
  return { group, update(t, engine) { if (!hooked && engine && engine.camera) updateLods(engine.camera); }, spots, info, lod, lods, stats: { ...tally, fixedTris, ...pop.stats, counts } };
}
