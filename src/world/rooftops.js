// ROOFTOPS module — everything that sits on top of the building shells of Port Aurel:
// roof finishes + parapets, the roof equipment kit (water tanks, bulkheads, AC, cooling towers, ducts, vents,
// skylights, chimneys, aerials, dishes, solar, sheds, roof gardens), neon roof signs, aircraft beacons, flags,
// steam plumes and the Lantern Tower crown. All positions derive from ctx.layout.buildings only.
import * as THREE from 'three';
import { Geo, Batch, TRS, frameZ, unitBox, unitCyl, lin, mul } from './rooftops/kit.js';
import { M, makePropMaterial, makeRoofMaterial, makeSkylightMaterial, Sprites } from './rooftops/materials.js';
import * as PR from './rooftops/props.js';
import * as PR2 from './rooftops/props2.js';
import { dress } from './rooftops/dress.js';
import { populate } from './rooftops/populate.js';
import { planSigns, buildSigns } from './rooftops/signs.js';
import { buildLantern } from './rooftops/lantern.js';
import { buildSteam, buildFlags } from './rooftops/fx.js';

export async function build(ctx) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : 0);
  const L = ctx.layout, GY = ctx.GROUND_Y;
  const group = new THREE.Group(); group.name = 'rooftops';
  const propMat = makePropMaterial(ctx);

  // ---- batches ----------------------------------------------------------------------------------------------
  const batches = {};
  const mk = (name, geo, opt = {}) => (batches[name] = new Batch(name, geo, opt.material || propMat, opt));
  mk('boxC', unitBox(), { cast: true, instMat: true });
  mk('boxN', unitBox(), { cast: false, instMat: true });
  mk('cylC', unitCyl(8), { cast: true, instMat: true });
  mk('cylN', unitCyl(6), { cast: false, instMat: true });
  mk('wire', unitCyl(3, false), { cast: false, instMat: true });        // thin lines / conduits (open 3-sided prism)
  { const g = new Geo(); g.cyl(0, 0, 0, Math.SQRT2, 0, 1, 4, { a0: Math.PI / 4, capT: false, smooth: false }); const b = g.build(); b.deleteAttribute('aMat'); mk('pyr', b, { cast: true, instMat: true }); }
  const rs = ctx.rng('rooftops-protos');
  mk('tankHi', PR.tankHi(), { cast: true }); mk('tankLo', PR.tankLo(), { cast: true }); mk('tankSteel', PR.tankSteel(), { cast: true });
  mk('acSmall', PR.acSmall(), { cast: true }); mk('acLarge', PR.acLarge(), { cast: true });
  mk('coolRound', PR.coolingRound(), { cast: true }); mk('coolBox', PR.coolingBox(), { cast: true });
  mk('mushroom', PR.mushroom(), {}); mk('turbine', PR.turbine(), {});
  mk('aerial', PR.aerial(), {}); mk('dish', PR.dish(), {});
  mk('solar', PR.solar(), { cast: true }); mk('ladder', PR.ladderProto(), {});
  // planting: two-sided leaf geometry (distant variants + close-range variants near the film roofs)
  const folMat = makePropMaterial(ctx, { foliage: true });
  mk('shrub', PR2.shrub(rs), { material: folMat }); mk('tree', PR2.tree(rs), { cast: true, material: folMat });
  mk('shrubHi', PR2.shrubHi(rs), { material: folMat }); mk('shrubTall', PR2.shrubTall(rs), { material: folMat }); mk('treeHi', PR2.treeHi(rs), { cast: true, material: folMat });
  mk('sheet', PR2.sheet(), { material: folMat, cast: true });
  mk('pot', PR2.chimneyPot(), {}); mk('bistro', PR2.bistro(), {}); mk('loft', PR2.loft(), { cast: true }); mk('whip', PR2.whip(), {});
  mk('pergola', PR.pergola(), { cast: true }); mk('mast', PR.latticeMast(), { cast: true }); mk('shed', PR.shed(), { cast: true });
  mk('skylight', PR.skylightGlass(), { material: makeSkylightMaterial(ctx) });

  // close-range planting near the three roof-level film cameras (and the hero garden roof)
  const nearFilm = (x, z) => Math.hypot(x - 90, z - 110) < 95 || Math.hypot(x - 165, z - 32) < 45;
  const roofInst = { mx: [], at: [], n: 0 };
  const sprites = new Sprites();
  const _m = new THREE.Matrix4(), _s = new THREE.Matrix4(), _rx = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const K = {
    sprites,
    roof(x0, x1, z0, z1, y, type, seed) {
      const m = TRS((x0 + x1) / 2, y, (z0 + z1) / 2, 0, x1 - x0, 1, z1 - z0);
      for (let i = 0; i < 16; i++) roofInst.mx.push(m.elements[i]);
      roofInst.at.push(type, seed, x1 - x0, z1 - z0); roofInst.n++;
    },
    box(cx, y0, cz, sx, sy, sz, color, mat, cast) { (cast ? batches.boxC : batches.boxN).add(TRS(cx, y0 + sy / 2, cz, 0, sx, sy, sz), color, mat); },
    cyl(x, y0, z, r, h, color, mat, cast) { (cast ? batches.cylC : batches.cylN).add(TRS(x, y0, z, 0, r, h, r), color, mat); },
    cone4(x, y, z, half, h, color, mat) { batches.pyr.add(TRS(x, y, z, 0, half, h, half), color, mat); },
    pipe(p0, p1, r, color, mat, cast = false) {
      const { m, L: len } = frameZ(p0, p1);
      _m.copy(m).multiply(_rx).multiply(_s.makeScale(r, len, r));
      (cast ? batches.cylC : batches.cylN).add(_m, color, mat);
    },
    wire(p0, p1, r, color, mat) {
      const { m, L: len } = frameZ(p0, p1);
      _m.copy(m).multiply(_rx).multiply(_s.makeScale(r, len, r));
      batches.wire.add(_m, color, mat);
    },
    beam(p0, p1, w, h, color, mat, cast) {
      const { m, L: len } = frameZ(p0, p1);
      _m.copy(m).multiply(_s.makeTranslation(0, 0, len / 2)).multiply(new THREE.Matrix4().makeScale(w, h, len));
      (cast ? batches.boxC : batches.boxN).add(_m, color, mat);
    },
    put(name, x, y, z, ry = 0, s = 1, color = null, sy = null) {
      const hsh = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      if ((name === 'shrub' || name === 'tree') && nearFilm(x, z)) name = name === 'tree' ? 'treeHi' : (hsh < 0.3 ? 'shrubTall' : 'shrubHi');
      const m = TRS(x, y, z, ry, s, sy ?? s, s);
      if (name === 'tankHi' || name === 'tankLo') {           // old timber tanks settle: a slight lean and squat / tall variety (position unchanged)
        const a = hsh * 6.2832, h2 = (hsh * 57.31) % 1, lean = h2 * h2 * 0.032, e = m.elements;
        const k = 0.965 + 0.07 * ((hsh * 13.7) % 1);
        e[4] = Math.cos(a) * lean * s; e[5] *= k; e[6] = Math.sin(a) * lean * s;
      }
      batches[name].add(m, color);
    },
    putM(name, m, color = null) { batches[name].add(m, color); },
    skylight(x, y, z, len, h, wid, ry, color = null) { batches.skylight.add(TRS(x, y, z, ry, len, h, wid), color); },
  };

  // ---- plan the features that need reserved roof space ---------------------------------------------------
  // (soft dependency) roofs the buildings module turned into real pitched roofs / false-front gables stay clear of our big features
  const BM = ctx.modules && ctx.modules.buildings;
  const pitched = (BM && BM.pitchedIds) || new Set();
  const gabled = id => !!(BM && BM.info && BM.info.get(id) && BM.info.get(id).roofType === 3);
  // keep the roof under the lead's blue-hour vantage (150,44,40) free of signs / masts (it carries the hero roof garden)
  const KEEP_CLEAR = [[165, 32]];
  const noBig = b => pitched.has(b.id) || gabled(b.id) || KEEP_CLEAR.some(([x, z]) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1);
  const plan = planSigns(ctx, ctx.rng('rooftops-signs'), noBig);
  plan.pitched = pitched;
  plan.masts = new Set(); plan.flags = new Map();
  {
    const R = ctx.rng('rooftops-masts'); const picked = [];
    const radio = plan.signs.find(s => s.word === 3); if (radio) { plan.masts.add(radio.id); const b = L.buildings.find(q => q.id === radio.id); picked.push(b); }
    const cands = L.buildings.filter(b => b.kind === 'building' && !noBig(b) && b.h > 40 && b.h < 108 && b.district !== 'east' && !plan.reserve.has(b.id) && (b.x1 - b.x0) > 16 && (b.z1 - b.z0) > 16 && b.x0 < 760 && b.z0 > -480 && b.z1 < 600)
      .map(b => ({ b, s: b.h * 0.2 + R() * 30 })).sort((a, b) => b.s - a.s);
    for (const c of cands) {
      if (picked.length >= 6) break;
      if (picked.some(q => Math.hypot(q.x0 - c.b.x0, q.z0 - c.b.z0) < 190)) continue;
      picked.push(c.b); plan.masts.add(c.b.id);
    }
    // flagpoles: dignified masonry buildings near the canal / the quay
    const Rf = ctx.rng('rooftops-flags'); const fl = [];
    const fc = L.buildings.filter(b => b.kind === 'building' && !pitched.has(b.id) && (b.style === 'stone' || b.style === 'deco' || b.style === 'stucco') && b.h > 20 && b.h < 115 && b.x0 < 640
      && (Math.abs((b.z0 + b.z1) / 2 - 153) < 150 || b.district === 'quay')).map(b => ({ b, s: Rf() })).sort((a, b) => a.s - b.s);
    for (const c of fc) {
      if (fl.length >= 11) break;
      if (fl.some(q => Math.hypot(q.x0 - c.b.x0, q.z0 - c.b.z0) < 120)) continue;
      fl.push(c.b); plan.flags.set(c.b.id, Rf() < 0.5 ? 'sw' : 'nw');
    }
  }

  // hero roof garden: the flat roof nearest the lead's old-town vantage (150,44,40) from whose west edge the Lantern crown is in clear view
  const sees = makeLOS(ctx, pitched);
  {
    const lt = L.buildings.find(q => q.landmark === 'lantern');
    const crownP = lt ? [(lt.x0 + lt.x1) / 2, GY + (lt.crown ? lt.crown.y0 + 12 : lt.h), (lt.z0 + lt.z1) / 2] : [668, 226, 153];
    const cands = L.buildings.filter(q => q.kind === 'building' && !pitched.has(q.id) && !gabled(q.id) && q.tiers.length === 1 && q.h > 22 && q.h < 62 && !plan.reserve.has(q.id) && !plan.masts.has(q.id)
      && (q.x1 - q.x0) > 22 && (q.z1 - q.z0) > 17 && q.x0 < 340 && q.x0 > 20 && Math.abs((q.z0 + q.z1) / 2 - 100) < 260)
      .map(q => ({ q, d: Math.hypot((q.x0 + q.x1) / 2 - 165, (q.z0 + q.z1) / 2 - 32) })).sort((a, b) => a.d - b.d);
    for (const { q } of cands) {
      const spot = [q.x0 + 1.5, GY + q.h + 1.7, (q.z0 + q.z1) / 2];
      if (!sees(spot, crownP)) continue;
      plan.heroGarden = { id: q.id, spot, crown: crownP };
      break;
    }
  }

  // ---- dress every roof ---------------------------------------------------------------------------------------
  const out = populate(ctx, K, plan);

  // ---- signs --------------------------------------------------------------------------------------------------
  const signs = buildSigns(ctx, K, group, plan, ctx.rng('rooftops-signgeo'));

  // ---- beacons: tall buildings + masts ---------------------------------------------------------------------
  const RED = [1.0, 0.05, 0.025];
  {
    const R = ctx.rng('rooftops-beacons');
    for (const t of out.tallTops) {
      const phase = R() * 6.28, speed = 1.6 + R() * 0.5;
      t.beacons.forEach(([x, y, z, k], i) => {
        K.box(x, y - 0.22, z, 0.16, 0.14, 0.16, lin(0x2a2a2a), M.IRON, false);
        sprites.lamp(x, y, z, 0.36 * (0.6 + 0.4 * k), mul(RED, 55 * k), { day: 0.07, pulse: k < 0.5 ? 0 : speed, phase, minPx: k < 0.5 ? 1.1 : 1.7 });
      });
    }
    for (const m of out.masts) {
      const phase = R() * 6.28;
      sprites.lamp(m.x, m.top + 0.2, m.z, 0.34, mul(RED, 55), { day: 0.07, pulse: 1.8, phase, minPx: 1.7 });
      sprites.lamp(m.x + 0.5, m.y + (m.top - m.y) * 0.5, m.z + 0.5, 0.26, mul(RED, 30), { day: 0.07, pulse: 1.8, phase, minPx: 1.2 });
      sprites.lamp(m.x - 0.5, m.y + (m.top - m.y) * 0.5, m.z - 0.5, 0.26, mul(RED, 30), { day: 0.07, pulse: 1.8, phase, minPx: 1.2 });
    }
  }

  // ---- flags --------------------------------------------------------------------------------------------------
  const flags = [];
  {
    const R = ctx.rng('rooftops-flagdress');
    const fieldCols = [[0.035, 0.09, 0.2], [0.3, 0.03, 0.03], [0.03, 0.14, 0.11], [0.04, 0.06, 0.16]];
    const pole = (x, y, z, H) => {
      K.cyl(x, y, z, 0.075, H, lin(0xd8d4c8), M.PAINT, true);
      K.cyl(x, y + H, z, 0.13, 0.16, lin(0xf0c05a), M.BRASS, false);
      K.box(x, y, z, 0.5, 0.25, 0.5, lin(0x777777), M.CONCRETE, false);
      const s = H > 9 ? 2.3 : 1.8;
      flags.push({ x: x + 0.09, y: y + H - 0.12, z: z + 0.03, s, color: fieldCols[Math.floor(R() * fieldCols.length)] });
    };
    for (const [id, corner] of plan.flags) {
      const r = out.roofs.get(id); if (!r) continue;
      pole(r.x0 + 0.95, r.y, corner === 'sw' ? r.z1 - 0.95 : r.z0 + 0.95, 7 + R() * 4);
    }
    const lt = L.buildings.find(q => q.landmark === 'lantern');
    if (lt) {
      const t = lt.tiers[0]; const y = GY + t.y1;
      pole(lt.x0 + 2.8, y, lt.z0 + 2.8 + 2.4, 12); pole(lt.x0 + 2.8, y, lt.z1 - 2.8 - 2.4, 12);
    }
  }
  buildFlags(ctx, group, PR.flagCloth(), flags);

  // ---- steam --------------------------------------------------------------------------------------------------
  const emitters = [];
  {
    const R = ctx.rng('rooftops-steam');
    const cs = out.coolers.filter(c => c.district !== 'east').map(c => ({ c, s: c.h * 0.6 + R() * 40 - Math.abs(c.z - 153) * 0.06 - Math.max(0, c.x - 720) * 0.2 })).sort((a, b) => b.s - a.s);
    for (const { c } of cs) {
      if (emitters.length >= 12) break;
      if (emitters.some(e => Math.hypot(e.x - c.x, e.z - c.z) < 55)) continue;
      emitters.push({ x: c.x, y: c.y, z: c.z, size: c.r * 1.05, rise: 13 + c.h * 0.13, strength: 0.5 + R() * 0.25 });
    }
    // small vent stacks on bulkheads in the low districts (close to the rooftop vantage points)
    const bs = out.bulkheads.filter(k => k.x < 320 && k.x > -130 && Math.abs(k.z - 90) < 250).map(k => ({ k, s: R() })).sort((a, b) => a.s - b.s);
    let n = 0;
    for (const { k } of bs) {
      if (n >= 6) break;
      if (emitters.some(e => Math.hypot(e.x - k.x, e.z - k.z) < 75)) continue;
      const sx = k.x + k.sx * 0.25, sz = k.z - k.sz * 0.2;
      K.cyl(sx, k.top, sz, 0.17, 1.5, lin(0x9a9da0), M.GALV, false);
      K.cyl(sx, k.top + 1.5, sz, 0.22, 0.08, lin(0x777a7c), M.GALV, false);
      emitters.push({ x: sx, y: k.top + 1.6, z: sz, size: 0.4, rise: 7.5, strength: 0.42 + R() * 0.15 }); n++;
    }
  }
  buildSteam(ctx, group, emitters, ctx.rng('rooftops-steamgeo'));

  // ---- the Lantern Tower crown -----------------------------------------------------------------------------
  const lantern = buildLantern(ctx, K, group);

  // ---- pass 2: lived-in roofscape (own RNG stream; nothing from pass 1 moves) ---------------------------------
  const vantagePoints = makeVantagePoints(ctx, out, signs, emitters, lantern, sees);
  const pass2 = !(ctx.params && ctx.params.get && ctx.params.get('roofpass2') === '0');      // ?roofpass2=0: look-dev / cost A-B switch
  const dressStats = pass2 ? dress(ctx, K, out, plan, vantagePoints) : {};

  // ---- finish: roof finish quads, instanced batches, sprites ----------------------------------------------
  {
    const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
    pg.setAttribute('aRoof', new THREE.InstancedBufferAttribute(new Float32Array(roofInst.at), 4));
    const mesh = new THREE.InstancedMesh(pg, makeRoofMaterial(ctx), roofInst.n);
    mesh.instanceMatrix.array.set(roofInst.mx); mesh.instanceMatrix.needsUpdate = true;
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.name = 'roof_finish';
    mesh.computeBoundingSphere(); mesh.computeBoundingBox();
    group.add(mesh);
  }
  for (const k in batches) batches[k].finish(group);
  sprites.finish(ctx, group);

  // optional stand-in building shells for isolated look-dev: ?only=rooftops&roofproxy=1
  if (ctx.params && ctx.params.get && ctx.params.get('roofproxy')) {
    let n = 0; for (const b of L.buildings) n += b.tiers.length;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), ctx.makeMaterial({ color: 0x8d857a, roughness: 0.9 }), n);
    let i = 0;
    for (const b of L.buildings) for (const t of b.tiers) {
      im.setMatrixAt(i++, TRS((b.x0 + b.x1) / 2, GY + (t.y0 + t.y1) / 2, (b.z0 + b.z1) / 2, 0, b.x1 - b.x0 - 2 * t.inset, t.y1 - t.y0, b.z1 - b.z0 - 2 * t.inset));
    }
    im.castShadow = im.receiveShadow = true; im.computeBoundingSphere(); im.name = 'roof_proxy_shells'; group.add(im);
  }

  // ---- stats ------------------------------------------------------------------------------------------------
  let tris = 0, draws = 0;
  group.traverse(o => {
    if (!o.isMesh || o.name === 'roof_proxy_shells') return;
    draws++;
    const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
    tris += n * (o.isInstancedMesh ? o.count : (g.isInstancedBufferGeometry ? g.instanceCount : 1));
  });
  const stats = { drawCalls: draws, triangles: Math.round(tris), tanks: out.tanks.length, signs: signs.length, steam: emitters.length, flags: flags.length, beacons: out.tallTops.length + out.masts.length + 1 };
  console.log(`[app] rooftops: buildings module ${BM ? 'present' : 'absent'}, ${pitched.size} pitched roofs skipped`);
  console.log(`[app] rooftops: ${draws} draw calls, ${(tris / 1e6).toFixed(2)} M tris, ${out.tanks.length} tanks, ${signs.length} signs, ${emitters.length} steam plumes, ${flags.length} flags, ${Math.round((typeof performance !== 'undefined' ? performance.now() : 0) - t0)} ms`);

  console.log('[app] rooftops pass 2: ' + JSON.stringify(dressStats));
  if (ctx.params && ctx.params.get && ctx.params.get('roofdbg')) {
    console.log('[app] rooftops vantage ' + JSON.stringify(vantagePoints.map(v => [v.pos, v.target, v.fov, v.building, v.seesCrown, v.note.slice(0, 24)])));
    console.log('[app] rooftops signs ' + JSON.stringify(signs.map(s => [s.text, s.id, Math.round(s.x), Math.round(s.y), Math.round(s.z), Math.round(s.width)])));
    console.log('[app] rooftops flags ' + JSON.stringify(flags.slice(0, 6).map(f => [Math.round(f.x), Math.round(f.y), Math.round(f.z)])) + ' masts ' + JSON.stringify(out.masts.map(m => [Math.round(m.x), Math.round(m.y), Math.round(m.z)])) + ' gardens ' + JSON.stringify(out.gardens.slice(0, 5).map(g => [g.id, Math.round(g.x), Math.round(g.y), Math.round(g.z), !!g.hero])));
    console.log('[app] rooftops steam ' + JSON.stringify(emitters.map(e => [Math.round(e.x), Math.round(e.y), Math.round(e.z)])));
  }

  return { group, stats, vantagePoints, lantern, signs, tanks: out.tanks, steam: emitters, flags, roofs: out.roofs, update() {} };
}

