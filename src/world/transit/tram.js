// The tram: a 3-car articulated set, original retro-modern design (rounded bull-nose ends, cream over oxblood,
// third-rail pickup). Exterior shell with REAL window openings + a complete interior (longitudinal slatted benches,
// poles, hanging straps, luggage racks, ceiling lamps, ad cards, bellows) so the sun paints window-shaped patches inside.
// Tram-local frame: origin = centre of the set on the rail top, x east, y up, z south.
import * as THREE from 'three';
import { Geo, V3, plate, roundRect, roundRectN, profArc, polyProf, sweepLoop, extrudeZ } from './geo.js';
import { DIM } from './timetable.js';
import { signQuad } from './stations.js';

export const T = {
  HW: 1.25, WT: 0.07, HI: 1.18, FL: DIM.FLOOR, Y_SK: 0.42, Y_EAVE: 2.95, Y_ROOF: 3.45, Y_CEIL: 3.30,
  SILL: DIM.FLOOR + 0.80, HEAD: DIM.FLOOR + 1.77, HL: DIM.CAR_L / 2, ZS: 5.35, LN: 2.0, BULK: 4.47,
  RAIL_X: 0.42, RAIL_Y: DIM.FLOOR + 1.93, SEAT_Y: DIM.FLOOR + 0.45,
};
const { HW, WT, HI, FL, Y_SK, Y_EAVE, Y_ROOF, Y_CEIL, SILL, HEAD, HL, ZS, LN, BULK } = T;
// material classes of the "solid" tram material (aFace.w): +10 = interior (dim ambient + lamp light)
const EXT = 0, PANEL = 11, FLOORC = 12, WOOD = 13, METAL_IN = 14, RUBBER_IN = 15, LEATHER = 16, SEAT = 17, CHROME = 18, PLASTIC = 19, METAL = 4, RUBBER = 5;
const ALU = [0.60, 0.61, 0.63];
const PI = Math.PI;
// window frame profiles [o (outward from the opening edge), d (depth), normal]: interior aluminium section, gaskets, exterior gasket
const O0 = -0.0025;
const frameProfiles = hi => ({
  inner: [[O0 + 0.052, 0, 1, 0], ...profArc(O0 + 0.046, 0.007, 0.006, 0, PI / 2, hi ? 3 : 1), ...profArc(O0 + 0.010, 0.003, 0.010, PI / 2, PI, hi ? 5 : 2), [O0, -0.029, -1, 0]],
  gasket: profArc(O0, -0.035, 0.006, PI / 2, PI, hi ? 3 : 1),
  outer: [...profArc(O0, -0.035, 0.006, PI, PI / 2, hi ? 3 : 1), [O0, -0.029, -1, 0], ...profArc(O0 + 0.006, 0, 0.006, PI, 0, hi ? 5 : 2)],
});
const orient = (pts, ref) => polyProf(pts).map(p => ((p[0] - ref[0]) * p[2] + (p[1] - ref[1]) * p[3] < 0 ? [p[0], p[1], -p[2], -p[3]] : p));
const CREAM = [0.66, 0.60, 0.46], DADO = [0.16, 0.22, 0.19], BRASS = [0.83, 0.60, 0.27], STEELC = [0.72, 0.72, 0.74], DARK = [0.045, 0.045, 0.05];
const WOODC = [0.46, 0.235, 0.095];
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const E8 = 0.8;

const roofProf = (() => { const p = []; const N = 7; for (let k = 0; k <= N; k++) { const th = k / N * Math.PI / 2; p.push([HW * Math.pow(Math.cos(th), E8), Y_EAVE + (Y_ROOF - Y_EAVE) * Math.pow(Math.sin(th), E8)]); } p[N][0] = 0; return p; })();
const ceilProf = (() => { const p = []; const N = 7; const y0 = Y_EAVE - 0.02; for (let k = 0; k <= N; k++) { const th = k / N * Math.PI / 2; p.push([HI * Math.pow(Math.cos(th), E8), y0 + (Y_CEIL - y0) * Math.pow(Math.sin(th), E8)]); } p[N][0] = 0; return p; })();
function profNormals(p) {
  return p.map((q, i) => { const a = p[Math.max(0, i - 1)], b = p[Math.min(p.length - 1, i + 1)]; const dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; return [dy / l, -dx / l]; });
}
/** ceiling height (y) of the interior at lateral position |x| */
export function ceilY(x) { x = Math.abs(x); for (let i = 0; i < ceilProf.length - 1; i++) { const a = ceilProf[i], b = ceilProf[i + 1]; if (x <= a[0] && x >= b[0]) return a[1] + (b[1] - a[1]) * (a[0] - x) / Math.max(1e-6, a[0] - b[0]); } return Y_CEIL; }

function quadAuto(g, a, b, c, d, na, nb, nc, nd) {
  const n = V3().subVectors(b, a).cross(V3().subVectors(d, a)); if (n.lengthSq() < 1e-12) n.subVectors(c, b).cross(V3().subVectors(d, b));
  const ref = V3().add(na).add(nb).add(nc).add(nd);
  if (n.dot(ref) >= 0) g.quadN(a, b, c, d, na, nb, nc, nd); else g.quadN(a, d, c, b, na, nd, nc, nb);
}
/** extruded profile strip (roof / ceiling) on both sides, outward or inward facing */
function profStrip(g, prof, z0, z1, inward) {
  const nr = profNormals(prof); const sg = inward ? -1 : 1;
  for (const s of [-1, 1]) for (let i = 0; i < prof.length - 1; i++) {
    const p = prof[i], q = prof[i + 1];
    const a = V3(s * p[0], p[1], z0), b = V3(s * p[0], p[1], z1), c = V3(s * q[0], q[1], z1), d = V3(s * q[0], q[1], z0);
    const n0 = V3(s * nr[i][0] * sg, nr[i][1] * sg, 0), n1 = V3(s * nr[i + 1][0] * sg, nr[i + 1][1] * sg, 0);
    quadAuto(g, a, b, c, d, n0, n0, n1, n1);
  }
}

