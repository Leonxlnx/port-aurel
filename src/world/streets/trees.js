// Street / park trees. Each species is grown once (trunk -> scaffold limbs -> secondary branches -> twigs) and emitted in
// three levels of detail that share the same skeleton, so they agree in silhouette and tone:
//   hi  : bark tubes down to the twigs + ~900 small alpha-tested leaf sprays (one card per spray of 10-20 leaves)
//   mid : trunk + limbs, one or two bough cards per twig (~250 cards)
//   lo  : trunk, one or two large bough cards per secondary branch (~60 cards)
// Leaves are drawn with stochastic ("hashed") alpha so their coverage stays correct at any distance and in the shadow
// map, are lit as thin translucent sheets (reflecting on the lit side, glowing yellow-green when back-lit), darken
// towards the inside of the crown and rock in the wind as a pure function of uTime.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const add3 = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len3 = a => Math.hypot(a[0], a[1], a[2]);
const nrm3 = a => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// leaf: 0 = palmate (plane / maple), 1 = ovate (linden / pear / ash). bark: [linear rgb], mottle 0..1 (plane-tree patches)
export const TREE_SPECIES = [
  { name: 'plane', trunkH: 3.4, crownR: 3.1, crownH: 6.4, trunkR: 0.2, scaffolds: 7, skew: 0.82, round: 0.5, rag: 1.0, arch: 0.16, drop: 0.9, sec: 6.5, twigs: 4.7, leaves: 6.2, card: 0.68, leaf: 0, bark: [0.15, 0.14, 0.11], mottle: 1, tint: [1.04, 1.0, 0.86], gap: 0.22 },
  { name: 'linden', trunkH: 2.9, crownR: 2.65, crownH: 6.8, trunkR: 0.19, scaffolds: 8, skew: 0.66, round: 0.62, rag: 0.6, arch: 0.3, drop: 0.7, sec: 6.5, twigs: 4.8, leaves: 5.8, card: 0.58, leaf: 1, bark: [0.085, 0.072, 0.058], mottle: 0, tint: [0.88, 0.97, 0.9], gap: 0.08 },
  { name: 'maple', trunkH: 3.0, crownR: 3.2, crownH: 5.6, trunkR: 0.18, scaffolds: 7, skew: 0.88, round: 0.45, rag: 0.8, arch: 0.22, drop: 0.8, sec: 6.5, twigs: 4.7, leaves: 6.2, card: 0.64, leaf: 0, bark: [0.11, 0.095, 0.078], mottle: 0, tint: [1.0, 0.98, 0.8], gap: 0.12 },
  { name: 'ash', trunkH: 3.6, crownR: 2.9, crownH: 6.0, trunkR: 0.16, scaffolds: 6, skew: 0.95, round: 0.55, rag: 1.4, arch: 0.1, drop: 1.0, sec: 5.5, twigs: 4.2, leaves: 5.2, card: 0.62, leaf: 1, bark: [0.13, 0.12, 0.1], mottle: 0, tint: [1.06, 1.04, 0.9], gap: 0.35 },
  { name: 'pear', trunkH: 2.7, crownR: 2.1, crownH: 6.0, trunkR: 0.14, scaffolds: 8, skew: 0.78, round: 0.45, rag: 0.7, arch: 0.42, drop: 0.5, sec: 5.5, twigs: 4.4, leaves: 5.4, card: 0.52, leaf: 1, bark: [0.075, 0.066, 0.056], mottle: 0, tint: [0.94, 1.0, 0.82], gap: 0.1 },
];

// ---- geometry accumulators -----------------------------------------------------------------------------------
class Buf {
  constructor(names) { this.a = {}; for (const [n, size] of names) this.a[n] = { size, v: [] }; this.idx = []; this.n = 0; }
  get tris() { return this.idx.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    for (const n in this.a) g.setAttribute(n, new THREE.Float32BufferAttribute(this.a[n].v, this.a[n].size));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/** tapered tube along pts with radii; cb(pos, normal, u (m around), v (m along)) emits a vertex and returns its index */
function tube(pts, radii, sides, idx, cb) {
  const n = pts.length; const rings = [];
  let ref = [0, 0, 1]; let vlen = 0;
  for (let i = 0; i < n; i++) {
    const t = nrm3(sub3(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)]));
    if (Math.abs(dot3(t, ref)) > 0.9) ref = [1, 0, 0];
    const u = nrm3(cross3(t, ref)), v = cross3(t, u); ref = cross3(u, t);          // carry the frame along the tube
    if (i > 0) vlen += len3(sub3(pts[i], pts[i - 1]));
    const ring = [];
    for (let k = 0; k <= sides; k++) {
      const a = k / sides * TAU, c = Math.cos(a), s = Math.sin(a);
      const nr = [u[0] * c + v[0] * s, u[1] * c + v[1] * s, u[2] * c + v[2] * s];
      ring.push(cb(add3(pts[i], nr, radii[i]), nr, k / sides * TAU * radii[0], vlen));
    }
    rings.push(ring);
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
    const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k], d = rings[i + 1][k + 1];
    idx.push(a, b, c, b, d, c);
  }
}

const bez = (a, q, b, t) => { const s = 1 - t; return [s * s * a[0] + 2 * s * t * q[0] + t * t * b[0], s * s * a[1] + 2 * s * t * q[1] + t * t * b[1], s * s * a[2] + 2 * s * t * q[2] + t * t * b[2]]; };

