// Vessels: the harbour ferry on layout.harbor.ferryRoute, yachts further out, a small coaster. All motion is a pure function of t.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Geo, C, lerp, clamp, paintMaterial } from './util.js';

/** lofted hull. x = length (bow +x), y up (waterline 0), z = beam. fns take u in [-1,1]. bands: [[yFn(u) ...] colours] */
function hullGeometry({ L, hb, deck, keel, N = 26, colors, transom = false, deckInset = 0.9, deckCol, stem = 0 }) {
  const pos = [], col = [];
  const st = [];
  for (let i = 0; i <= N; i++) {
    const u = -1 + 2 * i / N, x = u * L / 2, dk = deck(u), kl = keel(u), b = Math.max(hb(u), 0.02);
    const ys = [kl, lerp(kl, 0.3, 0.45), lerp(kl, 0.3, 0.8), 0.3, lerp(0.3, dk - 0.35, 0.4), dk - 0.35, dk];
    const zs = ys.map(y => { const v = clamp((y - kl) / (dk - kl), 0, 1); return b * Math.pow(1 - Math.pow(1 - v, 2.4), 0.5); });
    const xs = ys.map(y => x * (1 - stem * Math.pow(Math.abs(u), 5) * Math.pow(1 - clamp((y - kl) / (dk - kl), 0, 1), 1.6)));     // raked, cut-away stem / stern post
    st.push({ x, xs, ys, zs, dk, b });
  }
  const quad = (a, b2, c, d, cl) => { pos.push(...a, ...b2, ...c, ...a, ...c, ...d); for (let k = 0; k < 6; k++) col.push(...cl); };
  const bandCol = [colors.boot, colors.boot, colors.boot, colors.hull, colors.hull, colors.stripe];
  for (let i = 0; i < N; i++) {
    const a = st[i], b = st[i + 1];
    for (let k = 0; k < 6; k++) {
      quad([a.xs[k], a.ys[k], a.zs[k]], [b.xs[k], b.ys[k], b.zs[k]], [b.xs[k + 1], b.ys[k + 1], b.zs[k + 1]], [a.xs[k + 1], a.ys[k + 1], a.zs[k + 1]], bandCol[k]);          // starboard (+z)
      quad([a.xs[k], a.ys[k], -a.zs[k]], [a.xs[k + 1], a.ys[k + 1], -a.zs[k + 1]], [b.xs[k + 1], b.ys[k + 1], -b.zs[k + 1]], [b.xs[k], b.ys[k], -b.zs[k]], bandCol[k]);     // port
    }
    // inner bulwark + deck
    const da = a.dk - deckInset, db = b.dk - deckInset, za = a.b * 0.96, zb = b.b * 0.96;
    quad([a.x, da, -za], [a.x, da, za], [b.x, db, zb], [b.x, db, -zb], deckCol);
    if (deckInset > 0.05) {
      quad([a.x, a.dk, a.b], [b.x, b.dk, b.b], [b.x, db, zb], [a.x, da, za], colors.stripe);
      quad([a.x, a.dk, -a.b], [a.x, da, -za], [b.x, db, -zb], [b.x, b.dk, -b.b], colors.stripe);
    }
  }
  if (transom) { const a = st[0]; for (let k = 0; k < 6; k++) quad([a.xs[k], a.ys[k], a.zs[k]], [a.xs[k + 1], a.ys[k + 1], a.zs[k + 1]], [a.xs[k + 1], a.ys[k + 1], -a.zs[k + 1]], [a.xs[k], a.ys[k], -a.zs[k]], bandCol[k]); }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g = mergeVertices(g, 1e-3); g.computeVertexNormals(); g = g.toNonIndexed();
  g.setAttribute('aE', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
  return g;
}

function railing(g, pts, y, h, color, { closed = false, rails = 2, pr = 0.03, step = 1.5 } = {}) {
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n]; const len = Math.hypot(b[0] - a[0], b[1] - a[1]); const m = Math.max(1, Math.round(len / step));
    for (let k = 0; k < m; k++) { const t = k / m, x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t); g.tube([x, y, z], [x, y + h, z], pr, color, { seg: 5 }); }
    for (let r = 1; r <= rails; r++) g.tube([a[0], y + h * r / rails, a[1]], [b[0], y + h * r / rails, b[1]], r === rails ? pr * 1.5 : pr, color, { seg: 5 });
  }
}
const stadium = (hx, r, n = 7) => {            // outline of a rounded-end deck: straight half-length hx, end radius r
  const p = [];
  for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + Math.PI * i / n; p.push([hx + Math.cos(a) * r, Math.sin(a) * r]); }
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + Math.PI * i / n; p.push([-hx + Math.cos(a) * r, Math.sin(a) * r]); }
  return p;
};

/** glazing quad a,b,c,d (bottom-left, bottom-right, top-right, top-left seen from outside; hint = rough outward direction).
 *  Vertex colour carries (u, v, seed) and aE = -kind (1 saloon, 2 wheelhouse): the ferry material draws frame, gasket and a lit interior. */
function pane(g, a, b, c, d, seed, kind, hint) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const nl = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map(v => v / nl);
  if (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { [a, b] = [b, a]; [d, c] = [c, d]; n = n.map(v => -v); }
  const o = p => [p[0] + n[0] * 0.035, p[1] + n[1] * 0.035, p[2] + n[2] * 0.035];
  const t = new THREE.BufferGeometry();
  t.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...o(a), ...o(b), ...o(c), ...o(a), ...o(c), ...o(d)]), 3));
  t.setAttribute('color', new THREE.BufferAttribute(new Float32Array([0, 0, seed, 1, 0, seed, 1, 1, seed, 0, 0, seed, 1, 1, seed, 0, 1, seed]), 3));
  t.setAttribute('aE', new THREE.BufferAttribute(new Float32Array(6).fill(-kind), 1));
  t.computeVertexNormals(); g.raw(t);
}
/** flat-shaded shell through closed rings of [x,y,z] (same point count), faces auto-oriented outward; optional top cap */
function shell(g, rings, color, cap = true) {
  const pos = []; const m = rings[0].length; const ctr = [0, 0, 0]; let cnt = 0;
  for (const r of rings) for (const p of r) { ctr[0] += p[0]; ctr[1] += p[1]; ctr[2] += p[2]; cnt++; }
  ctr[0] /= cnt; ctr[1] /= cnt; ctr[2] /= cnt;
  const tri = (a, b, c) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (n[0] * (a[0] - ctr[0]) + n[1] * (a[1] - ctr[1]) + n[2] * (a[2] - ctr[2]) < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
  };
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < m; j++) { const a = rings[i][j], b = rings[i][(j + 1) % m], c = rings[i + 1][(j + 1) % m], d = rings[i + 1][j]; tri(a, b, c); tri(a, c, d); }
  if (cap) { const r = rings[rings.length - 1]; for (let j = 1; j < m - 1; j++) tri(r[0], r[j], r[j + 1]); }
  const t = new THREE.BufferGeometry(); t.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); t.computeVertexNormals();
  g.add(t, color);
}
const poly = (g, pts, r, color, seg = 6) => { for (let i = 0; i < pts.length - 1; i++) g.tube(pts[i], pts[i + 1], r, color, { seg }); };