// ---- nose (lofted superellipse bull-nose with a wrap-around windscreen) -----------------------------
function buildNose(G) {
  const prof = [[HW - 0.05, Y_SK], [HW, FL], [HW, 1.72], [HW, 2.25], [HW, 2.78], [HW, Y_EAVE]];
  for (let k = 1; k < roofProf.length; k++) prof.push(roofProf[k]);
  const J = prof.length - 1, K = 10, e = 2 / 2.5;
  const rake = y => 0.5 * sm(1.6, 3.3, y) + 0.12 * (1 - sm(0.42, 1.0, y));
  const P = (k, m) => {
    const j = m <= J ? m : 2 * J - m, side = m <= J ? -1 : 1;
    const phi = k / K * Math.PI / 2, sx = k === K ? 0 : Math.pow(Math.cos(phi), e), u = Math.pow(Math.sin(phi), e);
    const y0 = prof[j][1]; let y = y0;
    if (y > Y_EAVE) y = Y_EAVE + (y - Y_EAVE) * (1 - 0.55 * u * u * u);
    return V3(side * prof[j][0] * sx, y, ZS + (LN - rake(y0)) * u);
  };
  const M = 2 * J; const pts = [], nrm = [];
  for (let k = 0; k <= K; k++) { pts.push([]); for (let m = 0; m <= M; m++) pts[k].push(P(k, m)); }
  const cen = V3(0, 1.9, ZS - 1.0);
  for (let k = 0; k <= K; k++) {
    nrm.push([]);
    for (let m = 0; m <= M; m++) {
      const tk = V3().subVectors(pts[Math.min(K, k + 1)][m], pts[Math.max(0, k - 1)][m]);
      const tm = V3().subVectors(pts[k][Math.min(M, m + 1)], pts[k][Math.max(0, m - 1)]);
      let n = V3().crossVectors(tk, tm);
      if (n.lengthSq() < 1e-10) n = V3(0, 0, 1); n.normalize();
      if (n.dot(V3().subVectors(pts[k][m], cen)) < 0) n.negate();
      nrm[k].push(n);
    }
  }
  const jlow = m => (m < J ? m : M - 1 - m);
  const open = (k, m) => k >= 2 && k !== 4 && k < K && m >= 0 && m < M && (jlow(m) === 2 || jlow(m) === 3);
  const inner = (k, m) => pts[k][m].clone().addScaledVector(nrm[k][m], -0.06);
  const neg = v => v.clone().negate();
  for (let k = 0; k < K; k++) for (let m = 0; m < M; m++) {
    const a = pts[k][m], b = pts[k + 1][m], c = pts[k + 1][m + 1], d = pts[k][m + 1];
    const na = nrm[k][m], nb = nrm[k + 1][m], nc = nrm[k + 1][m + 1], nd = nrm[k][m + 1];
    if (open(k, m)) {
      G.glass.setClass(3); quadAuto(G.glass, a, b, c, d, na, nb, nc, nd);
      // closing strips toward solid neighbours
      const mid = V3().add(a).add(b).add(c).add(d).multiplyScalar(0.25);
      const edges = [[k, m, k + 1, m, open(k, m - 1)], [k, m + 1, k + 1, m + 1, open(k, m + 1)], [k, m, k, m + 1, open(k - 1, m)], [k + 1, m, k + 1, m + 1, k + 1 === K || open(k + 1, m)]];
      G.solid.setClass(RUBBER).color(...DARK);
      for (const [k0, m0, k1, m1, isOpen] of edges) {
        if (isOpen) continue;
        const p = pts[k0][m0], q = pts[k1][m1], pi = inner(k0, m0), qi = inner(k1, m1);
        const em = V3().add(p).add(q).add(pi).add(qi).multiplyScalar(0.25); const want = V3().subVectors(mid, em);
        G.solid.triDir(p, q, qi, want); G.solid.triDir(p, qi, pi, want);
      }
    } else {
      G.paint.color(1, 1, 1); quadAuto(G.paint, a, b, c, d, na, nb, nc, nd);
      G.solid.setClass(PANEL).color(0.07, 0.075, 0.08);
      quadAuto(G.solid, inner(k, m), inner(k + 1, m), inner(k + 1, m + 1), inner(k, m + 1), neg(na), neg(nb), neg(nc), neg(nd));
    }
  }
  // cab floor + underside
  const fan = (j, y, cls, col, up) => {
    G.solid.setClass(cls).color(...col); const c0 = V3(0, y, ZS + 0.4);
    const loop = []; for (let k = 0; k <= K; k++) loop.push(V3(pts[k][j].x, y, pts[k][j].z)); for (let k = K - 1; k >= 0; k--) loop.push(V3(pts[k][M - j].x, y, pts[k][M - j].z));
    for (let i = 0; i < loop.length - 1; i++) G.solid.triDir(c0, loop[i], loop[i + 1], V3(0, up, 0));
    G.solid.triDir(c0, loop[loop.length - 1], loop[0], V3(0, up, 0));
  };
  fan(1, FL, FLOORC, [0.10, 0.09, 0.08], 1); fan(0, Y_SK, EXT, [0.06, 0.06, 0.065], -1);
  // driver's console
  G.solid.setClass(PANEL).color(0.05, 0.055, 0.06).box(0, FL + 0.36, ZS + 0.98, 1.7, 0.72, 0.55);
  G.solid.box(0, FL + 0.78, ZS + 1.1, 1.5, 0.12, 0.34);
  G.solid.setClass(METAL_IN).color(...BRASS).cyl(V3(-0.35, FL + 0.84, ZS + 1.0), V3(-0.35, FL + 1.02, ZS + 0.95), 0.02, 0.02, 6, true);
  G.solid.color(...STEELC).cyl(V3(0.3, FL + 0.84, ZS + 1.0), V3(0.3, FL + 0.98, ZS + 1.0), 0.07, 0.07, 10, true);
  // analytic point / plan normal on the nose (for lamps)
  const at = (x, y) => {
    const sx = Math.abs(x) / HW, c = Math.pow(sx, 1 / e), s = Math.sqrt(Math.max(0, 1 - c * c)), u = Math.pow(s, e), Lr = LN - rake(y);
    const n = V3(Math.sign(x) * Math.pow(sx, 1.5) / HW, 0, Math.pow(u, 1.5) / Lr).normalize();
    return { p: V3(x, y, ZS + Lr * u), n };
  };
  return { at, tipZ: y => ZS + LN - rake(y) };
}

