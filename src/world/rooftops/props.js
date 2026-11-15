// Prototype geometries of the rooftop equipment kit (real-world scale, metres; origin = centre of the base on the roof).
import * as THREE from 'three';
import { Geo, lin, TRS } from './kit.js';
import { M } from './materials.js';

const C = {
  iron: lin(0x4a4744), galv: lin(0xa9adb0), wood: lin(0x7a5236), plank: lin(0x8a6a4c), felt: lin(0x3c3a3a),
  white: lin(0xd9d6cc), beige: lin(0xb9b2a0), grey: lin(0x8d9094), dark: lin(0x2a2b2d), green: lin(0x3f5a45),
  red: lin(0xb3291c), cream: lin(0xe6e0cf), leaf: [0.62, 0.62, 0.62],
};
export const COLORS = C;

function ladder(g, x, z, y0, y1, w = 0.42, axis = 'z') {
  // two rails + rungs; rails are separated along `axis`
  const r = 0.045;
  const off = axis === 'z' ? [0, w / 2] : [w / 2, 0];
  g.set(C.galv, M.GALV);
  g.box(x - off[0], (y0 + y1) / 2, z - off[1], r, y1 - y0, r, 'yY');
  g.box(x + off[0], (y0 + y1) / 2, z + off[1], r, y1 - y0, r, 'yY');
  const n = Math.max(2, Math.round((y1 - y0) / 0.55));
  for (let i = 0; i < n; i++) {
    const y = y0 + (i + 0.6) * (y1 - y0) / n;
    if (axis === 'z') g.box(x, y, z, 0.03, 0.03, w, 'zZ'); else g.box(x, y, z, w, 0.03, 0.03, 'xX');
  }
}

/** classic wooden water tank on a steel frame. Body r 1.8, total height ~7.2 m at scale 1 */
export function tankHi() {
  const g = new Geo(); const legH = 2.5, R = 1.8, H = 3.3, s = 1.25;
  g.set(C.iron, M.IRON);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(sx * s, legH / 2, sz * s, 0.15, legH, 0.15, 'yY');
  // top frame + mid ties
  for (const sz of [-1, 1]) { g.box(0, legH - 0.1, sz * s, 2 * s + 0.15, 0.2, 0.12); g.box(0, legH * 0.45, sz * s, 2 * s, 0.07, 0.07, 'xX'); }
  for (const sx of [-1, 1]) { g.box(sx * s, legH - 0.1, 0, 0.12, 0.2, 2 * s + 0.15); g.box(sx * s, legH * 0.45, 0, 0.07, 0.07, 2 * s, 'zZ'); }
  // X bracing on the four sides (lower bay)
  const yb0 = 0.08, yb1 = legH * 0.45;
  for (const sz of [-1, 1]) { g.beam([-s, yb0, sz * s], [s, yb1, sz * s], 0.045, 0.06, null, 'zZ'); g.beam([s, yb0, sz * s], [-s, yb1, sz * s], 0.045, 0.06, null, 'zZ'); }
  for (const sx of [-1, 1]) { g.beam([sx * s, yb0, -s], [sx * s, yb1, s], 0.045, 0.06, null, 'zZ'); g.beam([sx * s, yb0, s], [sx * s, yb1, -s], 0.045, 0.06, null, 'zZ'); }
  // timber deck
  g.set(C.plank, M.PLANKS);
  g.cyl(0, legH, 0, R + 0.22, R + 0.22, 0.14, 12, { capT: true, capB: true });
  // staves
  g.set(C.wood, M.STAVES);
  g.cyl(0, legH + 0.14, 0, R, R * 0.955, H, 18, { capT: false });
  // conical roof with a small overhang + hatch finial
  g.set(C.felt, M.FELT);
  g.cyl(0, legH + 0.14 + H - 0.02, 0, R * 1.07, 0.16, 1.05, 16, { capT: false, capB: true });
  g.set(C.galv, M.GALV);
  g.cyl(0, legH + 0.14 + H + 1.0, 0, 0.17, 0.17, 0.2, 6, { capT: false });
  g.cyl(0, legH + 0.14 + H + 1.2, 0, 0.26, 0.0, 0.2, 6, { capT: false, smooth: false });
  // ladder up the side + overflow / riser pipes
  ladder(g, R + 0.12, 0, 0, legH + 0.14 + H * 0.96, 0.42, 'z');
  g.set(C.iron, M.IRON);
  g.cyl(-0.5, 0, 0.4, 0.09, 0.09, legH, 6, { capT: false });
  g.cyl(0.45, 0, -0.5, 0.05, 0.05, legH, 5, { capT: false });
  return g.build();
}

