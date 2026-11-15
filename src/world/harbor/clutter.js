// Harbour clutter on the quay edge: crates, pallets, rope coils, fish boxes, lobster pots, drums, a hand crane, a davit,
// bicycles, an old anchor, net heaps, buoys and signs with fictional text.
import * as THREE from 'three';
import { box, cyl, sphere, torus, lathe, M, beam, tubeGeo, catenary, loftGeo, quadGeo } from './geo.js';
import { COL } from './quay.js';

const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const TAU = Math.PI * 2;

export function makeClutter(H) {
  const B = H.B, GY = H.GY;
  const loc = (x, y, z, ry) => { const R = M(x, y, z, 1, 1, 1, 0, ry, 0); return (...a) => R.clone().multiply(M(...a)); };

  const crate = (x, y, z, ry, w = 0.9, h = 0.6, d = 0.6, tone = 1) => {
    const at = loc(x, y, z, ry), c = mul([0.42, 0.34, 0.24], tone), dk = mul(c, 0.45);
    B.add('timber', box(), at(0, h / 2, 0, w - 0.03, h - 0.02, d - 0.03), dk, 0, 0);
    const nb = Math.max(2, Math.round(h / 0.2)), bh = h / nb;
    for (let i = 0; i < nb; i++) {
      const yy = (i + 0.5) * bh, k = 0.85 + 0.3 * (((i * 7 + Math.round(x * 3)) % 5) / 5);
      B.add('timber', box(), at(0, yy, d / 2, w, bh - 0.025, 0.02), mul(c, k), 0, 0); B.add('timber', box(), at(0, yy, -d / 2, w, bh - 0.025, 0.02), mul(c, k * 0.95), 0, 0);
      B.add('timber', box(), at(w / 2, yy, 0, 0.02, bh - 0.025, d), mul(c, k * 1.05), 0, 2); B.add('timber', box(), at(-w / 2, yy, 0, 0.02, bh - 0.025, d), mul(c, k), 0, 2);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('timber', box(), at(sx * (w / 2 - 0.03), h / 2, sz * (d / 2 + 0.012), 0.07, h, 0.022), mul(c, 0.8), 0, 1);
    const nt = Math.max(3, Math.round(d / 0.16));
    for (let i = 0; i < nt; i++) B.add('timber', box(), at(0, h + 0.008, -d / 2 + (i + 0.5) * d / nt, w, 0.02, d / nt - 0.02), mul(c, 0.9 + 0.2 * (i % 2)), 0, 0);
  };
  const pallet = (x, y, z, ry, tone = 1) => {
    const at = loc(x, y, z, ry), c = mul([0.44, 0.37, 0.27], tone);
    for (const dz of [-0.36, 0, 0.36]) B.add('timber', box(), at(0, 0.07, dz, 1.2, 0.09, 0.09), mul(c, 0.8), 0, 0);
    for (let i = 0; i < 6; i++) B.add('timber', box(), at(-0.52 + i * 0.208, 0.126, 0, 0.14, 0.022, 0.8), mul(c, 0.85 + 0.25 * ((i * 3) % 4) / 4), 0, 2);
    for (const dx of [-0.5, 0, 0.5]) B.add('timber', box(), at(dx, 0.012, 0, 0.12, 0.022, 0.8), mul(c, 0.7), 0, 2);
  };
  const palletStack = (x, z, ry, n, R) => { for (let i = 0; i < n; i++) pallet(x + (R() - 0.5) * 0.06, GY + i * 0.14, z + (R() - 0.5) * 0.06, ry + (R() - 0.5) * 0.12, 0.8 + R() * 0.4); return GY + n * 0.14; };
  const ropeCoil = (x, y, z, r = 0.35, col = COL.hemp, turns = 4, thick = 0.022) => {
    for (let i = 0; i < turns; i++) { const rr = r - (i % 2) * thick * 1.4; B.add('matte', new THREE.TorusGeometry(rr, thick, 5, 14), M(x, y + thick * (1 + i * 1.75), z, 1, 1, 1, Math.PI / 2, i * 0.9, 0), col, 0, 0, [TAU * rr, 1]); if (i === 0) B.add('matte', new THREE.TorusGeometry(rr - thick * 2.1, thick, 5, 12), M(x, y + thick, z, 1, 1, 1, Math.PI / 2, 0.4, 0), col, 0, 0, [TAU * rr, 1]); }
    B.add('matte', tubeGeo([[x + r, y + thick, z], [x + r + 0.25, y + thick, z + 0.3], [x + r + 0.2, y + thick, z + 0.8]], thick, 5), null, col, 0);
  };
  const fishBoxes = (x, z, ry, n, col) => {
    const at = loc(x, GY, z, ry), w = 0.78, d = 0.46, h = 0.2;
    for (let i = 0; i < n; i++) {
      const y = i * (h - 0.03);
      if (i < n - 1) { B.add('matte', box(), at(0, y + h / 2, 0, w - 0.03, h, d - 0.03), mul(col, 0.9), 3); B.add('matte', box(), at(0, y + h - 0.02, 0, w, 0.04, d), col, 3); }
      else {
        B.add('matte', box(), at(0, y + 0.012, 0, w - 0.04, 0.024, d - 0.04), mul(col, 0.6), 3);
        for (const s of [-1, 1]) { B.add('matte', box(), at(0, y + h / 2, s * (d / 2 - 0.012), w, h, 0.024), col, 3); B.add('matte', box(), at(s * (w / 2 - 0.012), y + h / 2, 0, 0.024, h, d - 0.04), col, 3); }
      }
    }
  };
  const lobsterPot = (x, y, z, ry) => {
    const at = loc(x, y, z, ry), len = 0.75, r = 0.24;
    const half = new THREE.CylinderGeometry(r, r, len, 9, 1, false, 0, Math.PI);
    B.add('matte', half, at(0, 0.02, 0, 1, 1, 1, 0, 0, Math.PI / 2), [0.16, 0.2, 0.13], 4, 0, [3.2, 2.5]);
    for (const dx of [-len / 2, 0, len / 2]) B.add('timber', new THREE.TorusGeometry(r, 0.014, 4, 9, Math.PI), at(dx, 0.02, 0, 1, 1, 1, 0, Math.PI / 2, 0), [0.33, 0.27, 0.18], 0, 1);
    for (const dz of [-r, -r / 3, r / 3, r]) B.add('timber', box(), at(0, 0.02, dz, len + 0.04, 0.025, 0.045), [0.33, 0.27, 0.18], 0, 0);
  };
  const drum = (x, y, z, col, lying = 0) => {
    const R = lying ? M(x, y + 0.29, z, 1, 1, 1, Math.PI / 2, lying, 0) : M(x, y + 0.44, z);
    const at = (...a) => R.clone().multiply(M(...a));
    B.add('iron', cyl(14), at(0, 0, 0, 0.285, 0.88, 0.285), col, 0);
    for (const dy of [-0.435, -0.15, 0.15, 0.435]) B.add('iron', cyl(14, 1, true), at(0, dy, 0, 0.295, 0.025, 0.295), mul(col, 0.9), 0);
    B.add('iron', cyl(6), at(0.16, 0.445, 0, 0.03, 0.02, 0.03), COL.galv, 3);
  };
  const buoy = (x, y, z, r, col) => { B.add('matte', sphere(10, 7), M(x, y + r, z, r, r * 1.1, r), col, 3); B.add('matte', cyl(6), M(x, y + r * 2.15, z, r * 0.2, r * 0.25, r * 0.2), mul(col, 0.4), 3); };
  const netHeap = (x, z, sx, sz, h, col, seed = 0) => {
    const rings = [];
    for (let i = 0; i <= 6; i++) { const a = i / 6, r = Math.pow(Math.cos(a * Math.PI / 2), 0.6) + 0.02, ring = []; for (let j = 0; j <= 12; j++) { const an = j / 12 * TAU, lump = 1 + 0.22 * Math.sin(an * 3 + i + seed) + 0.12 * Math.sin(an * 5 + i * 2 + seed * 2); ring.push([x + Math.cos(an) * r * lump * sx, GY + 0.01 + h * Math.sin(a * Math.PI / 2), z + Math.sin(an) * r * lump * sz]); } rings.push(ring); }
    const g = loftGeo(rings);
    const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5, uv.getY(i) * 6);
    B.add('matte', g, null, col, 4);
  };
  const signPost = (name, x, y, z, ry, w, h, postH = 2.4) => {
    const at = loc(x, y, z, ry);
    for (const s of [-1, 1]) B.add('iron', cyl(6), at(s * (w / 2 - 0.08), postH / 2, -0.04, 0.03, postH, 0.03), COL.ironBlack, 0);
    B.add('iron', box(), at(0, postH - h / 2, -0.012, w + 0.04, h + 0.04, 0.02), COL.ironBlack, 0);
    H.signs.push({ name, m: at(0, postH - h / 2, 0.002), w, h });
  };
  H.signPost = signPost;

  const crane = (x, z, ry) => {
    const at = loc(x, GY, z, ry), c = [0.05, 0.075, 0.085];
    B.add('stone', box(), at(0, 0.22, 0, 1.9, 0.5, 1.9), COL.coping, 1, 0);
    B.add('iron', lathe('cranecol', [[0.42, 0], [0.42, 0.12], [0.3, 0.3], [0.25, 1.2], [0.22, 3.3], [0.27, 3.4], [0.27, 3.6], [0.1, 3.75]], 12), at(0, 0.47, 0), c, 0);
    // jib: two curved riveted plates reaching over the water (local +x), lattice between
    const jib = s => { const p = []; for (let i = 0; i <= 8; i++) { const t = i / 8; p.push([-0.9 + t * 6.2, 3.3 + 2.6 * Math.sin(t * 1.25) , s * (0.2 - 0.12 * t)]); } return p; };
    for (const s of [-1, 1]) { const p = jib(s); for (let i = 0; i < p.length - 1; i++) B.add('iron', box(), at(0, 0, 0).multiply(beam(p[i], p[i + 1], 0.22 - i * 0.012, 0.03, [0, 0, 1])), c, 0); }
    { const a = jib(-1), b = jib(1); for (let i = 0; i < a.length - 1; i++) { B.add('iron', box(), at(0, 0, 0).multiply(beam(a[i], b[i + 1], 0.04, 0.03)), c, 0); B.add('iron', box(), at(0, 0, 0).multiply(beam(b[i], a[i], 0.05, 0.05)), c, 0); } }
    // tie rods to the counterweight, counterweight, winch with gear
    const tip = jib(1)[8];
    B.add('iron', tubeGeo([[-0.9, 3.3, 0], [0.0, 4.5, 0], [tip[0] - 1.6, tip[1] - 0.05, 0]], 0.02, 4), at(0, 0, 0), c, 0);
    B.add('iron', cyl(6), at(0, 4.2, 0, 0.05, 0.9, 0.05), c, 0);
    B.add('iron', box(), at(-1.25, 3.25, 0, 0.8, 0.7, 0.7), mul(c, 0.8), 2);
    B.add('iron', cyl(12), at(0.15, 1.5, 0.42, 0.2, 0.3, 0.2, Math.PI / 2, 0, 0), c, 0);
    B.add('iron', new THREE.TorusGeometry(0.42, 0.035, 5, 18), at(0.15, 1.5, 0.6), c, 0);
    for (let i = 0; i < 4; i++) B.add('iron', box(), at(0.15, 1.5, 0.6, 0.8, 0.04, 0.03, 0, 0, i * Math.PI / 4), c, 0);
    B.add('iron', tubeGeo([[0.15, 1.5, 0.75], [0.15, 1.2, 1.0], [0.15, 1.0, 1.0]], 0.02, 4), at(0, 0, 0), c, 0);
    // chain + hook from the tip
    B.add('iron', cyl(4, 1, true), at(tip[0] - 0.15, tip[1] - 1.7, 0, 0.016, 3.3, 0.016), COL.rustSteel, 2);
    B.add('iron', sphere(7, 5), at(tip[0] - 0.15, tip[1] - 3.4, 0, 0.11, 0.14, 0.11), COL.rustSteel, 2);
    B.add('iron', new THREE.TorusGeometry(0.1, 0.022, 4, 8, Math.PI * 1.4), at(tip[0] - 0.15, tip[1] - 3.62, 0, 1, 1, 1, 0, 0, Math.PI), COL.rustSteel, 2);
    B.add('iron', new THREE.TorusGeometry(0.2, 0.04, 5, 12), at(tip[0] - 0.1, tip[1] + 0.02, 0), c, 0);
    H.signs.push({ name: 'crane', m: at(-0.27, 2.1, 0, 1, 1, 1, 0, -Math.PI / 2, 0), w: 0.5, h: 0.25 });
  };
  const davit = (x, z, ry) => {
    const at = loc(x, GY, z, ry), c = COL.ironBlack, pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8, a = Math.max(0, t - 0.55) / 0.45 * Math.PI / 2; pts.push([0.9 * (1 - Math.cos(a)), 2.3 * Math.min(1, t / 0.55) + 0.9 * Math.sin(a), 0]); }
    B.add('iron', cyl(8, 0.7), at(0, 0.2, 0, 0.12, 0.4, 0.12), c, 0);
    B.add('iron', tubeGeo(pts, 0.045, 6), at(0, 0, 0), c, 0);
    const tip = pts[8];
    B.add('timber', box(), at(tip[0], tip[1] - 0.25, 0, 0.1, 0.18, 0.07), [0.3, 0.2, 0.1], 0, 1);
    B.add('matte', tubeGeo([[tip[0], tip[1] - 0.3, 0], [tip[0], 1.0, 0], [0.1, 0.9, 0.05], [0.05, 0.5, 0.05]], 0.012, 4), at(0, 0, 0), COL.hemp, 0);
  };
  const anchor = (x, z, ry) => {
    const at = loc(x, GY, z, ry), c = [0.03, 0.03, 0.032];
    B.add('stone', box(), at(0, 0.14, 0, 2.2, 0.28, 1.2), COL.coping, 1, 0);
    const T = at(0, 0.36, 0, 1, 1, 1, 0, 0, 0.28);
    B.add('iron', cyl(8, 0.75), T.clone().multiply(M(0, 0.0, 0, 0.07, 2.3, 0.07, 0, 0, Math.PI / 2)), c, 0);
    const arm = []; for (let i = -6; i <= 6; i++) { const a = i / 6 * 1.05; arm.push([-1.15 + 0.75 * (1 - Math.cos(a)), 0, 0.85 * Math.sin(a)]); }
    B.add('iron', tubeGeo(arm, 0.065, 6), T, c, 0);
    for (const s of [-1, 1]) B.add('iron', cyl(4, 0.2), T.clone().multiply(M(arm[s > 0 ? 12 : 0][0] + 0.06, 0, s * 0.78, 0.16, 0.34, 0.05, Math.PI / 2 * s, 0, 0.5)), c, 0);
    B.add('timber', box(), T.clone().multiply(M(0.95, 0, 0, 0.14, 1.7, 0.14)), [0.2, 0.15, 0.1], 1, 1);
    B.add('iron', new THREE.TorusGeometry(0.14, 0.03, 5, 10), T.clone().multiply(M(1.22, 0, 0, 1, 1, 1, Math.PI / 2, 0, 0)), c, 0);
  };
  const bicycle = (x, z, ry, lean, col) => {
    const R = M(x, GY, z, 1, 1, 1, lean, ry, 0), at = (...a) => R.clone().multiply(M(...a));
    const wr = 0.335, y = wr + 0.02;
    for (const wx of [-0.52, 0.52]) {
      B.add('matte', new THREE.TorusGeometry(wr, 0.02, 5, 18), at(wx, y, 0), COL.rubber, 1);
      B.add('iron', new THREE.TorusGeometry(wr - 0.025, 0.008, 3, 18), at(wx, y, 0), COL.galv, 3);
      for (let i = 0; i < 7; i++) B.add('iron', box(), at(wx, y, 0, 0.004, (wr - 0.03) * 2, 0.004, 0, 0, i * Math.PI / 7), COL.galv, 3);
      B.add('iron', cyl(6), at(wx, y, 0, 0.022, 0.08, 0.022, Math.PI / 2, 0, 0), COL.galv, 3);
    }
    const tube = (a, b, r = 0.014, c = col, k = 0) => B.add('iron', tubeGeo([a, b], r, 5), R, c, k);
    const bb = [-0.08, y - 0.07, 0], seat = [-0.2, y + 0.52, 0], head = [0.38, y + 0.52, 0], headB = [0.42, y + 0.36, 0], rear = [-0.52, y, 0], front = [0.52, y, 0];
    tube(bb, seat, 0.016); tube(seat, head); tube(bb, headB, 0.017); tube(head, headB, 0.018); tube(seat, rear, 0.01); tube(bb, rear, 0.011); tube(headB, front, 0.012);
    tube([-0.22, y + 0.5, 0], [-0.24, y + 0.64, 0], 0.012, COL.galv, 3);
    B.add('matte', box(), at(-0.25, y + 0.66, 0, 0.26, 0.05, 0.13), [0.12, 0.07, 0.04], 1);
    tube(head, [0.37, y + 0.7, 0], 0.012, COL.galv, 3);
    B.add('iron', tubeGeo([[0.3, y + 0.72, -0.26], [0.38, y + 0.7, -0.12], [0.38, y + 0.7, 0.12], [0.3, y + 0.72, 0.26]], 0.011, 4), R, COL.galv, 3);
    B.add('iron', cyl(8), at(-0.08, y - 0.07, 0.05, 0.09, 0.008, 0.09, Math.PI / 2, 0, 0), COL.galv, 3);
    // mudguards + rear rack with a basket
    B.add('iron', new THREE.TorusGeometry(wr + 0.035, 0.012, 3, 10, Math.PI * 0.75), at(-0.52, y, 0, 1, 1, 1, 0, 0, Math.PI * 0.2), col, 0);
    B.add('iron', new THREE.TorusGeometry(wr + 0.035, 0.012, 3, 8, Math.PI * 0.55), at(0.52, y, 0, 1, 1, 1, 0, 0, Math.PI * 0.3), col, 0);
    B.add('timber', box(), at(0.47, y + 0.62, 0, 0.3, 0.2, 0.36), [0.4, 0.3, 0.16], 0, 0);
  };

  // =================================================================================================== placement
  const R = H.rng('harbor-clutter'); const QX = H.L.QUAY_X;
  const xr = (a, b) => QX + a + R() * (b - a);
  const colsBox = [[0.06, 0.16, 0.42], [0.62, 0.22, 0.03], [0.5, 0.5, 0.47], [0.07, 0.3, 0.2], [0.55, 0.45, 0.06]];
  const drumCols = [[0.05, 0.12, 0.3], [0.4, 0.06, 0.04], [0.12, 0.13, 0.13], [0.3, 0.25, 0.06], [0.06, 0.2, 0.12]];
  // --- fish dock (z 336..566): the densest area
  for (let z = 340; z < 566; z += 4.2 + R() * 5.5) {
    if (z > 428 && z < 448) continue;       // crane apron
    const k = R();
    if (k < 0.2) { const n = 2 + Math.floor(R() * 3); for (let i = 0; i < n; i++) fishBoxes(xr(1.6, 2.2) + i * 0.9 * (R() < 0.5 ? 0 : 1), z + i * 0.55, Math.PI / 2 + (R() - 0.5) * 0.3, 2 + Math.floor(R() * 6), colsBox[Math.floor(R() * colsBox.length)]); }
    else if (k < 0.4) { const x = xr(2.0, 4.0), top = palletStack(x, z, R() * 0.4, 1 + Math.floor(R() * 2), R); crate(x - 0.2, top, z - 0.05, R() * 0.5, 0.8, 0.55, 0.6, 0.8 + R() * 0.4); if (R() < 0.6) crate(x + 0.35, top + 0.57, z, R() * 0.6, 0.6, 0.4, 0.45, 0.9 + R() * 0.3); crate(x + 1.3, GY, z + 0.5, R(), 0.7, 0.5, 0.5, 0.7 + R() * 0.4); }
    else if (k < 0.58) { const x = xr(1.5, 2.6); for (let i = 0; i < 3; i++) lobsterPot(x, GY, z + i * 0.56, Math.PI / 2 + (R() - 0.5) * 0.15); for (let i = 0; i < 2; i++) lobsterPot(x, GY + 0.27, z + 0.28 + i * 0.56, Math.PI / 2 + (R() - 0.5) * 0.15); if (R() < 0.6) lobsterPot(x, GY + 0.54, z + 0.56, Math.PI / 2); buoy(x + 0.7, GY, z - 0.4, 0.16, [0.75, 0.2, 0.03]); }
    else if (k < 0.72) { netHeap(xr(2.0, 3.2), z, 1.3 + R() * 0.6, 0.9 + R() * 0.4, 0.4 + R() * 0.25, R() < 0.5 ? [0.1, 0.24, 0.16] : [0.45, 0.2, 0.06], R() * 9); for (let i = 0; i < 4; i++) buoy(xr(1.6, 3.2), GY, z + (R() - 0.5) * 2, 0.11 + R() * 0.05, R() < 0.5 ? [0.75, 0.2, 0.03] : [0.75, 0.6, 0.05]); }
    else if (k < 0.86) { ropeCoil(xr(1.3, 2.0), GY, z, 0.3 + R() * 0.2, R() < 0.3 ? [0.18, 0.26, 0.4] : COL.hemp, 3 + Math.floor(R() * 3), 0.022 + R() * 0.012); if (R() < 0.5) drum(xr(2.4, 3.4), GY, z + 0.8, drumCols[Math.floor(R() * drumCols.length)]); }
    else { const x = xr(2.2, 3.6); drum(x, GY, z, drumCols[Math.floor(R() * 5)]); drum(x + 0.62, GY, z + 0.1, drumCols[Math.floor(R() * 5)]); if (R() < 0.6) drum(x + 0.3, GY, z + 0.62, drumCols[Math.floor(R() * 5)]); if (R() < 0.4) drum(x - 0.2, GY, z - 1.2, drumCols[2], 0.4 + R()); }
  }
  // second row further back from the edge: bigger stacks, drums, nets drying
  for (let z = 346; z < 562; z += 10 + R() * 14) {
    if (z > 428 && z < 448) continue;
    const x = xr(5.2, 8.0), k = R();
    if (k < 0.4) { const top = palletStack(x, z, R() * 0.5, 2 + Math.floor(R() * 5), R); if (R() < 0.7) { crate(x - 0.1, top, z, R() * 0.4, 1.0, 0.7, 0.7, 0.8 + R() * 0.4); if (R() < 0.5) crate(x, top + 0.72, z + 0.05, R() * 0.6, 0.7, 0.5, 0.5, 1.1); } palletStack(x + 1.5, z + 0.3, 1.5 + R() * 0.3, 1 + Math.floor(R() * 7), R); }
    else if (k < 0.65) { for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) if (R() < 0.85) drum(x + i * 0.62, GY, z + j * 0.62, drumCols[Math.floor(R() * 5)]); }
    else if (k < 0.85) { crate(x, GY, z, R() * 0.3, 1.2, 0.9, 0.9, 0.85); crate(x + 1.3, GY, z + 0.1, R() * 0.3, 1.0, 0.7, 0.8, 1.0); crate(x + 0.5, GY + 0.92, z, R() * 0.5, 0.8, 0.5, 0.6, 1.15); ropeCoil(x - 1.2, GY, z + 0.6, 0.35, COL.hemp, 4, 0.026); }
    else { netHeap(x, z, 1.8, 1.2, 0.55, [0.1, 0.24, 0.16], R() * 9); netHeap(x + 2.2, z + 0.8, 1.2, 1.0, 0.4, [0.45, 0.2, 0.06], R() * 9); for (let i = 0; i < 5; i++) buoy(x + (R() - 0.5) * 3, GY, z + 1.6 + R(), 0.12 + R() * 0.06, R() < 0.5 ? [0.75, 0.2, 0.03] : [0.75, 0.6, 0.05]); }
  }
  crane(QX + 2.4, 438, Math.PI);
  signPost('fish', QX + 6.2, GY, 345, Math.PI / 2, 2.6, 0.95, 3.2);
  signPost('deepwater', QX + 1.5, GY, 430.5, Math.PI / 2, 0.7, 0.7, 2.0);
  // --- tug berth (z -372..-296): ropes, drums, crates
  for (let z = -368; z < -298; z += 9 + R() * 8) {
    const k = R();
    if (k < 0.35) ropeCoil(xr(1.3, 2.2), GY, z, 0.4 + R() * 0.25, COL.hemp, 4, 0.03);
    else if (k < 0.65) { const x = xr(2.0, 3.0); drum(x, GY, z, drumCols[Math.floor(R() * 5)]); drum(x + 0.63, GY, z, drumCols[Math.floor(R() * 5)]); }
    else { const x = xr(2.2, 3.6), top = palletStack(x, z, R() * 0.3, 2, R); crate(x, top, z, R() * 0.3, 1.0, 0.7, 0.7, 0.9); }
  }
  signPost('quay7', QX + 1.4, GY, -292, Math.PI / 2, 0.7, 0.7, 2.2);
  signPost('nomooring', QX + 1.3, GY, 12, Math.PI / 2, 1.5, 0.75, 2.3);
  signPost('harbourmaster', QX + 5.5, GY, 588, Math.PI / 2, 3.0, 0.95, 3.2);
  // --- pier root + working stretch south of the pier
  palletStack(QX + 3.2, 612, 0.2, 4, R); crate(QX + 4.6, GY, 612.5, 0.3, 1.0, 0.8, 0.8); crate(QX + 4.5, GY + 0.82, 612.4, 0.5, 0.6, 0.45, 0.5, 1.2);
  ropeCoil(QX + 1.5, GY, 646, 0.45, COL.hemp, 4, 0.03); drum(QX + 2.6, GY, 668, drumCols[0]); drum(QX + 3.2, GY, 668.3, drumCols[1]);
  // on the pier deck
  const P = H.L.harbor.pier;
  ropeCoil(P.x0 + 14, P.deckY, P.z1 - 1.1, 0.36, COL.hemp, 4, 0.026); ropeCoil(P.x0 + 62, P.deckY, P.z1 - 0.9, 0.3, [0.18, 0.26, 0.4], 3, 0.022);
  crate(P.x0 + 6.2, P.deckY, P.z0 + 1.6, 0.2, 0.8, 0.5, 0.55); crate(P.x0 + 7.1, P.deckY, P.z0 + 1.5, -0.1, 0.6, 0.4, 0.45, 1.2);
  for (let i = 0; i < 3; i++) lobsterPot(P.x0 + 30 + i * 0.3, P.deckY + (i === 2 ? 0.27 : 0), P.z1 - 0.9 - (i === 2 ? 0.28 : i * 0.56), 0.1);
  fishBoxes(P.x0 + 96, P.z1 - 0.8, 0.1, 4, colsBox[0]); fishBoxes(P.x0 + 96.9, P.z1 - 0.85, 0.0, 2, colsBox[1]);
  // --- promenade: old anchor monument, davit by the bay steps, bicycles on railings, a few crates by the jetties
  anchor(QX + 6.5, 128, 0.3);
  davit(QX + 0.75, -66.5, Math.PI);
  bicycle(QX + 0.62, 96, Math.PI / 2, -0.16, [0.3, 0.05, 0.04]);
  bicycle(-78, H.L.canal.z0 - 0.62, 0.0, 0.17, [0.04, 0.16, 0.2]);
  bicycle(306, H.L.canal.z1 + 0.62, Math.PI, 0.17, [0.02, 0.02, 0.02]);
  crate(QX + 2.0, GY, -203, 0.2, 0.9, 0.6, 0.6); crate(QX + 2.1, GY + 0.62, -203.1, 0.5, 0.6, 0.4, 0.45, 1.15); ropeCoil(QX + 1.6, GY, -214.5, 0.3);
  signPost('boathire', -101, GY, H.L.canal.z0 - 1.1, Math.PI, 1.5, 0.75, 2.2);
  signPost('canal', QX + 1.2, GY, H.L.canal.z0 - 3.4, Math.PI / 2, 2.2, 0.7, 2.6);
  // canal quays: a few crates and coils by the mooring rings, a drum or two
  for (let x = -40; x < 500; x += 55 + R() * 50) {
    const north = R() < 0.5, z = north ? H.L.canal.z0 - 1.5 - R() * 0.8 : H.L.canal.z1 + 1.5 + R() * 0.8;
    if (H.L.bridges.some(b => x > b.x0 - 4 && x < b.x1 + 4)) continue;
    const k = R();
    if (k < 0.4) ropeCoil(x, GY, z, 0.28, COL.hemp, 3, 0.02);
    else if (k < 0.75) { crate(x, GY, z, R(), 0.8, 0.5, 0.55, 0.9); if (R() < 0.5) crate(x + 0.9, GY, z, R(), 0.6, 0.4, 0.45, 1.1); }
    else fishBoxes(x, z, R(), 3, colsBox[Math.floor(R() * 5)]);
  }
}

/** build the sign bucket geometry from H.signs (after all modules pushed their signs) */
export function buildSigns(H, rects) {
  for (const s of H.signs) {
    const r = rects[s.name] || rects.blank;
    const m = s.m || M(s.p[0], s.p[1], s.p[2], 1, 1, 1, 0, s.ry || 0, 0);
    const g = quadGeo([-s.w / 2, -s.h / 2, 0], [s.w / 2, -s.h / 2, 0], [s.w / 2, s.h / 2, 0], [-s.w / 2, s.h / 2, 0], [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]]);
    H.B.add('sign', g, m, [1, 1, 1], 0);
  }
}