// ---- one car ------------------------------------------------------------------------------------------
function buildCar(G, type, zc, mir, endSign, A) {
  const M4 = new THREE.Matrix4().makeTranslation(0, 0, zc).multiply(new THREE.Matrix4().makeScale(1, 1, mir));
  const PM = new THREE.Matrix4().makeTranslation(0, 0, zc);      // prints: never mirrored (lettering)
  for (const k of ['paint', 'solid', 'glass', 'lamp']) G[k].matrix(M4);
  const { paint, solid, glass, lamp } = G;
  const isE = type === 'E', hi = !isE, nC = hi ? 10 : 5, FP = frameProfiles(hi);
  const zA = -HL, zB = isE ? ZS : HL;                    // straight body extent
  const wins = [[-5.8, 1.9], [-1.93, 1.62], [0, 1.62], [1.93, 1.62]]; if (!isE) wins.push([5.8, 1.9]); else wins.push([4.93, 0.62]);
  const doors = [-3.7, 3.7];
  const VENT_Y = SILL + 0.66 * (HEAD - SILL);

  for (const s of [-1, 1]) {
    // ---- side wall plate with real openings ----
    const holes = [];
    for (const [c, w] of wins) holes.push(roundRect(c - w / 2, SILL, c + w / 2, HEAD, 0.13, nC));
    for (const c of doors) holes.push(roundRect(c - 0.65, FL + 0.02, c + 0.65, FL + 1.95, 0.05, 3));
    paint.color(1, 1, 1); solid.setClass(PANEL).color(...CREAM);
    const sideG = new Geo({ local: true }); sideG.matrix(M4); sideG.setClass(RUBBER).color(...DARK);
    plate([[zA, Y_SK], [zB, Y_SK], [zB, Y_EAVE], [zA, Y_EAVE]], holes, (u, v, d) => V3(s * (HI + d * WT), v, u), 0, 1, paint, solid, sideG, { outerSide: false });
    solid.add(sideG);
    // ---- windows ----
    for (const [c, w] of wins) {
      const z0 = c - w / 2, z1 = c + w / 2;
      const loop = roundRectN(z0, SILL, z1, HEAD, 0.13, nC), xg = s * (HW - 0.035);
      const mapI = (u, v, d) => V3(s * (HI - d), v, u), mapE = (u, v, d) => V3(s * (HW + d), v, u);
      solid.setClass(METAL_IN).color(...ALU); sweepLoop(solid, loop, FP.inner, mapI);
      solid.setClass(RUBBER_IN).color(...DARK); sweepLoop(solid, loop, FP.gasket, mapI);
      solid.setClass(RUBBER).color(...DARK); sweepLoop(solid, loop, FP.outer, mapE);
      if (w > 1) {
        // transom + fixed divider + inner sliding vent pane with a finger pull
        solid.setClass(METAL_IN).color(...ALU);
        solid.rbeam(V3(xg, VENT_Y, z0 - 0.004), V3(xg, VENT_Y, z1 + 0.004), 0.034, 0.032, 0.008, V3(1, 0, 0), hi ? 3 : 1, false);
        solid.rbeam(V3(xg, VENT_Y, c), V3(xg, HEAD + 0.004, c), 0.026, 0.03, 0.007, null, hi ? 2 : 1, false);
        const xp = s * (HW - 0.035 - 0.017), pa = c - 0.02, pb = z1 - 0.03, ya = VENT_Y + 0.006, yb = HEAD - 0.012;
        solid.color(0.52, 0.53, 0.55);
        solid.rbeam(V3(xp, ya, pa), V3(xp, yb, pa), 0.018, 0.011, 0.004, null, 1, false).rbeam(V3(xp, ya, pb), V3(xp, yb, pb), 0.018, 0.011, 0.004, null, 1, false);
        solid.rbeam(V3(xp, ya, pa), V3(xp, ya, pb), 0.016, 0.011, 0.004, V3(1, 0, 0), 1, false).rbeam(V3(xp, yb, pa), V3(xp, yb, pb), 0.016, 0.011, 0.004, V3(1, 0, 0), 1, false);
        solid.setClass(PLASTIC).color(0.05, 0.05, 0.055).rbeam(V3(xp - s * 0.011, (ya + yb) / 2 - 0.022, pa), V3(xp - s * 0.011, (ya + yb) / 2 + 0.022, pa), 0.014, 0.012, 0.004, null, 1, true);
        glass.setClass(1).quad(V3(xp, ya, pa), V3(xp, ya, pb), V3(xp, yb, pb), V3(xp, yb, pa), V3(s, 0, 0));
      }
      glass.setClass(1).quad(V3(s * (HW - 0.035), SILL - 0.01, z0 - 0.01), V3(s * (HW - 0.035), SILL - 0.01, z1 + 0.01), V3(s * (HW - 0.035), HEAD + 0.01, z1 + 0.01), V3(s * (HW - 0.035), HEAD + 0.01, z0 - 0.01), V3(s, 0, 0));
    }
    // ---- doors (two leaves, closed) ----
    for (const c of doors) {
      for (const [a, b] of [[c - 0.645, c - 0.004], [c + 0.004, c + 0.645]]) {
        paint.color(1, 1, 1); solid.setClass(PANEL).color(0.50, 0.46, 0.36);
        const sg = new Geo({ local: true }); sg.matrix(M4); sg.setClass(RUBBER).color(...DARK);
        plate(roundRect(a, FL + 0.025, b, FL + 1.945, 0.02, 2), [roundRect(a + 0.11, FL + 0.80, b - 0.11, FL + 1.72, 0.085, 4)], (u, v, d) => V3(s * (HW - 0.058 + d * 0.042), v, u), 0, 1, paint, solid, sg);
        solid.add(sg);
        glass.setClass(2).quad(V3(s * (HW - 0.037), FL + 0.78, a + 0.1), V3(s * (HW - 0.037), FL + 0.78, b - 0.1), V3(s * (HW - 0.037), FL + 1.74, b - 0.1), V3(s * (HW - 0.037), FL + 1.74, a + 0.1), V3(s, 0, 0));
        solid.setClass(METAL_IN).color(...STEELC).cyl(V3(s * (HW - 0.1), FL + 0.85, (a + b) / 2 + (a < c ? 0.2 : -0.2)), V3(s * (HW - 0.1), FL + 1.5, (a + b) / 2 + (a < c ? 0.2 : -0.2)), 0.012, 0.012, 5);
      }
      solid.setClass(METAL_IN).color(...BRASS).box(s * (HI - 0.09), FL + 0.004, c, 0.22, 0.008, 1.3);
      solid.setClass(PLASTIC).color(0.74, 0.56, 0.05).box(s * (HI - 0.245), FL + 0.003, c, 0.07, 0.006, 1.3, 'b');
      // route diagram card in the cove above the door
      const pr = G.print; pr.matrix(PM); const p1 = ceilProf[1], p3 = ceilProf[3], q1 = V3(s * (p1[0] - 0.012), p1[1] - 0.004, 0), q2 = V3(s * (p1[0] + (p3[0] - p1[0]) * 0.45 - 0.01), p1[1] + (p3[1] - p1[1]) * 0.45 - 0.01, 0);
      pr.uvRect = A.rect('line'); pr.fo = [0, 0, 0, 1]; pr.color(1, 1, 1);
      const za = c * mir - s * 0.62, zb2 = c * mir + s * 0.62;
      pr.quad(V3(q1.x, q1.y, za), V3(q1.x, q1.y, zb2), V3(q2.x, q2.y, zb2), V3(q2.x, q2.y, za));
      pr.uvRect = null; pr.fo = null; pr.matrix(null);
    }
    // cantrail gutter
    paint.color(1, 1, 1).box(s * (HW + 0.01), Y_EAVE - 0.005, (zA + zB) / 2, 0.028, 0.035, zB - zA);

    // ---- benches, racks, screens ----
    const segs = isE ? [[-7.15, -4.48], [-2.92, 2.92]] : [[-7.15, -4.48], [-2.92, 2.92], [4.48, 7.15]];
    for (const [za, zb] of segs) {
      const mid = (za + zb) / 2, len = zb - za;
      // upholstered bench: crowned cushion with a rolled nose, reclined back with a top roll, piping along the edges
      const X = xi => HI - xi;
      const seatP = [[0.05, 0.425], [0.07, 0.445], [0.14, 0.452], [0.28, 0.456], [0.40, 0.452]];
      for (const a of hi ? [90, 68, 46, 24, 2, -20] : [90, 35, -20]) seatP.push([0.44 + 0.025 * Math.cos(a * PI / 180), 0.427 + 0.025 * Math.sin(a * PI / 180)]);
      seatP.push([0.462, 0.37], [0.455, 0.352]);
      const backP = [[0.085, 0.455], [0.078, 0.50], [0.066, 0.62], [0.060, 0.668]];
      for (const a of hi ? [0, 30, 60, 90, 120, 150, 180] : [0, 60, 120, 180]) backP.push([0.036 + 0.024 * Math.cos(a * PI / 180), 0.672 + 0.024 * Math.sin(a * PI / 180)]);
      backP.push([0.010, 0.63], [0.004, 0.60]);
      solid.setClass(SEAT).color(0.235, 0.085, 0.06);
      extrudeZ(solid, orient(seatP.map(p => [X(p[0]), FL + p[1]]), [X(0.25), FL + 0.40]), za, zb, s, true);
      extrudeZ(solid, orient(backP.map(p => [X(p[0]), FL + p[1]]), [X(0.03), FL + 0.55]), za, zb, s, true);
      solid.color(0.10, 0.035, 0.03);
      for (const [xi, y] of [[0.4595, 0.4465], [0.0614, 0.681], [0.4645, 0.372]]) solid.cyl(V3(s * X(xi), FL + y, za), V3(s * X(xi), FL + y, zb), 0.0045, 0.0045, hi ? 7 : 4);
      solid.setClass(PANEL).color(...DADO).box(s * (HI - 0.45), FL + 0.176, mid, 0.02, 0.352, len);
      solid.setClass(METAL_IN).color(0.2, 0.2, 0.21).box(s * (HI - 0.462), FL + 0.15, mid, 0.006, 0.15, len - 0.4);
      // aluminium ledge between the seat back and the window frame
      solid.setClass(METAL_IN).color(...ALU).rbeam(V3(s * (HI - 0.02), FL + 0.728, za), V3(s * (HI - 0.02), FL + 0.728, zb), 0.02, 0.04, 0.007, V3(1, 0, 0), hi ? 3 : 1, true);
      // luggage rack: brass rods on cast brackets
      const yr = FL + 1.9; solid.setClass(METAL_IN).color(...BRASS);
      for (let i = 0; i < 4; i++) solid.cyl(V3(s * (HI - 0.07 - i * 0.085), yr + (i === 3 ? 0.035 : 0), za + 0.05), V3(s * (HI - 0.07 - i * 0.085), yr + (i === 3 ? 0.035 : 0), zb - 0.05), 0.0075, 0.0075, hi ? 8 : 5);
      const nb = len > 5 ? 7 : Math.max(2, Math.round(len / 0.95));
      for (let i = 0; i <= nb; i++) {
        const z = za + 0.06 + (len - 0.12) * i / nb;
        solid.rbeam(V3(s * (HI - 0.004), yr - 0.07, z), V3(s * (HI - 0.19), yr - 0.008, z), 0.012, 0.016, 0.004, null, 1, false);
        solid.rbeam(V3(s * (HI - 0.33), yr - 0.008, z), V3(s * (HI - 0.33), yr + 0.035, z), 0.012, 0.012, 0.004, null, 1, false);
        solid.rbeam(V3(s * (HI - 0.004), yr - 0.008, z), V3(s * (HI - 0.33), yr - 0.008, z), 0.012, 0.012, 0.004, null, 1, false);
      }
      // stanchions at the seat front (brushed stainless), aligned with the window pillars
      solid.setClass(CHROME).color(0.80, 0.80, 0.82);
      for (const zp of len > 5 ? [-0.784, 0.784] : [mid]) {
        const xp = s * (HI - 0.5), yc = ceilY(HI - 0.5), ns = hi ? 16 : 8;
        solid.cyl(V3(xp, FL, zp), V3(xp, yc, zp), 0.0165, 0.0165, ns);
        solid.cyl(V3(xp, FL, zp), V3(xp, FL + 0.012, zp), 0.034, 0.03, ns).cyl(V3(xp, FL + 0.012, zp), V3(xp, FL + 0.03, zp), 0.03, 0.0165, ns);
        solid.cyl(V3(xp, yc - 0.03, zp), V3(xp, yc - 0.008, zp), 0.0165, 0.03, ns).cyl(V3(xp, yc - 0.008, zp), V3(xp, yc + 0.01, zp), 0.03, 0.03, ns);
        solid.cyl(V3(xp, FL + 0.40, zp), V3(s * (HI - 0.455), FL + 0.40, zp), 0.009, 0.009, 6);
      }
      // route diagram strip above the middle window of the long bench + emergency hammer box + ventilation grille on the pillars
      if (len > 5) {
        const pr = G.print; pr.matrix(PM);
        pr.uvRect = A.rect('route'); pr.fo = [0, 0, 0, 1]; pr.color(1, 1, 1);
        const xr = s * (HI - 0.0045), y0 = FL + 1.797, y1 = FL + 1.903, zl = -s * 0.69;
        pr.quad(V3(xr, y0, zl), V3(xr, y0, -zl), V3(xr, y1, -zl), V3(xr, y1, zl));
        pr.uvRect = null; pr.fo = null; pr.matrix(null);
        solid.setClass(METAL_IN).color(...ALU);
        for (const y of [y0 - 0.004, y1 + 0.004]) solid.rbeam(V3(s * (HI - 0.004), y, -0.70), V3(s * (HI - 0.004), y, 0.70), 0.009, 0.008, 0.003, V3(1, 0, 0), 1, true);
        // hammer box
        const zh = 0.905, yh = FL + 1.36;
        solid.setClass(PLASTIC).color(0.50, 0.045, 0.03).rbeam(V3(s * (HI - 0.017), yh - 0.105, zh), V3(s * (HI - 0.017), yh + 0.105, zh), 0.072, 0.034, 0.009, null, hi ? 3 : 1, true);
        solid.setClass(PANEL).color(0.025, 0.025, 0.028).box(s * (HI - 0.0345), yh - 0.012, zh, 0.002, 0.15, 0.05);
        solid.setClass(PLASTIC).color(0.78, 0.60, 0.08).box(s * (HI - 0.038), yh - 0.025, zh, 0.006, 0.105, 0.011);
        solid.setClass(METAL_IN).color(...STEELC).box(s * (HI - 0.039), yh + 0.036, zh, 0.008, 0.018, 0.04);
        // louvred grille
        const zg = -0.92, yg = FL + 1.60, xgI = s * (HI - 0.006);
        solid.setClass(PANEL).color(0.02, 0.02, 0.022).box(s * (HI - 0.002), yg, zg, 0.003, 0.07, 0.085);
        solid.setClass(METAL_IN).color(0.50, 0.51, 0.53);
        for (const e of [-1, 1]) {
          solid.rbeam(V3(xgI, yg + e * 0.04, zg - 0.05), V3(xgI, yg + e * 0.04, zg + 0.05), 0.01, 0.012, 0.004, V3(1, 0, 0), 1, true);
          solid.rbeam(V3(xgI, yg - 0.04, zg + e * 0.046), V3(xgI, yg + 0.04, zg + e * 0.046), 0.01, 0.012, 0.004, null, 1, true);
        }
        for (let i = 0; i < 5; i++) { const y = yg - 0.028 + i * 0.014; solid.beam(V3(s * (HI - 0.003), y - 0.004, zg - 0.042), V3(s * (HI - 0.003), y - 0.004, zg + 0.042), 0.011, 0.0025, V3(s * 0.6, 0.8, 0), false); }
      }
      // end screens (toward doors) with a pole
      for (const ze of [za, zb]) {
        if (Math.abs(Math.abs(ze) - 7.15) < 0.01) { solid.setClass(WOOD).color(...WOODC).box(s * (HI - 0.25), FL + 0.36, ze, 0.5, 0.72, 0.03); continue; }
        solid.setClass(PANEL).color(...DADO).box(s * (HI - 0.25), FL + 0.5, ze, 0.5, 1.0, 0.03);
        solid.setClass(METAL_IN).color(...STEELC).box(s * (HI - 0.25), FL + 1.0, ze, 0.5, 0.025, 0.035).box(s * (HI - 0.25), FL + 1.7, ze, 0.5, 0.022, 0.03);
        solid.setClass(CHROME).color(0.80, 0.80, 0.82).cyl(V3(s * (HI - 0.5), FL, ze), V3(s * (HI - 0.5), ceilY(HI - 0.5), ze), 0.017, 0.017, hi ? 14 : 8);
        glass.setClass(4).quad(V3(s * (HI - 0.49), FL + 1.01, ze), V3(s * (HI - 0.01), FL + 1.01, ze), V3(s * (HI - 0.01), FL + 1.69, ze), V3(s * (HI - 0.49), FL + 1.69, ze), V3(0, 0, 1));
      }
    }
    // overhead grab rail + hangers
    const r0 = zA + 0.45, r1 = isE ? BULK - 0.15 : HL - 0.45;
    solid.setClass(CHROME).color(0.80, 0.80, 0.82).cyl(V3(s * T.RAIL_X, T.RAIL_Y, r0), V3(s * T.RAIL_X, T.RAIL_Y, r1), 0.016, 0.016, hi ? 14 : 8);
    for (let z = r0 + 0.02; z <= r1; z += (r1 - r0 - 0.04) / 8) solid.cyl(V3(s * T.RAIL_X, T.RAIL_Y, z), V3(s * T.RAIL_X, ceilY(T.RAIL_X), z), 0.009, 0.009, hi ? 8 : 5);
    // ceiling trim strips
    for (const x of [0.32, 0.78]) solid.setClass(WOOD).color(0.20, 0.11, 0.05).box(s * x, ceilY(x) - 0.006, (zA + (isE ? BULK : HL)) / 2, 0.03, 0.012, (isE ? BULK : HL) - zA - 0.1);
    // ad cards in the cove
    const pr = G.print; pr.matrix(PM);
    const p1 = ceilProf[1], p2 = ceilProf[3];
    let ai = (s > 0 ? 0 : 4) + (isE ? 1 : 0) + (mir < 0 ? 2 : 0);
    for (const c of isE ? [-6.0, -1.95, 0, 1.95] : [-6.0, -1.95, 0, 1.95, 6.0]) {
      const za = c * mir - s * 0.36, zb2 = c * mir + s * 0.36;
      pr.uvRect = A.rect('ad' + (ai++ % 8)); pr.fo = [0, 0, 0, 1]; pr.color(1, 1, 1);
      pr.quad(V3(s * (p1[0] - 0.012), p1[1] - 0.004, za), V3(s * (p1[0] - 0.012), p1[1] - 0.004, zb2), V3(s * (p2[0] - 0.008), p2[1] - 0.012, zb2), V3(s * (p2[0] - 0.008), p2[1] - 0.012, za));
      solid.setClass(METAL_IN).color(...BRASS);
      for (const zz of [c - 0.37, c + 0.37]) solid.beam(V3(s * (p1[0] - 0.014), p1[1] - 0.006, zz), V3(s * (p2[0] - 0.01), p2[1] - 0.014, zz), 0.012, 0.008, null, false);
    }
    pr.uvRect = null; pr.fo = null; pr.matrix(null);
    // underframe equipment
    solid.setClass(EXT).color(0.07, 0.07, 0.075);
    for (const [a, b] of isE ? [[-4.6, -1.4], [0.6, 3.0]] : [[-4.4, -1.2], [1.2, 4.4]]) solid.box(s * 0.82, 0.27, (a + b) / 2, 0.62, 0.3, b - a);
  }
  // ---- roof, ceiling, floor ----
  paint.color(1, 1, 1); profStrip(paint, roofProf, zA, zB, false);
  solid.setClass(PANEL).color(0.69, 0.65, 0.53); profStrip(solid, ceilProf, zA, isE ? ZS + 0.02 : zB, true);
  solid.setClass(FLOORC).color(0.17, 0.125, 0.095).quad(V3(-HI, FL, zB), V3(HI, FL, zB), V3(HI, FL, zA), V3(-HI, FL, zA), V3(0, 1, 0));
  solid.setClass(EXT).color(0.06, 0.06, 0.065).quad(V3(-HW + 0.05, Y_SK, zA), V3(HW - 0.05, Y_SK, zA), V3(HW - 0.05, Y_SK, zB), V3(-HW + 0.05, Y_SK, zB), V3(0, -1, 0));
  // ---- gangway end walls + (cab bulkhead | second end wall) ----
  const section = [[-HW, Y_SK], [HW, Y_SK]]; for (const p of roofProf) section.push([p[0], p[1]]); for (let i = roofProf.length - 2; i >= 0; i--) section.push([-roofProf[i][0], roofProf[i][1]]);
  const ends = isE ? [-1] : [-1, 1];
  for (const e of ends) {
    paint.color(0.05, 0.05, 0.055); solid.setClass(PANEL).color(...CREAM);
    const sg = new Geo({ local: true }); sg.matrix(M4); sg.setClass(RUBBER_IN).color(...DARK);
    plate(section, [roundRect(-0.6, FL, 0.6, FL + 1.95, 0.12, 4)], (u, v, d) => V3(u, v, e * (HL - (1 - d) * WT)), 0, 1, paint, solid, sg, { outerSide: false });
    solid.add(sg);
  }
  if (isE) {
    const isec = [[-HI, FL], [HI, FL]]; for (const p of ceilProf) isec.push([p[0], p[1]]); for (let i = ceilProf.length - 2; i >= 0; i--) isec.push([-ceilProf[i][0], ceilProf[i][1]]);
    const gA = new Geo({ local: true }), gB = new Geo({ local: true }), gS = new Geo({ local: true });
    for (const g of [gA, gB, gS]) g.matrix(M4);
    gA.setClass(PANEL).color(0.06, 0.065, 0.07); gB.setClass(PANEL).color(...CREAM); gS.setClass(METAL_IN).color(...STEELC);
    plate(isec, [roundRect(-0.27, FL + 0.98, 0.27, FL + 1.72, 0.07, 4)], (u, v, d) => V3(u, v, BULK + d * 0.04), 0, 1, gA, gB, gS, { outerSide: false });
    solid.add(gA).add(gB).add(gS);
    glass.setClass(7).quad(V3(-0.29, FL + 0.96, BULK + 0.02), V3(0.29, FL + 0.96, BULK + 0.02), V3(0.29, FL + 1.74, BULK + 0.02), V3(-0.29, FL + 1.74, BULK + 0.02), V3(0, 0, 1));
    solid.setClass(WOOD).color(0.22, 0.12, 0.055);
    for (const x of [-0.38, 0.38]) solid.box(x, FL + 1.0, BULK - 0.008, 0.035, 2.0, 0.016);
    solid.box(0, FL + 2.0, BULK - 0.008, 0.8, 0.035, 0.016);
    solid.setClass(METAL_IN).color(...BRASS).box(0.3, FL + 1.02, BULK - 0.03, 0.03, 0.12, 0.04);
    // nose
    const nose = buildNose(G);
    // head / tail lamps
    for (const s of [-1, 1]) {
      const h = nose.at(s * 0.60, 1.2);
      solid.setClass(METAL).color(...STEELC).cyl(h.p.clone().addScaledVector(h.n, -0.03), h.p.clone().addScaledVector(h.n, 0.035), 0.125, 0.118, 14);
      lamp.color(0.42, 0.39, 0.33); lamp.fo = [12, 150, endSign, 1];
      lamp.cyl(h.p.clone().addScaledVector(h.n, 0.0), h.p.clone().addScaledVector(h.n, 0.03), 0.105, 0.09, 14, true);
      const t = nose.at(s * 0.86, 0.80);
      solid.color(0.4, 0.4, 0.42).cyl(t.p.clone().addScaledVector(t.n, -0.03), t.p.clone().addScaledVector(t.n, 0.03), 0.07, 0.066, 10); solid.color(...STEELC);
      lamp.color(0.5, 0.02, 0.01); lamp.fo = [10, 30, endSign, 2];
      lamp.cyl(t.p.clone(), t.p.clone().addScaledVector(t.n, 0.027), 0.06, 0.052, 10, true);
      lamp.fo = null;
    }
    // bumper + coupler + destination box
    solid.setClass(EXT).color(0.10, 0.10, 0.11);
    for (let i = 0; i < 28; i++) { const x0 = -1.12 + i * 2.24 / 28, x1 = x0 + 2.24 / 28 * 1.04; const a = nose.at(Math.abs(x0) < 1e-4 ? 1e-4 : x0, 0.66), b = nose.at(Math.abs(x1) < 1e-4 ? 1e-4 : x1, 0.66); solid.beam(a.p.clone().addScaledVector(a.n, 0.012), b.p.clone().addScaledVector(b.n, 0.012), 0.05, 0.11, V3(0, 1, 0), false); }
    solid.setClass(EXT).color(0.05, 0.05, 0.055).box(0, 0.47, ZS + LN - 0.1, 0.22, 0.16, 0.6);
    const zt = nose.tipZ(2.97);
    paint.color(0.05, 0.05, 0.055).box(0, 2.985, zt - 0.14, 1.02, 0.235, 0.36);
    G.destZ.push({ z: zc + mir * (zt + 0.043), dir: mir });
  }
  // ---- ceiling lamps ----
  const lz0 = zA + 0.75, lz1 = (isE ? BULK : HL) - 0.75, nl = Math.round((lz1 - lz0) / 1.45);
  for (let i = 0; i <= nl; i++) {
    const z = lz0 + (lz1 - lz0) * i / nl;
    solid.setClass(METAL_IN).color(...BRASS).cyl(V3(0, Y_CEIL - 0.02, z), V3(0, Y_CEIL + 0.0, z), 0.135, 0.135, 14);
    solid.cyl(V3(0, Y_CEIL - 0.02, z), V3(0, Y_CEIL - 0.021, z), 0.135, 0.105, 14);
    lamp.color(1.0, 0.80, 0.52); lamp.fo = [0.12, 26, 0, 0];
    const pts = []; for (let k = 0; k <= 5; k++) { const a = -Math.PI / 2 + k / 5 * Math.PI / 2; pts.push([Math.max(1e-3, Math.cos(a) * 0.105), Math.sin(a) * 0.055]); }
    lamp.lathe(V3(0, Y_CEIL - 0.02, z), pts, 14); lamp.fo = null;
  }
  // floor hatches
  for (const z of isE ? [-1.3, 1.5] : [-1.3, 1.5, 5.6, -5.6]) {
    solid.setClass(FLOORC).color(0.21, 0.165, 0.13).box(0, FL + 0.002, z, 0.5, 0.004, 0.62, 'b');
    solid.setClass(METAL_IN).color(...BRASS);
    for (const e of [-0.31, 0.31]) solid.box(0, FL + 0.004, z + e, 0.54, 0.008, 0.018, 'b');
    for (const e of [-0.26, 0.26]) solid.box(e, FL + 0.004, z, 0.018, 0.008, 0.62, 'b');
  }
  // vestibule poles
  solid.setClass(CHROME).color(0.80, 0.80, 0.82);
  for (const c of doors) solid.cyl(V3(0, FL, c), V3(0, Y_CEIL, c), 0.018, 0.018, hi ? 14 : 8);
  // ---- roof equipment ----
  solid.setClass(EXT).color(0.22, 0.23, 0.24);
  if (!isE) { for (const z of [-3.0, 3.0]) { solid.box(0, Y_ROOF + 0.1, z, 1.5, 0.26, 2.7); solid.color(0.12, 0.12, 0.13).box(0, Y_ROOF + 0.24, z, 1.3, 0.03, 2.5); solid.color(0.22, 0.23, 0.24); } }
  else {
    solid.box(0, Y_ROOF + 0.09, -4.2, 1.4, 0.24, 2.2);
    for (let i = 0; i < 4; i++) solid.lathe(V3(0, Y_ROOF - 0.03, -1.6 + i * 1.6), [[0.07, 0], [0.07, 0.1], [0.17, 0.12], [0.15, 0.18], [0.02, 0.2]], 10);
  }
  solid.setClass(EXT).color(0.2, 0.17, 0.14).box(0, Y_ROOF + 0.0, (zA + zB) / 2 + (isE ? 0.6 : 0), 0.36, 0.03, isE ? 3.2 : 1.6);
  for (const k of ['paint', 'solid', 'glass', 'lamp']) G[k].matrix(null);
}

