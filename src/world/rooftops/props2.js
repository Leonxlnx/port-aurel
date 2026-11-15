// Roofscape pass 2 prototypes: leafy planting (replaces the blob topiary of props.js), chimney pots, washing,
// terrace furniture, pigeon lofts and old guyed aerial poles. Real-world scale, origin = centre of the base.
import * as THREE from 'three';
import { Geo, lin, TRS } from './kit.js';
import { M } from './materials.js';
import { COLORS as C } from './props.js';

const _nrm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const _cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** scatter leaf kites over the shells of a set of ellipsoid lobes; soft "puffy" normals so the mass shades as one volume */
function leafCloud(g, rng, lobes, n, L, W, centre, opt = {}) {
  const { up = 0.0, droop = 0.25, under = -0.45 } = opt;
  const wsum = lobes.reduce((s, l) => s + l.r[0] * l.r[2], 0);
  let made = 0, guard = 0;
  while (made < n && guard++ < n * 6) {
    let pick = rng() * wsum, lb = lobes[0];
    for (const l of lobes) { pick -= l.r[0] * l.r[2]; if (pick <= 0) { lb = l; break; } }
    const u = rng() * 2 - 1, th = rng() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const d = [s * Math.cos(th), u, s * Math.sin(th)];
    if (d[1] < under) continue;
    const bump = 1 + 0.2 * Math.sin(th * 3 + lb.ph) * Math.sin(u * 4 + lb.ph * 1.7);
    const f = (rng() < 0.07 ? 1.12 + 0.22 * rng() : 0.78 + 0.32 * rng()) * bump;
    const p = [lb.c[0] + d[0] * lb.r[0] * f, lb.c[1] + d[1] * lb.r[1] * f, lb.c[2] + d[2] * lb.r[2] * f];
    let hidden = false;
    for (const o of lobes) if (o !== lb && Math.hypot((p[0] - o.c[0]) / o.r[0], (p[1] - o.c[1]) / o.r[1], (p[2] - o.c[2]) / o.r[2]) < 0.78) { hidden = true; break; }
    if (hidden || p[1] < 0.03) continue;
    const rv = [rng() - 0.5, rng() - 0.5, rng() - 0.5];
    const a = _nrm([d[0] * 0.55 + rv[0] * 1.5, d[1] * 0.55 + rv[1] * 1.5 - droop + up, d[2] * 0.55 + rv[2] * 1.5]);
    const ln = _nrm([d[0] + (rng() - 0.5) * 0.9, d[1] + (rng() - 0.5) * 0.9 + 0.2, d[2] + (rng() - 0.5) * 0.9]);
    const b = _nrm(_cross(a, ln));
    const len = L[0] + (L[1] - L[0]) * rng(), wid = W[0] + (W[1] - W[0]) * rng();
    const tip = [p[0] + a[0] * len, p[1] + a[1] * len, p[2] + a[2] * len];
    const k = 0.42, q = wid * 0.18;
    const mx = [p[0] + a[0] * len * k + ln[0] * q, p[1] + a[1] * len * k + ln[1] * q, p[2] + a[2] * len * k + ln[2] * q];
    const lf = [mx[0] + b[0] * wid * 0.5, mx[1] + b[1] * wid * 0.5, mx[2] + b[2] * wid * 0.5], rt = [mx[0] - b[0] * wid * 0.5, mx[1] - b[1] * wid * 0.5, mx[2] - b[2] * wid * 0.5];
    const pn = _nrm([d[0] * 0.6 + (p[0] - centre[0]) * 0.6, d[1] * 0.6 + (p[1] - centre[1]) * 0.5 + 0.38, d[2] * 0.6 + (p[2] - centre[2]) * 0.6]);
    const t = (0.5 + 0.5 * rng()) * (0.7 + 0.55 * Math.min(1, Math.max(0, (f / bump - 0.78) / 0.34)));
    g.set([t * (0.86 + 0.3 * rng()), t, t * (0.78 + 0.3 * rng())], M.PLANT);
    g.quad(p, rt, tip, lf, [0, 0, 1, 1], pn);
    made++;
  }
}
function lobeSet(rng, defs, jit = 0.06) {
  return defs.map(([x, y, z, rx, ry, rz]) => ({ c: [x + (rng() - 0.5) * jit, y + (rng() - 0.5) * jit, z + (rng() - 0.5) * jit], r: [rx, ry, rz ?? rx], ph: rng() * 6.28 }));
}
function cores(g, rng, lobes, k, segW, segH, tone) {
  g.set([tone, tone, tone], M.PLANT);
  const J = []; for (let i = 0; i < 64; i++) J.push((rng() - 0.5) * 0.3);
  for (const l of lobes) {
    g.push(new THREE.Matrix4().makeTranslation(l.c[0], l.c[1], l.c[2]).multiply(new THREE.Matrix4().makeScale(l.r[0] * k, l.r[1] * k, l.r[2] * k)));
    g.sphere(0, 0, 0, 1, segW, segH, 1, (i, j) => J[(i * 7 + j * 13) % 64]); g.pop();
  }
}

