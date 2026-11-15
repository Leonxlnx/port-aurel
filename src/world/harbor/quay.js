// Quay walls, coping, steps, ladders, rings, drains, fenders, railings, bollards, chains, life-ring stands.
import * as THREE from 'three';
import { Bucket, box, cyl, sphere, torus, lathe, M, beam, tubeGeo, catenary, prismGeo, quadGeo } from './geo.js';

export const COL = {
  granite: [0.31, 0.295, 0.27], coping: [0.43, 0.41, 0.37], tread: [0.40, 0.385, 0.35], lime: [0.47, 0.42, 0.34], limeLight: [0.56, 0.51, 0.42],
  ironGreen: [0.030, 0.050, 0.040], ironBlack: [0.022, 0.022, 0.024], rustSteel: [0.10, 0.07, 0.05], galv: [0.55, 0.56, 0.57],
  deck: [0.40, 0.35, 0.28], tar: [0.12, 0.092, 0.07], pale: [0.60, 0.56, 0.48], hemp: [0.55, 0.45, 0.30], rubber: [0.035, 0.035, 0.037],
  lamp: [1.0, 0.60, 0.26],
};
const V3 = THREE.Vector3;

export function mkWall(id, ax, az, bx, bz, nx, nz) {
  const len = Math.hypot(bx - ax, bz - az);
  return { id, a: [ax, az], b: [bx, bz], d: [(bx - ax) / len, (bz - az) / len], n: [nx, nz], len, blocked: [], railGaps: [], copingGaps: [] };
}
export function wpt(w, t, o = 0) { return [w.a[0] + w.d[0] * t + w.n[0] * o, w.a[1] + w.d[1] * t + w.n[1] * o]; }
/** wall-local frame: X = along (t), Y = up, Z = outward (toward the water) */
export function wm(w, t, y = 0, o = 0) {
  const p = wpt(w, t, o);
  return new THREE.Matrix4().makeBasis(new V3(w.d[0], 0, w.d[1]), new V3(0, 1, 0), new V3(w.n[0], 0, w.n[1])).setPosition(p[0], y, p[1]);
}
/** box given by local ranges */
export function lb(H, w, mat, t0, t1, y0, y1, o0, o1, color, kind = 0, param = 0) {
  const m = wm(w, (t0 + t1) / 2, (y0 + y1) / 2, (o0 + o1) / 2).multiply(new THREE.Matrix4().makeScale(Math.abs(t1 - t0), y1 - y0, o1 - o0));
  H.B.add(mat, box(), m, color, kind, param);
}
export function isBlocked(w, t0, t1, margin = 0) { return w.blocked.some(g => t0 < g[1] + margin && t1 > g[0] - margin); }
export function freeRuns(len, gaps, t0 = 0, t1 = len) {
  const g = gaps.map(x => [Math.max(t0, x[0]), Math.min(t1, x[1])]).filter(x => x[1] > x[0]).sort((a, b) => a[0] - b[0]);
  const out = []; let c = t0;
  for (const x of g) { if (x[0] > c + 0.01) out.push([c, x[0]]); c = Math.max(c, x[1]); }
  if (t1 > c + 0.01) out.push([c, t1]);
  return out;
}