function buildBellows(G, z0, z1) {
  const g = G.solid; const loop = roundRect(-0.71, FL - 0.1, 0.71, FL + 2.07, 0.14, 3); const N = 8; const cy = FL + 0.985;
  const ring = k => { const sc = k % 2 ? 1.075 : 1.0, z = z0 + (z1 - z0) * k / N; return loop.map(p => V3(p[0] * sc, cy + (p[1] - cy) * sc, z)); };
  for (let k = 0; k < N; k++) {
    const A = ring(k), B = ring(k + 1);
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      g.setClass(RUBBER).color(0.035, 0.035, 0.04).quad(A[i], A[j], B[j], B[i]);
      g.setClass(RUBBER_IN).color(0.05, 0.05, 0.055).quad(A[j], A[i], B[i], B[j]);
    }
  }
  g.setClass(METAL_IN).color(0.2, 0.2, 0.21).box(0, FL + 0.005, (z0 + z1) / 2, 1.24, 0.012, z1 - z0 + 0.16);
}

function buildBogie(G, zc) {
  const g = G.solid;
  for (const dz of [-0.95, 0.95]) {
    for (const sx of [-1, 1]) {
      g.setClass(EXT).color(0.13, 0.11, 0.10).cyl(V3(sx * 0.665, 0.36, zc + dz), V3(sx * 0.775, 0.36, zc + dz), 0.36, 0.36, 28, true);
      g.cyl(V3(sx * 0.63, 0.36, zc + dz), V3(sx * 0.665, 0.36, zc + dz), 0.385, 0.385, 28, true);
      g.setClass(EXT).color(0.06, 0.06, 0.065).box(sx * 0.95, 0.36, zc + dz, 0.16, 0.24, 0.3);
      g.cyl(V3(sx * 0.95, 0.48, zc + dz - 0.24), V3(sx * 0.95, 0.66, zc + dz - 0.24), 0.055, 0.055, 7);
      g.cyl(V3(sx * 0.95, 0.48, zc + dz + 0.24), V3(sx * 0.95, 0.66, zc + dz + 0.24), 0.055, 0.055, 7);
    }
    g.setClass(EXT).color(0.07, 0.07, 0.07).cyl(V3(-0.66, 0.36, zc + dz), V3(0.66, 0.36, zc + dz), 0.06, 0.06, 7);
  }
  g.setClass(EXT).color(0.06, 0.06, 0.065);
  for (const sx of [-1, 1]) {
    g.box(sx * 0.95, 0.60, zc, 0.1, 0.16, 2.6); g.box(sx * 0.95, 0.2, zc, 0.06, 0.08, 1.3);
    g.color(0.2, 0.15, 0.1).box(sx * 1.1, 0.2, zc, 0.07, 0.07, 1.5); g.color(0.06, 0.06, 0.065);
    g.setClass(METAL).color(0.4, 0.4, 0.42).box(sx * 1.14, 0.085, zc, 0.09, 0.03, 0.34); g.setClass(EXT).color(0.06, 0.06, 0.065);
    g.box(sx * 1.12, 0.14, zc, 0.03, 0.1, 0.08);
  }
  g.box(0, 0.56, zc, 2.0, 0.18, 0.5);
  g.box(0, 0.36, zc, 0.5, 0.3, 0.9);
  // arc points at the collector shoes (aFace: z = side sign, w = 3 + shoe id -> random flashes in the lamp shader)
  const l = G.lamp; l.color(0.55, 0.75, 1.0);
  for (const sx of [-1, 1]) { l.fo = [260, 260, sx, 3 + ((Math.round(zc * 7) + (sx > 0 ? 3 : 0)) % 9 + 9) % 9]; l.sphere(V3(sx * 1.14, 0.075, zc + 0.15), 0.035, 6, 4); }
  l.fo = null;
}