const SPRAY = 0.64, MORE = 1.5;
/** small private generator (mulberry32 seeded from a string) */
function lcg(str) {
  let a = 2166136261; for (let i = 0; i < str.length; i++) { a ^= str.charCodeAt(i); a = Math.imul(a, 16777619); }
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

// ---- growth --------------------------------------------------------------------------------------------------
function grow(R, sp) {
  const rr = (a, b) => a + (b - a) * R();
  const H = sp.trunkH, CR = sp.crownR, CH = sp.crownH, y0 = H - sp.drop, yH = CH + sp.drop;
  const lean = [rr(-0.45, 0.45), rr(-0.45, 0.45)];
  const base = [0, -0.06, 0], top = [lean[0] * 0.45, H, lean[1] * 0.45];
  const apex = [lean[0] + rr(-0.3, 0.3), H + CH * rr(0.8, 0.9), lean[1] + rr(-0.3, 0.3)];
  const C = [lean[0], y0 + yH * 0.5, lean[1]];
  // ragged envelope: radius as a function of azimuth and relative height
  const ph = [rr(0, TAU), rr(0, TAU), rr(0, TAU), rr(0, TAU)], az0 = rr(0, TAU), asym = rr(0.05, 0.2) * sp.rag;
  const prof = h => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(clamp(h, 0, 1), sp.skew))), sp.round);
  const lobe = (az, h) => 1 + sp.rag * (0.13 * Math.sin(2 * az + ph[0] + h * 2.0) + 0.1 * Math.sin(3 * az + ph[1] - h * 3.0) + 0.07 * Math.sin(5 * az + ph[2] + h * 5.0)) + asym * Math.cos(az - az0);
  const envR = (az, h) => CR * prof(h) * lobe(az, h);
  const envPt = (az, h, f = 1) => { const r = envR(az, h) * f; return [C[0] + Math.cos(az) * r, y0 + yH * h, C[2] + Math.sin(az) * r]; };
  /** 0 on the axis .. 1 on the envelope */
  const metric = p => { const h = (p[1] - y0) / yH; if (h <= 0.01 || h >= 0.995) return 2; const dx = p[0] - C[0], dz = p[2] - C[2]; return Math.hypot(dx, dz) / Math.max(0.05, envR(Math.atan2(dz, dx), h)); };
  const pull = (from, to) => { let p = to; for (let i = 0; i < 6 && metric(p) > 1.04; i++) p = lerp3(from, p, 0.8); return p; };
  const rndDir = () => { const z = rr(-1, 1), a = rr(0, TAU), s = Math.sqrt(1 - z * z); return [s * Math.cos(a), z, s * Math.sin(a)]; };

  const tubes = [];              // { pts, radii, level }
  const twigs = [];              // { a, b, sec }
  const secs = [];               // { a, b }
  const trunkPts = [base, [lean[0] * 0.08, H * 0.3, lean[1] * 0.08], [lean[0] * 0.25, H * 0.68, lean[1] * 0.25], top, lerp3(top, apex, 0.5), apex];
  const tr = sp.trunkR;
  tubes.push({ pts: [[0, -0.06, 0], [0, 0.12, 0], trunkPts[1], trunkPts[2], top, lerp3(top, apex, 0.35), lerp3(top, apex, 0.7), apex], radii: [tr * 1.75, tr * 1.25, tr * 1.04, tr * 0.96, tr * 0.86, tr * 0.6, tr * 0.34, 0.02], level: 0 });
  const leader = s => lerp3(top, apex, s);
  const limbs = [];
  const N1 = sp.scaffolds;
  for (let i = 0; i < N1; i++) {
    const s = (i + rr(0.1, 0.7)) / N1 * 0.72, az = i * 2.39996 + rr(-0.45, 0.45) + az0;
    const h = clamp(0.13 + 0.77 * Math.pow(s / 0.72, 0.85) + rr(-0.06, 0.06), 0.1, 0.93);
    const reach = R() < sp.gap ? rr(0.55, 0.72) : rr(0.84, 1.0);
    const S = leader(s), E = envPt(az, h, reach), L = len3(sub3(E, S));
    const Q = add3(lerp3(S, E, 0.45), [0, 1, 0], L * (sp.arch * rr(0.7, 1.4) + 0.22 * (1 - s / 0.72)));
    limbs.push({ S, Q, E, L, r: tr * (0.52 - 0.22 * s / 0.72) });
  }
  limbs.push({ S: leader(0.72), Q: leader(0.87), E: apex, L: len3(sub3(apex, leader(0.72))), r: 0, leader: true });
  for (const lb of limbs) {
    const P = t => bez(lb.S, lb.Q, lb.E, t);
    if (!lb.leader) { const pts = [], radii = []; for (let k = 0; k <= 5; k++) { pts.push(P(k / 5)); radii.push(lb.r * (1 - 0.86 * k / 5) + 0.012); } tubes.push({ pts, radii, level: 1 }); }
    const N2 = Math.max(2, Math.round(sp.sec * clamp(lb.L / 2.6, 0.5, 1.3) * (lb.leader ? 0.7 : 1)));
    const ends = [];
    for (let k = 0; k < N2; k++) {
      const t = 0.28 + 0.68 * (k + rr(0.1, 0.9)) / N2, a = P(t);
      const out = nrm3([a[0] - C[0], 0, a[2] - C[2]]);
      const d = nrm3(add3(add3(rndDir(), out, 0.55), [0, 1, 0], rr(-0.25, 0.5)));
      const b = pull(a, add3(a, d, rr(0.9, 1.7) * (1 - 0.35 * t) * CR / 3));
      ends.push({ a, b, r: Math.max(0.018, lb.r * (1 - 0.8 * t) * 0.55) });
    }
    ends.push({ a: P(0.86), b: P(1.0), r: 0.02, tip: true });
    for (const e of ends) {
      const si = secs.length; secs.push(e);
      const mid = add3(lerp3(e.a, e.b, 0.5), [0, 1, 0], len3(sub3(e.b, e.a)) * 0.12);
      const Ps = t => bez(e.a, mid, e.b, t);
      if (!e.tip) tubes.push({ pts: [Ps(0), Ps(0.5), Ps(1)], radii: [e.r, e.r * 0.6, 0.008], level: 2 });
      const N3 = Math.max(2, Math.round(sp.twigs + rr(-0.6, 0.6)));
      for (let k = 0; k < N3; k++) {
        const t = k === N3 - 1 ? 1 : 0.3 + 0.7 * (k + rr(0, 0.8)) / N3, a = Ps(t);
        const out = nrm3(sub3(a, C));
        const d = nrm3(add3(add3(rndDir(), out, 0.7), [0, 1, 0], rr(-0.55, 0.35)));
        const b = pull(a, add3(a, d, rr(0.45, 0.85) * CR / 3));
        twigs.push({ a, b, sec: si });
        tubes.push({ pts: [a, b], radii: [0.011, 0.004], level: 3 });
      }
    }
  }
  // leaf sprays along the twigs (hi level)
  const cards = [];
  const rad = [CR, yH * 0.5, CR], Cs = [C[0], C[1] - yH * 0.12, C[2]];
  // The sprays are SPRAY x the nominal card size and MORE x as many (at 4K the big cards read as cards). The extra ones
  // and the core cards draw from a private generator so that the skeletons stay exactly what they were.
  const R2 = lcg(sp.name), r2 = (a, b) => a + (b - a) * R2();
  const spray = (Rn, tw, ti, dir, tip) => {
    const rn = (a, b) => a + (b - a) * Rn();
    const rd = () => { const z = rn(-1, 1), a = rn(0, TAU), sn = Math.sqrt(1 - z * z); return [sn * Math.cos(a), z, sn * Math.sin(a)]; };
    const t = tip ? 1 : rn(0.2, 1.0), q = lerp3(tw.a, tw.b, t);
    const out = nrm3(sub3(q, Cs));
    // the spray grows away from the twig, slightly outward and drooping
    let d = tip ? add3(add3(dir, rd(), 0.35), [0, -1, 0], 0.15) : add3(add3(add3(rd(), dir, 0.4), out, 0.45), [0, -1, 0], 0.3);
    d = nrm3(d);
    // blade plane: faces up / outward with a wide scatter
    let nn = add3(add3(rd(), [0, 1, 0], 0.75), out, 0.55); nn = nrm3(sub3(nn, [d[0] * dot3(nn, d), d[1] * dot3(nn, d), d[2] * dot3(nn, d)]));
    const size = sp.card * SPRAY * rn(0.78, 1.22);
    cards.push({ c: add3(q, d, size * 0.42), d, n: nn, size, twig: ti, sec: tw.sec, t, tile: sp.leaf * 4 + Math.floor(Rn() * 4), rnd: Rn(), phase: Rn(), flip: Rn() < 0.5 });
  };
  twigs.forEach((tw, ti) => {
    const dir = nrm3(sub3(tw.b, tw.a)), n = Math.max(3, Math.round(sp.leaves + rr(-0.9, 0.9)));
    for (let k = 0; k < n; k++) spray(R, tw, ti, dir, k === 0);
    const extra = Math.round(n * (MORE - 1) + r2(-0.4, 0.4));
    for (let k = 0; k < extra; k++) spray(R2, tw, ti, dir, false);
  });
  // canopy core: denser, darker boughs around the secondary branches, a little inside the leafy shell
  secs.forEach((e, si) => {
    const nC = e.tip ? 2 : 3;
    for (let k = 0; k < nC; k++) {
      const q0 = lerp3(e.a, e.b, r2(0.2, 0.75)), q = lerp3(q0, [C[0], q0[1], C[2]], r2(0.1, 0.3));
      const out = nrm3(sub3(q, Cs)), z = r2(-1, 1), a = r2(0, TAU), sn = Math.sqrt(1 - z * z);
      const nn = nrm3(add3(add3([sn * Math.cos(a), z, sn * Math.sin(a)], [0, 1, 0], 0.5), out, 0.8));
      const d = nrm3(cross3(nn, [r2(-1, 1), r2(-1, 1), r2(-1, 1)]));
      cards.push({ c: q, d, n: nn, size: sp.card * r2(1.25, 1.75), twig: -1, sec: si, t: 0, tile: 8 + sp.leaf * 2 + (R2() < 0.5 ? 0 : 1), rnd: R2(), phase: R2(), flip: R2() < 0.5, core: true });
    }
  });
  // exposure: how open is the way out of the crown (other sprays outward / above dim it)
  const m = cards.length;
  for (let i = 0; i < m; i++) {
    const p = cards[i].c, o = nrm3(add3(nrm3([(p[0] - Cs[0]) / rad[0], (p[1] - Cs[1]) / rad[1], (p[2] - Cs[2]) / rad[2]]), [0, 1, 0], 0.45));
    let occ = 0;
    for (let j = 0; j < m; j++) {
      if (j === i) continue; const q = cards[j].c, dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > 4.0 || d2 < 1e-6) continue; const d = Math.sqrt(d2), cs = (dx * o[0] + dy * o[1] + dz * o[2]) / d;
      if (cs > 0.35) occ += (1 - d / 2.0) * (cs - 0.35) / 0.65;
    }
    cards[i].occ = occ;
  }
  const occs = cards.map(c => c.occ).sort((a, b) => a - b), o90 = occs[Math.floor(m * 0.9)] || 1;
  for (const c of cards) { c.exp = clamp(Math.exp(-1.5 * c.occ / o90), 0.12, 1); if (c.core) c.exp = clamp(c.exp * 0.5, 0.08, 0.4); }
  return { sp, tubes, twigs, secs, cards, C, Cs, rad, H, CH, CR, y0, yH };
}