/** distant / cheap variant of the wooden tank */
export function tankLo() {
  const g = new Geo(); const legH = 2.5, R = 1.8, H = 3.3, s = 1.25;
  g.set(C.iron, M.IRON);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(sx * s, legH / 2, sz * s, 0.16, legH, 0.16, 'yY');
  for (const sz of [-1, 1]) g.beam([-s, 0.1, sz * s], [s, legH * 0.9, sz * s], 0.06, 0.07, null, 'zZ');
  for (const sx of [-1, 1]) g.beam([sx * s, 0.1, -s], [sx * s, legH * 0.9, s], 0.06, 0.07, null, 'zZ');
  g.set(C.plank, M.PLANKS);
  g.cyl(0, legH, 0, R + 0.22, R + 0.22, 0.14, 8, { capT: false, capB: true });
  g.set(C.wood, M.STAVES);
  g.cyl(0, legH + 0.14, 0, R, R * 0.955, H, 10, { capT: false });
  g.set(C.felt, M.FELT);
  g.cyl(0, legH + 0.14 + H - 0.02, 0, R * 1.07, 0.0, 1.2, 10, { capT: false });
  return g.build();
}

/** squat galvanised steel tank on low dunnage (modern buildings) */
export function tankSteel() {
  const g = new Geo(); const R = 1.7, H = 2.6;
  g.set(C.iron, M.IRON);
  for (const sz of [-0.9, 0.9]) g.box(0, 0.3, sz, 3.6, 0.22, 0.16);
  for (const sx of [-1.3, 0, 1.3]) g.box(sx, 0.52, 0, 0.16, 0.22, 2.6);
  g.set(C.galv, M.GALV);
  g.cyl(0, 0.63, 0, R, R, H, 14, { capT: false });
  g.cyl(0, 0.63 + H, 0, R, 0.25, 0.42, 14, { capT: true });
  for (const y of [1.3, 2.2]) g.cyl(0, y, 0, R + 0.035, R + 0.035, 0.07, 14, { capT: false });
  g.cyl(0.6, 0.63 + H + 0.25, 0.2, 0.3, 0.3, 0.2, 6, { capT: true });
  ladder(g, R + 0.1, 0, 0.3, 0.63 + H + 0.25, 0.4, 'z');
  g.set(C.iron, M.IRON);
  g.cyl(-R - 0.2, 0, 0.5, 0.07, 0.07, 1.4, 5, { capT: false });
  return g.build();
}

/** small packaged AC unit 1.5 x 1.0 x 1.0 with a top fan */
export function acSmall() {
  const g = new Geo();
  g.set(C.dark, M.IRON);
  g.box(-0.55, 0.06, 0, 0.1, 0.12, 0.95, 'y'); g.box(0.55, 0.06, 0, 0.1, 0.12, 0.95, 'y');
  g.set([1, 1, 1], M.PAINT);
  g.box(0, 0.62, 0, 1.5, 1.0, 1.0, 'yzZ');
  g.set([1, 1, 1], M.LOUVER);
  g.quad([-0.75, 0.12, 0.5], [0.75, 0.12, 0.5], [0.75, 1.12, 0.5], [-0.75, 1.12, 0.5]);
  g.quad([0.75, 0.12, -0.5], [-0.75, 0.12, -0.5], [-0.75, 1.12, -0.5], [0.75, 1.12, -0.5]);
  g.set([0.8, 0.8, 0.8], M.PAINT);
  g.cyl(0, 1.12, 0, 0.42, 0.42, 0.1, 10, { capT: true, capMat: M.FAN });
  return g.build();
}