function strapGeometry(hi) {
  const g = new Geo({ local: true });
  const cy = -0.268, R = 0.052, r = 0.0078, W = 0.026, t = 0.0032;
  // leather band: one loop around the rail and the ring, pinched by two stitched keepers
  const path = [];
  const arc = (cx, cyy, rad, a0, a1, n) => { for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * PI / 180; path.push([cx + rad * Math.cos(a), cyy + rad * Math.sin(a)]); } };
  arc(0, 0.02, 0.0205, -55, 235, hi ? 14 : 6);
  path.push([-0.0036, -0.045], [-0.0036, -0.188]);
  arc(0, cy + R, r + 0.0028, 125, 415, hi ? 10 : 5);
  path.push([0.0036, -0.188], [0.0036, -0.045]);
  const P = polyProf(path, true, true); P.push(P[0]);
  g.setClass(LEATHER).color(0.21, 0.105, 0.05);
  extrudeZ(g, P.map(p => [p[0] + p[2] * t / 2, p[1] + p[3] * t / 2, p[2], p[3]]), -W / 2, W / 2);
  extrudeZ(g, P.map(p => [p[0] - p[2] * t / 2, p[1] - p[3] * t / 2, -p[2], -p[3]]), -W / 2, W / 2);
  if (hi) for (const z of [-W / 2, W / 2]) for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], o = (p, k) => V3(p[0] + k * p[2] * t / 2, p[1] + k * p[3] * t / 2, z), dz = V3(0, 0, Math.sign(z));
    g.triDir(o(a, 1), o(b, 1), o(b, -1), dz); g.triDir(o(a, 1), o(b, -1), o(a, -1), dz);
  }
  g.color(0.15, 0.07, 0.035);
  g.rbeam(V3(0, -0.078, 0), V3(0, -0.046, 0), W + 0.004, 0.0125, 0.003, null, hi ? 2 : 1, true);
  g.rbeam(V3(0, -0.192, 0), V3(0, -0.176, 0), W + 0.004, 0.0125, 0.003, null, hi ? 2 : 1, true);
  if (hi) { g.setClass(METAL_IN).color(...BRASS); g.cyl(V3(-0.0085, -0.062, 0), V3(0.0085, -0.062, 0), 0.0042, 0.0042, 8, true); }
  // smooth ring handle (ivory plastic)
  g.setClass(PLASTIC).color(0.78, 0.71, 0.56);
  g.torus(V3(0, cy, 0), V3(1, 0, 0), R, r, hi ? 36 : 14, hi ? 10 : 5);
  return g.build();
}