function ferryGeometry(R) {
  const g = new Geo();
  const hullC = C(0x1f3d3a), boot = C(0x5c1f17), cream = C(0xe4dcc8), deckC = C(0x55605a), buff = C(0xc79a3a), black = C(0x17181a), redB = C(0x8e2a20), wood = C(0x6b4a30), white = C(0xeeeae0);
  const orange = C(0xc8501e), canvas = C(0x8d8672), rope = C(0x9a8a66), rubber = C(0x0e0e10), lampC = [1.0, 0.74, 0.44];
  const L = 36, B = 9.6;
  const hb = u => B / 2 * Math.pow(1 - Math.pow(Math.abs(u), 2.7), 0.55);
  const deck = u => 2.05 + 0.85 * u * u;                                  // sheer rising to both ends
  g.raw(hullGeometry({ L, hb, deck, keel: u => -1.6 * (1 - Math.pow(Math.abs(u), 4)), colors: { boot, hull: hullC, stripe: cream }, deckCol: deckC, N: 46, stem: 0.065 }));
  // rubbing strake, bulwark cap rail, freeing ports, tyre fenders
  const NS = 46;
  for (const s of [-1, 1]) {
    for (let i = 0; i < NS; i++) {
      const u0 = -0.985 + 1.97 * i / NS, u1 = -0.985 + 1.97 * (i + 1) / NS;
      g.tube([u0 * L / 2, deck(u0) - 0.42, s * (hb(u0) + 0.03)], [u1 * L / 2, deck(u1) - 0.42, s * (hb(u1) + 0.03)], 0.11, black, { seg: 6 });
      g.tube([u0 * L / 2, deck(u0) + 0.03, s * hb(u0) * 0.985], [u1 * L / 2, deck(u1) + 0.03, s * hb(u1) * 0.985], 0.07, wood, { seg: 6 });
    }
    for (let x = -12.1; x <= 12.2; x += 2.2) { const u = x / (L / 2); g.box(0.55, 0.13, 0.06, x, deck(u) - 0.78, s * (hb(u) * 0.992 + 0.005), black); }
    for (const u of [-0.62, -0.31, 0, 0.31, 0.62]) {
      const x = u * L / 2, y = deck(u) - 1.02, z = s * (hb(u) + 0.13);
      g.add(new THREE.TorusGeometry(0.4, 0.15, 8, 18), rubber, Geo.mat(x, y, z, 0, 0, 0));
      g.tube([x, y + 0.4, z], [x, deck(u) + 0.03, s * hb(u) * 0.985], 0.02, rope, { seg: 4 });
    }
  }
  const D0 = 1.2;                                   // main deck level amidships
  // saloon with rounded ends, mouldings and a row of framed windows (lit interior drawn by the ferry material)
  const sx = 10.6, sr = 3.35, sh = 2.75, RS = 36;
  g.box(sx * 2, sh, sr * 2, 0, D0 + sh / 2, 0, cream);
  for (const s of [-1, 1]) g.cyl(sr, sr, sh, s * sx, D0, 0, cream, { seg: RS });
  g.box(sx * 2 + 0.02, 0.5, sr * 2 + 0.04, 0, D0 + 0.25, 0, hullC);       // dark plinth band
  for (const s of [-1, 1]) g.cyl(sr + 0.02, sr + 0.02, 0.5, s * sx, D0, 0, hullC, { seg: RS });
  for (const [y, t, o] of [[D0 + 1.1, 0.07, 0.07], [D0 + 2.36, 0.09, 0.09]]) {                           // sill + eyebrow mouldings
    g.box(sx * 2, t, (sr + o) * 2, 0, y, 0, white); for (const s of [-1, 1]) g.cyl(sr + o, sr + o, t, s * sx, y - t / 2, 0, white, { seg: RS });
  }
  const WY = D0 + 1.72;
  const paneN = (cx, cy, cz, nx, nz, w, h, seed, kind = 1) => {
    const ex = nz * w / 2, ez = -nx * w / 2;
    pane(g, [cx - ex, cy - h / 2, cz - ez], [cx + ex, cy - h / 2, cz + ez], [cx + ex, cy + h / 2, cz + ez], [cx - ex, cy + h / 2, cz - ez], seed, kind, [nx, 0, nz]);
  };
  let wi = 0;
  for (let x = -sx + 0.7; x <= sx - 0.6; x += 1.52) for (const s of [-1, 1]) {
    const isDoor = Math.abs(Math.abs(x) - 4.6) < 0.7;
    if (isDoor) {
      g.box(1.0, 2.0, 0.08, x, D0 + 1.05, s * (sr + 0.01), wood); g.box(1.16, 0.08, 0.14, x, D0 + 2.1, s * (sr + 0.03), white);
      paneN(x, D0 + 1.52, s * (sr + 0.05), 0, s, 0.58, 0.7, 0.35 + 0.6 * R());
      g.box(0.05, 0.2, 0.06, x + 0.36, D0 + 1.05, s * (sr + 0.07), black);
    } else { const k = wi++; paneN(x, WY, s * sr, 0, s, 1.2, 1.1, k % 9 === 4 ? 0.02 + 0.1 * R() : (k % 7 === 2 ? 0.16 + 0.12 * R() : 0.3 + 0.7 * R())); }
  }
  for (const s of [-1, 1]) for (let k = -2; k <= 2; k++) { const a = k * 0.5; paneN(s * (sx + Math.cos(a) * sr), WY, Math.sin(a) * sr, s * Math.cos(a), Math.sin(a), 1.14, 1.1, 0.3 + 0.7 * R()); }
  // upper (boat) deck with overhang, nosing, railings, benches, deck-head lamps
  const U0 = D0 + sh;
  g.box(sx * 2, 0.2, 8.5, 0, U0 + 0.1, 0, white); for (const s of [-1, 1]) g.cyl(4.25, 4.25, 0.2, s * sx, U0, 0, white, { seg: RS });
  g.box(sx * 2, 0.03, 8.2, 0, U0 + 0.21, 0, deckC); for (const s of [-1, 1]) g.cyl(4.1, 4.1, 0.03, s * sx, U0 + 0.2, 0, deckC, { seg: RS });
  { const o = stadium(sx, 4.27, 14); for (let i = 0; i < o.length; i++) { const a = o[i], b = o[(i + 1) % o.length]; g.tube([a[0], U0 + 0.1, a[1]], [b[0], U0 + 0.1, b[1]], 0.115, white, { seg: 6 }); } }
  for (let x = -sx; x <= sx; x += 3.53) for (const s of [-1, 1]) {
    g.tube([x, D0, s * 4.1], [x, U0, s * 4.1], 0.05, white, { seg: 6 });                                  // stanchions carrying the overhang
    if (x + 1.76 < sx) g.sphere(0.1, x + 1.76, U0 - 0.07, s * 3.75, lampC, { e: 3.2, ws: 8, hs: 6 });     // deck-head lamps
  }
  railing(g, stadium(sx, 4.15, 10), U0 + 0.2, 1.05, white, { closed: true, rails: 3, pr: 0.028, step: 1.45 });
  for (const x of [-9.6, -4.9, 4.9, 9.6]) for (const s of [-1, 1]) g.add(new THREE.TorusGeometry(0.33, 0.085, 8, 18), x * s > 0 ? orange : white, Geo.mat(x, U0 + 0.78, s * 4.2));   // life rings
  for (const x of [-3.9, 3.9]) for (const s of [-1, 1]) { g.box(1.5, 0.08, 0.45, x, U0 + 0.68, s * 2.9, wood); g.box(1.5, 0.45, 0.06, x, U0 + 0.95, s * 2.68, wood); g.box(0.06, 0.45, 0.4, x - 0.6, U0 + 0.43, s * 2.9, black); g.box(0.06, 0.45, 0.4, x + 0.6, U0 + 0.43, s * 2.9, black); }
  // lifeboats under radial davits, abreast the funnel
  for (const s of [-1, 1]) {
    const bz = s * 3.45, by = U0 + 2.12;
    g.add(new THREE.SphereGeometry(1, 22, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), white, Geo.mat(0, by, bz, 0, 0, 0, 2.4, 0.8, 0.82));
    g.add(new THREE.SphereGeometry(1, 22, 6, 0, Math.PI * 2, 0, Math.PI / 2), canvas, Geo.mat(0, by, bz, 0, 0, 0, 2.4, 0.3, 0.82));
    { const t = new THREE.TorusGeometry(1, 0.035, 6, 30); t.rotateX(Math.PI / 2); g.add(t, wood, Geo.mat(0, by, bz, 0, 0, 0, 2.42, 1.6, 0.84)); }
    for (const x of [-1.3, 1.3]) { g.box(0.14, 1.2, 1.0, x, U0 + 0.8, bz, white); g.tube([x, by + 0.02, bz - 0.86], [x, by + 0.02, bz + 0.86], 0.03, rope, { seg: 4 }); }
    for (const x of [-1.75, 1.75]) {
      poly(g, [[x, U0 + 0.2, s * 4.0], [x, U0 + 2.75, s * 4.0], [x, U0 + 3.12, s * 3.93], [x, U0 + 3.36, s * 3.75], [x, U0 + 3.44, s * 3.45]], 0.07, white, 8);
      g.sphere(0.07, x, U0 + 2.75, s * 4.0, white, { ws: 8, hs: 6 }); g.sphere(0.07, x, U0 + 3.12, s * 3.93, white, { ws: 8, hs: 6 }); g.sphere(0.07, x, U0 + 3.36, s * 3.75, white, { ws: 8, hs: 6 });
      g.tube([x, U0 + 3.42, s * 3.45], [x, by + 0.28, s * 3.45], 0.016, rope, { seg: 4 }); g.box(0.1, 0.16, 0.08, x, by + 0.75, s * 3.45, black);
    }
  }
  // twin wheelhouses (double-ender): raked glazing, chamfered front, visor roof, mast with stays
  for (const s of [-1, 1]) {
    const wx = s * 7.4, wy = U0 + 0.2, hs = 1.02, ht = 2.3, rake = 0.3;
    const fAt = (f, y) => f + (f > 0.9 ? rake * clamp((y - hs) / (ht - hs), 0, 1) : 0);
    const Pw = (f, y, z) => [wx + s * fAt(f, y), wy + y, z];
    const plan = [[-1.5, -1.9], [-1.5, 1.9], [0.95, 1.9], [1.5, 1.2], [1.5, -1.2], [0.95, -1.9]];
    shell(g, [0, hs, ht].map(y => plan.map(([f, z]) => Pw(f, y, z))), cream, true);
    g.box(3.02, 0.07, 3.86, wx - s * 0.02, wy + hs, 0, white);                                          // sill band
    const y0 = 1.14, y1 = 2.18, K = 2;
    for (const [z0, z1] of [[-1.13, -0.4], [-0.36, 0.36], [0.4, 1.13]]) pane(g, Pw(1.5, y0, z0), Pw(1.5, y0, z1), Pw(1.5, y1, z1), Pw(1.5, y1, z0), R(), K, [s, 0, 0]);
    for (const zs of [-1, 1]) {
      const cf = t => [0.95 + 0.55 * t, zs * (1.9 - 0.7 * t)];
      const a = cf(0.1), b = cf(0.9);
      pane(g, Pw(a[0], y0, a[1]), Pw(b[0], y0, b[1]), Pw(b[0], y1, b[1]), Pw(a[0], y1, a[1]), R(), K, [s * 0.6, 0, zs * 0.8]);
      pane(g, Pw(0.3, y0, zs * 1.9), Pw(0.86, y0, zs * 1.9), Pw(0.86, y1, zs * 1.9), Pw(0.3, y1, zs * 1.9), R(), K, [0, 0, zs]);
      g.box(0.8, 1.95, 0.06, wx - s * 0.9, wy + 1.0, zs * 1.92, wood);                                    // door with a light
      pane(g, Pw(-1.15, 1.2, zs * 1.94), Pw(-0.65, 1.2, zs * 1.94), Pw(-0.65, 1.95, zs * 1.94), Pw(-1.15, 1.95, zs * 1.94), R(), K, [0, 0, zs]);
      g.box(0.5, 0.3, 0.14, wx, wy + 1.9, zs * 2.02, black);                                              // sidelight boxes
    }
    pane(g, Pw(-1.5, y0, -1.0), Pw(-1.5, y0, 1.0), Pw(-1.5, y1, 1.0), Pw(-1.5, y1, -1.0), R(), K, [-s, 0, 0]);
    const rx = wx + s * 0.3, ry = wy + 2.37;                                                              // roof slab with a visor and rolled edges
    g.box(3.9, 0.12, 4.7, rx, ry, 0, white);
    for (const z of [-2.35, 2.35]) g.tube([rx - 1.95, ry, z], [rx + 1.95, ry, z], 0.075, white, { seg: 6 });
    for (const x of [-1.95, 1.95]) g.tube([rx + x, ry, -2.35], [rx + x, ry, 2.35], 0.075, white, { seg: 6 });
    const mx = wx - s * 0.6;
    g.tube([mx, wy + 2.44, 0], [mx, wy + 5.6, 0], 0.075, white, { seg: 8, r1: 0.04 });
    g.tube([mx, wy + 4.3, -1.0], [mx, wy + 4.3, 1.0], 0.035, white, { seg: 6 });
    g.cyl(0.07, 0.07, 0.2, mx, wy + 5.6, 0, black, { seg: 8 }); g.cyl(0.06, 0.06, 0.16, mx + s * 0.14, wy + 5.0, 0, black, { seg: 8 });
    g.tube([mx, wy + 5.5, 0], [s * 17.3, deck(0.96) + 0.25, 0], 0.016, black, { seg: 4 });               // forestay
    for (const z of [-1, 1]) {
      g.tube([mx, wy + 5.25, 0], [wx - s * 1.55, wy + 2.44, z * 2.15], 0.014, black, { seg: 4 });         // shrouds
      g.tube([mx, wy + 5.25, 0], [wx + s * 0.9, wy + 2.44, z * 2.15], 0.014, black, { seg: 4 });
      g.tube([mx, wy + 4.3, z * 0.95], [mx - s * 0.25, wy + 2.44, z * 1.5], 0.011, rope, { seg: 3 });     // signal halyards
    }
    g.box(0.12, 0.14, 1.3, wx + s * 0.5, wy + 2.75, 0, white); g.cyl(0.05, 0.05, 0.3, wx + s * 0.5, wy + 2.44, 0, white, { seg: 8 });   // radar scanner
    g.cyl(0.035, 0.035, 0.3, wx + s * 1.7, wy + 2.44, 1.3, black, { seg: 6 }); g.cyl(0.15, 0.13, 0.24, wx + s * 1.62, wy + 2.86, 1.3, black, { seg: 12, rz: -s * Math.PI / 2 });   // searchlight
    g.tube([wx - s * 1.4, wy + 2.44, -1.7], [wx - s * 1.4, wy + 4.9, -1.7], 0.014, black, { seg: 4 });   // whip aerial
    for (const z of [-0.5, -0.2]) g.add(new THREE.ConeGeometry(0.09, 0.4, 10, 1, true), black, Geo.mat(wx + s * 1.5, wy + 2.56, z - 1.0, 0, 0, s * Math.PI / 2));   // horns
  }
  // funnel: oval, buff with a red band and black top, cap lip, stays, steam pipe + whistle
  const fy = U0 + 0.2, FO = { seg: 36, sx: 1.4, sz: 0.85 };
  g.cyl(1.36, 1.4, 0.16, 0, fy, 0, black, FO);
  g.cyl(1.12, 1.3, 3.1, 0, fy, 0, buff, FO);
  g.cyl(1.09, 1.12, 0.55, 0, fy + 3.1, 0, redB, FO);
  g.cyl(1.05, 1.09, 0.95, 0, fy + 3.65, 0, black, FO);
  g.cyl(1.125, 1.125, 0.07, 0, fy + 3.06, 0, black, FO); g.cyl(1.1, 1.1, 0.07, 0, fy + 3.63, 0, black, FO);
  g.cyl(1.11, 1.08, 0.12, 0, fy + 4.5, 0, black, FO);
  for (const [x, r, h] of [[0.45, 0.2, 0.55], [-0.5, 0.15, 0.75]]) { g.cyl(r, r, h, x, fy + 4.55, 0, black, { seg: 12 }); g.cyl(r + 0.035, r + 0.035, 0.05, x, fy + 4.55 + h - 0.05, 0, black, { seg: 12 }); }
  for (const a of [-1, 1]) for (const b of [-1, 1]) g.tube([a * 1.25, fy + 3.45, b * 0.62], [a * 3.5, fy + 0.02, b * 2.1], 0.016, black, { seg: 4 });   // stays
  poly(g, [[1.86, fy, 0.25], [1.72, fy + 2.0, 0.25], [1.6, fy + 3.5, 0.25], [1.58, fy + 4.0, 0.25]], 0.045, black, 6);
  g.cyl(0.07, 0.07, 0.28, 1.58, fy + 4.0, 0.25, black, { seg: 8 }); g.cyl(0.1, 0.1, 0.04, 1.58, fy + 4.28, 0.25, black, { seg: 8 });
  g.box(4.6, 1.0, 2.6, 0, fy + 0.5, 0, cream); g.box(4.72, 0.06, 2.72, 0, fy + 1.03, 0, white);          // engine casing
  for (const s of [-1, 1]) { g.cyl(0.32, 0.32, 1.3, s * 3.4, fy + 0.45, 2.6, white, { seg: 14, rz: Math.PI / 2 }); g.cyl(0.32, 0.32, 1.3, s * 3.4, fy + 0.45, -2.6, white, { seg: 14, rz: Math.PI / 2 }); }   // life-raft canisters
  for (const s of [-1, 1]) {                                                                             // mushroom vents + tall cowls
    g.cyl(0.2, 0.22, 1.1, s * 2.9, fy, 0, cream, { seg: 12 }); g.sphere(0.36, s * 2.9, fy + 1.14, 0, cream, { ws: 16, hs: 10, sy: 0.62 });
    g.cyl(0.16, 0.18, 1.5, s * 4.7, fy, 0.9 * s, cream, { seg: 12 }); g.sphere(0.27, s * 4.7, fy + 1.62, 0.9 * s, cream, { ws: 14, hs: 10 });
    g.cyl(0.24, 0.2, 0.3, s * 4.7 + s * 0.2, fy + 1.62, 0.9 * s, cream, { seg: 12, rz: -s * Math.PI / 2 });
  }
  // end decks: bollards, capstan, jackstaff
  for (const s of [-1, 1]) {
    const ex = s * 15.6, ey = deck(0.87) - 0.9;
    for (const z of [-1.6, 1.6]) { g.cyl(0.13, 0.16, 0.5, ex, ey, z, black, { seg: 12 }); g.cyl(0.17, 0.17, 0.05, ex, ey + 0.5, z, black, { seg: 12 }); }
    g.cyl(0.3, 0.36, 0.6, s * 14.6, ey, 0, black, { seg: 16 }); g.cyl(0.38, 0.38, 0.06, s * 14.6, ey + 0.6, 0, black, { seg: 16 });
    g.tube([s * 17.3, deck(0.96), 0], [s * 17.45, deck(0.96) + 2.2, 0], 0.03, white, { seg: 6 }); g.sphere(0.06, s * 17.45, deck(0.96) + 2.22, 0, white, { ws: 8, hs: 6 });
  }
  return g.build();
}