/** large roof-top unit 3.0 x 1.6 x 1.5 with two fans and an intake hood */
export function acLarge() {
  const g = new Geo();
  g.set(C.dark, M.IRON);
  g.box(0, 0.09, -0.65, 3.0, 0.18, 0.12, 'y'); g.box(0, 0.09, 0.65, 3.0, 0.18, 0.12, 'y');
  g.set([1, 1, 1], M.PAINT);
  g.box(0, 0.93, 0, 3.0, 1.5, 1.6, 'yZ');
  g.set([1, 1, 1], M.LOUVER);
  g.quad([-1.5, 0.18, 0.8], [1.5, 0.18, 0.8], [1.5, 1.68, 0.8], [-1.5, 1.68, 0.8]);
  g.set([0.8, 0.8, 0.8], M.PAINT);
  g.cyl(-0.7, 1.68, 0, 0.55, 0.55, 0.14, 10, { capT: true, capMat: M.FAN });
  g.cyl(0.7, 1.68, 0, 0.55, 0.55, 0.14, 10, { capT: true, capMat: M.FAN });
  // intake hood on one end
  g.set([0.9, 0.9, 0.9], M.PAINT);
  g.quad([1.5, 1.5, 0.6], [2.1, 0.9, 0.6], [2.1, 0.9, -0.6], [1.5, 1.5, -0.6]);
  g.tri([1.5, 1.5, 0.6], [1.5, 0.9, 0.6], [2.1, 0.9, 0.6]); g.tri([1.5, 1.5, -0.6], [2.1, 0.9, -0.6], [1.5, 0.9, -0.6]);
  return g.build();
}

/** round bottle-type cooling tower, 3 m diameter, 3.6 m tall */
export function coolingRound() {
  const g = new Geo();
  g.set(C.dark, M.IRON);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.78; g.box(Math.cos(a) * 1.15, 0.3, Math.sin(a) * 1.15, 0.12, 0.6, 0.12, 'yY'); }
  g.set([1, 1, 1], M.PAINT);
  g.lathe(0, 0, [[1.25, 0.55], [1.5, 0.95], [1.5, 1.25]], 12);
  g.set([0.8, 0.8, 0.8], M.LOUVER);
  g.cyl(0, 1.25, 0, 1.42, 1.3, 0.6, 12, { capT: false });
  g.set([1, 1, 1], M.PAINT);
  g.lathe(0, 0, [[1.34, 1.85], [1.12, 2.8], [1.22, 3.4]], 12);
  g.set([0.7, 0.7, 0.7], M.PAINT);
  g.cyl(0, 3.3, 0, 1.2, 1.2, 0.1, 12, { capT: true, capMat: M.FAN });
  g.cyl(0, 0.55, 0, 1.25, 1.25, 0.01, 12, { capT: false, capB: true });
  g.set(C.iron, M.IRON);
  g.cyl(1.55, 0, 0.3, 0.09, 0.09, 1.1, 5, { capT: false });
  return g.build();
}

/** box cooling tower 3.4 x 3.4 x 3.2 with a fan stack */
export function coolingBox() {
  const g = new Geo();
  g.set(C.dark, M.IRON);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(sx * 1.5, 0.3, sz * 1.5, 0.16, 0.6, 0.16, 'yY');
  g.box(0, 0.62, -1.5, 3.3, 0.14, 0.14); g.box(0, 0.62, 1.5, 3.3, 0.14, 0.14);
  g.set([1, 1, 1], M.PAINT);
  g.box(0, 2.0, 0, 3.4, 2.7, 3.4, 'xX');
  g.set([1, 1, 1], M.LOUVER);
  g.quad([1.7, 0.65, 1.7], [1.7, 0.65, -1.7], [1.7, 3.35, -1.7], [1.7, 3.35, 1.7]);
  g.quad([-1.7, 0.65, -1.7], [-1.7, 0.65, 1.7], [-1.7, 3.35, 1.7], [-1.7, 3.35, -1.7]);
  g.set([0.75, 0.75, 0.75], M.PAINT);
  g.cyl(0, 3.35, 0, 1.3, 1.15, 0.75, 12, { capT: true, capMat: M.FAN });
  g.set(C.iron, M.IRON);
  g.cyl(1.9, 0, -0.8, 0.11, 0.11, 1.6, 5, { capT: false });
  return g.build();
}