/** line of sight against the layout's tier boxes (parapets included; pitched roofs get their ridge height) */
function makeLOS(ctx, pitched) {
  const boxes = [];
  for (const b of ctx.layout.buildings) b.tiers.forEach((t, i) => boxes.push([b.x0 + t.inset, b.x1 - t.inset, b.z0 + t.inset, b.z1 - t.inset,
    ctx.GROUND_Y + t.y1 + 1.35 + (i === b.tiers.length - 1 && pitched.has(b.id) ? 8.5 : 0)]));
  return (p, t) => {
    const dx = t[0] - p[0], dy = t[1] - p[1], dz = t[2] - p[2]; const len = Math.hypot(dx, dy, dz); const n = Math.ceil(len / 2.5);
    for (let i = 2; i < n - 8; i++) {
      const u = i / n, x = p[0] + dx * u, y = p[1] + dy * u, z = p[2] + dz * u;
      for (const q of boxes) if (y < q[4] && x > q[0] && x < q[1] && z > q[2] && z < q[3]) return false;
    }
    return true;
  };
}

// 6-10 camera positions standing on real roofs (eye height ~1.7 m), with something interesting in the foreground
function makeVantagePoints(ctx, out, signs, emitters, lantern, sees) {
  const L = ctx.layout; const V = [];
  const crown = lantern ? [lantern.center[0], lantern.center[1] + 6, lantern.center[2]] : [668, 232, 153];
  const roofAt = (x, z) => {
    let best = null, bd = 1e9;
    for (const b of L.buildings) {
      const r = out.roofs.get(b.id); if (!r) continue;
      const dx = Math.max(r.x0 - x, 0, x - r.x1), dz = Math.max(r.z0 - z, 0, z - r.z1); const d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = { b, r }; }
    }
    return best;
  };
  // nudge a standing spot off the equipment
  const clear = (r, x, z) => {
    const ok = (px, pz) => px > r.x0 + 0.9 && px < r.x1 - 0.9 && pz > r.z0 + 0.9 && pz < r.z1 - 0.9 && (r.used || []).every(u => Math.abs(px - u.x) > u.w / 2 + 0.7 || Math.abs(pz - u.z) > u.d / 2 + 0.7);
    if (ok(x, z)) return [x, z];
    for (let rad = 1; rad < 14; rad += 1) for (let a = 0; a < 8; a++) { const px = x + Math.cos(a * 0.785) * rad, pz = z + Math.sin(a * 0.785) * rad; if (ok(px, pz)) return [px, pz]; }
    return [Math.min(r.x1 - 1, Math.max(r.x0 + 1, x)), Math.min(r.z1 - 1, Math.max(r.z0 + 1, z))];
  };
  const okSpot = (r, px, pz) => px > r.x0 + 0.9 && px < r.x1 - 0.9 && pz > r.z0 + 0.9 && pz < r.z1 - 0.9 && (r.used || []).every(u => Math.abs(px - u.x) > u.w / 2 + 0.7 || Math.abs(pz - u.z) > u.d / 2 + 0.7);
  const los = (r, x, z, tx, tz, skip) => {
    for (let i = 1; i < 14; i++) { const u = i / 14, px = x + (tx - x) * u, pz = z + (tz - z) * u; for (const q of (r.used || [])) { if (q === skip) continue; if (Math.abs(px - q.x) < q.w / 2 + 0.25 && Math.abs(pz - q.z) < q.d / 2 + 0.25) return false; } }
    return true;
  };
  /** a free spot on the roof ~dist from (tx,tz) with a clear line of sight, preferring to look along dirPref (radians in the xz plane) */
  const spotFor = (r, tx, tz, dist, dirPref) => {
    const own = (r.used || []).find(q => Math.abs(tx - q.x) < q.w / 2 && Math.abs(tz - q.z) < q.d / 2);
    let best = null, bs = -1e9;
    for (let a = 0; a < 24; a++) for (const d of [dist, dist * 0.8, dist * 1.25]) {
      const ang = a * Math.PI / 12; const x = tx - Math.cos(ang) * d, z = tz - Math.sin(ang) * d;
      if (!okSpot(r, x, z) || !los(r, x, z, tx, tz, own)) continue;
      const s = Math.cos(ang - dirPref) * 3 - Math.abs(d - dist) * 0.2;
      if (s > bs) { bs = s; best = [x, z, ang]; }
    }
    return best;
  };
  const stand = (x, z, target, note, fov = 40, eye = 1.7) => {
    const q = roofAt(x, z); if (!q) return;
    const [px, pz] = clear(q.r, x, z);
    V.push({ pos: [+px.toFixed(2), +(q.r.y + eye).toFixed(2), +pz.toFixed(2)], target: target.map(v => +v.toFixed(2)), fov, note, building: q.b.id });
  };
  // 1 — old-district roof garden at blue hour, looking over the roofs toward the core and the Lantern Tower
  {
    const g = out.gardens.find(q => q.hero);
    if (g && g.view) V.push({ pos: g.view.map(v => +v.toFixed(2)), target: [crown[0], 150, crown[2]], fov: 40, note: 'hero roof garden (pergola, festoon lights, planters) in the left foreground, the core skyline and the Lantern Tower beyond; best at blue hour', building: g.id });
  }
  // 2 — water tank close-up (nearest hi-detail tank to the canal in the old town)
  const tk = out.tanks.filter(t => !t.steel && t.x < 240 && t.x > -60).sort((a, b) => Math.hypot(a.x - 100, a.z - 110) - Math.hypot(b.x - 100, b.z - 110));
  for (const t of tk.slice(0, 12)) {
    const q = roofAt(t.x, t.z); const sp = spotFor(q.r, t.x, t.z, 13.5 * t.s, Math.atan2(153 - t.z, 668 - t.x) - 0.3);
    if (!sp || Math.cos(sp[2] - Math.atan2(153 - t.z, 668 - t.x)) < 0.5) continue;
    V.push({ pos: [+sp[0].toFixed(2), +(q.r.y + 1.6).toFixed(2), +sp[1].toFixed(2)], target: [+(t.x + 0.5).toFixed(2), +(t.y + t.h * 0.52).toFixed(2), +(t.z + 0.8).toFixed(2)], fov: 42, note: 'wooden water tank close-up (west face catches the low sun), Lantern Tower in the distance to its right', building: q.b.id });
    break;
  }
  if (tk[3]) { const t = tk[3]; stand(t.x + 9, t.z - 4, [t.x - 30, t.y + t.h * 0.5, t.z + 6], 'tank silhouetted against the western sky / bay (look west at sunset)', 35); }
  // 3 — canal-front roof looking up the canal to the tower
  {
    const bank = L.buildings.filter(b => out.roofs.has(b.id) && b.kind === 'building' && b.x1 < 340 && b.x0 > -130 && (Math.abs(b.z1 - 127) < 3 || Math.abs(b.z0 - 179) < 3)).sort((a, b) => a.x0 - b.x0);
    let n = 0, lastX = -1e9;
    for (const b of bank) {
      const r = out.roofs.get(b.id); const north = b.z1 < 153;
      const pz = north ? r.z1 - 1.3 : r.z0 + 1.3;
      for (const px of [r.x1 - 1.5, (r.x0 + r.x1) / 2, r.x0 + 1.5]) {
        if (!okSpot(r, px, pz) || px - lastX < 90) continue;
        const pos = [px, r.y + 1.7, pz];
        if (!sees(pos, crown)) continue;
        V.push({ pos: pos.map(v => +v.toFixed(2)), target: [crown[0], 150, crown[2]], fov: 30, note: (north ? 'north' : 'south') + ' canal-bank roof edge: the canal vista with the Lantern Tower as its end point (crown in clear view)', building: b.id });
        lastX = px; n++; break;
      }
      if (n >= 2) break;
    }
  }
  // 4 — behind a neon sign
  if (signs[0]) { const s = signs[0]; stand(s.x + 9.5, s.z - s.width * 0.35, [s.x - 1.5, s.y - 0.5, s.z + s.width * 0.25], `behind the "${s.text}" roof sign: scaffold and reversed neon letters against the bay`, 35); }
  // 5 — tower roofs around the crown
  stand(690, 84, crown, 'top of the tower north of the Lantern Tower: the crown side-lit at golden hour / glowing at blue hour (close, looking up)', 32);
  stand(620, 216, crown, 'tower roof south-west of the Lantern Tower: three-quarter view of the crown', 30);
  // 6 — high in the core looking west down the canal to the sunset
  stand(400, 100, [-300, 0, 153], 'high core roof looking west along the canal toward the bay and the setting sun, roofs and tanks of the old town below', 35);
  // 7 — steam
  for (const e of emitters) {
    const q = roofAt(e.x, e.z); if (!q) continue; const sp = spotFor(q.r, e.x, e.z, 11, Math.PI);
    if (!sp) continue;
    V.push({ pos: [+sp[0].toFixed(2), +(q.r.y + 1.7).toFixed(2), +sp[1].toFixed(2)], target: [+(e.x + 3).toFixed(2), +(e.y + 5).toFixed(2), +(e.z + 1).toFixed(2)], fov: 40, note: 'cooling towers venting steam on a core tower roof (plume drifts east; back-lit when the view is toward the west)', building: q.b.id });
    break;
  }
  V.length = Math.min(V.length, 10);
  for (const v of V) v.seesCrown = sees(v.pos, crown);
  return V;
}