// ---------------------------------------------------------------------------------------------------- railing panel
export function railPanelGeo() {
  const b = new Bucket(); const c = COL.ironGreen;
  const LEN = 2.0, NB = 15, bay = LEN / NB;
  b.add(box(), M(0, 0.56, 0, 0.085, 1.12, 0.085), c);                          // post
  b.add(box(), M(0, 0.05, 0, 0.16, 0.10, 0.16), c);                            // base
  b.add(box(), M(0, 1.13, 0, 0.12, 0.03, 0.12), c);
  b.add(sphere(6, 4), M(0, 1.2, 0, 0.062, 0.062, 0.062), c);                   // finial
  b.add(cyl(5, 1, true), M(LEN / 2, 1.05, 0, 0.033, LEN, 0.033, 0, 0, Math.PI / 2), c);     // top rail
  b.add(box(), M(LEN / 2, 0.88, 0, LEN, 0.04, 0.022), c);
  b.add(box(), M(LEN / 2, 0.13, 0, LEN, 0.045, 0.022), c);
  for (let i = 1; i < NB; i++) b.add(cyl(4, 1, true), M(i * bay, 0.505, 0, 0.011, 0.75, 0.011, 0, Math.PI / 4, 0), c);
  const ring = new THREE.RingGeometry(0.046, 0.07, 7, 1);
  for (let i = 0; i < 7; i++) {
    const x = bay * (2 * i + 1.5);
    b.add(ring, M(x, 0.965, 0.006), c); b.add(ring, M(x, 0.965, -0.006, 1, 1, 1, 0, Math.PI, 0), c);
  }
  return b.build();
}
/** railing between two points (xz) with base heights ya, yb (pickets stay vertical) */
export function railLine(H, ax, az, bx, bz, ya, yb = ya, endPosts = true) {
  const L = Math.hypot(bx - ax, bz - az); if (L < 0.5) return;
  const n = Math.max(1, Math.round(L / 2)), seg = L / n;
  const dx = (bx - ax) / L, dz = (bz - az) / L, dy = (yb - ya) / L;
  for (let i = 0; i < n; i++) {
    const s = i * seg;
    const m = new THREE.Matrix4().makeBasis(new V3(dx * seg / 2, dy * seg / 2, dz * seg / 2), new V3(0, 1, 0), new V3(-dz, 0, dx));
    m.setPosition(ax + dx * s, ya + dy * s, az + dz * s);
    H.rails.push(m);
  }
  if (endPosts) railPost(H, bx, yb, bz);
}
export function railPost(H, x, y, z) {
  const c = COL.ironGreen, B = H.B;
  B.add('iron', box(), M(x, y + 0.56, z, 0.085, 1.12, 0.085), c);
  B.add('iron', box(), M(x, y + 0.05, z, 0.16, 0.10, 0.16), c);
  B.add('iron', sphere(6, 4), M(x, y + 1.2, z, 0.062, 0.062, 0.062), c);
}