// ---- emit ------------------------------------------------------------------------------------------------------
const TILE = 0.25, INSET = 2.5 / 1024;
function tileUV(tile) { const tx = tile % 4, ty = Math.floor(tile / 4); return [tx * TILE + INSET, ty * TILE + INSET, (tx + 1) * TILE - INSET, (ty + 1) * TILE - INSET]; }
const BOUGH_TILE = leaf => 8 + leaf * 2;       // + 0 / 1
const BARK_TILE = pale => 12 + (pale ? 1 : 0);

function leafBuf() { return new Buf([['position', 3], ['normal', 3], ['uv', 2], ['aLeaf', 4], ['aCtr', 3]]); }

function emitCard(B, T, c, d, n, size, tile, flip, phase, rnd, exp) {
  const ax = nrm3(cross3(d, n)), h = size * 0.5, uv = tileUV(tile);
  const flex = clamp((c[1] - T.H * 0.55) / (T.CH + T.H * 0.45), 0, 1);
  const base = B.n;
  for (let j = 0; j < 4; j++) {
    const sx = (j === 0 || j === 3) ? -1 : 1, sy = j < 2 ? -1 : 1;
    const p = [c[0] + (ax[0] * sx + d[0] * sy) * h, c[1] + (ax[1] * sx + d[1] * sy) * h, c[2] + (ax[2] * sx + d[2] * sy) * h];
    const ns = nrm3([(p[0] - T.Cs[0]) / T.rad[0], (p[1] - T.Cs[1]) / T.rad[1], (p[2] - T.Cs[2]) / T.rad[2]]);
    B.a.position.v.push(p[0], p[1], p[2]); B.a.normal.v.push(ns[0], ns[1], ns[2]);
    B.a.uv.v.push((sx > 0) !== flip ? uv[2] : uv[0], sy > 0 ? uv[3] : uv[1]);
    B.a.aLeaf.v.push(phase, flex * flex * (3 - 2 * flex), rnd, exp); B.a.aCtr.v.push(c[0], c[1], c[2]);
  }
  B.n += 4; B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function emitBarkInLeaf(B, tb, sides, pale, segs = null) {
  const uv = tileUV(BARK_TILE(pale)), u = (uv[0] + uv[2]) / 2, v = (uv[1] + uv[3]) / 2;
  let pts = tb.pts, radii = tb.radii;
  if (segs) { const n = pts.length - 1; pts = segs.map(i => tb.pts[Math.round(i * n)]); radii = segs.map(i => tb.radii[Math.round(i * n)]); }
  tube(pts, radii, sides, B.idx, (p, nr) => {
    B.a.position.v.push(p[0], p[1], p[2]); B.a.normal.v.push(nr[0], nr[1], nr[2]); B.a.uv.v.push(u, v);
    B.a.aLeaf.v.push(0, 0, 0.5, -1); B.a.aCtr.v.push(p[0], p[1], p[2]);
    return B.n++;
  });
}

/** one species -> { hi: { bark, barkTris, leaf, leafTris }, mid: { leaf, leafTris }, lo: { leaf, leafTris } } */
export function makeTree(R, sp) {
  const T = grow(R, sp), rr = (a, b) => a + (b - a) * R(), rrMain = rr;
  const pale = sp.mottle > 0.5;
  // --- hi: bark mesh
  const bark = new Buf([['position', 3], ['normal', 3], ['color', 3], ['aBark', 3]]);
  const SIDES = [9, 5, 3, 3];
  for (const tb of T.tubes) {
    const dk = tb.level === 0 ? 1 : tb.level === 1 ? 0.92 : 0.8;
    tube(tb.pts, tb.radii, SIDES[tb.level], bark.idx, (p, nr, u, v) => {
      bark.a.position.v.push(p[0], p[1], p[2]); bark.a.normal.v.push(nr[0], nr[1], nr[2]);
      bark.a.color.v.push(sp.bark[0] * dk, sp.bark[1] * dk, sp.bark[2] * dk); bark.a.aBark.v.push(u, v, tb.level < 2 ? sp.mottle : sp.mottle * 0.4);
      return bark.n++;
    });
  }
  // --- hi: leaf sprays
  const hi = leafBuf();
  for (const c of T.cards) emitCard(hi, T, c.c, c.d, c.n, c.size, c.tile, c.flip, c.phase, c.rnd, c.exp);
  // --- cluster cards for the lower levels
  const cluster = (members, grow, pad = sp.card * 0.5) => {
    let cx = 0, cy = 0, cz = 0, e = 0, em = 0; for (const c of members) { cx += c.c[0]; cy += c.c[1]; cz += c.c[2]; e += c.exp; em = Math.max(em, c.exp); }
    const k = members.length; const c = [cx / k, cy / k, cz / k]; let r = 0;
    for (const q of members) r = Math.max(r, len3(sub3(q.c, c)));
    return { c, size: (r + pad) * 2 * grow, exp: 0.3 * e / k + 0.7 * em, rnd: members[0].rnd, phase: members[0].phase };
  };
  const R2 = lcg(sp.name + ':lod'), r2 = (a, b) => a + (b - a) * R2();
  const crossed = (B, cl, both, tile, rr = rrMain) => {
    const out = nrm3(sub3(cl.c, T.Cs));
    let n1 = nrm3(add3(out, [rr(-1, 1), rr(-0.4, 1), rr(-1, 1)], 0.6));
    let d1 = nrm3(cross3(n1, [rr(-1, 1), rr(-1, 1), rr(-1, 1)]));
    emitCard(B, T, cl.c, d1, n1, cl.size, tile + (cl.rnd < 0.5 ? 0 : 1), cl.phase < 0.5, cl.phase, cl.rnd, cl.exp);
    if (both) { const d2 = nrm3(cross3(n1, d1)); emitCard(B, T, cl.c, n1, d2, cl.size * 0.94, tile + (cl.rnd < 0.5 ? 1 : 0), cl.phase > 0.5, cl.phase, 1 - cl.rnd, cl.exp); }
  };
  const byTwig = new Map(), bySec = new Map();
  for (const c of T.cards) { if (c.core) continue; (byTwig.get(c.twig) || byTwig.set(c.twig, []).get(c.twig)).push(c); (bySec.get(c.sec) || bySec.set(c.sec, []).get(c.sec)).push(c); }
  const mid = leafBuf();
  emitBarkInLeaf(mid, T.tubes[0], 5, pale, [0, 0.15, 0.45, 0.6, 0.8, 1]);
  for (const tb of T.tubes) if (tb.level === 1) emitBarkInLeaf(mid, tb, 3, pale, [0, 0.4, 1]);
  // two boughs per twig (tip half / inner half) instead of one big card, plus the core cards
  let ti = 0;
  for (const [, mem] of byTwig) {
    const srt = [...mem].sort((a, b) => b.t - a.t), h = Math.max(1, Math.ceil(srt.length * 0.5)), pad = sp.card * SPRAY * 0.5;
    crossed(mid, cluster(srt.slice(0, h), 0.92, pad), (ti++ % 5) < 2, BOUGH_TILE(sp.leaf));
    if (srt.length > h) crossed(mid, cluster(srt.slice(h), 0.92, pad), false, BOUGH_TILE(sp.leaf), r2);
  }
  for (const c of T.cards) if (c.core) emitCard(mid, T, c.c, c.d, c.n, c.size * 1.5, c.tile, c.flip, c.phase, c.rnd, c.exp);
  const lo = leafBuf();
  emitBarkInLeaf(lo, T.tubes[0], 3, pale, [0, 0.45, 0.8, 1]);
  let si = 0; for (const [, mem] of bySec) crossed(lo, cluster(mem, 0.8), (si++ % 2) === 0, BOUGH_TILE(sp.leaf));
  void r2;
  return {
    hi: { bark: bark.build(), barkTris: bark.tris, leaf: hi.build(), leafTris: hi.tris },
    mid: { leaf: mid.build(), leafTris: mid.tris },
    lo: { leaf: lo.build(), leafTris: lo.tris },
    height: T.H + T.CH,
  };
}

// ---- leaf atlas ------------------------------------------------------------------------------------------------
// 1024 x 1024 RGBA, 4 x 4 tiles: row 0 palmate sprays, row 1 ovate sprays, row 2 boughs (2 palmate, 2 ovate), row 3 bark
export function leafTexture(R) {
  const N = 1024, T = 256; const data = new Uint8Array(N * N * 4);
  const rr = (a, b) => a + (b - a) * R();
  const LP = [0, 0.8, -0.8, 1.6, -1.6], LA = [1.0, 0.88, 0.88, 0.6, 0.6];
  /** one leaf: base at (bx, by) in tile pixels, pointing along ang, len pixels long */
  const leaf = (ox, oy, bx, by, len, ang, kind, col, shade) => {
    const ca = Math.cos(ang), sa = Math.sin(ang), c0 = col[0] * shade, c1 = col[1] * shade, c2 = col[2] * shade;
    const x0 = Math.max(3, Math.floor(bx - len)), x1 = Math.min(T - 4, Math.ceil(bx + len)), y0 = Math.max(3, Math.floor(by - len)), y1 = Math.min(T - 4, Math.ceil(by + len));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - bx, dy = y + 0.5 - by, u = (dx * ca + dy * sa) / len, v = (-dx * sa + dy * ca) / len;
      let k = 0;
      if (kind === 0) {
        const r2 = u * u + v * v; if (r2 > 1) continue;
        const r = Math.sqrt(r2), phi = Math.atan2(v, u); let Rm = 0, vein = 9;
        for (let q = 0; q < 5; q++) { const d = Math.abs(phi - LP[q]); if (d < vein) vein = d; if (d < 0.56) { const e = d / 0.17, w = LA[q] * (0.6 + 0.4 * Math.exp(-e * e)); if (w > Rm) Rm = w; } }
        if (r > Rm) continue;
        k = (vein * r < 0.02 ? 1.2 : 1.0) * (0.84 + 0.22 * r / Rm) * (v > 0 ? 1.05 : 0.95);
      } else {
        if (u <= 0 || u >= 1) continue; const w = 0.37 * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.62)), 0.85);
        const av = Math.abs(v); if (av > w) continue;
        const side = Math.abs(((u * 7 + av * 3.2) % 1) - 0.5) < 0.07 ? 1.1 : 1.0;
        k = (av < 0.024 ? 1.24 : side) * (1.02 - 0.22 * av / w) * (v > 0 ? 1.06 : 0.94);
      }
      const o = ((oy + y) * N + ox + x) * 4;
      data[o] = Math.min(255, c0 * k); data[o + 1] = Math.min(255, c1 * k); data[o + 2] = Math.min(255, c2 * k); data[o + 3] = 255;
    }
  };
  const line = (ox, oy, ax, ay, bx, by, w, col) => {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 1.5);
    for (let i = 0; i <= n; i++) {
      const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
      for (let yy = Math.floor(y - w); yy <= Math.ceil(y + w); yy++) for (let xx = Math.floor(x - w); xx <= Math.ceil(x + w); xx++) {
        if (xx < 3 || yy < 1 || xx > T - 4 || yy > T - 4 || Math.hypot(xx + 0.5 - x, yy + 0.5 - y) > w) continue;
        const o = ((oy + yy) * N + ox + xx) * 4; data[o] = col[0]; data[o + 1] = col[1]; data[o + 2] = col[2]; data[o + 3] = 255;
      }
    }
  };
  const leafCol = kind => {
    const q = R(), b = rr(0.8, 1.14);
    if (q < 0.05) return [146 * b, 136 * b, 52 * b];                      // turning yellow
    if (q < 0.07) return [108 * b, 86 * b, 46 * b];                       // browned
    const y = rr(0, 1);
    return kind === 0 ? [(80 + 22 * y) * b, (116 + 8 * y) * b, (44 - 6 * y) * b] : [(66 + 20 * y) * b, (108 + 8 * y) * b, (44 - 4 * y) * b];
  };
  for (let tile = 0; tile < 16; tile++) {
    const ox = (tile % 4) * T, oy = Math.floor(tile / 4) * T, row = Math.floor(tile / 4);
    if (row < 2) {
      // a twig spray: a main stem from the bottom centre with side shoots, every shoot carrying a few leaves
      const kind = row, lenOf = () => T * (kind === 0 ? rr(0.15, 0.21) : rr(0.13, 0.18));
      const sway = rr(-0.1, 0.1) * T, stem = t => [T / 2 + sway * t * t + Math.sin(t * 5 + tile) * 3, 4 + t * T * 0.6];
      for (let i = 0; i < 12; i++) { const a = stem(i / 12), b = stem((i + 1) / 12); line(ox, oy, a[0], a[1], b[0], b[1], 2.4 - 1.4 * i / 12, [70, 58, 40]); }
      const M = 9, put = (bx, by, ang, len, sh) => {
        // keep the whole blade inside the tile
        for (let q = 0; q < 4; q++) { const tx = bx + Math.cos(ang) * len, ty = by + Math.sin(ang) * len; if (tx > M && tx < T - M && ty > M && ty < T - M) break; len *= 0.82; }
        if (bx < M || bx > T - M || by < M || by > T - M) return;
        leaf(ox, oy, bx, by, len, ang, kind, leafCol(kind), sh);
      };
      const nodes = kind === 0 ? 8 : 9;
      for (let i = 0; i <= nodes; i++) {
        const t = 0.1 + 0.9 * i / nodes, s = stem(t), sh = 0.62 + 0.38 * i / nodes;
        if (i === nodes) { for (const da of [0.75, -0.75, 0]) put(s[0], s[1], Math.PI / 2 + da + rr(-0.2, 0.2), lenOf(), sh); break; }
        for (const side of (i % 2 ? [1, -1] : [-1, 1])) {
          const a = Math.PI / 2 + side * rr(0.8, 1.3) * (1 - 0.3 * t), L = T * rr(0.16, 0.34) * (1 - 0.35 * t);
          const ex = s[0] + Math.cos(a) * L, ey = s[1] + Math.sin(a) * L;
          line(ox, oy, s[0], s[1], ex, ey, 1.0, [84, 80, 46]);
          for (let j = 1; j <= 2; j++) {
            if (kind === 0 && R() < 0.25) continue;
            const px = s[0] + (ex - s[0]) * j / 3, py = s[1] + (ey - s[1]) * j / 3; put(px, py, a + (j % 2 ? 1 : -1) * side * rr(0.7, 1.2), lenOf() * 0.9, sh * rr(0.85, 1));
          }
          put(ex, ey, a + rr(-0.35, 0.35), lenOf(), sh);
          if (side === (i % 2 ? 1 : -1) && R() < 0.5) continue;
        }
      }
    } else if (row === 2) {
      // a bough seen from afar: several clumps of small leaves
      const kind = tile % 4 < 2 ? 0 : 1, nc = Math.round(rr(9, 11));
      for (let c = 0; c < nc; c++) {
        const a = rr(0, TAU), r = Math.sqrt(R()) * T * 0.34, cx = T / 2 + Math.cos(a) * r, cy = T / 2 + Math.sin(a) * r, sh = rr(0.7, 1.08);
        const n = Math.round(rr(9, 13));
        for (let i = 0; i < n; i++) {
          const ang = rr(0, TAU), off = rr(0, 0.05) * T, len = T * (kind === 0 ? rr(0.085, 0.12) : rr(0.085, 0.12));
          leaf(ox, oy, cx + Math.cos(ang) * off, cy + Math.sin(ang) * off, len, ang, kind, leafCol(kind), sh * (0.78 + 0.22 * i / n));
        }
      }
    } else if (tile < 14) {
      const c = tile === 12 ? [62, 54, 45] : [122, 114, 94];
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const o = ((oy + y) * N + ox + x) * 4, k = 0.85 + 0.3 * R(); data[o] = c[0] * k; data[o + 1] = c[1] * k; data[o + 2] = c[2] * k; data[o + 3] = 255; }
    }
    // transparent texels take the tile's mean leaf colour so filtering leaves no dark fringe
    let sr = 0, sg = 0, sb = 0, sn = 0;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const o = ((oy + y) * N + ox + x) * 4; if (data[o + 3]) { sr += data[o]; sg += data[o + 1]; sb += data[o + 2]; sn++; } }
    if (!sn) { sr = 70; sg = 100; sb = 40; sn = 1; }
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { const o = ((oy + y) * N + ox + x) * 4; if (!data[o + 3]) { data[o] = sr / sn; data[o + 1] = sg / sn; data[o + 2] = sb / sn; } }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}