/** builds all tram geometry once (shared by both trams). A = print atlas */
export function buildTramGeometry(A) {
  const G = { paint: new Geo({ local: true }), solid: new Geo({ local: true }), glass: new Geo({ local: true }), lamp: new Geo({ local: true }), print: new Geo(), destZ: [] };
  const P = DIM.PITCH;
  buildCar(G, 'E', -P, -1, -1, A);
  buildCar(G, 'M', 0, 1, 0, A);
  buildCar(G, 'E', P, 1, 1, A);
  buildBellows(G, -P + HL, -HL); buildBellows(G, HL, P - HL);
  for (const z of [-P - 4.6, -P / 2, P / 2, P + 4.6]) buildBogie(G, z);
  // destination blinds (tram-local so the lettering is never mirrored); aFace.z = atlas v-offset for the northbound text
  const rS = A.rect('destS'), rN = A.rect('destN');
  for (const d of G.destZ) signQuad(G.print, V3(0, 2.985, d.z), V3(0, 0, d.dir), 0.93, 0.155, rS, [0.9, 7, rN[1] - rS[1], 0]);
  // enamel route-number plates below the cab side windows
  for (const c of [-1, 1]) for (const s of [-1, 1]) signQuad(G.print, V3(s * (HW + 0.004), 1.24, c * (P + 4.93)), V3(s, 0, 0), 0.34, 0.34, A.rect('num'), [0, 0, 0, 0]);
  // strap pivots (on the two overhead rails)
  const straps = [];
  for (const s of [-1, 1]) for (let c = -1; c <= 1; c++) {
    const z0 = -HL + 0.75, z1 = (c === 0 ? HL : BULK - 0.15) - 0.75; const n = Math.round((z1 - z0) / 0.46);
    for (let i = 0; i <= n; i++) { const zl = z0 + (z1 - z0) * i / n; straps.push([s * T.RAIL_X, T.RAIL_Y - 0.02, c * P + (c < 0 ? -zl : zl), straps.length, c === 0 ? 1 : 0]); }
  }
  return { paint: G.paint.build(), solid: G.solid.build(), glass: G.glass.build(), lamp: G.lamp.build(), print: G.print.build(), strapGeo: strapGeometry(true), strapGeoLo: strapGeometry(false), straps };
}