/** close-range shrub: woody stems, dark core, ~210 individual leaves; fits the old r 0.5 / 0.95 m envelope */
export function shrubHi(rng) {
  const g = new Geo();
  g.set(lin(0x3a2e22), M.PLANKS);
  for (let i = 0; i < 4; i++) { const a = i * 1.57 + rng(); g.tube([Math.cos(a) * 0.04, 0, Math.sin(a) * 0.04], [Math.cos(a) * 0.2, 0.34, Math.sin(a) * 0.2], 0.018, 0.01, 4); }
  const lobes = lobeSet(rng, [[0, 0.4, 0, 0.38, 0.34, 0.38], [0.2, 0.56, 0.1, 0.25, 0.25, 0.25], [-0.21, 0.5, -0.13, 0.27, 0.23, 0.27], [0.03, 0.72, -0.06, 0.2, 0.19, 0.2], [-0.05, 0.36, 0.24, 0.22, 0.2, 0.22]]);
  cores(g, rng, lobes, 0.7, 5, 3, 0.3);
  leafCloud(g, rng, lobes, 160, [0.1, 0.16], [0.055, 0.085], [0, 0.4, 0]);
  return g.build();
}
/** upright, spiky shrub (oleander / laurel habit) in the same envelope */
export function shrubTall(rng) {
  const g = new Geo();
  g.set(lin(0x3a2e22), M.PLANKS);
  for (let i = 0; i < 5; i++) { const a = i * 1.26 + rng(); g.tube([Math.cos(a) * 0.03, 0, Math.sin(a) * 0.03], [Math.cos(a) * 0.16, 0.6, Math.sin(a) * 0.16], 0.014, 0.008, 4); }
  const lobes = lobeSet(rng, [[0, 0.33, 0, 0.3, 0.3, 0.3], [0.1, 0.6, 0.04, 0.22, 0.28, 0.22], [-0.09, 0.7, -0.06, 0.19, 0.27, 0.19], [0.02, 0.5, -0.17, 0.2, 0.26, 0.2]]);
  cores(g, rng, lobes, 0.62, 5, 3, 0.28);
  leafCloud(g, rng, lobes, 150, [0.14, 0.23], [0.032, 0.052], [0, 0.45, 0], { up: 0.75, droop: 0, under: -0.2 });
  return g.build();
}
/** distant shrub: two ragged cores + a handful of big sprigs so the outline is not a ball */
export function shrub(rng) {
  const g = new Geo();
  const lobes = lobeSet(rng, [[0.02, 0.42, 0, 0.44, 0.42, 0.4]]);
  cores(g, rng, lobes, 0.95, 5, 3, 0.62);
  leafCloud(g, rng, lobes, 8, [0.26, 0.4], [0.16, 0.22], [0, 0.4, 0]);
  return g.build();
}
function treeLobes(rng) {
  return lobeSet(rng, [[0, 2.12, 0, 0.78, 0.66, 0.78], [0.56, 1.8, 0.3, 0.5, 0.42, 0.5], [-0.52, 1.9, -0.36, 0.55, 0.44, 0.55], [-0.16, 2.52, 0.26, 0.48, 0.4, 0.48], [0.3, 2.42, -0.44, 0.42, 0.36, 0.42], [-0.3, 1.62, 0.5, 0.36, 0.3, 0.36]], 0.12);
}
function treeWood(g, lobes) {
  g.set(lin(0x4a3a2c), M.PLANKS);
  g.tube([0, 0, 0], [0.04, 1.3, 0.02], 0.085, 0.06, 6);
  g.tube([0.04, 1.3, 0.02], [0, 2.0, 0], 0.06, 0.035, 5);
  for (let i = 1; i < lobes.length; i++) { const c = lobes[i].c; g.tube([0.03, 1.05 + i * 0.09, 0.02], [c[0] * 0.85, c[1] - 0.05, c[2] * 0.85], 0.035, 0.014, 4); }
}
/** close-range small tree (~3 m): trunk, limbs, dark cores, ~640 leaves */
export function treeHi(rng) {
  const g = new Geo(); const lobes = treeLobes(rng);
  treeWood(g, lobes);
  cores(g, rng, lobes, 0.68, 6, 4, 0.28);
  leafCloud(g, rng, lobes, 640, [0.13, 0.22], [0.07, 0.11], [0, 2.1, 0]);
  return g.build();
}
/** distant small tree */
export function tree(rng) {
  const g = new Geo(); const lobes = treeLobes(rng);
  treeWood(g, lobes);
  cores(g, rng, lobes, 0.9, 5, 3, 0.6);
  leafCloud(g, rng, lobes, 34, [0.34, 0.5], [0.2, 0.28], [0, 2.1, 0]);
  return g.build();
}