// ---- materials -------------------------------------------------------------------------------------------------
const WIND_GLSL = /* glsl */`
  {
  #ifdef USE_INSTANCING
    vec3 ip_ = instanceMatrix[3].xyz;
  #else
    vec3 ip_ = vec3(0.0);
  #endif
    float ph_ = ip_.x * 0.11 + ip_.z * 0.07;
    float gust_ = 0.5 + 0.5 * sin(uTime * 0.27 + ip_.x * 0.013 + ip_.z * 0.017);
    gust_ = 0.3 + 0.7 * gust_ * gust_;
    float bp_ = dot(aCtr, vec3(0.9, 0.5, 0.7));
    vec3 sway_ = vec3(sin(uTime * 0.83 + ph_ + bp_ * 0.6), 0.35 * sin(uTime * 1.31 + bp_), cos(uTime * 0.71 + ph_ * 1.3 + bp_ * 0.5)) * (0.05 * aLeaf.y * gust_);
    float fl_ = sin(uTime * (2.6 + aLeaf.x * 1.7) + aLeaf.x * 40.0) * 0.6 + sin(uTime * (4.9 + aLeaf.z * 2.0) + aLeaf.x * 17.0) * 0.4;
    vec3 ax_ = normalize(vec3(sin(aLeaf.x * 91.0), 0.4, cos(aLeaf.x * 57.0)));
    transformed += sway_ + cross(ax_, transformed - aCtr) * (fl_ * 0.11 * gust_ * step(0.0, aLeaf.w));
  }`;