const BOLLARD = [[0.27, 0], [0.27, 0.05], [0.19, 0.10], [0.155, 0.22], [0.15, 0.40], [0.17, 0.47], [0.255, 0.53], [0.275, 0.58], [0.24, 0.63], [0.12, 0.665], [0.001, 0.67]];
export function bollard(H, x, y, z, s = 1, col = COL.ironBlack) {
  H.stats.nBollard = (H.stats.nBollard || 0) + 1;
  H.B.add('iron', lathe('bollard', BOLLARD, 18), M(x, y, z, s, s, s), col);
  H.moor.push([x, y + 0.36 * s, z]);
}
export function cleat(H, x, y, z, ry = 0, s = 1) {
  const B = H.B, c = COL.galv;
  B.add('iron', box(), M(x, y + 0.035 * s, z, 0.07 * s, 0.07 * s, 0.07 * s, 0, ry, 0), c, 3);
  B.add('iron', cyl(6), M(x, y + 0.085 * s, z, 0.022 * s, 0.34 * s, 0.022 * s, 0, ry, Math.PI / 2), c, 3);
  H.moor.push([x, y + 0.08 * s, z]);
}
export function ladder(H, w, t, yTop, yBot = -1.3) {
  const B = H.B, c = COL.rustSteel, o = 0.24;
  for (const s of [-0.21, 0.21]) {
    const pts = [[t + s, yBot, o], [t + s, yTop + 0.75, o], [t + s, yTop + 0.95, o - 0.12], [t + s, yTop + 0.95, o - 0.5], [t + s, yTop + 0.02, o - 0.62]];
    B.add('iron', tubeGeo(pts, 0.021, 5), wm(w, 0, 0, 0), c, 2);
    B.add('iron', cyl(4), wm(w, t + s, yTop - 0.9, o / 2 + 0.02).multiply(M(0, 0, 0, 0.018, o, 0.018, Math.PI / 2, 0, 0)), c, 2);
    B.add('iron', cyl(4), wm(w, t + s, 0.5, o / 2 + 0.02).multiply(M(0, 0, 0, 0.018, o, 0.018, Math.PI / 2, 0, 0)), c, 2);
  }
  for (let y = yBot + 0.2; y < yTop + 0.1; y += 0.3) B.add('iron', cyl(4, 1, true), wm(w, t, y, o).multiply(M(0, 0, 0, 0.015, 0.42, 0.015, 0, 0, Math.PI / 2)), c, 2);
}
export function mooringRing(H, w, t, y = 1.55) {
  const B = H.B, c = COL.rustSteel;
  B.add('iron', torus(0.13, 0.022, 5, 10), wm(w, t, y - 0.13, 0.035), c, 2);
  B.add('iron', box(), wm(w, t, y + 0.01, 0.03).multiply(M(0, 0, 0, 0.07, 0.07, 0.07)), c, 2);
  const p = wpt(w, t, 0.05); H.moor.push([p[0], y - 0.1, p[1]]);
}
export function lifeRing(H, x, y, z, ry) {
  const B = H.B;
  const R = M(x, y, z, 1, 1, 1, 0, ry, 0);
  const at = (...a) => R.clone().multiply(M(...a));
  B.add('iron', box(), at(0, 0.8, 0, 0.09, 1.6, 0.09), [0.75, 0.74, 0.7], 0);
  B.add('timber', box(), at(0, 1.25, 0.07, 0.8, 0.8, 0.04), [0.62, 0.6, 0.54], 2, 1);
  B.add('timber', box(), at(0, 1.68, 0.09, 0.9, 0.05, 0.16), [0.45, 0.06, 0.04], 2, 0);
  for (let i = 0; i < 4; i++) B.add('matte', torus(0.28, 0.065, 6, 5, Math.PI / 2), at(0, 1.25, 0.14, 1, 1, 1, 0, 0, i * Math.PI / 2 + Math.PI / 4), i % 2 ? [0.75, 0.73, 0.68] : [0.72, 0.16, 0.04], 3);
}
/** lantern head (hexagonal glass lantern with cap) centred at x,y,z (y = lantern base) */
export function lantern(H, x, y, z, s = 1, register = true, lightOpts = {}) {
  const B = H.B, c = COL.ironBlack;
  B.add('iron', cyl(6, 0.6), M(x, y + 0.03 * s, z, 0.11 * s, 0.06 * s, 0.11 * s), c);
  B.add('glass', cyl(6, 1.35, true), M(x, y + 0.27 * s, z, 0.125 * s, 0.42 * s, 0.125 * s), COL.lamp, 24, 0);
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6; B.add('iron', box(), M(x + Math.cos(a) * 0.15 * s, y + 0.27 * s, z + Math.sin(a) * 0.15 * s, 0.014 * s, 0.44 * s, 0.014 * s, 0, -a, -0.105), c); }
  B.add('iron', cyl(6, 0.12), M(x, y + 0.56 * s, z, 0.21 * s, 0.16 * s, 0.21 * s), c);
  B.add('iron', sphere(12, 8), M(x, y + 0.68 * s, z, 0.035 * s, 0.05 * s, 0.035 * s), c);
  if (register) H.lamps.push({ x, y: y + 0.3 * s, z, ...lightOpts });
}
const LAMP_COL = [[0.16, 0], [0.16, 0.12], [0.11, 0.2], [0.095, 0.5], [0.075, 0.62], [0.06, 0.7], [0.048, 1.6], [0.04, 2.9], [0.06, 2.96], [0.07, 3.05], [0.05, 3.12]];
/** decorative cast-iron lamp standard, total ~3.9 m */
export function lampPost(H, x, y, z, s = 1, lightOpts = {}) {
  H.stats.nLampPost = (H.stats.nLampPost || 0) + 1;
  H.B.add('iron', lathe('lampcol', LAMP_COL, 16), M(x, y, z, s, s, s), COL.ironGreen);
  // ladder-rest cross arm
  H.B.add('iron', cyl(5), M(x, y + 2.75 * s, z, 0.016 * s, 0.6 * s, 0.016 * s, 0, 0, Math.PI / 2), COL.ironGreen);
  lantern(H, x, y + 3.12 * s, z, 1.15 * s, true, lightOpts);
}