/** ferry paint: framed glazing with a lit, varied interior (aE < 0 panes) + a grazing-angle sky/sun sheen so backlit edges catch a warm rim */
function ferryMaterial(ctx) {
  return paintMaterial(ctx, {
    grime: 0.1, wet: 0.8, roughness: 0.42,
    uniforms: { uWinGain: { value: 0.55 }, uRimGain: { value: 0.4 } }, extraPars: 'uniform float uWinGain; uniform float uRimGain;',
    extraColor: /* glsl */`
      vec3 fEm_ = vec3(0.0); float fGl_ = 0.0;
      if (e_ < -0.5) {
        vec2 uv_ = paintC_.xy; float sd_ = paintC_.z;
        float h1_ = fract(sd_ * 7.31 + 0.13), h2_ = fract(sd_ * 13.7 + 0.41), h3_ = fract(sd_ * 29.3 + 0.77);
        vec2 q_ = abs(uv_ - 0.5) - vec2(0.5 - 0.075 - 0.09);
        float d_ = length(max(q_, 0.0)) + min(max(q_.x, q_.y), 0.0) - 0.09;
        float aa_ = max(fwidth(d_), 1e-4);
        fGl_ = 1.0 - smoothstep(-aa_, aa_, d_);
        float seal_ = 1.0 - smoothstep(0.012, 0.02 + aa_, abs(d_ - 0.012));
        vec3 frame_ = vec3(0.60, 0.58, 0.51) * (0.85 + 0.3 * fbm3(vWPos * 3.0)) * (1.0 - 0.8 * seal_);
        diffuseColor.rgb = mix(frame_, vec3(0.018, 0.022, 0.027), fGl_);
        float u_ = uv_.x, v_ = clamp((uv_.y - 0.075) / 0.85, 0.0, 1.0);
        vec3 in_;
        if (e_ < -1.5) {                                                    // wheelhouse: dark, a faint glow of instruments low down
          in_ = vec3(0.50, 0.62, 0.46) * 0.07 * smoothstep(0.45, 0.0, v_) * (0.5 + 0.7 * h1_);
        } else {
          float room_ = mix(0.24, 1.0, smoothstep(0.12, 0.95, v_));                                    // wall glow rising to the ceiling
          float seat_ = 0.17 + 0.13 * h2_ * step(0.5, fract(u_ * 2.0 + h1_));                           // seat backs against the light
          room_ *= mix(0.28, 1.0, smoothstep(0.0, 0.05, v_ - seat_));
          vec2 lp_ = vec2(u_ - (0.28 + 0.44 * h1_), (v_ - 0.87) * 2.4);
          float lamp_ = exp(-dot(lp_, lp_) * 110.0) * 0.95 + exp(-dot(lp_, lp_) * 9.0) * 0.3;        // ceiling fitting + its pool on the deck head
          vec3 warm_ = mix(vec3(1.0, 0.46, 0.16), vec3(1.0, 0.66, 0.34), h2_);
          in_ = warm_ * (room_ * mix(0.3, 1.0, h3_) + lamp_);
          float cur_ = step(0.14, sd_) * step(sd_, 0.29);                                               // drawn curtain
          in_ = mix(in_, vec3(0.95, 0.34, 0.10) * 0.42 * (0.75 + 0.25 * sin(u_ * 40.0 + h1_ * 6.0)) * mix(0.7, 1.0, v_), cur_);
          in_ *= mix(1.0, 0.45, step(0.78, h3_) * smoothstep(0.66, 0.7, v_) * (1.0 - cur_));          // half-lowered blind
          in_ *= mix(1.0, 0.03, step(sd_, 0.14));                                                       // unlit compartment
        }
        fEm_ = in_ * fGl_ * uWinGain;
      } else if (e_ < 0.001) {
        diffuseColor.rgb *= 1.0 - 0.25 * smoothstep(0.45, 0.8, fbm3(vWPos * vec3(0.9, 3.0, 0.9) + 5.0));   // rain streaks / salt
      }`,
    extraSurface: ' if (fGl_ > 0.5) roughnessFactor = 0.1;',
    extraEmissive: /* glsl */`
      totalEmissiveRadiance += fEm_ * smoothstep(0.03, 0.3, uNight);
      { vec3 V_ = normalize(uCamPos - vWPos); vec3 N_ = normalize(vWNormal); if (dot(N_, V_) < 0.0) N_ = -N_;
        float fr_ = pow(1.0 - clamp(dot(N_, V_), 0.0, 1.0), 5.0);
        vec3 R_ = reflect(-V_, N_); R_.y = abs(R_.y) + 0.02; R_ = normalize(R_);
        vec3 sky_ = skyLUT(uSkyLUT, R_);
        float sun_ = pow(max(dot(R_, uSunDir), 0.0), 48.0) * smoothstep(-3.0, 0.5, uSunElev);
        totalEmissiveRadiance += (sky_ * (0.03 + 0.6 * fr_) + uSunColor * sun_ * fr_ * 0.9) * uRimGain * mix(1.0, 0.35, fGl_) * (e_ < -0.5 ? 1.0 : smoothstep(0.003, 0.012, max(paintC_.r, max(paintC_.g, paintC_.b)))); }`,
  });
}