/** clay chimney pot ~0.7 m (tint per instance) */
export function chimneyPot() {
  const g = new Geo(); g.set([1, 1, 1], M.CONCRETE);
  g.lathe(0, 0, [[0.15, 0], [0.105, 0.1], [0.085, 0.56], [0.118, 0.62], [0.118, 0.69]], 5);
  g.set([0.12, 0.1, 0.09], M.CONCRETE);
  g.cyl(0, 0.6, 0, 0.1, 0.1, 0.01, 5, { capT: true });
  return g.build();
}

/** hanging bed sheet: 1 x 1 m, top edge on y = 0 along X, hangs down -Y, gently billowed (static) */
export function sheet() {
  const g = new Geo(); g.set([1, 1, 1], M.CLOTH);
  const nx = 6, ny = 4;
  const P = (u, v) => [(u - 0.5) * (1 - 0.05 * v * Math.sin(u * 9.0)), -v, 0.045 * Math.sin(u * 7 + 1) * Math.pow(v, 0.8) + 0.03 * Math.sin(u * 13 + v * 3) * v + 0.1 * v * v * (0.3 + u * 0.6)];
  const N = (u, v) => { const e = 0.01, a = P(u - e, v), b = P(u + e, v), c = P(u, v - e), d = P(u, v + e); return _nrm(_cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - d[0], c[1] - d[1], c[2] - d[2]])); };
  const V = (u, v) => { const p = P(u, v), n = N(u, v); g.vert(p[0], p[1], p[2], n[0], n[1], n[2], u, v); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const u0 = i / nx, u1 = (i + 1) / nx, v0 = j / ny, v1 = (j + 1) / ny;
    V(u0, v1); V(u1, v1); V(u1, v0); V(u0, v1); V(u1, v0); V(u0, v0);
  }
  return g.build();
}

/** bistro set: round table + two folding chairs (painted metal, tint per instance) */
export function bistro() {
  const g = new Geo(); g.set([1, 1, 1], M.PAINT);
  g.cyl(0, 0.7, 0, 0.34, 0.34, 0.03, 10, { capT: true, capB: true });
  g.cyl(0, 0.03, 0, 0.03, 0.03, 0.67, 5, { capT: false });
  g.cyl(0, 0, 0, 0.21, 0.19, 0.03, 8, { capT: true });
  const chair = () => {
    g.box(0, 0.45, 0, 0.38, 0.03, 0.38);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(sx * 0.17, 0.225, sz * 0.17, 0.025, 0.45, 0.025, 'yY');
    for (const sz of [-1, 1]) g.box(-0.18, 0.67, sz * 0.17, 0.025, 0.44, 0.025, 'y');
    g.box(-0.18, 0.8, 0, 0.02, 0.09, 0.36, 'zZ'); g.box(-0.18, 0.64, 0, 0.02, 0.06, 0.36, 'zZ');
  };
  g.push(TRS(-0.66, 0, 0.05, 0.12)); chair(); g.pop();
  g.push(TRS(0.5, 0, 0.5, Math.PI - 0.75)); chair(); g.pop();
  return g.build();
}

