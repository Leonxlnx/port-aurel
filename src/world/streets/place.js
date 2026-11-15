// Deterministic placement of everything that stands on streets and sidewalks.
import { Scatter, rtools, WHITE } from './kit.js';
import { CURB_H, parkPathDist } from './plan.js';
import { SignBuilder, ICONS } from './signs.js';
import { CAR_TYPES, CAR_PAINTS, TAXI_PAINT } from './cars.js';

const SODIUM = [1.0, 0.56, 0.22], TUNG = [1.0, 0.70, 0.40], GLOBE = [1.0, 0.76, 0.48];
const SHOP_COLS = [[1.0, 0.72, 0.42], [1.0, 0.8, 0.55], [0.95, 0.85, 0.7], [1.0, 0.6, 0.3], [1.0, 0.76, 0.5], [0.7, 0.85, 1.0]];
const BOX_TINTS = [[0.45, 0.06, 0.05], [0.6, 0.45, 0.06], [0.06, 0.16, 0.4], [0.08, 0.3, 0.14], [0.5, 0.5, 0.48]];
const BIKE_TINTS = [[0.5, 0.06, 0.05], [0.05, 0.12, 0.3], [0.02, 0.02, 0.02], [0.4, 0.4, 0.4], [0.1, 0.3, 0.2], [0.55, 0.4, 0.08], [0.45, 0.2, 0.3]];
const CHAIR_TINTS = [[0.55, 0.55, 0.55], [0.3, 0.2, 0.12], [0.08, 0.2, 0.14], [0.45, 0.1, 0.08], [0.6, 0.55, 0.4]];
const SHADE_TINTS = [[0.75, 0.7, 0.58], [0.5, 0.1, 0.08], [0.1, 0.25, 0.2], [0.7, 0.45, 0.12], [0.12, 0.2, 0.38], [0.8, 0.78, 0.72]];
const HYDRANT_TINTS = [[0.5, 0.05, 0.04], [0.58, 0.42, 0.05], [0.45, 0.07, 0.05], [0.5, 0.05, 0.04]];
const BULB_WARM = [1.0, 0.72, 0.38];
const BULB_FEST = [[1.0, 0.72, 0.38], [1.0, 0.72, 0.38], [1.0, 0.45, 0.2], [1.0, 0.25, 0.18], [0.35, 0.8, 0.75], [1.0, 0.8, 0.3]];