function yachtGeometry(R, { sails, L = 12.5, hullHex = 0xe8e4da }) {
  const g = new Geo(); const hullC = C(hullHex), boot = C(0x2a3a52), deckC = C(0xb9aa8c), spar = C(0xcfc8b8), sail = C(0xd9d3c2), dark = [0.02, 0.022, 0.026];
  const B = L * 0.3;
  const hb = u => B / 2 * (u > 0.05 ? Math.pow(1 - Math.pow((u - 0.05) / 0.95, 1.9), 0.75) : 1 - 0.38 * Math.pow((0.05 - u) / 1.05, 2));
  const deck = u => 1.05 + 0.28 * u * u + 0.12 * u;
  g.raw(hullGeometry({ L, hb, deck, keel: u => -0.55 * (1 - Math.pow(Math.abs(u), 3)) - 0.1, colors: { boot, hull: hullC, stripe: hullC }, deckCol: deckC, N: 16, transom: true, deckInset: 0.08 }));
  g.box(L * 0.36, 0.55, B * 0.6, -L * 0.03, 1.3, 0, hullC); g.box(L * 0.3, 0.3, B * 0.5, -L * 0.03, 1.36, 0, dark);     // cabin trunk with a window band
  const mx = L * 0.1, mh = L * 1.28;
  g.tube([mx, 1.0, 0], [mx, 1.0 + mh, 0], 0.085, spar, { seg: 5, r1: 0.05 });
  g.tube([mx, 2.3, 0], [mx - L * 0.42, 2.45, 0], 0.07, spar, { seg: 5 });                                              // boom
  for (const f of [0.45, 0.72]) g.tube([mx, 1 + mh * f, -B * 0.32], [mx, 1 + mh * f, B * 0.32], 0.025, spar, { seg: 3 });   // spreaders
  g.tube([L * 0.49, 1.35, 0], [mx, 1 + mh * 0.97, 0], 0.014, spar, { seg: 3 }); g.tube([-L * 0.5, 1.2, 0], [mx, 1 + mh, 0], 0.014, spar, { seg: 3 });
  for (const s of [-1, 1]) g.tube([mx - 0.2, 1.1, s * B * 0.46], [mx, 1 + mh * 0.72, s * B * 0.32 * 0 + s * 0.02], 0.012, spar, { seg: 3 });
  const tri = (a, b, c, col) => { const t = new THREE.BufferGeometry(); t.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c, ...a, ...c, ...b]), 3)); t.computeVertexNormals(); g.add(t, col); };
  if (sails) {
    const belly = B * 0.22;
    tri([mx - 0.05, 2.55, 0], [mx - L * 0.4, 2.6, belly], [mx - 0.05, 1 + mh * 0.98, 0], sail);
    tri([L * 0.47, 1.5, 0], [mx - 0.3, 1.7, belly * 1.3], [mx + 0.1, 1 + mh * 0.9, 0], sail);
  } else g.tube([mx - 0.1, 2.5, 0], [mx - L * 0.4, 2.62, 0], 0.16, sail, { seg: 5 });
  return g.build();
}