/** lamp standard with two side arms carrying globes (arms along z) */
export function candelabra(H, x, y, z, s = 1, lightOpts = {}) {
  lampPost(H, x, y, z, s, lightOpts); H.stats.nCandelabra = (H.stats.nCandelabra || 0) + 1;
  for (const d of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 7; i++) { const t = i / 7; pts.push([x, y + (2.0 + 0.5 * t * t - 0.16 * Math.sin(t * Math.PI)) * s, z + d * 0.6 * s * Math.sin(t * Math.PI / 2)]); }
    H.B.add('iron', tubeGeo(pts, 0.022 * s, 8), null, COL.ironGreen);
    const e = pts[7];
    H.B.add('iron', cyl(16, 1.6), M(e[0], e[1] + 0.03 * s, e[2], 0.05 * s, 0.07 * s, 0.05 * s), COL.ironGreen);
    H.B.add('glass', sphere(28, 16), M(e[0], e[1] + 0.2 * s, e[2], 0.14 * s, 0.15 * s, 0.14 * s), COL.lamp, 18, 0);
    H.B.add('iron', sphere(12, 8), M(e[0], e[1] + 0.36 * s, e[2], 0.03 * s, 0.04 * s, 0.03 * s), COL.ironGreen);
  }
}

// ---------------------------------------------------------------------------------------------------- stairs
function stairs(H, w, t, dir) {
  const GY = H.GY, Wd = 1.7, topY = GY + 0.06, botY = 0.27, go = 0.32;
  const n = Math.round((topY - botY) / 0.18), rise = (topY - botY) / n;
  const landTop = 1.6, landBot = 2.6;
  const T = s => t + s * dir;
  const seg = (s0, s1, y) => {
    lb(H, w, 'stone', T(s0), T(s1), -4, y - 0.05, 0, Wd, COL.granite, 0);
    lb(H, w, 'stone', T(s0 - 0.02), T(s1), y - 0.05, y, 0.1, Wd + 0.03, COL.tread, 1, 0);
  };
  seg(0, landTop, topY);
  for (let i = 0; i < n - 1; i++) seg(landTop + i * go, landTop + (i + 1) * go, topY - (i + 1) * rise);
  const sb = landTop + (n - 1) * go;
  seg(sb, sb + landBot, botY);
  // wall-side handrail
  const hr = [[T(landTop - 0.2), topY + 0.92, 0.09], [T(sb + 0.1), botY + 0.92 + rise, 0.09], [T(sb + 0.6), botY + 0.92, 0.09]];
  H.B.add('iron', tubeGeo(hr, 0.022, 5), wm(w, 0, 0, 0), COL.ironGreen, 0);
  for (let s = landTop; s < sb + 0.5; s += 1.3) {
    const y = topY + 0.92 - Math.max(0, s - landTop) / go * rise;
    H.B.add('iron', cyl(4), wm(w, T(s), Math.max(y, botY + 0.92), 0.045).multiply(M(0, 0, 0, 0.014, 0.09, 0.014, Math.PI / 2, 0, 0)), COL.ironGreen, 0);
  }
  // mooring post + ring at the bottom landing
  const p = wpt(w, T(sb + landBot - 0.35), Wd - 0.25);
  H.stats.nStairPost = (H.stats.nStairPost || 0) + 1; H.B.add('iron', cyl(16, 0.8), M(p[0], botY + 0.3, p[1], 0.07, 0.6, 0.07), COL.rustSteel, 2);
  H.moor.push([p[0], botY + 0.4, p[1]]);
  mooringRing(H, w, T(sb + 1.2), botY + 1.0);
  const lo = Math.min(T(0), T(sb + landBot)), hi = Math.max(T(0), T(sb + landBot));
  w.blocked.push([lo - 0.5, hi + 0.5]);
  w.railGaps.push([Math.min(T(0.05), T(landTop - 0.1)), Math.max(T(0.05), T(landTop - 0.1))]);
  w.stairs = w.stairs || []; w.stairs.push({ t0: lo, t1: hi, foot: wpt(w, T(sb + landBot / 2), Wd / 2) });
  return wpt(w, T(sb + landBot / 2), Wd / 2);
}