export function populate(ctx, plan, NV) {
  const L = ctx.layout, G0 = ctx.GROUND_Y, SW = G0 + CURB_H;
  const R = ctx.rng('streets-place'); const { rr, pick, chance } = rtools(R);
  const sc = new Scatter();
  const names = [...plan.aves.map(a => ({ text: a.name, ave: true })), ...plan.sts.map(s => ({ text: s.name, ave: false }))];
  const signs = new SignBuilder(names);
  const trees = [], sprites = [], cables = [], signals = [];
  const stats = { lamps: 0, trees: 0, cars: 0, lights: 0 };
  const light = (x, z, y, color, intensity, radius) => { ctx.lights.add({ x, z, y, color, intensity, radius }); stats.lights++; };
  const hit = (list, s, m = 0) => list.some(iv => s > iv[0] - m && s < iv[1] + m);
  const inPlaza = (x, z) => plan.inRect(plan.PLAZA, x, z);

  // ---- helpers ------------------------------------------------------------------------------------
  function lampCobraAt(x, z, dx, dz) {
    sc.put('lampCobra', x, SW, z, Math.atan2(dx, dz), 1, WHITE, R());
    const bx = x + dx * 2.72, bz = z + dz * 2.72;
    light(bx, bz, SW + 9.1, SODIUM, 1.25, 13);
    sprites.push([bx, SW + 9.1, bz, 46, 25, 8.7, 0.34]); stats.lamps++;
  }
  function lampPostAt(x, z, y) {
    sc.put('lampPost', x, y, z, rr(0, 6.28), 1, WHITE, R());
    light(x, z, y + 3.96, TUNG, 0.85, 8.5);
    sprites.push([x, y + 3.96, z, 22, 15.2, 8.4, 0.42]); stats.lamps++;
  }
  function lampOrnateAt(x, z, y, ry) {
    sc.put('lampOrnate', x, y, z, ry, 1, WHITE, R());
    light(x, z, y + 4.3, GLOBE, 0.8, 10);
    const c = Math.cos(ry), s = Math.sin(ry);
    for (const sg of [-1, 1]) sprites.push([x + sg * 0.82 * c, y + 4.3, z - sg * 0.82 * s, 15, 11.4, 7.0, 0.4]);
    stats.lamps++;
  }
  function treeAt(x, z, y, scale, grate = true) {
    const autumn = R() < 0.1;
    trees.push({ x, y, z, s: scale * rr(0.9, 1.14), sy: rr(0.94, 1.12), ry: rr(0, 6.28), v: Math.floor(R() * NV),
      tint: autumn ? [rr(1.15, 1.3), rr(1.0, 1.08), rr(0.5, 0.65)] : [rr(0.84, 1.1), rr(0.9, 1.08), rr(0.7, 1.0)] });
    if (grate) sc.put('treeGrate', x, y, z, 0);
    stats.trees++;
  }
  function cafeSet(x, z, y, nChairs, tint) {
    sc.put('cafeTable', x, y, z, rr(0, 6.28));
    const a0 = rr(0, 6.28);
    for (let i = 0; i < nChairs; i++) {
      const a = a0 + i * (Math.PI * 2 / nChairs) + rr(-0.25, 0.25), d = rr(0.6, 0.72);
      sc.put('cafeChair', x + Math.cos(a) * d, y, z + Math.sin(a) * d, Math.atan2(-Math.cos(a), -Math.sin(a)) + rr(-0.3, 0.3), 1, tint);
    }
  }
  function parasol(x, z, y, tint, open = true) { sc.put(open ? 'parasolOpen' : 'parasolClosed', x, y, z, rr(0, 6.28), 1, tint); }
  const carWeights = CAR_TYPES.reduce((a, t) => a + t.weight, 0);
  function parkCar(x, z, hx, hz) {
    let r = R() * carWeights, t = CAR_TYPES[0];
    for (const c of CAR_TYPES) { r -= c.weight; if (r <= 0) { t = c; break; } }
    const tint = t.name === 'carTaxi' ? TAXI_PAINT : pick(CAR_PAINTS);
    const q = R(); const w = q < 0.03 ? 1.0 : (q < 0.09 ? 0.5 : 0.0);
    sc.put(t.name, x, G0, z, Math.atan2(-hz, hx) + rr(-0.03, 0.03), 1, tint, w);
    stats.cars++;
    return t;
  }
  function bikeRackAt(x, z, y, alongX, n) {
    // hoops in a row along the sidewalk, each hoop perpendicular to it
    for (let i = 0; i < n; i++) {
      const px = x + (alongX ? i * 0.85 : 0), pz = z + (alongX ? 0 : i * 0.85); const ry = alongX ? Math.PI / 2 : 0;
      sc.put('bikeRack', px, y, pz, ry);
      if (chance(0.65)) {
        const side = chance(0.5) ? 1 : -1;
        sc.put('bicycle', px + (alongX ? side * 0.14 : rr(-0.1, 0.1)), y, pz + (alongX ? rr(-0.1, 0.1) : side * 0.14), ry + (chance(0.5) ? Math.PI : 0), 1, pick(BIKE_TINTS), 0, side * rr(0.08, 0.16));
      }
    }
  }

  // span-wire pendant lamps over the narrow streets of the old town (instead of posts)
  const spanLit = new Set();
  for (const st of plan.sts) {
    if (st.wide || st.quay || st.perim) continue;
    for (let ci = 0; ci <= 2; ci++) {
      const c = L.cols[ci];
      const bn = plan.blockAt((c.x0 + c.x1) / 2, st.z0 - 2), bs = plan.blockAt((c.x0 + c.x1) / 2, st.z1 + 2);
      if (!bn || !bs || bn.kind !== 'built' || bs.kind !== 'built') continue;
      spanLit.add(st.id + ':' + ci);
      const n = Math.max(2, Math.round((c.x1 - c.x0) / 24));
      for (let k = 0; k < n; k++) {
        const x = c.x0 + (k + 0.5) * (c.x1 - c.x0) / n; const y = G0 + 7.4;
        cables.push({ a: [x, y, st.z0 + 0.25], b: [x, y, st.z1 - 0.25], sag: 0.4, bulbs: 0 });
        sc.put('lampPendant', x, y - 0.4, st.cz, 0, 1, WHITE, R());
        light(x, st.cz, y - 0.9, TUNG, 1.0, 9.5);
        sprites.push([x, y - 0.96, st.cz, 22, 15.2, 8.4, 0.3]); stats.lamps++;
      }
    }
  }

  // ---- block frontages -------------------------------------------------------------------------------
  const DENS = { core: 1, mid: 0.8, old: 0.9, quay: 0.9, east: 0.55 };
  const PARK_P = { core: 0.56, mid: 0.5, old: 0.62, quay: 0.52, east: 0.38 };
  const TREE_AVES = new Set([0, 4, 7, 10]);
  function furnish(f) {
    const st = f.st, sw = f.sw, isAve = f.type === 'ave';
    const P = (s, d) => (f.along === 'z' ? [f.c + f.nx * (sw - d), s] : [s, f.c + f.nz * (sw - d)]);
    const ox = f.nx, oz = f.nz;
    const faceOut = Math.atan2(ox, oz), faceIn = Math.atan2(-ox, -oz);
    const hx = st.oneWay ? st.oneWay : -f.nz, hz = st.oneWay ? 0 : f.nx;          // travel direction of the adjacent lane
    const s0 = f.a0 + 6.5, s1 = f.a1 - 6.5; if (s1 - s0 < 6) return;
    const occ = [], noPark = [];
    const built = f.block.kind === 'built';
    const big = isAve || st.wide;
    const dens = (DENS[f.district] || 0.7) * (big ? 1 : 0.6) * (built ? 1 : 0.5);
    // lamps
    if (big || !spanLit.has(st.id + ':' + f.block.col)) {
      const pitch = big ? 30 : 21; const phase = (f.side === 'W' || f.side === 'N') ? 0.2 : 0.7;
      for (let k = Math.ceil(s0 / pitch - phase); ; k++) {
        const s = (k + phase) * pitch; if (s > s1) break; if (s < s0) continue;
        const [x, z] = P(s, big ? 0.55 : 0.6);
        if (big) lampCobraAt(x, z, ox, oz); else lampPostAt(x, z, SW);
        occ.push([s - 1.4, s + 1.4]);
      }
    }
    // bus stop
    if (isAve && !st.tram && !st.perim && built && f.a1 - f.a0 > 55 && ((f.block.col * 3 + (f.block.row + 20) * 5 + (f.side === 'E' ? 1 : 0)) % 4 === 0)) {
      let s = (f.a0 + f.a1) / 2 + 2; if (hit(occ, s, 3.6)) s += 6.5;
      const [x, z] = P(s, 1.45); const ry = faceOut, c = Math.cos(ry), sn = Math.sin(ry);
      sc.put('shelter', x, SW, z, ry);
      const W = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
      const adI = Math.floor(R() * 4);
      { const [ax, az] = W(2.05 + 0.086, -0.08); signs.ad(ax, SW + 1.2, az, ry + Math.PI / 2, adI); }
      { const [ax, az] = W(2.05 - 0.086, -0.08); signs.ad(ax, SW + 1.2, az, ry - Math.PI / 2, (adI + 1) % 4); }
      light(x, z, SW + 2.4, [1.0, 0.9, 0.75], 0.5, 6);
      const [px, pz] = P(s - 3.4 * (hx + hz), 0.45);
      signs.pole(px, pz, SW, SW + 2.9); signs.sign(px, SW + 2.6, pz, Math.atan2(-hx, -hz), ICONS.bus, 0.5);
      occ.push([s - 3.6, s + 3.6]); noPark.push([s - 9, s + 9]);
    }
    // trees
    const hasTrees = !st.tram && !st.perim && ((isAve && (st.wide || TREE_AVES.has(st.idx))) || (!isAve && st.wide));
    if (hasTrees) {
      const pitch = 12, phase = (f.side === 'W' || f.side === 'N') ? 0.5 : 0.0;
      for (let k = Math.ceil(s0 / pitch - phase); ; k++) {
        const s = (k + phase) * pitch; if (s > s1 - 1) break; if (s < s0 + 1 || hit(occ, s, 2.0)) continue;
        const [x, z] = P(s, 1.05); treeAt(x, z, SW, st.wide ? 1.0 : 0.9); occ.push([s - 1.3, s + 1.3]);
      }
    }
    // hydrant
    if (chance(0.5)) {
      const s = rr(s0 + 2, s1 - 2);
      if (!hit(occ, s, 0.9)) { const [x, z] = P(s, 0.55); sc.put('hydrant', x, SW, z, faceOut, 1, pick(HYDRANT_TINTS)); occ.push([s - 0.8, s + 0.8]); noPark.push([s - 3.3, s + 3.3]); }
    }
    // small furniture
    for (let s = s0 + rr(0, 2); s < s1; s += 3.4) {
      if (hit(occ, s, 1.0)) continue;
      let r = R() / dens;
      const take = p => { if (r < p) { r = 99; return true; } r -= p; return false; };
      if (take(0.07)) { const [x, z] = P(s, 0.95); sc.put('bench', x, SW, z, chance(0.8) ? faceIn : faceOut); }
      else if (take(0.045)) { const [x, z] = P(s, 0.6); sc.put('bin', x, SW, z, rr(0, 6.28)); }
      else if (take(0.022)) { const n = 3 + Math.floor(R() * 3); const [x, z] = P(s - 1.2, 1.0); bikeRackAt(x, z, SW, f.along === 'x', n); }
      else if (take(0.02)) { const n = 1 + Math.floor(R() * 3); for (let i = 0; i < n; i++) { const [x, z] = P(s + i * 0.5, 0.5); sc.put('newsbox', x, SW, z, faceIn + rr(-0.05, 0.05), 1, pick(BOX_TINTS)); } }
      else if (take(0.012)) { const [x, z] = P(s, 0.62); sc.put('mailbox', x, SW, z, faceIn, 1, [0.05, 0.12, 0.32]); }
      else if (take(0.045) && sw > 3.6) { const [x, z] = P(s, 0.9); sc.put('planter', x, SW, z, 0); }
      else if (take(0.02) && built) { const [x, z] = P(s, sw - 0.42); sc.put('utilityBox', x, SW, z, faceOut + (f.along === 'x' ? 0 : 0)); }
      else if (take(0.012)) { const [x, z] = P(s, 0.6); sc.put('phonePost', x, SW, z, faceIn, 1, [0.08, 0.2, 0.45]); }
      else if (take(0.035)) { const [x, z] = P(s, 0.42); signs.pole(x, z, SW, SW + 2.75); signs.sign(x, SW + 2.45, z, Math.atan2(-hx, -hz), chance(0.6) ? ICONS.noPark : ICONS.speed, 0.5); }
    }
    for (const s of [f.a0 + 4.6, f.a1 - 4.6]) if (chance(0.18 * Math.min(1, dens * 1.4))) { const [x, z] = P(s, 0.65); sc.put('bin', x, SW, z, rr(0, 6.28)); }
    // parked cars
    if (st.parkW > 0) {
      const p = (PARK_P[f.district] || 0.5) * (f.type === 'blvd' ? 0.7 : 1);
      for (let k = 2; ; k++) {
        const s = f.a0 + k * 5.8; if (s > f.a1 - 9.5) break; if (s < f.a0 + 9.5) continue;
        if (hit(noPark, s, 2.4) || !chance(p)) continue;
        const [x, z] = P(s + rr(-0.3, 0.3), -(0.3 + 0.9 + rr(0, 0.12)));
        parkCar(x, z, hx, hz);
      }
    }
    shopLights(f, big);
  }
  function shopLights(f, major) {
    if (f.block.kind !== 'built') return;
    for (const id of f.block.lots) {
      const b = L.buildings[id]; if (!b || !b.shop || !b.open[f.side.toLowerCase()]) continue;
      if (!major && !chance(0.35)) continue;
      const lo = f.along === 'z' ? b.z0 : b.x0, hi = f.along === 'z' ? b.z1 : b.x1; const n = Math.max(1, Math.round((hi - lo) / 11));
      const col = pick(SHOP_COLS); const inten = rr(0.28, 0.5) * (major ? 1 : 0.7);
      for (let i = 0; i < n; i++) {
        const s = lo + (i + 0.5) * (hi - lo) / n;
        const x = f.along === 'z' ? f.c + f.nx * 1.7 : s, z = f.along === 'z' ? s : f.c + f.nz * 1.7;
        light(x, z, G0 + 3.2, col, inten, rr(8, 11));
      }
    }
  }
  for (const f of plan.frontages) {
    if (f.type === 'ave' || f.type === 'st' || f.type === 'blvd') furnish(f);
    else shopLights(f, true);
  }

  // ---- intersections ---------------------------------------------------------------------------------
  for (const it of plan.inters) {
    const { av, st } = it;
    const hasN = st.rz0 > st.z0 + 0.1, hasS = st.rz1 < st.z1 - 0.1;
    const corner = (ew, ns, inX = 1.25, inZ = 1.25) => {
      // ew: -1 west / +1 east sidewalk of the avenue; ns: -1 north / +1 south sidewalk of the street
      const x = ew < 0 ? av.x0 + av.sw - inX : av.x1 - av.sw + inX;
      const z = ns < 0 ? st.z0 + st.sw - inZ : st.z1 - st.sw + inZ;
      return [x, z];
    };
    // street-name blades
    {
      const ns = hasN ? -1 : 1; const [x, z] = corner(1, ns, 0.75, 2.2);
      signs.pole(x, z, SW, SW + 3.25);
      signs.blade(x, SW + 3.12, z, Math.PI / 2, av.name);       // blade plane along Z (reads from east/west)
      signs.blade(x, SW + 2.88, z, 0, st.name);
      if (st.oneWay && !it.quay) signs.sign(x, SW + 2.5, z, 0, st.oneWay > 0 ? ICONS.arrowR : ICONS.arrowL, 0.62, st.oneWay > 0 ? ICONS.arrowL : ICONS.arrowR, 0.62);
    }
    if (it.quay) continue;
    const phase = R();
    if (it.signal && hasN && hasS) {
      signals.push({ x: av.cx, z: st.cz, phase, ave: av.id, street: st.id });
      { const [x, z] = corner(1, 1); sc.put('signalMast', x, SW, z, 0, 1, WHITE, phase); }               // northbound, SE corner
      { const [x, z] = corner(-1, -1); sc.put('signalMast', x, SW, z, Math.PI, 1, WHITE, phase); }        // southbound, NW corner
      if (st.oneWay >= 0) { const [x, z] = corner(-1, 1); sc.put('signalPost', x, SW, z, -Math.PI / 2, 1, WHITE, phase + 0.5); }   // eastbound, SW corner
      if (st.oneWay <= 0) { const [x, z] = corner(1, -1); sc.put('signalPost', x, SW, z, Math.PI / 2, 1, WHITE, phase + 0.5); }    // westbound, NE corner
    } else {
      // stop signs for the side street
      if (st.oneWay >= 0 && hasS) { const [x, z] = corner(-1, 1, 0.9, 0.9); signs.pole(x, z, SW, SW + 2.6); signs.sign(x, SW + 2.3, z, -Math.PI / 2, ICONS.stop, 0.62); }
      if (st.oneWay <= 0 && hasN) { const [x, z] = corner(1, -1, 0.9, 0.9); signs.pole(x, z, SW, SW + 2.6); signs.sign(x, SW + 2.3, z, Math.PI / 2, ICONS.stop, 0.62); }
    }
  }

  // ---- promenade -------------------------------------------------------------------------------------
  {
    const QX = plan.QX, PR = plan.PROM;
    const blocked = z => (z > L.canal.z0 - 10 && z < L.canal.z1 + 10) || L.harbor.jetties.some(j => z > j.z0 - 3 && z < j.z1 + 3) || (z > L.harbor.pier.z0 - 4 && z < L.harbor.pier.z1 + 4);
    const inStreet = z => plan.sts.some(s => !s.quay && z > s.rz0 - 1.5 && z < s.rz1 + 1.5);
    let k = 0;
    for (let z = PR.z0 + 8; z < PR.z1 - 8; z += 18, k++) {
      if (!blocked(z)) lampOrnateAt(QX + 3.3, z, G0, Math.PI / 2);
      for (const off of [5.5, 12.5]) {
        const zb = z + off; if (blocked(zb) || !chance(0.72)) continue;
        sc.put('bench', QX + 4.0, G0, zb, -Math.PI / 2);
      }
      if (!blocked(z + 9) && chance(0.5)) sc.put('bin', QX + 3.6, G0, z + 9, 0);
    }
    for (let z = PR.z0 + 10; z < PR.z1 - 10; z += 12) {
      if (z > L.canal.z0 - 12 && z < L.canal.z1 + 12) continue;
      if (inStreet(z)) continue;
      treeAt(QX + 13.2, z, G0, 1.05);
    }
    // bollards across the street mouths, a few bike racks beside them
    for (const s of plan.sts) {
      if (s.quay) continue;
      for (let z = s.rz0 + 0.6; z <= s.rz1 - 0.5; z += 1.75) sc.put('bollard', PR.x1 - 0.7, G0, z, 0);
      if (chance(0.4)) bikeRackAt(PR.x1 - 6.5, s.z0 - 5.5, G0, false, 4);
    }
    // café terraces in front of the quay-side shops
    for (const f of plan.frontages) {
      if (f.type !== 'prom' || f.block.kind !== 'built') continue;
      for (const id of f.block.lots) {
        const b = L.buildings[id]; if (!b || !b.shop || !b.open.w || !chance(0.6)) continue;
        const z0 = b.z0 + 2.2, z1 = Math.min(b.z1 - 2.2, b.z0 + 17);
        const chair = pick(CHAIR_TINTS), shade = pick(SHADE_TINTS); const open = chance(0.7);
        let i = 0;
        for (let z = z0 + 0.8; z < z1 - 0.5; z += 2.5, i++) {
          for (const x of [PR.x1 - 2.6, PR.x1 - 5.2]) {
            cafeSet(x + rr(-0.15, 0.15), z + rr(-0.15, 0.15), G0, chance(0.6) ? 2 : 3, chair);
            if ((i + (x < PR.x1 - 4 ? 1 : 0)) % 2 === 0) parasol(x + 0.05, z + 1.22, G0, shade, open || chance(0.2));
          }
        }
        sc.put('planter', PR.x1 - 3.9, G0, z0 - 0.6, 0); sc.put('planter', PR.x1 - 3.9, G0, z1 + 0.6, 0);
        sc.put('planter', PR.x1 - 6.9, G0, z0 - 0.6, 0); sc.put('planter', PR.x1 - 6.9, G0, z1 + 0.6, 0);
      }
    }
  }

  // ---- canal quays -----------------------------------------------------------------------------------
  for (const bank of ['N', 'S']) {
    const st = plan.sts.find(s => s.quay === bank);
    const tw = bank === 'N' ? 1 : -1;                       // direction toward the water
    const zW = bank === 'N' ? st.z1 - 1.9 : st.z0 + 1.9;
    const zB = bank === 'N' ? st.rz0 + 0.8 : st.rz1 - 0.8;
    const fr = plan.frontages.filter(f => f.type === 'quay' && f.st === st);
    const shopAt = x => fr.some(f => f.block.lots.some(id => { const b = L.buildings[id]; return b && b.shop && x > b.x0 && x < b.x1 && b.open[bank === 'N' ? 's' : 'n']; }));
    for (const c of L.cols) {
      const x0 = c.x0, x1 = Math.min(c.x1, plan.PLAZA.x0); if (x1 - x0 < 24) continue;
      const n = Math.floor((x1 - x0 - 9) / 16), pad = (x1 - x0 - n * 16) / 2;
      const shade = pick(SHADE_TINTS), chair = pick(CHAIR_TINTS);
      for (let k = 0; k <= n; k++) {
        const x = x0 + pad + k * 16;
        lampOrnateAt(x, zW, G0, 0);
        if (k === n) break;
        treeAt(x + 8, zW, G0, 0.88);
        sc.put('festoonPole', x + 8, G0, zB, 0);
        cables.push({ a: [x, G0 + 4.72, zW], b: [x + 8, G0 + 5.36, zB], sag: 0.7, bulbs: 1 });
        cables.push({ a: [x + 8, G0 + 5.36, zB], b: [x + 16, G0 + 4.72, zW], sag: 0.7, bulbs: 1 });
        light(x + 4, (zW + zB) / 2, G0 + 4.3, BULB_WARM, 0.28, 7.5); light(x + 12, (zW + zB) / 2, G0 + 4.3, BULB_WARM, 0.28, 7.5);
        for (const off of [4, 12]) {
          const xm = x + off, r = R();
          if (r < 0.45 && shopAt(xm)) {
            cafeSet(xm - 1.25, zW - tw * 0.35, G0, 2, chair); cafeSet(xm + 1.25, zW - tw * 0.35, G0, 2, chair);
            parasol(xm, zW - tw * 1.5, G0, shade, chance(0.75));
          } else if (r < 0.8) sc.put('bench', xm, G0, zW - tw * 0.2, tw > 0 ? 0 : Math.PI);
          else if (r < 0.9) sc.put('planter', xm, G0, zW, 0);
        }
      }
      for (const xe of [x0 + 0.9, x1 - 0.9]) for (let z = st.rz0 + 1.3; z < st.rz1 - 2.6; z += 1.9) sc.put('bollard', xe, G0, z, 0);
    }
  }

  // ---- plaza around the basin and the tower ----------------------------------------------------------------
  {
    const PZ = plan.PLAZA, Bn = L.basin, T = L.lantern;
    // lamps and benches around the basin
    const ring = { x0: Bn.x0 - 5, x1: Bn.x1 + 5, z0: Bn.z0 - 5, z1: Bn.z1 + 5 };
    const per = [];
    for (let x = ring.x0 + 5; x <= ring.x1 - 5; x += 16) { per.push([x, ring.z0, 0, 1]); per.push([x, ring.z1, 0, -1]); }
    for (let z = ring.z0; z <= ring.z1 + 0.1; z += (ring.z1 - ring.z0) / 6) { per.push([ring.x1, z, -1, 0]); if (z < L.canal.z0 - 6 || z > L.canal.z1 + 6) per.push([ring.x0, z, 1, 0]); }
    for (const p of per) {
      lampOrnateAt(p[0], p[1], G0, p[2] ? Math.PI / 2 : 0);
      if (chance(0.7)) { const bx = p[0] + (p[2] ? 0 : 8) + p[2] * 1.4, bz = p[1] + (p[3] ? 0 : 6.5) + p[3] * 1.4; if (!L.isWater(bx + p[2] * 2, bz + p[3] * 2) && inPlaza(bx, bz)) sc.put('bench', bx, G0, bz, Math.atan2(p[2], p[3])); }
    }
    // trees along the north and south edges
    const aveGap = x => plan.aves.some(a => x > a.x0 - 2.5 && x < a.x1 + 2.5);
    for (let x = PZ.x0 + 5; x < PZ.x1 - 3; x += 11) { if (aveGap(x)) continue; treeAt(x, PZ.z0 + 3.6, G0, 1.0); treeAt(x, PZ.z1 - 3.6, G0, 1.0); }
    // grove east of the tower
    for (let x = T.x + T.w / 2 + 9; x < PZ.x1 - 4; x += 10.5) for (let z = PZ.z0 + 14; z < PZ.z1 - 12; z += 10.5) {
      if (Math.abs(z - T.z) < 9) continue;
      treeAt(x, z, G0, 1.05);
    }
    // lamps and planters flanking the axis between basin and tower
    const px = (L.plaza.x0 + L.plaza.x1) / 2;
    for (const dz of [-37, -22, 22, 37]) lampOrnateAt(px, T.z + dz, G0, Math.PI / 2);
    for (const dz of [-30, -14, 14, 30]) { sc.put('planter', L.plaza.x0 + 3, G0, T.z + dz, 0); sc.put('planter', L.plaza.x1 - 2, G0, T.z + dz, 0); }
    for (const dz of [-9, 9]) { sc.put('bench', px, G0, T.z + dz * 1.0, dz < 0 ? 0 : Math.PI); }
    // bollards where the avenues end at the plaza
    for (const a of plan.aves) {
      if (a.cx < PZ.x0 || a.cx > PZ.x1) continue;
      for (let x = a.x0 + 0.8; x <= a.x1 - 0.7; x += 1.8) { sc.put('bollard', x, G0, PZ.z0 + 0.6, 0); sc.put('bollard', x, G0, PZ.z1 - 0.6, 0); }
    }
    // soft uplight pools at the foot of the tower
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [-1, 0], [1, 0]]) light(T.x + dx * (T.w / 2 + 4), T.z + dz * (T.d / 2 + 4), G0 + 3, [1.0, 0.82, 0.58], 0.5, 12);
  }

  // ---- boulevard median east of the tower -----------------------------------------------------------------
  for (const c of L.cols) {
    if (c.x0 < plan.PLAZA.x1 - 1) continue;
    const M = plan.MED; let k = 0;
    for (let x = c.x0 + 5; x <= c.x1 - 5; x += 11) { treeAt(x, M.z0 + 4.6, SW, 1.25, false); treeAt(x + 5.5 > c.x1 - 4 ? x : x + 5.5, M.z1 - 4.6, SW, 1.25, false); }
    for (let x = c.x0 + 8; x <= c.x1 - 8; x += 17, k++) {
      lampOrnateAt(x, k % 2 ? M.p0 - 1.7 : M.p1 + 1.7, SW, 0);
      const bz = k % 2 ? M.p1 + 1.2 : M.p0 - 1.2;
      if (chance(0.75)) sc.put('bench', x + 1.5, SW, bz, k % 2 ? Math.PI : 0);
      if (chance(0.35)) sc.put('bin', x + 3.4, SW, bz, 0);
    }
  }

  // ---- parks ---------------------------------------------------------------------------------------------
  for (const b of plan.blocks) {
    if (b.kind !== 'park') continue;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, hx = (b.x1 - b.x0) / 2, hz = (b.z1 - b.z0) / 2;
    const pd = (x, z) => {
      const lx = x - cx, lz = z - cz;
      const d = b.pocket ? Math.min(Math.max(Math.abs(lx) - 1.2, Math.abs(lz) - hz), Math.max(Math.abs(lz) - 1.2, Math.abs(lx) - hx)) : parkPathDist(lx, lz, hx, hz);
      return Math.min(d, Math.min(hx - Math.abs(lx), hz - Math.abs(lz)) - 0.5);
    };
    const things = [];
    const far = (x, z, d) => things.every(p => Math.hypot(p[0] - x, p[1] - z) > d);
    // lamps and benches along the paths
    for (let x = b.x0 + 2; x < b.x1 - 2; x += 2.6) for (let z = b.z0 + 2; z < b.z1 - 2; z += 2.6) {
      const d = pd(x, z);
      if (d > 1.0 && d < 2.0 && far(x, z, b.pocket ? 13 : 17) && chance(0.5)) { lampPostAt(x, z, SW); things.push([x, z]); }
    }
    const benches = [];
    for (let x = b.x0 + 2.5; x < b.x1 - 2.5; x += 2.1) for (let z = b.z0 + 2.5; z < b.z1 - 2.5; z += 2.1) {
      const d = pd(x, z);
      if (d > 0.55 && d < 1.15 && far(x, z, 3) && benches.every(p => Math.hypot(p[0] - x, p[1] - z) > 10) && chance(0.35)) {
        const gx = pd(x + 0.3, z) - pd(x - 0.3, z), gz = pd(x, z + 0.3) - pd(x, z - 0.3);
        sc.put('bench', x, SW, z, Math.atan2(-gx, -gz)); benches.push([x, z]); things.push([x, z]);
        if (chance(0.3)) sc.put('bin', x + (Math.abs(gz) > Math.abs(gx) ? 1.6 : 0), SW, z + (Math.abs(gz) > Math.abs(gx) ? 0 : 1.6), 0);
      }
    }
    // trees
    const want = Math.round((hx * hz * 4) / 62); let placed = 0;
    for (let t = 0; t < want * 14 && placed < want; t++) {
      const x = rr(b.x0 + 3.5, b.x1 - 3.5), z = rr(b.z0 + 3.5, b.z1 - 3.5);
      if (pd(x, z) < 1.7 || !far(x, z, 5.6)) continue;
      treeAt(x, z, SW, rr(1.15, 1.65), false); things.push([x, z]); placed++;
    }
  }

  // ---- market square -------------------------------------------------------------------------------------
  {
    const q = plan.blocks.find(b => b.kind === 'square');
    if (q) {
      const cx = (q.x0 + q.x1) / 2, cz = (q.z0 + q.z1) / 2;
      const fx = cx - 3, fz = cz - 3;
      sc.put('fountain', fx, SW, fz, 0);
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + 0.5; sc.put('bench', fx + Math.cos(a) * 6.6, SW, fz + Math.sin(a) * 6.6, Math.atan2(-Math.cos(a), -Math.sin(a))); }
      sc.put('kiosk', q.x0 + 9, SW, q.z1 - 9, 0);
      light(q.x0 + 9, q.z1 - 9, SW + 2.2, [1.0, 0.85, 0.6], 0.9, 8);
      const tints = [[0.5, 0.1, 0.08], [0.1, 0.24, 0.42], [0.7, 0.5, 0.1], [0.12, 0.36, 0.22]];
      let i = 0;
      for (let x = q.x0 + 13; x < q.x1 - 16; x += 4.4, i++) {
        sc.put('stall', x, SW, q.z0 + 9, 0, 1, tints[i % 4]);
        if (x > q.x0 + 20) sc.put('stall', x, SW, q.z1 - 8.5, Math.PI, 1, tints[(i + 2) % 4]);
      }
      // festoon grid
      const rowsZ = [q.z0 + 4.5, cz + 8.5, q.z1 - 4.5]; const xs = [];
      for (let x = q.x0 + 5; x <= q.x1 - 13; x += 12.5) xs.push(x);
      const top = SW + 5.38;
      rowsZ.forEach((z, r) => xs.forEach((x, k) => sc.put('festoonPole', x + (r === 1 ? 6.25 : 0), SW, z, 0)));
      for (let k = 0; k < xs.length; k++) {
        const mx = xs[k] + 6.25;
        for (const r of [0, 2]) {
          cables.push({ a: [xs[k], top, rowsZ[r]], b: [mx, top, rowsZ[1]], sag: 1.15, bulbs: 2 });
          if (k + 1 < xs.length) cables.push({ a: [xs[k + 1], top, rowsZ[r]], b: [mx, top, rowsZ[1]], sag: 1.15, bulbs: 2 });
        }
        light(mx, (rowsZ[0] + rowsZ[1]) / 2, SW + 4, BULB_WARM, 0.5, 11); light(mx, (rowsZ[2] + rowsZ[1]) / 2, SW + 4, BULB_WARM, 0.5, 11);
      }
      for (let z = q.z0 + 6; z < q.z1 - 4; z += 10) treeAt(q.x0 + 3.2, z, SW, 0.95);
      for (const [x, z] of [[q.x0 + 7, q.z0 + 7.5], [q.x1 - 12, q.z0 + 7.5], [q.x1 - 12, q.z1 - 7.5], [q.x0 + 20, q.z1 - 4]]) lampOrnateAt(x, z, SW, 0);
      for (let k = 0; k < 4; k++) cafeSet(q.x0 + 12.5 + k * 2.4, q.z1 - 13.5 + (k % 2) * 1.6, SW, 3, CHAIR_TINTS[1]);
    }
  }

  return { sc, signs, trees, sprites, cables, signals, stats, BULB_WARM, BULB_FEST };
}