/** mushroom roof vent ~0.75 m */
export function mushroom() {
  const g = new Geo(); g.set(C.galv, M.GALV);
  g.cyl(0, 0, 0, 0.14, 0.14, 0.5, 5, { capT: false });
  g.cyl(0, 0.44, 0, 0.36, 0.36, 0.1, 7, { capT: false });
  g.cyl(0, 0.54, 0, 0.36, 0.0, 0.2, 7, { capT: false });
  return g.build();
}

/** turbine ventilator ~1 m */
export function turbine() {
  const g = new Geo(); g.set(C.galv, M.GALV);
  g.cyl(0, 0, 0, 0.2, 0.17, 0.5, 6, { capT: false });
  g.sphere(0, 0.78, 0, 0.34, 8, 4, 0.9);
  return g.build();
}

/** yagi TV aerial on a mast; height ~3 m, boom along +X */
export function aerial() {
  const g = new Geo(); g.set(C.galv, M.GALV);
  g.cyl(0, 0, 0, 0.03, 0.025, 3.0, 4, { capT: false });
  g.box(0.25, 2.85, 0, 1.5, 0.035, 0.035, 'xX');
  const n = 6;
  for (let i = 0; i < n; i++) { const x = -0.4 + i * 0.26; const L = i === 0 ? 1.05 : 0.9 - i * 0.07; g.box(x, 2.85, 0, 0.03, 0.03, L, 'zZ'); }
  g.box(-0.4, 2.85, 0, 0.03, 0.34, 0.03, 'yY');
  // second smaller array lower on the mast
  g.box(0, 2.2, 0.0, 0.035, 0.035, 0.9, 'zZ');
  for (let i = 0; i < 3; i++) g.box(0, 2.2, -0.3 + i * 0.3, 0.6 - i * 0.08, 0.03, 0.03, 'xX');
  return g.build();
}