export function makeLeafMaterial(ctx, map) {
  const mat = ctx.makeMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.62, metalness: 0, color: 0xffffff }, {
    key: 'streets-leaf2',
    defines: { NO_CITY_LIGHTS: 1 },
    vertexPars: /* glsl */`attribute vec4 aLeaf; attribute vec3 aCtr; attribute vec4 aInst; varying vec4 vInst; varying vec4 vLeaf; varying vec2 vTree;`,
    vertex: /* glsl */`vInst = aInst; vLeaf = aLeaf;
      #ifdef USE_INSTANCING
        vTree = fract(sin(vec2(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233)), dot(instanceMatrix[3].xz, vec2(39.3468, 11.1351)))) * 43758.5453);
      #else
        vTree = vec2(0.5);
      #endif
    ` + WIND_GLSL,
    fragPars: /* glsl */`varying vec4 vInst; varying vec4 vLeaf; varying vec2 vTree; float leafBark_ = 0.0; float leafNL_ = 1.0;`,
    color: /* glsl */`
      {
        leafBark_ = step(vLeaf.w, -0.5);
        if (leafBark_ < 0.5) {
          // stochastic coverage: exact on average at any distance, antialiased by the sample accumulation
          float thr_ = fract(ign(gl_FragCoord.xy) + uFrame * 0.0363549 + vLeaf.z * 5.37);
          diffuseColor.a = diffuseColor.a > mix(0.25, 0.75, thr_) ? 1.0 : 0.0;
          float r_ = vLeaf.z;
          vec3 c_ = diffuseColor.rgb * vInst.rgb;
          c_ *= (0.84 + 0.32 * fract(r_ * 7.3)) * mix(vec3(1.0), vec3(1.14, 1.0, 0.7), 0.55 * fract(r_ * 13.7));
          float brown_ = step(0.972, fract(r_ * 29.3));
          c_ = mix(c_, vec3(dot(c_, vec3(0.45))) * vec3(1.4, 1.08, 0.5), 0.55 * brown_);
          // every tree its own green (olive ... deep bluish green, lighter / darker) ...
          vec3 hue_ = vTree.x < 0.5 ? mix(vec3(1.12, 0.98, 0.70), vec3(1.0), smoothstep(0.0, 0.5, vTree.x)) : mix(vec3(1.0), vec3(0.70, 0.88, 0.86), smoothstep(0.5, 1.0, vTree.x));
          c_ *= hue_ * (0.70 + 0.34 * vTree.y) * vec3(0.9, 0.96, 0.9);
          // ... and inside a crown: bough-sized patches of deeper and of olive green, a darker cooler core, a few yellowed sprays
          float bn_ = vnoise3(vWPos * vec3(0.62, 0.8, 0.62) + vTree.x * 31.0);
          c_ *= mix(vec3(0.58, 0.76, 0.70), vec3(1.10, 1.04, 0.80), smoothstep(0.2, 0.8, bn_));
          c_ *= mix(vec3(0.46, 0.62, 0.54), vec3(1.0), smoothstep(0.08, 0.75, clamp(vLeaf.w, 0.0, 1.0)));
          float yel_ = step(0.95, fract(r_ * 41.3 + vTree.y));
          c_ = mix(c_, vec3(dot(c_, vec3(0.4))) * vec3(1.9, 1.5, 0.42), 0.6 * yel_);
          diffuseColor.rgb = c_;
        } else diffuseColor.a = 1.0;
      }`,
    normal: /* glsl */`
      {
        vec3 nv_ = normal;
        #ifdef DOUBLE_SIDED
          nv_ *= faceDirection;                       // undo the flip: keep the smooth crown normal on both faces
        #endif
        if (leafBark_ < 0.5) {
          // lean the normal towards the light so N.L never drops to zero; the real leaf response is rebuilt in the ao hook
          vec3 lv_ = worldToViewDir(uLightDir);
          normal = normalize(nv_ * 0.55 + lv_);
          leafNL_ = max(dot(normal, lv_), 1e-3);
        } else normal = nv_;
      }`,
    ao: /* glsl */`
      {
        vec3 cl_ = uNight > 0.001 ? texture2D(uCityLights, (vWPos.xz - uCityLightRect.xy) / uCityLightRect.zw).rgb : vec3(0.0);
        vec3 glow_ = vec3(0.060, 0.052, 0.050) * uNight * mix(1.0, 0.4, smoothstep(8.0, 120.0, vWPos.y));
        if (leafBark_ < 0.5) {
          vec3 Lw_ = normalize(uLightDir), Vw_ = normalize(uCamPos - vWPos);
          vec3 nG_ = normalize(cross(dFdx(vWPos), dFdy(vWPos))); if (dot(nG_, Vw_) < 0.0) nG_ = -nG_;     // blade normal, towards the eye
          vec3 nS_ = normalize(vWNormal);                                                                 // crown normal
          float e_ = clamp(vLeaf.w, 0.0, 1.0);
          float ndl_ = dot(nG_, Lw_), cardL_ = abs(ndl_);
          float lit_ = smoothstep(-0.12, 0.22, ndl_);                       // 1: we see the sunlit face, 0: the light comes through
          float vol_ = 0.7 + 0.3 * clamp(dot(nS_, Lw_) * 0.6 + 0.5, 0.0, 1.0);
          float self_ = mix(0.6, 1.0, e_);
          vec3 through_ = mix(vec3(1.22, 1.16, 0.42), vec3(0.7, 0.8, 0.7), uNight) * (0.3 + 0.7 * cardL_);
          vec3 k_ = (vec3(lit_ * (0.65 + 0.35 * cardL_)) + (1.0 - lit_) * through_) * vol_ * self_;
          vec3 E_ = reflectedLight.directDiffuse / (leafNL_ * max(diffuseColor.rgb, vec3(0.012)));       // light colour x shadow / pi
          reflectedLight.directDiffuse *= k_ / leafNL_;
          vec3 h_ = normalize(Lw_ + Vw_);
          float sp_ = pow(max(dot(nG_, h_), 0.0), 24.0) * lit_ * (1.0 + 3.0 * pow(1.0 - max(dot(Vw_, h_), 0.0), 5.0));
          reflectedLight.directSpecular = E_ * sp_ * 0.09 * self_;
          float amb_ = mix(0.3, 1.0, e_ * e_ * (3.0 - 2.0 * e_));
          // skylight on foliage: dimmer than on a wall (most of it is lost inside the crown) and olive rather than teal
          vec3 ind_ = reflectedLight.indirectDiffuse * (amb_ * 0.72);
          reflectedLight.indirectDiffuse = mix(ind_, dot(ind_, vec3(0.3, 0.55, 0.15)) * vec3(0.95, 1.0, 0.6), 0.6);
          reflectedLight.indirectSpecular *= amb_ * 0.4;
          // street lamps reach the crown from below / beside: the underside and the outer sprays catch them
          // Night: the crown stays dark; only the lower sprays near a lamp, on the side facing it, catch its warm light.
          // (the light map is top-down: its gradient points towards the nearest lamp)
          reflectedLight.indirectDiffuse += diffuseColor.rgb * glow_ * amb_ * 0.8;
          if (uNight > 0.001) {
            vec2 cuv_ = (vWPos.xz - uCityLightRect.xy) / uCityLightRect.zw, cd_ = 1.8 / uCityLightRect.zw;
            const vec3 LW_ = vec3(0.3, 0.5, 0.2);
            float l0_ = dot(cl_, LW_);
            vec2 gd_ = vec2(dot(texture2D(uCityLights, cuv_ + vec2(cd_.x, 0.0)).rgb, LW_), dot(texture2D(uCityLights, cuv_ + vec2(0.0, cd_.y)).rgb, LW_)) - l0_;
            float gm_ = length(gd_);
            float side_ = mix(0.75, clamp(0.35 + 1.0 * dot(normalize(nS_.xz + vec2(1e-4)), gd_ / max(gm_, 1e-6)), 0.08, 1.25), smoothstep(0.0, 0.12 * l0_ + 1e-5, gm_));
            float hf_ = exp(-max(vWPos.y - 7.0, 0.0) / 2.8) * (0.5 + 0.5 * clamp(0.55 - nS_.y, 0.0, 1.0));
            float near_ = smoothstep(0.05, 0.6, l0_);                                 // pools around the lamps, not an even wash
            vec3 warm_ = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2))) * vec3(1.42, 0.96, 0.52), 0.82);
            reflectedLight.indirectDiffuse += warm_ * cl_ * (hf_ * side_ * near_ * uNight * mix(0.3, 1.0, e_) * 2.5);
          }
        } else {
          float hf_ = exp(-max(vWPos.y - 9.0, 0.0) / 6.5) * (0.55 + 0.45 * clamp(vWNormal.y, 0.0, 1.0));
          reflectedLight.indirectDiffuse += diffuseColor.rgb * (cl_ * hf_ * uNight + glow_);
        }
      }`,
  });
  // shadow pass: same wind, same stochastic coverage -> soft, dappled, correctly dense leaf shadows
  const G = ctx.G;
  const depth = new THREE.MeshDepthMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide });
  depth.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = G.time; sh.uniforms.uFrame = G.frame; sh.uniforms.uLightDir = G.lightDir; sh.uniforms.uCamPos = G.camPos;
    // besides the wind: sink the leaves a little along the light (the shadow itself does not move) so that a spray
    // does not shadow itself or its closest neighbours — keeps the sunlit shell of the crown bright
    const SINK = /* glsl */`
      #ifdef USE_INSTANCING
      {
        // (further away the shadow map gets coarse, so the sink grows with the distance to the camera)
        float sink_ = 0.45 + 0.014 * distance(instanceMatrix[3].xyz, uCamPos);
        vec3 w_ = -normalize(uLightDir) * (sink_ * step(0.0, aLeaf.w));
        vec3 c0_ = instanceMatrix[0].xyz, c1_ = instanceMatrix[1].xyz, c2_ = instanceMatrix[2].xyz;
        transformed += vec3(dot(c0_, w_) / dot(c0_, c0_), dot(c1_, w_) / dot(c1_, c1_), dot(c2_, w_) / dot(c2_, c2_));
      }
      #endif`;
    sh.vertexShader = 'attribute vec4 aLeaf; attribute vec3 aCtr; uniform float uTime; uniform vec3 uLightDir; uniform vec3 uCamPos;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_GLSL + SINK);
    sh.fragmentShader = 'uniform float uFrame;\n' + sh.fragmentShader.replace('#include <alphatest_fragment>', /* glsl */`
      { float thr_ = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.0363549);
        if (diffuseColor.a < mix(0.25, 0.75, thr_)) discard; }`);
  };
  depth.customProgramCacheKey = () => 'streets-leaf-depth';
  return { mat, depth };
}