export function coasterGeometry(R) {
  const g = new Geo(); const hullC = C(0x1c1d20), boot = C(0x64241a), white = C(0xddd9cc), deckC = C(0x5a3a2c), rust = C(0x6e4632), buff = C(0x2d4a66), black = C(0x121214), mastC = C(0xb89a55);
  const warm = [1.0, 0.78, 0.5], dark = [0.02, 0.022, 0.026];
  const L = 66, B = 11;
  const hb = u => B / 2 * (u > 0.55 ? Math.pow(1 - Math.pow((u - 0.55) / 0.45, 2.1), 0.62) : u < -0.72 ? Math.pow(1 - Math.pow((-u - 0.72) / 0.28, 2.6), 0.45) : 1);
  const deck = u => 3.2 + (u > 0.62 ? 1.5 : 0) + (u < -0.5 ? 1.2 : 0) + 0.5 * u * u;
  g.raw(hullGeometry({ L, hb, deck, keel: u => -3.4 * (1 - Math.pow(Math.abs(u), 6)), colors: { boot, hull: hullC, stripe: hullC }, deckCol: deckC, N: 30, deckInset: 0.8 }));
  for (const x of [-4, 11]) { g.box(12, 1.3, 7.4, x, 3.2, 0, rust); g.box(12.3, 0.25, 7.7, x, 3.95, 0, C(0x3f5a4a)); }             // hatches
  // midships mast with derricks
  g.tube([3.6, 2.6, 0], [3.6, 16.5, 0], 0.28, mastC, { seg: 6, r1: 0.16 }); g.tube([3.6, 12.5, -2.2], [3.6, 12.5, 2.2], 0.08, mastC, { seg: 4 });
  g.tube([3.3, 4.2, 0], [-4.5, 10.5, 0.4], 0.14, mastC, { seg: 5 }); g.tube([3.9, 4.2, 0], [11.5, 9.5, -0.4], 0.14, mastC, { seg: 5 });
  g.tube([22, 5.2, 0], [22, 12.5, 0], 0.16, mastC, { seg: 5, r1: 0.09 });                                                          // foremast
  // aft superstructure, three tiers, with lit ports
  const tiers = [[-25, 14, 9.6, 4.9, 2.5], [-25.5, 11.5, 8.4, 7.4, 2.4], [-24.5, 7.5, 7.2, 9.8, 2.4]];
  for (const [x, len, w, y, h] of tiers) {
    g.box(len, h, w, x, y + h / 2, 0, white); g.box(len + 0.8, 0.14, w + 0.9, x, y + h + 0.07, 0, white);
    for (let k = -len / 2 + 1; k < len / 2 - 0.5; k += 1.7) for (const s of [-1, 1]) { const lit = R() > 0.45; g.box(0.8, 0.7, 0.06, x + k, y + h * 0.6, s * (w / 2 + 0.01), lit ? warm : dark, { e: lit ? 4 : 0 }); }
  }
  g.box(0.06, 0.9, 6.4, -24.5 + 3.76, 9.8 + 1.5, 0, dark);                                                                         // bridge windows
  g.cyl(1.0, 1.25, 3.6, -28.5, 12.2, 0, buff, { seg: 14, sx: 1.3, sz: 0.9 }); g.cyl(0.98, 1.0, 0.8, -28.5, 15.8, 0, black, { seg: 14, sx: 1.3, sz: 0.9 });
  g.tube([-23, 12.3, 0], [-23, 18.5, 0], 0.12, mastC, { seg: 5 }); g.tube([-23, 16.5, -1.5], [-23, 16.5, 1.5], 0.05, mastC, { seg: 4 });
  for (const s of [-1, 1]) g.box(5.2, 1.0, 1.9, -27, 8.4, s * 4.0, C(0xc2562a));                                                   // lifeboats
  return g.build();
}