/** satellite dish ~0.9 m on a short post; looks along +X, tilted up */
export function dish() {
  const g = new Geo();
  g.set(C.galv, M.GALV);
  g.cyl(0, 0, 0, 0.035, 0.035, 0.8, 5, { capT: false });
  const tilt = new THREE.Matrix4().makeTranslation(0, 0.85, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 + 0.5));
  g.push(tilt);
  g.set(C.white, M.PAINT);
  g.lathe(0, 0, [[0.02, 0.0], [0.28, 0.05], [0.47, 0.15]], 10);            // back (convex) side faces outward
  g.set(mulc(C.white, 0.8), M.PAINT);
  latheInv(g, [[0.02, 0.012], [0.28, 0.062], [0.47, 0.162]], 10);            // inner (concave) face
  g.set(C.dark, M.IRON);
  g.beam([0.0, 0.03, 0], [0.0, 0.5, 0], 0.025, 0.025, [1, 0, 0], 'zZ');
  g.box(0, 0.52, 0, 0.07, 0.1, 0.07);
  g.pop();
  return g.build();
}
function mulc(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
// inward-facing lathe (for the concave side of a dish)
function latheInv(g, profile, seg) {
  for (let k = 0; k < profile.length - 1; k++) {
    const [r0, y0] = profile[k], [r1, y1] = profile[k + 1];
    for (let i = 0; i < seg; i++) {
      const aa = (i / seg) * Math.PI * 2, ab = ((i + 1) / seg) * Math.PI * 2;
      const A = [Math.cos(aa) * r0, y0, Math.sin(aa) * r0], B = [Math.cos(ab) * r0, y0, Math.sin(ab) * r0];
      const Cc = [Math.cos(ab) * r1, y1, Math.sin(ab) * r1], D = [Math.cos(aa) * r1, y1, Math.sin(aa) * r1];
      const am = (aa + ab) / 2;
      g.quad(A, B, Cc, D, [0, 0, 1, 1], [-Math.cos(am) * (y1 - y0), r1 - r0, -Math.sin(am) * (y1 - y0)]);
    }
  }
}

/** solar array: 3 panels (3.2 x 1.7 m) tilted 24 deg toward +Z */
export function solar() {
  const g = new Geo(); const t = 0.42;
  g.set(C.galv, M.GALV);
  for (const x of [-1.4, 1.4]) { g.box(x, 0.45, -0.72, 0.05, 0.9, 0.05, 'yY'); g.box(x, 0.12, 0.72, 0.05, 0.24, 0.05, 'yY'); }
  g.push(new THREE.Matrix4().makeTranslation(0, 0.56, 0).multiply(new THREE.Matrix4().makeRotationX(t)));
  for (let i = 0; i < 3; i++) {
    const x = (i - 1) * 1.07;
    g.set([1, 1, 1], M.SOLAR);
    g.quad([x - 0.52, 0.02, 0.85], [x + 0.52, 0.02, 0.85], [x + 0.52, 0.02, -0.85], [x - 0.52, 0.02, -0.85]);
    g.set(C.grey, M.GALV);
    g.box(x, 0, 0, 1.04, 0.035, 1.7, 'Y');
  }
  g.pop();
  return g.build();
}

/** wall ladder, 3 m tall (scale Y to fit); rails separated along Z, stands 0.12 m in front (+X) of the origin plane */
export function ladderProto() {
  const g = new Geo(); ladder(g, 0.12, 0, 0, 3.0, 0.42, 'z');
  // hooked top returning over the parapet
  g.set(C.galv, M.GALV);
  for (const z of [-0.21, 0.21]) g.beam([0.12, 3.0, z], [-0.25, 3.25, z], 0.045, 0.045, null, 'zZ');
  return g.build();
}

/** unit skylight glazing: base 1 x 1 centred, ridge along X at height 1 */
export function skylightGlass() {
  const g = new Geo(); g.set([1, 1, 1], 0);
  g.quad([-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0], [-0.5, 1, 0]);
  g.quad([0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, 0], [0.5, 1, 0]);
  g.tri([0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, 0], [0.3, 0.3], [0.7, 0.3], [0.5, 0.7]);
  g.tri([-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0], [0.3, 0.3], [0.7, 0.3], [0.5, 0.7]);
  const b = g.build(); b.deleteAttribute('aMat'); return b;
}

/** shrub blob r ~0.5 */
export function shrub(rng) {
  const g = new Geo(); g.set(C.leaf, M.PLANT);
  const J = []; for (let i = 0; i < 64; i++) J.push((rng() - 0.5) * 0.5);
  g.sphere(0, 0.42, 0, 0.5, 6, 4, 0.85, (i, j) => J[(i * 7 + j * 13) % 64]);
  return g.build();
}

/** small tree: trunk + three leaf masses, ~3 m */
export function tree(rng) {
  const g = new Geo();
  g.set(lin(0x4a3a2c), M.PLANKS);
  g.cyl(0, 0, 0, 0.09, 0.06, 1.5, 5, { capT: false });
  g.set(C.leaf, M.PLANT);
  const J = []; for (let i = 0; i < 64; i++) J.push((rng() - 0.5) * 0.55);
  g.sphere(0, 2.1, 0, 0.95, 7, 5, 0.9, (i, j) => J[(i * 5 + j * 11) % 64]);
  g.sphere(0.5, 1.75, 0.3, 0.6, 6, 4, 0.9, (i, j) => J[(i * 3 + j * 7 + 9) % 64]);
  g.sphere(-0.45, 1.85, -0.35, 0.65, 6, 4, 0.9, (i, j) => J[(i * 9 + j * 5 + 21) % 64]);
  return g.build();
}

/** timber pergola 3.6 x 2.6 x 2.4 */
export function pergola() {
  const g = new Geo(); g.set(C.plank, M.PLANKS);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) g.box(sx * 1.6, 1.15, sz * 1.1, 0.12, 2.3, 0.12, 'yY');
  for (const sz of [-1, 1]) g.box(0, 2.3, sz * 1.1, 3.8, 0.16, 0.08);
  for (let i = 0; i < 8; i++) g.box(-1.75 + i * 0.5, 2.44, 0, 0.05, 0.13, 2.9, 'y');
  return g.build();
}