export function makeBarkMaterial(ctx) {
  return ctx.makeMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.93, metalness: 0 }, {
    key: 'streets-bark',
    vertexPars: /* glsl */`attribute vec3 aBark; attribute vec4 aInst; varying vec3 vBark; varying float vBarkY;`,
    vertex: /* glsl */`vBark = aBark; vBarkY = position.y;`,
    fragPars: /* glsl */`varying vec3 vBark; varying float vBarkY; float barkH_ = 0.0;`,
    color: /* glsl */`
      {
        vec2 q_ = vBark.xy;
        float fade_ = 1.0 - smoothstep(14.0, 55.0, distance(vWPos, uCamPos));
        float ridge_ = smoothstep(0.0, 0.42, abs(fbm2(vec2(q_.x * 24.0, q_.y * 3.2)) * 2.0 - 0.94));     // 0 in the fissures
        float plate_ = smoothstep(0.44, 0.52, vnoise(q_ * vec2(5.5, 2.1) + 3.7)) * vBark.z;                // plane-tree patches
        vec3 c_ = mix(diffuseColor.rgb, vec3(0.3, 0.285, 0.215), plate_);
        c_ = mix(c_, vec3(0.2, 0.22, 0.13), 0.35 * vBark.z * smoothstep(0.55, 0.75, vnoise(q_ * vec2(3.1, 1.3) + 11.0)));
        float relief_ = mix(1.0, 0.3, plate_);
        c_ *= mix(1.0, 0.5 + 0.7 * ridge_, fade_ * relief_);
        c_ *= 0.82 + 0.36 * vnoise(q_ * vec2(1.7, 0.7) + 9.1);
        c_ *= mix(0.55, 1.0, smoothstep(0.0, 0.45, vBarkY));              // damp, dirty foot
        diffuseColor.rgb = c_;
        barkH_ = ridge_ * 0.01 * fade_ * relief_;
      }`,
    normal: /* glsl */`
      {
        vec3 sp_ = -vViewPosition; vec3 dpx_ = dFdx(sp_), dpy_ = dFdy(sp_);
        float dhx_ = dFdx(barkH_), dhy_ = dFdy(barkH_);
        vec3 r1_ = cross(dpy_, normal), r2_ = cross(normal, dpx_);
        float det_ = dot(dpx_, r1_);
        normal = normalize(abs(det_) * normal - sign(det_) * (dhx_ * r1_ + dhy_ * r2_));
      }`,
  });
}