/** pigeon loft: timber shed on legs, slatted front with landing board, trap box on the roof; front toward +X */
export function loft() {
  const g = new Geo();
  g.set(lin(0x5a4a3c), M.PLANKS);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(sx * 0.95, 0.25, sz * 0.62, 0.09, 0.5, 0.09, 'yY');
  g.set([1, 1, 1], M.PLANKS);
  g.box(0, 1.3, 0, 2.2, 1.6, 1.5, 'Y');
  g.tri([-1.1, 2.1, 0.75], [1.1, 2.1, 0.75], [1.1, 2.5, 0.75]); g.tri([1.1, 2.1, -0.75], [-1.1, 2.1, -0.75], [1.1, 2.5, -0.75]);
  g.quad([1.1, 2.1, 0.75], [1.1, 2.1, -0.75], [1.1, 2.5, -0.75], [1.1, 2.5, 0.75]);
  // open slatted front
  g.set([0.03, 0.03, 0.03], M.IRON);
  g.box(1.105, 1.55, 0, 0.02, 0.8, 1.2, 'x');
  g.set([1.1, 1.1, 1.1], M.PLANKS);
  for (let i = 0; i < 7; i++) g.box(1.13, 1.55, -0.54 + i * 0.18, 0.03, 0.8, 0.045, 'yY');
  g.box(1.38, 1.12, 0, 0.5, 0.035, 1.3);
  for (const z of [-0.5, 0.5]) g.beam([1.12, 0.8, z], [1.55, 1.1, z], 0.035, 0.035, null, 'zZ');
  // mono-pitch felt roof with overhang
  g.set(C.felt, M.FELT);
  g.quad([-1.25, 2.06, 0.9], [1.3, 2.54, 0.9], [1.3, 2.54, -0.9], [-1.25, 2.06, -0.9]);
  g.quad([-1.25, 2.0, -0.9], [1.3, 2.48, -0.9], [1.3, 2.48, 0.9], [-1.25, 2.0, 0.9]);
  g.quad([1.3, 2.48, 0.9], [1.3, 2.48, -0.9], [1.3, 2.54, -0.9], [1.3, 2.54, 0.9]);
  // trap / landing cage on the roof
  g.set([0.95, 0.95, 0.95], M.PLANKS);
  g.box(-0.2, 2.55, 0.1, 0.7, 0.5, 0.6, 'y');
  g.set([0.03, 0.03, 0.03], M.IRON);
  g.box(0.155, 2.56, 0.1, 0.02, 0.34, 0.44, 'x');
  // side door
  g.set(C.green, M.PAINT);
  g.box(-0.3, 1.25, 0.76, 0.7, 1.4, 0.03);
  return g.build();
}

/** old guyed aerial pole ~5.6 m with cross arms and a folded dipole */
export function whip() {
  const g = new Geo(); g.set(C.galv, M.GALV);
  g.cyl(0, 0, 0, 0.035, 0.022, 5.6, 5, { capT: false });
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.4; g.beam([0, 3.7, 0], [Math.cos(a) * 1.25, 0.02, Math.sin(a) * 1.25], 0.014, 0.014, null, 'zZ'); }
  g.box(0, 5.1, 0, 1.3, 0.03, 0.03, 'xX');
  for (const x of [-0.62, -0.2, 0.2, 0.62]) g.box(x, 5.1, 0, 0.022, 0.022, 0.62 - Math.abs(x) * 0.25, 'zZ');
  g.box(0, 4.35, 0, 0.03, 0.03, 0.95, 'zZ');
  g.box(0, 4.35, 0.46, 0.02, 0.5, 0.02, 'yY'); g.box(0, 4.35, -0.46, 0.02, 0.5, 0.02, 'yY');
  g.set(C.dark, M.IRON);
  g.box(0, 0.04, 0, 0.3, 0.08, 0.3, 'y');
  return g.build();
}