// ---------------------------------------------------------------------------------------------------- main
export function buildQuay(H) {
  const { L, GY, B } = H; const QX = L.QUAY_X, C = L.canal, BA = L.basin, HQ = L.harbor.quay;
  const rng = H.rng('harbor-quay');
  const walls = H.walls = {
    bayN: mkWall('bayN', QX, HQ.z0, QX, C.z0, -1, 0),
    bayS: mkWall('bayS', QX, C.z1, QX, HQ.z1, -1, 0),
    canN: mkWall('canN', QX, C.z0, C.x1, C.z0, 0, 1),
    canS: mkWall('canS', QX, C.z1, C.x1, C.z1, 0, -1),
    basWn: mkWall('basWn', BA.x0, BA.z0, BA.x0, C.z0, 1, 0),
    basWs: mkWall('basWs', BA.x0, C.z1, BA.x0, BA.z1, 1, 0),
    basN: mkWall('basN', BA.x0, BA.z0, BA.x1, BA.z0, 0, 1),
    basS: mkWall('basS', BA.x0, BA.z1, BA.x1, BA.z1, 0, -1),
    basE: mkWall('basE', BA.x1, BA.z0, BA.x1, BA.z1, -1, 0),
    endN: mkWall('endN', QX, HQ.z0, QX + 70, HQ.z0, 0, -1),
    endS: mkWall('endS', QX, HQ.z1, QX + 70, HQ.z1, 0, 1),
  };
  // --- gaps: bridges, pier, jetties
  for (const br of L.bridges) for (const w of [walls.canN, walls.canS]) {
    const g = [br.x0 - QX - 0.75, br.x1 - QX + 0.75];
    w.copingGaps.push(g); w.railGaps.push(g); w.blocked.push([g[0] - 1.2, g[1] + 1.2]);
  }
  const P = L.harbor.pier;
  const bayT = z => z < C.z0 ? [walls.bayN, z - HQ.z0] : [walls.bayS, z - C.z1];
  { const [w, t] = bayT(P.z0); w.railGaps.push([t - 0.3, t + (P.z1 - P.z0) + 0.3]); w.copingGaps.push([t, t + (P.z1 - P.z0)]); w.blocked.push([t - 4, t + (P.z1 - P.z0) + 4]); }
  for (const j of L.harbor.jetties) { const [w, t] = bayT(j.z0); w.railGaps.push([t - 0.2, t + (j.z1 - j.z0) + 0.2]); w.blocked.push([t - 3, t + (j.z1 - j.z0) + 3]); }

  // --- stairs (7 flights)
  H.stairFeet = [
    stairs(H, walls.canN, 50, 1), stairs(H, walls.canS, 245, -1), stairs(H, walls.canN, 450, 1), stairs(H, walls.canS, 572, -1),
    stairs(H, walls.bayN, -60 - HQ.z0, -1), stairs(H, walls.bayS, 235 - C.z1, 1), stairs(H, walls.basE, 30, 1),
  ];

  // --- wall faces + coping
  const copingProfile = [[-0.62, GY - 0.18], [0.10, GY - 0.18], [0.10, GY + 0.015], [0.055, GY + 0.06], [-0.60, GY + 0.06], [-0.62, GY + 0.04]];
  for (const w of Object.values(walls)) {
    const CH = 42;
    for (let t = 0; t < w.len; t += CH) {
      const t1 = Math.min(w.len, t + CH);
      B.add('stone', quadGeo([t, -4, 0], [t1, -4, 0], [t1, GY - 0.17, 0], [t, GY - 0.17, 0]), wm(w, 0, 0, 0), COL.granite, 0);
    }
    for (const [r0, r1] of freeRuns(w.len, w.copingGaps)) {
      for (let t = r0; t < r1; t += 39) {
        const len = Math.min(39, r1 - t);
        const p = wpt(w, t, 0);
        const m = new THREE.Matrix4().makeBasis(new V3(w.n[0], 0, w.n[1]), new V3(0, 1, 0), new V3(w.d[0], 0, w.d[1])).setPosition(p[0], 0, p[1]);
        B.add('stone', prismGeo(copingProfile, len, true), m, COL.coping, 1, 1.3);
      }
    }
    // plain filler where the coping is interrupted (bridges / pier): thin band so the wall top is closed
    for (const g of w.copingGaps) lb(H, w, 'stone', Math.max(0, g[0]), Math.min(w.len, g[1]), GY - 0.2, GY - 0.02, -0.5, 0.0, COL.granite, 0);
  }

  // --- drains (aligned with the shader stain lattice: world coordinate along the wall = 21k + 10.5), rings, ladders
  for (const w of Object.values(walls)) {
    const along = Math.abs(w.d[0]) > 0.5 ? 0 : 1;      // world axis index (x or z) that runs along the wall
    const c0 = w.a[along], sgn = w.d[along];
    const lo = Math.min(c0, c0 + sgn * w.len), hi = Math.max(c0, c0 + sgn * w.len);
    for (let k = Math.ceil((lo - 10.5) / 21); 21 * k + 10.5 < hi; k++) {
      const t = (21 * k + 10.5 - c0) * sgn;
      if (isBlocked(w, t - 0.6, t + 0.6) || t < 1 || t > w.len - 1) continue;
      B.add('iron', cyl(10, 1, true), wm(w, t, 1.3, 0.06).multiply(M(0, 0, 0, 0.115, 0.16, 0.115, Math.PI / 2, 0, 0)), COL.rustSteel, 2);
      B.add('iron', cyl(10, 1, true), wm(w, t, 1.3, 0.13).multiply(M(0, 0, 0, 0.135, 0.03, 0.135, Math.PI / 2, 0, 0)), COL.rustSteel, 2);
      B.add('matte', new THREE.CircleGeometry(0.11, 10), wm(w, t, 1.3, 0.012), [0.004, 0.004, 0.004], 1);
    }
    w.drainLattice = { along, c0, sgn };
  }
  const nearDrain = (w, t) => { const c = w.drainLattice.c0 + w.drainLattice.sgn * t; const f = ((c - 10.5) % 21 + 21) % 21; return f < 1 || f > 20; };
  const ringWalls = [walls.canN, walls.canS, walls.basN, walls.basS, walls.basE, walls.basWn, walls.basWs];
  for (const w of ringWalls) for (let t = 5 + rng() * 4; t < w.len - 3; t += 11 + rng() * 5) {
    if (isBlocked(w, t - 0.5, t + 0.5) || nearDrain(w, t)) continue;
    mooringRing(H, w, t, 1.45 + rng() * 0.25);
  }
  const ladderAt = (w, t) => { if (!isBlocked(w, t - 1, t + 1)) { ladder(H, w, t, GY + 0.06); w.blocked.push([t - 0.6, t + 0.6]); w.railGaps.push([t - 0.34, t + 0.34]); } };
  [70, 240, 430, 620].forEach(t => ladderAt(walls.canN, t)); [135, 330, 520, 650].forEach(t => ladderAt(walls.canS, t));
  ladderAt(walls.basN, 60); ladderAt(walls.basS, 35); ladderAt(walls.basE, 66);
  for (let z = HQ.z0 + 55; z < HQ.z1 - 30; z += 78) { const [w, t] = bayT(z + (rng() - 0.5) * 16); ladderAt(w, t); }

  // --- timber fender piles with waling (work berths on the bay quay) and tyre fenders elsewhere
  const paleTop = (yTop, base = COL.tar) => (x, y, z) => { const k = Math.min(1, Math.max(0, (y - (yTop - 0.45)) / 0.4)); return [base[0] + (COL.pale[0] - base[0]) * k, base[1] + (COL.pale[1] - base[1]) * k, base[2] + (COL.pale[2] - base[2]) * k]; };
  H.paleTop = paleTop;
  const fenderStretch = (z0, z1) => {
    const [w, t0] = bayT(z0); const t1 = t0 + (z1 - z0);
    for (let t = t0; t <= t1; t += 2.6) {
      if (isBlocked(w, t - 0.3, t + 0.3)) continue;
      const top = GY + 0.25 + rng() * 0.25;
      const p = wpt(w, t, 0.27);
      B.add('timber', box(), M(p[0], (top - 0.45 - 3.6) / 2, p[1], 0.3, top - 0.45 + 3.6, 0.3), COL.tar, 1, 1);
      B.add('timber', box(), M(p[0], top - 0.225, p[1], 0.3, 0.45, 0.3), paleTop(top), 1, 1);
      B.add('iron', box(), M(p[0], top - 0.5, p[1], 0.34, 0.07, 0.34), COL.rustSteel, 2);
    }
    lb(H, w, 'timber', t0 - 0.4, t1 + 0.4, 1.05, 1.33, 0.42, 0.62, COL.tar, 1, w.d[0] ? 0 : 2);
    w.blocked.push([t0 - 0.5, t0 - 0.4]);    // marker only (keeps ladders off)
  };
  fenderStretch(-372, -296); fenderStretch(336, 424); fenderStretch(452, 566);
  const tyre = (w, t) => {
    if (isBlocked(w, t - 0.5, t + 0.5)) return;
    const y = 0.75 + rng() * 0.35;
    B.add('matte', torus(0.29, 0.115, 6, 12), wm(w, t, y, 0.13), COL.rubber, 1);
    for (const s of [-0.16, 0.16]) B.add('iron', tubeGeo([[t + s, y + 0.22, 0.13], [t + s * 0.6, GY - 0.1, 0.11], [t + s * 0.5, GY + 0.07, 0.0], [t + s * 0.5, GY + 0.07, -0.25]], 0.014, 4), wm(w, 0, 0, 0), COL.rustSteel, 2);
  };
  for (let z = -640; z < -385; z += 6.5 + rng() * 3) { const [w, t] = bayT(z); tyre(w, t); }
  for (let z = 612; z < 760; z += 7 + rng() * 3) { const [w, t] = bayT(z); tyre(w, t); }
  for (let t = 318; t < 372; t += 6 + rng() * 2) tyre(walls.canN, t);

  // --- railings: canal + basin everywhere (minus gaps), promenade stretches on the bay quay
  const RO = -0.3, RY = GY + 0.06;
  const railWall = (w, t0 = 0, t1 = w.len) => {
    for (const [r0, r1] of freeRuns(w.len, w.railGaps, t0, t1)) {
      if (r1 - r0 < 0.6) continue;
      const a = wpt(w, r0, RO), b = wpt(w, r1, RO);
      railPost(H, a[0], RY, a[1]);
      railLine(H, a[0], a[1], b[0], b[1], RY, RY, true);
    }
  };
  railWall(walls.canN, 0.4); railWall(walls.canS, 0.4);
  railWall(walls.basWn, 0.3, walls.basWn.len); railWall(walls.basWs, 0, walls.basWs.len - 0.3);
  railWall(walls.basN, 0.3, walls.basN.len - 0.3); railWall(walls.basS, 0.3, walls.basS.len - 0.3); railWall(walls.basE, 0.3, walls.basE.len - 0.3);
  const railStretches = [[-262, -96], [-96, C.z0 - 0.4], [C.z1 + 0.4, 330], [606.5, 640]];
  for (const [z0, z1] of railStretches) { const [w, t0] = bayT(z0 + 0.01); railWall(w, t0, t0 + (z1 - z0)); }
  H.railStretches = railStretches;

  // --- bollards along the working quay, chain-and-post stretches
  const inRail = z => railStretches.some(s => z > s[0] - 1 && z < s[1] + 1);
  for (let z = HQ.z0 + 12; z < HQ.z1 - 8; z += 17.5) {
    const zz = z + (rng() - 0.5) * 2;
    if (zz > P.z0 - 2 && zz < P.z1 + 2) continue;
    if (zz > C.z0 - 6 && zz < C.z1 + 6) continue;
    if (inRail(zz)) continue;
    bollard(H, QX + 0.95, GY, zz, 1);
  }
  const chainStretch = (z0, z1) => {
    const x = QX + 0.34, sp = 2.7, n = Math.round((z1 - z0) / sp);
    for (let i = 0; i <= n; i++) {
      const z = z0 + i * sp;
      H.stats.nChainPost = (H.stats.nChainPost || 0) + 1; B.add('iron', cyl(12, 0.72), M(x, RY + 0.37, z, 0.062, 0.74, 0.062), COL.ironBlack, 0);
      B.add('iron', sphere(10, 6), M(x, RY + 0.77, z, 0.07, 0.07, 0.07), COL.ironBlack, 0);
      if (i < n) B.add('iron', tubeGeo(catenary([x, RY + 0.68, z + 0.05], [x, RY + 0.68, z + sp - 0.05], 0.2 + rng() * 0.08, 7), 0.018, 4), null, COL.rustSteel, 2);
    }
  };
  chainStretch(-560, -420); chainStretch(-800, -700); chainStretch(645 + 2.7, 780); chainStretch(820, 930);

  // --- life-ring stands
  lifeRing(H, QX + 0.9, GY, -100, Math.PI / 2); lifeRing(H, QX + 0.9, GY, 122, Math.PI / 2); lifeRing(H, QX + 0.9, GY, 200, Math.PI / 2);
  lifeRing(H, -90, GY, C.z0 - 0.95, Math.PI); lifeRing(H, 200, GY, C.z1 + 0.95, 0); lifeRing(H, 410, GY, C.z0 - 0.95, Math.PI);
  lifeRing(H, BA.x1 + 0.95, GY, 170, Math.PI / 2); lifeRing(H, 560, GY, BA.z0 - 0.95, Math.PI);
}