export function buildVessels(ctx, S) {
  const group = new THREE.Group(); group.name = 'vessels';
  const R = ctx.rng('seascape.vessels');
  const mat = S.vesselMat;
  // ---- ferry path ------------------------------------------------------------------------------
  const route = ctx.layout.harbor.ferryRoute;
  const curve = new THREE.CatmullRomCurve3(route.map(p => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal', 0.5);
  const NP = 400; const pts = curve.getSpacedPoints(NP); const LEN = curve.getLength();
  const V = 6, ACC = 0.22, TA = V / ACC, T1 = LEN / V + TA, DWELL = 28, CYCLE = 2 * (T1 + DWELL);
  // phase: abeam of the second route vertex (in front of the quay cameras) at t = 20 s
  const sAtVertex = (() => { let best = 0, bd = 1e9; for (let i = 0; i <= NP; i++) { const d = Math.hypot(pts[i].x - route[1][0], pts[i].z - route[1][1]); if (d < bd) { bd = d; best = i; } } return best / NP * LEN; })();
  const TAU0 = sAtVertex / V + TA / 2 - 20;
  const prof = tau => {                                 // distance + speed along one leg, trapezoid speed profile
    if (tau <= 0) return [0, 0]; if (tau >= T1) return [LEN, 0];
    if (tau < TA) return [0.5 * ACC * tau * tau, ACC * tau];
    if (tau > T1 - TA) { const r = T1 - tau; return [LEN - 0.5 * ACC * r * r, ACC * r]; }
    return [V * (tau - TA / 2), V];
  };
  function ferryState(t) {
    let c = (t + TAU0) % CYCLE; if (c < 0) c += CYCLE;
    let s, sp, dir;
    if (c < T1 + DWELL) { [s, sp] = prof(c); dir = 1; } else { [s, sp] = prof(c - T1 - DWELL); s = LEN - s; dir = -1; }
    const f = clamp(s / LEN, 0, 1) * NP; const i = Math.min(NP - 1, Math.floor(f)), k = f - i;
    const x = lerp(pts[i].x, pts[i + 1].x, k), z = lerp(pts[i].z, pts[i + 1].z, k);
    const i0 = Math.max(0, i - 6), i1 = Math.min(NP, i + 7);
    let hx = pts[i1].x - pts[i0].x, hz = pts[i1].z - pts[i0].z; const hl = Math.hypot(hx, hz); hx /= hl; hz /= hl;
    // signed curvature from neighbouring tangents (for a touch of heel in the turns)
    const j0 = Math.max(0, i - 14), j1 = Math.min(NP, i + 14);
    const ta = Math.atan2(pts[Math.min(NP, j0 + 4)].z - pts[j0].z, pts[Math.min(NP, j0 + 4)].x - pts[j0].x), tb = Math.atan2(pts[j1].z - pts[Math.max(0, j1 - 4)].z, pts[j1].x - pts[Math.max(0, j1 - 4)].x);
    let dth = tb - ta; while (dth > Math.PI) dth -= 2 * Math.PI; while (dth < -Math.PI) dth += 2 * Math.PI;
    const curv = dth / Math.max(1, (j1 - j0 - 4) * LEN / NP);
    return { x, z, hx, hz, dir, speed: sp, curv };
  }
  const ferry = new THREE.Mesh(ferryGeometry(R), ferryMaterial(ctx)); ferry.castShadow = ferry.receiveShadow = true; ferry.name = 'ferry'; group.add(ferry);
  const fl = {
    mast: S.dyn.add(0, 0, 0, [1.0, 0.95, 0.85], 30, 0.2), stern: S.dyn.add(0, 0, 0, [1.0, 0.95, 0.85], 12, 0.16),
    port: S.dyn.add(0, 0, 0, [1.0, 0.04, 0.015], 10, 0.18), stbd: S.dyn.add(0, 0, 0, [0.03, 1.0, 0.3], 10, 0.18),
    deckA: S.dyn.add(0, 0, 0, [1.0, 0.72, 0.4], 9, 0.3), deckB: S.dyn.add(0, 0, 0, [1.0, 0.72, 0.4], 9, 0.3),
  };
  // ---- yachts + coaster --------------------------------------------------------------------------
  const gFurled = yachtGeometry(R, { sails: false }), gSail = yachtGeometry(R, { sails: true, L: 13.5 }), gKetch = yachtGeometry(R, { sails: false, L: 15, hullHex: 0x2b3e55 });
  const yachts = [
    { name: 'yacht1', g: gFurled, x: -1480, z: -430, psi: 3.0, vx: 0, vz: 0, L: 12.5 },
    { name: 'yacht2', g: gKetch, x: -2050, z: 62, psi: 3.25, vx: 0, vz: 0, L: 15 },
    { name: 'yacht3', g: gFurled, x: -1390, z: 700, psi: 2.9, vx: 0, vz: 0, L: 12.5 },
    { name: 'yacht4', g: gSail, x: -2250, z: -760, psi: 0.5, vx: 1.1, vz: -0.6, L: 13.5 },
    { name: 'yacht5', g: gSail, x: -2600, z: 980, psi: -0.7, vx: 0.75, vz: 0.75, L: 13.5 },
  ];
  yachts.forEach((y, i) => {
    y.mesh = new THREE.Mesh(y.g, mat); y.mesh.castShadow = true; y.mesh.name = y.name; group.add(y.mesh); y.seed = i * 1.7 + 0.4;
    y.light = S.dyn.add(0, 0, 0, [1.0, 0.95, 0.85], 26, 0.12);
    if (y.vx || y.vz) y.psi = Math.atan2(-y.vz, y.vx);
  });
  const coaster = new THREE.Mesh(coasterGeometry(R), mat); coaster.castShadow = true; coaster.name = 'coaster'; group.add(coaster);
  const cl = [S.dyn.add(0, 0, 0, [1, 0.95, 0.85], 80, 0.25), S.dyn.add(0, 0, 0, [1, 0.95, 0.85], 80, 0.25), S.dyn.add(0, 0, 0, [1.0, 0.08, 0.04], 40, 0.2), S.dyn.add(0, 0, 0, [1, 0.8, 0.5], 30, 0.5)];
  const coasterState = t => ({ x: -2950 - 0.4 * t, z: -1650 + 2.9 * t, hx: -0.137, hz: 0.99, speed: 2.93 });

  const e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3();
  const put = (mesh, idx, lx, ly, lz) => { v.set(lx, ly, lz).applyMatrix4(mesh.matrix); S.dyn.setPos(idx, v.x, v.y, v.z); };
  function update(t) {
    const f = ferryState(t);
    const psi = Math.atan2(-f.hz, f.hx);
    ferry.position.set(f.x, 0.05 * Math.sin(t * 0.9) + 0.03 * Math.sin(t * 1.63), f.z);
    e.set(0.013 * Math.sin(t * 0.71 + 1) - clamp(f.curv * f.speed * f.speed * f.dir * 0.11, -0.05, 0.05), psi, 0.007 * Math.sin(t * 0.63));   // x = roll about the length axis after yaw (YXZ: yaw, then roll about local x)
    ferry.rotation.copy(e); ferry.updateMatrix();
    const d = f.dir;
    put(ferry, fl.mast, d * 6.8, 9.9, 0); put(ferry, fl.stern, -d * 17.4, 2.9, 0);
    put(ferry, fl.port, d * 7.4, 6.05, -d * 2.12); put(ferry, fl.stbd, d * 7.4, 6.05, d * 2.12);
    put(ferry, fl.deckA, 15.2, 3.4, 0); put(ferry, fl.deckB, -15.2, 3.4, 0);
    for (const y of yachts) {
      const x = y.x + y.vx * t, z = y.z + y.vz * t;
      const swing = (y.vx || y.vz) ? 0 : 0.12 * Math.sin(t * 0.05 + y.seed * 3);       // anchored boats swing a little
      y.mesh.position.set(x, 0.07 * Math.sin(t * 1.0 + y.seed), z);
      e.set(0.05 * Math.sin(t * 0.83 + y.seed) + ((y.vx || y.vz) ? 0.12 : 0), y.psi + swing, 0.025 * Math.sin(t * 1.21 + y.seed * 2));
      y.mesh.rotation.copy(e); y.mesh.updateMatrix();
      put(y.mesh, y.light, y.L * 0.1, 1.1 + y.L * 1.28, 0);
    }
    const c = coasterState(t);
    coaster.position.set(c.x, 0.04 * Math.sin(t * 0.5), c.z); e.set(0.01 * Math.sin(t * 0.45), Math.atan2(-c.hz, c.hx), 0.006 * Math.sin(t * 0.38)); coaster.rotation.copy(e); coaster.updateMatrix();
    put(coaster, cl[0], 22, 12.8, 0); put(coaster, cl[1], -23, 18.8, 0); put(coaster, cl[2], -21, 12.6, -5); put(coaster, cl[3], -24, 9, -5.2);
  }
  update(0);
  /** positions of all vessels at time t (for wakes, reflections, camera work) */
  function vessels(t) {
    const f = ferryState(t); const c = coasterState(t);
    const out = [{ name: 'ferry', kind: 'ferry', x: f.x, y: 0, z: f.z, heading: [f.hx * f.dir, f.hz * f.dir], bow: [f.hx, f.hz], speed: f.speed, length: 36, beam: 9.6, draft: 1.6, height: 10.5 }];
    for (const y of yachts) out.push({ name: y.name, kind: 'yacht', x: y.x + y.vx * t, y: 0, z: y.z + y.vz * t, heading: [Math.cos(y.psi), -Math.sin(y.psi)], speed: Math.hypot(y.vx, y.vz), length: y.L, beam: y.L * 0.3, draft: 0.6, height: y.L * 1.3 });
    out.push({ name: 'coaster', kind: 'cargo', x: c.x, y: 0, z: c.z, heading: [c.hx, c.hz], speed: c.speed, length: 66, beam: 11, draft: 3.4, height: 19 });
    return out;
  }
  return { group, update, vessels, ferryState, ferryCycle: CYCLE };
}