/** lattice radio mast 26 m, red/white aviation paint */
export function latticeMast() {
  const g = new Geo(); const H = 24, bays = 8, b0 = 1.25, b1 = 0.28;
  const half = y => b0 + (b1 - b0) * (y / H);
  const red = lin(0xb5301f), wht = lin(0xd8d4c8);
  for (let k = 0; k < bays; k++) {
    const y0 = k * H / bays, y1 = (k + 1) * H / bays, h0 = half(y0), h1 = half(y1);
    g.set(k % 2 === 0 ? red : wht, M.PAINT);
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = cs[i], [bx, bz] = cs[(i + 1) % 4];
      g.beam([ax * h0, y0, az * h0], [ax * h1, y1, az * h1], 0.1, 0.1, [ax, 0, az], 'zZ');           // leg
      g.beam([ax * h1, y1, az * h1], [bx * h1, y1, bz * h1], 0.06, 0.06, null, 'zZ');                 // ring
      if ((i + k) % 2 === 0) g.beam([ax * h0, y0, az * h0], [bx * h1, y1, bz * h1], 0.05, 0.05, null, 'zZ');
      else g.beam([bx * h0, y0, bz * h0], [ax * h1, y1, az * h1], 0.05, 0.05, null, 'zZ');
    }
  }
  g.set(wht, M.PAINT);
  g.cyl(0, H, 0, 0.07, 0.04, 4.0, 5, { capT: false });
  g.set(C.galv, M.GALV);
  g.box(0, H - 0.05, 0, 1.1, 0.06, 1.1);
  // dipole whiskers
  for (const y of [H + 1.2, H + 2.4, H + 3.4]) { g.box(0, y, 0, 0.9, 0.035, 0.035, 'xX'); g.box(0, y - 0.3, 0, 0.035, 0.035, 0.9, 'zZ'); }
  // two drum antennas
  g.set(C.white, M.PAINT);
  g.push(TRS(0.75, H * 0.72, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2))); g.cyl(0, 0, 0, 0.55, 0.55, 0.3, 10, { capT: true, capB: true }); g.pop();
  g.push(TRS(0, H * 0.58, -0.85).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2))); g.cyl(0, 0, 0, 0.45, 0.45, 0.28, 10, { capT: true, capB: true }); g.pop();
  return g.build();
}

/** small roof shed 2.6 x 2.0, mono-pitch felt roof, door toward +X */
export function shed() {
  const g = new Geo();
  g.set([1, 1, 1], M.PLANKS);
  g.box(0, 1.0, 0, 2.6, 2.0, 2.0, 'yY');
  g.tri([-1.3, 2.0, 1.0], [1.3, 2.0, 1.0], [1.3, 2.45, 1.0]);
  g.tri([1.3, 2.0, -1.0], [-1.3, 2.0, -1.0], [1.3, 2.45, -1.0]);
  g.quad([1.3, 2.0, 1.0], [1.3, 2.0, -1.0], [1.3, 2.45, -1.0], [1.3, 2.45, 1.0]);
  g.set(C.felt, M.FELT);
  g.quad([-1.45, 1.95, 1.15], [1.45, 2.5, 1.15], [1.45, 2.5, -1.15], [-1.45, 1.95, -1.15]);
  g.quad([-1.45, 1.89, -1.15], [1.45, 2.44, -1.15], [1.45, 2.44, 1.15], [-1.45, 1.89, 1.15]);
  g.set(C.green, M.PAINT);
  g.box(1.31, 0.95, 0.2, 0.04, 1.9, 0.8);
  return g.build();
}

/** flag cloth: grid in the XY plane, hoist edge at x = 0, 1.8 x 1.1 m, uv 0..1 */
export function flagCloth() {
  const nx = 22, ny = 10, W = 1.8, H = 1.1;
  const g = new THREE.PlaneGeometry(W, H, nx, ny); g.translate(W / 2, 0, 0);
  return g;
}
