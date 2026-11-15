// Boats: lofted hulls (rowing boats, skiffs, cabin cruisers, sailing yachts, canal barges, a tug, fishing boats),
// instanced per type with per-instance paint; gentle rigid bobbing as a pure function of t.
// Object space: +x = bow, +y = up (waterline y = 0), +z = starboard.
import * as THREE from 'three';
import { Bucket, box, cyl, sphere, torus, M, beam, tubeGeo, catenary, loftGeo, stripGeo, quadGeo } from './geo.js';
import { COL, isBlocked, wpt } from './quay.js';

const sat = x => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const S = { gloss: 0, wood: 1, metal: 2, canvas: 3, rubber: 4, rope: 5, deck: 6, net: 7 };
const P = { fix: 0, A: 1, B: 2, win: 3, light: 4 };
const WH = [1, 1, 1];
const C = {
  varnish: [0.34, 0.17, 0.06], teak: [0.42, 0.33, 0.22], rawwood: [0.36, 0.31, 0.25], white: [0.74, 0.73, 0.68], cream: [0.68, 0.62, 0.47],
  black: [0.022, 0.022, 0.024], steel: [0.6, 0.6, 0.6], hemp: [0.55, 0.45, 0.30], rubber: [0.035, 0.035, 0.037], grey: [0.22, 0.23, 0.24],
  navy: [0.03, 0.05, 0.11], fenderW: [0.72, 0.72, 0.7], fenderB: [0.06, 0.12, 0.3], orange: [0.7, 0.2, 0.03], net: [0.10, 0.22, 0.14], brass: [0.6, 0.45, 0.18],
};

function makeHull(hp) {
  const sheer = u => hp.F + (hp.Fb - hp.F) * Math.pow(sat((u - 0.5) / 0.5), hp.sheerPow ?? 2) + (hp.Fs - hp.F) * Math.pow(sat((0.5 - u) / 0.5), 2);
  const half = u => {
    let k;
    if (u >= hp.um) { const t = (u - hp.um) / (1 - hp.um); k = Math.pow(Math.max(0, 1 - Math.pow(t, hp.pb)), hp.qb ?? 1); }
    else { const t = (hp.um - u) / hp.um; k = 1 - (1 - hp.transom) * Math.pow(t, hp.ps ?? 2); if (hp.transom <= 0) k = Math.pow(Math.max(0, 1 - Math.pow(t, hp.ps ?? 2)), hp.qs ?? 0.6); }
    return hp.B / 2 * k;
  };
  const draft = u => hp.D * (1 - (hp.kb ?? 1) * Math.pow(sat((u - hp.ub) / (1 - hp.ub)), 2)) * (1 - (hp.ks ?? 0.5) * Math.pow(sat((hp.us - u) / hp.us), 2));
  const point = (u, v, side, inset = 0) => {
    const b = Math.max(0, half(u) - inset), h = sheer(u), d = draft(u) - inset;
    const bow = smooth(hp.um, 1, u);
    const e = lerp(hp.e, hp.eBow ?? hp.e, bow), f = lerp(hp.f ?? 1, hp.fBow ?? hp.f ?? 1, bow);
    const th = v * Math.PI / 2;
    const sx = Math.pow(Math.sin(th), e), sy = 1 - Math.pow(Math.cos(th), f);
    const y = -d + (h + d) * sy;
    const x = hp.L * (u - 0.5) + (hp.rakeBow ?? 0) * (y / Math.max(0.1, hp.Fb)) * smooth(0.5, 1, u) - (hp.rakeStern ?? 0) * (y / Math.max(0.1, hp.Fs)) * smooth(0.5, 0, u);
    return [x, y, side * b * sx];
  };
  const u0 = hp.transom > 0 ? 0 : 0.0006, u1 = 0.998;
  const stations = n => Array.from({ length: n }, (_, i) => u0 + (u1 - u0) * (0.5 - 0.5 * Math.cos(Math.PI * Math.pow(i / (n - 1), 0.9))));
  const rings = (nu, nv, inset = 0) => stations(nu).map(u => { const r = []; for (let j = 0; j <= 2 * nv; j++) { const s = j - nv; r.push(point(u, Math.abs(s) / nv, s < 0 ? -1 : 1, inset)); } return r; });
  /** [x, halfWidth] of the section at height y */
  const sect = (u, y, inset = 0) => {
    let prev = point(u, 0, 1, inset);
    for (let k = 1; k <= 28; k++) { const p = point(u, k / 28, 1, inset); if (p[1] >= y) { const t = sat((y - prev[1]) / Math.max(1e-6, p[1] - prev[1])); return [lerp(prev[0], p[0], t), lerp(prev[2], p[2], t)]; } prev = p; }
    return [prev[0], prev[2]];
  };
  const xToU = x => sat(x / hp.L + 0.5);
  return { hp, sheer, half, draft, point, rings, sect, stations, xToU };
}

// ------------------------------------------------------------------------------------------------ shared parts
const bx = (bk, x, y, z, sx, sy, sz, col, part = 0, surf = 0, rx = 0, ry = 0, rz = 0) => bk.add(box(), M(x, y, z, sx, sy, sz, rx, ry, rz), col, part, surf);
const tb = (bk, pts, r, col, part = 0, surf = 0, sides = 5) => bk.add(tubeGeo(pts, r, sides), null, col, part, surf);

function addHull(bk, Hh, nu, nv, part = P.A, col = WH) {
  bk.add(loftGeo(Hh.rings(nu, nv), { capStart: true, capEnd: true }), null, col, part, S.gloss);
}
/** deck at sheer - bul with camber; returns { y(u), edge(u) -> [x, y, halfWidth] } */
function addDeck(bk, Hh, nu, bul, camber, col, surf = S.deck, part = 0, ua = 0, ub = 1) {
  const us = Hh.stations(nu).filter(u => u >= ua - 1e-6 && u <= ub + 1e-6);
  const edge = u => { const y = Hh.sheer(u) - bul; const [x, w] = Hh.sect(u, y, 0.012); return [x, y, w]; };
  const rings = us.map(u => { const [x, y, w] = edge(u); return [-1, -0.55, 0, 0.55, 1].map(k => [x, y + camber * (1 - k * k) * Math.min(1, w / (Hh.hp.B * 0.3)), k * w]); });
  bk.add(loftGeo(rings, { flip: true }), null, col, part, surf);
  return { edge, y: (u, k = 0) => { const [, y, w] = edge(u); return y + camber * (1 - k * k) * Math.min(1, w / (Hh.hp.B * 0.3)); } };
}
/** inner bulwark faces + cap rail along the sheer */
function addBulwark(bk, Hh, nu, deck, inner, railR, railCol, railPart = 0, railSurf = S.wood, innerPart = P.A) {
  const us = Hh.stations(nu);
  for (const s of [-1, 1]) {
    const top = us.map(u => { const p = Hh.point(u, 1, s, 0.02); return [p[0], p[1], p[2]]; });
    if (inner) {
      const bot = us.map(u => { const [x, y, w] = deck.edge(u); return [x, y - 0.01, s * w]; });
      bk.add(stripGeo(bot, top, s > 0), null, WH, innerPart, S.gloss);
    }
    if (railR > 0) bk.add(tubeGeo(top.map(p => [p[0], p[1] + railR * 0.4, p[2]]), railR, 5), null, railCol, railPart, railSurf);
  }
}
/** superstructure loft. st = [{x, w, h, y}], sides lean inward by `tin`. */
const paneSeed = (a, b, c) => { const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return [v - Math.floor(v), 1, 1]; };
function cabin(bk, st, { tin = 0.9, camber = 0.08, col = WH, part = P.B, surf = S.gloss, caps = true } = {}) {
  // section ring: rounded shoulder between the wall and the cambered roof; dw insets the ring (chamfered end corners)
  const ringOf = (s, dw = 0) => { const w = s.w - dw, h = s.h - dw * 0.5; return [[s.x, s.y, -w], [s.x, s.y + h * 0.88, -w * tin], [s.x, s.y + h * 0.965, -w * tin * 0.965], [s.x, s.y + h, -w * tin * 0.86], [s.x, s.y + h + camber * w * 0.7, -w * tin * 0.45], [s.x, s.y + h + camber * w, 0], [s.x, s.y + h + camber * w * 0.7, w * tin * 0.45], [s.x, s.y + h, w * tin * 0.86], [s.x, s.y + h * 0.965, w * tin * 0.965], [s.x, s.y + h * 0.88, w * tin], [s.x, s.y, w]]; };
  const atSt = x => { let i = 0; while (i < st.length - 2 && x > st[i + 1].x) i++; const a = st[i], b = st[i + 1], t = sat((x - a.x) / (b.x - a.x)); return { x, w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), y: lerp(a.y, b.y, t) }; };
  const rings = []; const n = st.length;
  const c0 = Math.min(0.09, st[0].w * 0.08, (st[1].x - st[0].x) * 0.3), c1 = Math.min(0.09, st[n - 1].w * 0.08, (st[n - 1].x - st[n - 2].x) * 0.3);
  rings.push(ringOf(st[0], c0), ringOf(atSt(st[0].x + c0 * 0.35), c0 * 0.3), ringOf(atSt(st[0].x + c0)));
  for (let i = 1; i < n - 1; i++) rings.push(ringOf(st[i]));
  rings.push(ringOf(atSt(st[n - 1].x - c1)), ringOf(atSt(st[n - 1].x - c1 * 0.35), c1 * 0.3), ringOf(st[n - 1], c1));
  bk.add(loftGeo(rings, { flip: true, capStart: caps, capEnd: caps }), null, col, part, surf);
  const at = x => { let i = 0; while (i < st.length - 2 && x > st[i + 1].x) i++; const a = st[i], b = st[i + 1], t = sat((x - a.x) / (b.x - a.x)); return { x, w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t), y: lerp(a.y, b.y, t) }; };
  /** side window from xa..xb between height fractions f0..f1 (of the 0.88h side wall) */
  const sideWin = (xa, xb, f0, f1, sides = [-1, 1], part2 = P.win, col2 = WH, off = 0.014) => {
    for (const s of sides) {
      const pt = (x, f) => { const q = at(x); return [x, q.y + q.h * 0.88 * f, s * (q.w * lerp(1, tin, f) + off)]; };
      const a = pt(xa, f0), b = pt(xb, f0), c = pt(xb, f1), d = pt(xa, f1);
      bk.add(s > 0 ? quadGeo(a, b, c, d) : quadGeo(b, a, d, c), null, col2 === WH ? paneSeed(xa, f0, s) : col2, part2, 1);
    }
  };
  /** window on the front (dir=1) or back (dir=-1) cap, k0..k1 across (-1..1), f0..f1 up */
  const endWin = (dir, k0, k1, f0, f1, part2 = P.win, col2 = WH) => {
    const q = dir > 0 ? st[st.length - 1] : st[0]; const x = q.x + dir * 0.014;
    const pt = (k, f) => [x, q.y + q.h * 0.88 * f, k * q.w * lerp(1, tin, f)];
    const a = pt(k0, f0), b = pt(k1, f0), c = pt(k1, f1), d = pt(k0, f1);
    bk.add(dir > 0 ? quadGeo(b, a, d, c) : quadGeo(a, b, c, d), null, col2 === WH ? paneSeed(k0, f0, dir * 3.1) : col2, part2, 1);
  };
  return { at, sideWin, endWin };
}
function fender(bk, Hh, u, side, col, len = 0.42, r = 0.085) {
  const y = 0.34; const [x, w] = Hh.sect(u, y); const top = Hh.point(u, 1, side);
  bk.add(cyl(10), M(x, y, side * (w + r * 0.9), r, len, r), col, 0, S.rubber);
  bk.add(sphere(10, 5), M(x, y - len / 2, side * (w + r * 0.9), r, r * 0.7, r), col, 0, S.rubber);
  tb(bk, [[x, y + len / 2, side * (w + r * 0.9)], [top[0], top[1] + 0.03, top[2] * 0.98]], 0.008, C.hemp, 0, S.rope, 3);
}
function tyre(bk, Hh, u, side, y = 0.4) {
  const [x, w] = Hh.sect(u, y); const top = Hh.point(u, 1, side);
  bk.add(torus(0.27, 0.105, 8, 16), M(x, y, side * (w + 0.1)), C.rubber, 0, S.rubber);
  tb(bk, [[x, y + 0.26, side * (w + 0.1)], [top[0], top[1] + 0.03, top[2] * 0.98]], 0.012, C.hemp, 0, S.rope, 3);
}
function cleatB(bk, x, y, z) { bx(bk, x, y + 0.03, z, 0.05, 0.06, 0.05, C.steel, 0, S.metal); bk.add(cyl(5), M(x, y + 0.07, z, 0.016, 0.26, 0.016, 0, 0, Math.PI / 2), C.steel, 0, S.metal); }
function navLight(bk, x, y, z, r = 0.05) { bk.add(sphere(10, 6), M(x, y, z, r, r * 1.2, r), WH, P.light, 0); }
function ropeCoil(bk, x, y, z, r = 0.22, col = C.hemp) {
  for (let i = 0; i < 3; i++) bk.add(torus(1, 0.14, 5, 12), M(x, y + 0.025 + i * 0.045, z, r - i * 0.015, r - i * 0.015, 0.2, Math.PI / 2, i * 0.7, 0), col, 0, S.rope, [9, 1]);
}

// ------------------------------------------------------------------------------------------------ boat types
function buildRowboat(variant) {
  const bk = new Bucket();
  const hp = variant === 1
    ? { L: 4.7, B: 1.78, D: 0.2, F: 0.46, Fb: 0.66, Fs: 0.5, um: 0.4, pb: 2.0, qb: 0.8, transom: 0.84, e: 0.5, eBow: 1.15, f: 0.8, rakeBow: 0.4, rakeStern: 0.1, ub: 0.6, kb: 1, us: 0.3, ks: 0.45 }
    : { L: 4.0, B: 1.46, D: 0.17, F: 0.4, Fb: 0.6, Fs: 0.45, um: 0.45, pb: 1.9, qb: 0.85, transom: 0.6, e: 0.72, eBow: 1.2, f: 1.0, rakeBow: 0.32, rakeStern: 0.12, ub: 0.6, kb: 1, us: 0.32, ks: 0.6 };
  const Hh = makeHull(hp); const NU = 15, NV = 6, t = 0.035;
  addHull(bk, Hh, NU, NV, P.A);
  const us = Hh.stations(NU);
  // rubbing strake + gunwale
  for (const s of [-1, 1]) {
    const top = us.map(u => Hh.point(u, 1, s));
    tb(bk, top.map(p => [p[0], p[1] + 0.01, p[2]]), 0.024, C.varnish, 0, S.wood, 5);
    tb(bk, us.map(u => { const p = Hh.point(u, 0.86, s); return [p[0], p[1], p[2] + s * 0.012]; }), 0.014, C.varnish, 0, S.wood, 4);
  }
  if (variant === 2) {
    // canvas cover stretched over the gunwales with a ridge pole
    const rings = us.map((u, i) => {
      const a = Hh.point(u, 0.9, -1), b = Hh.point(u, 1, -1), c = Hh.point(u, 1, 1), d = Hh.point(u, 0.9, 1);
      const w = Math.abs(c[2]); const ridge = b[1] + 0.05 + 0.2 * Math.min(1, w / 0.5) * (0.85 + 0.15 * Math.sin(i * 2.1));
      return [[a[0], a[1], a[2] - 0.02], [b[0], b[1] + 0.03, b[2] - 0.015], [b[0], lerp(b[1], ridge, 0.75), b[2] * 0.5], [b[0], ridge, 0], [c[0], lerp(c[1], ridge, 0.75), c[2] * 0.5], [c[0], c[1] + 0.03, c[2] + 0.015], [d[0], d[1], d[2] + 0.02]];
    });
    bk.add(loftGeo(rings, { flip: true, capStart: true }), null, WH, P.B, S.canvas);
    for (let k = 1; k < 5; k++) { const r = rings[Math.round(k * (NU - 1) / 5)]; tb(bk, r.map(p => [p[0], p[1] + 0.012, p[2] * 1.01]), 0.008, C.hemp, 0, S.rope, 3); }
    return { geo: bk.build(), hp, cleats: [[hp.L * 0.46, hp.Fb, 0], [-hp.L * 0.46, hp.Fs, 0]], kind: 'rowboat' };
  }
  // inner shell, gunwale caps, floorboards
  bk.add(loftGeo(Hh.rings(NU, NV, t), { flip: true, capStart: true }), null, WH, P.B, S.gloss);
  for (const s of [-1, 1]) bk.add(stripGeo(us.map(u => Hh.point(u, 1, s)), us.map(u => Hh.point(u, 1, s, t)), s < 0), null, C.varnish, 0, S.wood);
  const fu = us.filter(u => u > 0.1 && u < 0.86);
  const fl = fu.map(u => { const y = -Hh.draft(u) + 0.11; const [x, w] = Hh.sect(u, y, t); return [x, y, w]; });
  bk.add(stripGeo(fl.map(p => [p[0], p[1], -p[2]]), fl.map(p => [p[0], p[1], p[2]]), true), null, C.rawwood, 0, S.deck);
  // thwarts, stern sheets, bow seat
  const seat = (u, len, dy = 0.17) => { const y = Hh.sheer(u) - dy; const [x, w] = Hh.sect(u, y, t); bx(bk, x, y, 0, len, 0.032, 2 * w + 0.01, C.varnish, 0, S.wood); return [x, y]; };
  const s1 = seat(0.34, 0.24), s2 = seat(0.6, 0.24); seat(0.07, 0.42, 0.15); seat(0.86, 0.3, 0.14);
  // knees / ribs
  for (const u of [0.2, 0.47, 0.74]) { const r = []; for (let j = 0; j <= 10; j++) { const s = j - 5; r.push(Hh.point(u, Math.abs(s) / 5 * 0.97, s < 0 ? -1 : 1, t + 0.012)); } tb(bk, r, 0.014, C.varnish, 0, S.wood, 4); }
  if (variant === 0) {
    // oars laid across the thwarts
    for (const s of [-1, 1]) {
      const z = s * 0.2, y = s1[1] + 0.04;
      bk.add(cyl(6), M((s1[0] + s2[0]) / 2 + 0.25, y, z, 0.021, 2.5, 0.021, 0, s * 0.05, Math.PI / 2), C.rawwood, 0, S.wood);
      bx(bk, (s1[0] + s2[0]) / 2 + 0.25 + 1.45, y, z - s * 0.07, 0.6, 0.02, 0.13, C.rawwood, 0, S.wood, 0, s * 0.05, 0);
    }
    for (const s of [-1, 1]) { const p = Hh.point(0.5, 1, s); bx(bk, p[0], p[1] + 0.05, p[2] * 0.97, 0.05, 0.08, 0.03, C.brass, 0, S.metal); }
    ropeCoil(bk, hp.L * 0.33, -Hh.draft(0.8) + 0.12, 0, 0.17);
  } else {
    // outboard motor on the transom + fuel can, coil
    const xt = -hp.L / 2 - 0.02, yt = hp.Fs;
    bx(bk, xt - 0.1, yt + 0.22, 0, 0.3, 0.36, 0.26, C.grey, 0, S.gloss);
    bx(bk, xt - 0.1, yt + 0.42, 0, 0.26, 0.06, 0.22, C.black, 0, S.gloss);
    bx(bk, xt - 0.07, yt - 0.3, 0, 0.1, 0.9, 0.08, C.black, 0, S.gloss);
    tb(bk, [[xt + 0.05, yt + 0.25, 0], [xt + 0.5, yt + 0.3, 0.05]], 0.015, C.black, 0, S.gloss, 4);
    bx(bk, -hp.L * 0.3, -Hh.draft(0.2) + 0.25, 0.3, 0.3, 0.26, 0.2, [0.55, 0.06, 0.04], 0, S.gloss);
    ropeCoil(bk, hp.L * 0.3, -Hh.draft(0.8) + 0.12, 0.05, 0.2, [0.25, 0.35, 0.5]);
    for (const [u, s] of [[0.35, 1], [0.65, 1], [0.5, -1]]) fender(bk, Hh, u, s, s > 0 ? C.fenderW : C.fenderB, 0.3, 0.07);
  }
  return { geo: bk.build(), hp, cleats: [[hp.L * 0.46, hp.Fb, 0], [-hp.L * 0.46, hp.Fs, 0]], kind: variant === 1 ? 'skiff' : 'rowboat' };
}

function pulpit(bk, Hh, deck, uA, uB, h, n, col = C.steel) {
  // stanchions + lifelines from uA to uB on both sides
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= n; i++) { const u = lerp(uA, uB, i / n); const [x, y, w] = deck.edge(u); const p = [x, y, s * (w - 0.06)]; pts.push(p); bk.add(cyl(4, 1, true), M(p[0], p[1] + h / 2, p[2], 0.011, h, 0.011), col, 0, S.metal); }
    tb(bk, pts.map(p => [p[0], p[1] + h, p[2]]), 0.007, col, 0, S.metal, 3);
    tb(bk, pts.map(p => [p[0], p[1] + h * 0.52, p[2]]), 0.006, col, 0, S.metal, 3);
  }
}
function bowRail(bk, Hh, deck, h, col = C.steel) {
  const a = deck.edge(0.86), b = deck.edge(0.975);
  const pts = [[a[0], a[1] + h, -(a[2] - 0.06)], [b[0], b[1] + h, -Math.max(0.05, b[2] - 0.03)], [b[0] + 0.12, b[1] + h, 0], [b[0], b[1] + h, Math.max(0.05, b[2] - 0.03)], [a[0], a[1] + h, a[2] - 0.06]];
  tb(bk, pts, 0.013, col, 0, S.metal, 4);
  for (const p of [pts[0], pts[1], pts[3], pts[4]]) bk.add(cyl(4, 1, true), M(p[0], p[1] - h / 2, p[2], 0.011, h, 0.011), col, 0, S.metal);
}

function buildCruiser(variant) {
  const bk = new Bucket();
  const hp = variant === 0
    ? { L: 8.2, B: 2.8, D: 0.5, F: 0.82, Fb: 1.28, Fs: 0.8, um: 0.4, pb: 2.0, qb: 0.9, transom: 0.86, e: 0.55, eBow: 1.3, f: 0.8, fBow: 1.1, rakeBow: 0.75, rakeStern: -0.1, ub: 0.55, kb: 1, us: 0.25, ks: 0.3 }
    : { L: 6.6, B: 2.35, D: 0.42, F: 0.7, Fb: 1.05, Fs: 0.72, um: 0.42, pb: 2.0, qb: 0.85, transom: 0.8, e: 0.6, eBow: 1.3, f: 0.85, fBow: 1.1, rakeBow: 0.55, rakeStern: 0.05, ub: 0.55, kb: 1, us: 0.25, ks: 0.35 };
  const Hh = makeHull(hp); const NU = 17, NV = 6;
  addHull(bk, Hh, NU, NV, P.A);
  const deck = addDeck(bk, Hh, NU, 0.035, 0.05, C.teak, S.deck);
  addBulwark(bk, Hh, NU, deck, false, 0.03, C.varnish);
  const L = hp.L, yd = u => deck.y(u);
  // rub rail
  for (const s of [-1, 1]) tb(bk, Hh.stations(NU).map(u => { const p = Hh.point(u, 0.9, s); return [p[0], p[1], p[2] + s * 0.012]; }), 0.022, C.varnish, 0, S.wood, 4);
  if (variant === 0) {
    // trunk cabin forward + raised wheelhouse + canvas-covered cockpit aft
    const st = [];
    for (const [x, wk, h] of [[-0.06, 0.74, 1.25], [0.08, 0.74, 1.3], [0.115, 0.72, 0.62], [0.26, 0.62, 0.55], [0.31, 0.5, 0.42]]) { const u = x + 0.5; st.push({ x: x * L, w: Hh.half(u) * wk, h, y: yd(u) - 0.02 }); }
    const cb = cabin(bk, st, { tin: 0.9, camber: 0.07, part: P.B });
    cb.sideWin(-0.045 * L, 0.0 * L, 0.5, 0.92); cb.sideWin(0.01 * L, 0.07 * L, 0.5, 0.92);
    for (let i = 0; i < 3; i++) cb.sideWin((0.135 + i * 0.045) * L, (0.165 + i * 0.045) * L, 0.42, 0.85);
    // windshield panes on the raked front between the wheelhouse roof and the trunk cabin
    const q = cb.at(0.08 * L);
    const ws = (f, k) => { const a = st[2], b = st[1]; return [lerp(a.x, b.x, f) + 0.016, lerp(a.y + a.h, b.y + b.h, f) + 0.008, k * lerp(a.w, b.w, f) * 0.9 * 0.86]; };
    for (const [k0, k1] of [[-0.92, -0.06], [0.06, 0.92]]) bk.add(quadGeo(ws(0.15, k1), ws(0.15, k0), ws(0.88, k0), ws(0.88, k1)), null, paneSeed(k0, 0.3, 7), P.win, 1);
    bx(bk, -0.065 * L - 0.012, q.y + 0.72, 0.22 * q.w, 0.03, 1.1, 0.55, C.varnish, 0, S.wood);     // door
    // roof rails, mast with anchor light, horn
    for (const s of [-1, 1]) tb(bk, [[-0.05 * L, q.y + 1.36, s * q.w * 0.6], [0.06 * L, q.y + 1.4, s * q.w * 0.6]], 0.013, C.varnish, 0, S.wood, 4);
    bk.add(cyl(5, 0.6), M(0.0, q.y + 1.37 + 0.55, 0, 0.022, 1.1, 0.022), C.varnish, 0, S.wood);
    navLight(bk, 0, q.y + 1.37 + 1.13, 0);
    // cockpit cover (canvas) aft
    const cu = [0.03, 0.08, 0.2, 0.36, 0.425];
    const rings = cu.map((u, i) => { const [x, y, w] = deck.edge(u); const ww = w * 0.86, hh = i === 0 ? 0.25 : (i === cu.length - 1 ? 1.0 : 0.62 + 0.3 * (i / (cu.length - 1))); return [[x, y, -ww], [x, y + hh * 0.8, -ww * 0.92], [x, y + hh, 0], [x, y + hh * 0.8, ww * 0.92], [x, y, ww]]; });
    bk.add(loftGeo(rings, { flip: true, capStart: true }), null, WH, P.B, S.canvas);
    bowRail(bk, Hh, deck, 0.5); pulpit(bk, Hh, deck, 0.5, 0.86, 0.5, 3);
    // flag staff
    bk.add(cyl(4, 0.6), M(-L / 2 + 0.15, yd(0.02) + 0.45, 0, 0.012, 0.9, 0.012, 0, 0, 0.25), C.varnish, 0, S.wood);
  } else {
    // small day cruiser: cuddy forward, windscreen, open cockpit under a tonneau
    const st = [];
    for (const [x, wk, h] of [[0.0, 0.76, 0.6], [0.04, 0.76, 0.62], [0.2, 0.64, 0.5], [0.3, 0.45, 0.36]]) { const u = x + 0.5; st.push({ x: x * L, w: Hh.half(u) * wk, h, y: yd(u) - 0.02 }); }
    const cb = cabin(bk, st, { tin: 0.88, camber: 0.09, part: P.B });
    cb.sideWin(0.05 * L, 0.11 * L, 0.38, 0.82); cb.sideWin(0.13 * L, 0.19 * L, 0.38, 0.8);
    const q = cb.at(0.01 * L);
    for (const [k0, k1] of [[-0.92, -0.04], [0.04, 0.92]]) { const x = 0.01 * L; const a = [x + 0.03, q.y + 0.62, k0 * q.w * 0.86], b = [x + 0.03, q.y + 0.62, k1 * q.w * 0.86], c = [x - 0.14, q.y + 1.02, k1 * q.w * 0.8], d = [x - 0.14, q.y + 1.02, k0 * q.w * 0.8]; bk.add(quadGeo(b, a, d, c), null, WH, P.win, 0); bk.add(quadGeo(a, b, c, d), null, WH, P.win, 0); }
    for (const kk of [-0.9, 0, 0.9]) tb(bk, [[0.01 * L + 0.03, q.y + 0.6, kk * q.w * 0.86], [0.01 * L - 0.15, q.y + 1.05, kk * q.w * 0.8]], 0.014, C.steel, 0, S.metal, 4);
    tb(bk, [[0.01 * L - 0.15, q.y + 1.05, -0.9 * q.w * 0.8], [0.01 * L - 0.15, q.y + 1.05, 0.9 * q.w * 0.8]], 0.014, C.steel, 0, S.metal, 4);
    const cu = [0.03, 0.1, 0.3, 0.47];
    const rings = cu.map((u, i) => { const [x, y, w] = deck.edge(u); const ww = w * 0.88, hh = 0.12 + 0.34 * (i / (cu.length - 1)); return [[x, y, -ww], [x, y + hh, -ww * 0.7], [x, y + hh * 1.15, 0], [x, y + hh, ww * 0.7], [x, y, ww]]; });
    bk.add(loftGeo(rings, { flip: true, capStart: true, capEnd: true }), null, WH, P.B, S.canvas);
    bowRail(bk, Hh, deck, 0.4);
    bk.add(cyl(5, 0.6), M(0.01 * L - 0.15, q.y + 1.3, 0, 0.014, 0.5, 0.014), C.steel, 0, S.metal);
    navLight(bk, 0.01 * L - 0.15, q.y + 1.58, 0, 0.04);
    // outboard
    bx(bk, -L / 2 - 0.14, hp.Fs + 0.2, 0, 0.34, 0.5, 0.36, C.black, 0, S.gloss); bx(bk, -L / 2 - 0.1, hp.Fs - 0.35, 0, 0.12, 0.9, 0.1, C.grey, 0, S.gloss);
  }
  for (const [u, s] of [[0.3, 1], [0.5, 1], [0.68, 1], [0.3, -1], [0.5, -1], [0.68, -1]]) fender(bk, Hh, u, s, (u * 10 | 0) % 2 ? C.fenderW : C.fenderB);
  const cl = [[0.86, 0], [0.08, 0.6], [0.08, -0.6]];
  for (const [u, k] of cl) { const [x, y, w] = deck.edge(u); cleatB(bk, x, y, k * w); }
  return { geo: bk.build(), hp, cleats: [[L * 0.4, hp.Fb - 0.05, 0], [-L * 0.44, hp.Fs, 0]], kind: 'cruiser' };
}

function buildYacht(variant) {
  const bk = new Bucket();
  const hp = variant === 0
    ? { L: 10.6, B: 2.9, D: 1.0, F: 0.8, Fb: 1.42, Fs: 1.02, um: 0.44, pb: 1.65, qb: 1.0, transom: 0.34, ps: 1.8, e: 0.85, eBow: 1.3, f: 1.0, rakeBow: 1.5, rakeStern: 1.15, ub: 0.55, kb: 1, us: 0.36, ks: 1.0 }
    : { L: 12.4, B: 3.2, D: 1.1, F: 0.86, Fb: 1.55, Fs: 1.1, um: 0.45, pb: 1.65, qb: 1.0, transom: 0.3, ps: 1.8, e: 0.85, eBow: 1.3, f: 1.0, rakeBow: 1.7, rakeStern: 1.4, ub: 0.55, kb: 1, us: 0.36, ks: 1.0 };
  const Hh = makeHull(hp); const NU = 19, NV = 7, L = hp.L;
  addHull(bk, Hh, NU, NV, P.A);
  const deck = addDeck(bk, Hh, NU, 0.03, 0.07, C.teak, S.deck);
  addBulwark(bk, Hh, NU, deck, false, 0.028, C.varnish);
  const yd = u => deck.y(u);
  // sheer stripe (gold cove line)
  for (const s of [-1, 1]) tb(bk, Hh.stations(NU).map(u => { const p = Hh.point(u, 0.9, s); return [p[0], p[1], p[2] + s * 0.006]; }), 0.012, C.brass, 0, S.gloss, 3);
  // coach roof with portholes, cockpit coamings, tiller
  const st = [];
  for (const [x, wk, h] of [[-0.14, 0.6, 0.4], [-0.1, 0.62, 0.44], [0.04, 0.62, 0.46], [0.12, 0.56, 0.42], [0.17, 0.42, 0.3]]) { const u = x + 0.5; st.push({ x: x * L, w: Hh.half(u) * wk, h, y: yd(u) - 0.02 }); }
  const cb = cabin(bk, st, { tin: 0.9, camber: 0.1, part: P.B });
  for (let i = 0; i < 5; i++) cb.sideWin((-0.105 + i * 0.05) * L, (-0.08 + i * 0.05) * L, 0.42, 0.78);
  bx(bk, -0.14 * L - 0.012, st[0].y + 0.25, 0, 0.03, 0.5, 0.5, C.varnish, 0, S.wood);                 // companionway
  bx(bk, -0.1 * L, st[0].y + 0.47, 0, 0.5, 0.03, 0.6, C.varnish, 0, S.wood);                             // hatch
  const ca = deck.edge(0.36), cbk = deck.edge(0.15);
  for (const s of [-1, 1]) bk.add(box(), beam([cbk[0], cbk[1] + 0.11, s * cbk[2] * 0.62], [ca[0], ca[1] + 0.13, s * ca[2] * 0.6], 0.035, 0.22), C.varnish, 0, S.wood);
  bx(bk, cbk[0], cbk[1] + 0.11, 0, 0.035, 0.22, cbk[2] * 1.24, C.varnish, 0, S.wood);
  bx(bk, (ca[0] + cbk[0]) / 2, cbk[1] - 0.01, 0, ca[0] - cbk[0], 0.03, cbk[2] * 1.2, mul(C.teak, 0.55), 0, S.deck);   // cockpit sole (dark)
  tb(bk, [[cbk[0] - 0.1, cbk[1] + 0.2, 0], [cbk[0] + 0.5, cbk[1] + 0.42, 0], [cbk[0] + 1.3, cbk[1] + 0.5, 0.08]], 0.02, C.varnish, 0, S.wood, 4);
  // masts, booms, furled sails, rigging
  const rig = (xm, hM, boomL, r, jib) => {
    const u = Hh.xToU(xm), y0 = yd(u) + 0.38;
    bk.add(cyl(16, 0.55), M(xm, y0 - 0.4 + hM / 2, 0, r, hM, r), C.varnish, 0, S.wood);
    const top = y0 - 0.4 + hM, yb = y0 + 0.75;
    // boom + furled main under a sail cover
    bk.add(cyl(12), M(xm - boomL / 2, yb, 0, r * 0.6, boomL, r * 0.6, 0, 0, Math.PI / 2), C.varnish, 0, S.wood);
    const n = 18, sail = [];
    for (let i = 0; i <= n; i++) { const tt = i / n; sail.push([xm - 0.1 - (boomL - 0.3) * tt, yb + 0.16 + 0.02 * Math.sin(i * 0.95) + 0.012 * Math.sin(i * 2.3), 0.02 * Math.sin(i * 1.35)]); }
    // flaked sail lashed to the boom: bulges between the ties, pinched under them
    bk.add(tubeGeo(sail, (i, tt) => (0.05 + 0.13 * Math.pow(Math.sin(Math.PI * Math.min(1, tt * 1.15 + 0.08)), 0.5)) * (i % 4 === 2 ? 0.8 : 1.0 + 0.1 * Math.sin(i * 1.7)), 12), null, WH, P.B, S.canvas);
    for (let i = 2; i < n; i += 4) bk.add(torus(1, 0.07, 5, 14), M(sail[i][0], sail[i][1] - 0.03, 0, 0.17, 0.19, 0.2, 0, Math.PI / 2, 0), C.white, 0, S.rope);
    // gooseneck, topping lift, sheet
    tb(bk, [[xm - boomL + 0.05, yb + 0.03, 0], [xm - 0.02, top - 0.1, 0]], 0.006, C.steel, 0, S.metal, 3);
    tb(bk, [[xm - boomL + 0.5, yb - 0.05, 0], [xm - boomL + 0.7, yd(Hh.xToU(xm - boomL + 0.7)) + 0.1, 0]], 0.009, C.hemp, 0, S.rope, 3);
    // shrouds + spreaders
    const sp = y0 + hM * 0.55, [xe, ye, we] = deck.edge(u);
    for (const s of [-1, 1]) {
      tb(bk, [[xm, top - 0.25, 0], [xm, sp, s * 0.75 * (r / 0.085)], [xe - 0.15, ye + 0.05, s * (we - 0.05)]], 0.006, C.steel, 0, S.metal, 3);
      tb(bk, [[xm, sp - 0.2, 0], [xe + 0.45, ye + 0.05, s * (we - 0.06)]], 0.006, C.steel, 0, S.metal, 3);
      tb(bk, [[xm, sp, 0], [xm, sp, s * 0.75 * (r / 0.085)]], 0.012, C.varnish, 0, S.wood, 4);
    }
    // halyards along the mast
    tb(bk, [[xm + r + 0.02, top - 0.2, 0.03], [xm + r + 0.05, y0 + 0.3, 0.05]], 0.005, C.hemp, 0, S.rope, 3);
    return { top, y0 };
  };
  const xm = variant === 0 ? 0.09 * L : 0.12 * L, hM = variant === 0 ? 12.6 : 14.0;
  const main = rig(xm, hM, variant === 0 ? 4.5 : 4.3, 0.085, true);
  navLight(bk, xm, main.top + 0.06, 0, 0.045);
  // forestay with furled jib, backstay
  const bowp = Hh.point(0.985, 1, 1), sternp = Hh.point(0.01, 1, 1);
  const fs0 = [bowp[0] - 0.1, bowp[1] + 0.05, 0], fs1 = [xm + 0.05, main.top - 0.3, 0];
  const jib = []; for (let i = 0; i <= 10; i++) { const tt = i / 10; jib.push([lerp(fs0[0], fs1[0], tt), lerp(fs0[1], fs1[1], tt), 0]); }
  bk.add(tubeGeo(jib, (i, tt) => tt > 0.86 || tt < 0.02 ? 0.008 : 0.035 + 0.035 * (1 - tt) + 0.008 * Math.sin(i * 2.3), 10), null, WH, P.B, S.canvas);
  if (variant === 0) tb(bk, [[xm - 0.05, main.top - 0.05, 0], [sternp[0] + 0.1, sternp[1] + 0.05, 0]], 0.006, C.steel, 0, S.metal, 3);
  else {
    // yawl: mizzen mast aft
    const xz = -0.36 * L; const mz = rig(xz, 7.4, 2.5, 0.06, false);
    tb(bk, [[xm - 0.05, main.top - 0.05, 0], [xz + 0.05, mz.y0 + 0.4, 0]], 0.006, C.steel, 0, S.metal, 3);
    tb(bk, [[xz, mz.top - 0.1, 0], [xm, main.y0 + hM * 0.5, 0]], 0.005, C.steel, 0, S.metal, 3);
  }
  bowRail(bk, Hh, deck, 0.55); pulpit(bk, Hh, deck, 0.1, 0.86, 0.55, 6);
  // anchor on the foredeck, cleats, fenders, dinghy-less
  { const [x, y] = deck.edge(0.9); bx(bk, x - 0.1, y + 0.06, 0, 0.5, 0.05, 0.08, C.steel, 0, S.metal); bx(bk, x + 0.12, y + 0.05, 0, 0.06, 0.05, 0.4, C.steel, 0, S.metal); }
  for (const [u, k] of [[0.9, 0.5], [0.9, -0.5], [0.08, 0.7], [0.08, -0.7], [0.5, 0.92], [0.5, -0.92]]) { const [x, y, w] = deck.edge(u); cleatB(bk, x, y, k * w); }
  for (const [u, s] of [[0.3, 1], [0.45, 1], [0.6, 1], [0.72, 1], [0.3, -1], [0.45, -1], [0.6, -1], [0.72, -1]]) fender(bk, Hh, u, s, (u * 20 | 0) % 2 ? C.fenderW : C.fenderB, 0.5, 0.09);
  return { geo: bk.build(), hp, cleats: [[L * 0.42, hp.Fb - 0.08, 0], [-L * 0.4, hp.Fs - 0.05, 0]], kind: variant ? 'yawl' : 'sloop', mastTop: main.top };
}

function buildBarge() {
  const bk = new Bucket();
  const hp = { L: 21, B: 3.9, D: 0.75, F: 0.85, Fb: 1.3, Fs: 1.1, um: 0.5, pb: 5.0, qb: 0.55, transom: 0, ps: 5.0, qs: 0.5, e: 0.22, eBow: 0.5, f: 0.3, fBow: 0.7, rakeBow: 0.5, rakeStern: 0.3, ub: 0.8, kb: 0.8, us: 0.15, ks: 0.6, sheerPow: 3 };
  const Hh = makeHull(hp); const NU = 21, NV = 6, L = hp.L;
  addHull(bk, Hh, NU, NV, P.A);
  const deck = addDeck(bk, Hh, NU, 0.14, 0.03, [0.09, 0.09, 0.095], S.gloss);
  addBulwark(bk, Hh, NU, deck, true, 0.04, C.black, 0, S.gloss);
  const yd = u => deck.y(u);
  // rubbing bands
  for (const s of [-1, 1]) for (const v of [0.93, 0.7]) tb(bk, Hh.stations(NU).map(u => { const p = Hh.point(u, v, s); return [p[0], p[1], p[2] + s * 0.02]; }), 0.045, C.black, 0, S.rubber, 7);
  // hold coaming + tarpaulin tent (ridge with sag between hoops)
  const ua = 0.2, ub = 0.8, n = 20, rings = [], coam = [];
  for (let i = 0; i <= n; i++) {
    const u = lerp(ua, ub, i / n); const [x, y, w] = deck.edge(u); const ww = w - 0.42;
    const endK = Math.min(1, Math.min(i, n - i) / 1.5);
    const sag = 0.06 * Math.abs(Math.sin(i * Math.PI / 2.5)) + 0.03 * Math.sin(i * 1.7);
    const ridge = y + 0.42 + (0.72 - sag) * endK;
    rings.push([[x, y + 0.02, -ww - 0.05], [x, y + 0.42, -ww - 0.04], [x, y + 0.46 + (ridge - y - 0.46) * 0.62 - sag * 0.5, -ww * 0.5], [x, ridge, 0], [x, y + 0.46 + (ridge - y - 0.46) * 0.62 - sag * 0.5, ww * 0.5], [x, y + 0.42, ww + 0.04], [x, y + 0.02, ww + 0.05]]);
    coam.push([x, y, ww]);
  }
  bk.add(loftGeo(rings, { flip: true, capStart: true, capEnd: true }), null, WH, P.B, S.canvas);
  for (let i = 1; i < n; i += 2) tb(bk, rings[i].map(p => [p[0], p[1] + 0.012, p[2] * 1.005]), 0.011, C.hemp, 0, S.rope, 3);
  // wheelhouse aft
  const uw = 0.115, [xw, yw, ww] = deck.edge(uw);
  const st = [{ x: xw - 1.3, w: ww * 0.66, h: 1.95, y: yw }, { x: xw + 1.3, w: ww * 0.7, h: 1.95, y: yw }];
  const cb = cabin(bk, st, { tin: 0.94, camber: 0.07, part: P.B });
  cb.sideWin(xw - 1.05, xw - 0.2, 0.52, 0.9); cb.sideWin(xw + 0.0, xw + 1.05, 0.52, 0.9);
  cb.endWin(1, -0.85, -0.05, 0.52, 0.9); cb.endWin(1, 0.05, 0.85, 0.52, 0.9); cb.endWin(-1, -0.8, -0.3, 0.55, 0.9);
  bx(bk, xw - 1.3 - 0.012, yw + 0.85, ww * 0.25, 0.03, 1.6, 0.6, C.varnish, 0, S.wood);
  {                                                                                                 // roof overhang with a rolled edge, grab rails, boat hook
    const rw = ww * 0.82, xa = xw - 1.5, xb2 = xw + 1.78, yr = yw + 2.07;
    bx(bk, (xa + xb2) / 2, yr, 0, xb2 - xa, 0.06, rw * 2, C.black, 0, S.gloss);
    tb(bk, [[xa, yr, -rw], [xb2, yr, -rw], [xb2, yr, rw], [xa, yr, rw], [xa, yr, -rw]], 0.04, C.black, 0, S.gloss, 6);
    for (const s of [-1, 1]) tb(bk, [[xw - 1.0, yr + 0.03, s * rw * 0.72], [xw - 1.0, yr + 0.13, s * rw * 0.72], [xw + 1.0, yr + 0.13, s * rw * 0.72], [xw + 1.0, yr + 0.03, s * rw * 0.72]], 0.014, C.brass, 0, S.metal, 5);
    tb(bk, [[xw - 1.3, yr + 0.06, rw * 0.35], [xw + 1.6, yr + 0.06, rw * 0.3]], 0.017, C.rawwood, 0, S.wood, 6);
    bk.add(torus(0.2, 0.055, 7, 16), M(xw - 0.2, yr + 0.085, -rw * 0.1, 1, 1, 1, Math.PI / 2, 0, 0), [0.7, 0.2, 0.05], 0, S.rubber);   // life ring lying on the roof
    // deck lamp under the forward overhang: bracket, enamel shade, bulb
    tb(bk, [[xw + 1.32, yw + 1.92, 0], [xw + 1.62, yw + 1.97, 0]], 0.012, C.black, 0, S.metal, 5);
    bk.add(cyl(14, 0.25), M(xw + 1.62, yw + 1.93, 0, 0.12, 0.08, 0.12), C.black, 0, S.gloss);
    navLight(bk, xw + 1.62, yw + 1.875, 0, 0.04);
    for (const s of [-1, 1]) {                                                                        // sidelight screens
      bx(bk, xw + 0.55, yw + 1.82, s * (ww * 0.67 + 0.09), 0.3, 0.2, 0.1, s > 0 ? [0.02, 0.12, 0.05] : [0.2, 0.02, 0.02], 0, S.gloss);
      navLight(bk, xw + 0.6, yw + 1.82, s * (ww * 0.67 + 0.17), 0.035);
    }
  }
  bk.add(cyl(14, 1, false), M(xw - 0.8, yw + 2.5, -ww * 0.3, 0.07, 0.9, 0.07), C.black, 0, S.gloss);   // stove pipe
  bk.add(cyl(14, 0.3), M(xw - 0.8, yw + 2.98, -ww * 0.3, 0.12, 0.08, 0.12), C.black, 0, S.gloss);
  // hold coaming with wedge cleats, stern bitts, deck gear
  for (const s of [-1, 1]) {
    bk.add(stripGeo(coam.map(p => [p[0], p[1] - 0.01, s * (p[2] + 0.085)]), coam.map(p => [p[0], p[1] + 0.2, s * (p[2] + 0.07)]), s < 0), null, C.rawwood, 0, S.wood);
    tb(bk, coam.map(p => [p[0], p[1] + 0.2, s * (p[2] + 0.07)]), 0.028, C.black, 0, S.gloss, 6);
    for (let i = 1; i < coam.length; i += 2) bx(bk, coam[i][0], coam[i][1] + 0.1, s * (coam[i][2] + 0.1), 0.09, 0.14, 0.05, C.steel, 0, S.metal);
  }
  {
    const [xq, yq, wq] = deck.edge(0.055);
    for (const s of [-1, 1]) { bk.add(cyl(14, 0.9), M(xq, yq + 0.2, s * wq * 0.5, 0.07, 0.4, 0.07), C.black, 0, S.gloss); bk.add(cyl(14), M(xq, yq + 0.41, s * wq * 0.5, 0.085, 0.03, 0.085), C.black, 0, S.gloss); }
    const [xg, yg, wg] = deck.edge(0.185);
    ropeCoil(bk, xg + 0.25, yg + 0.02, wg * 0.74, 0.2);
    bk.add(cyl(16, 0.86), M(xg + 0.2, yg + 0.24, -wg * 0.74, 0.2, 0.46, 0.2), C.varnish, 0, S.wood);     // water barrel with hoops
    for (const dy of [0.1, 0.38]) bk.add(cyl(16, 1, true), M(xg + 0.2, yg + dy, -wg * 0.74, 0.2, 0.03, 0.2), C.black, 0, S.metal);
  }
  navLight(bk, xw + 0.9, yw + 2.2, 0, 0.05);
  // fore deck: bitts, winch, short mast with light
  const [xb, yb] = deck.edge(0.9);
  for (const s of [-1, 1]) { bk.add(cyl(16, 0.9), M(xb, yb + 0.25, s * 0.5, 0.08, 0.5, 0.08), C.black, 0, S.gloss); bk.add(cyl(16), M(xb, yb + 0.51, s * 0.5, 0.095, 0.03, 0.095), C.black, 0, S.gloss); }
  bk.add(cyl(10), M(xb, yb + 0.36, 0, 0.035, 1.3, 0.035, Math.PI / 2, 0, 0), C.black, 0, S.gloss);
  bx(bk, xb - 1.2, yb + 0.25, 0, 0.7, 0.5, 0.9, C.black, 0, S.gloss); bk.add(cyl(18), M(xb - 1.2, yb + 0.55, 0, 0.16, 1.1, 0.16, Math.PI / 2, 0, 0), C.grey, 0, S.gloss);
  bk.add(cyl(12, 0.6), M(xb - 2.2, yb + 1.3, 0, 0.035, 2.6, 0.035), C.varnish, 0, S.wood);
  navLight(bk, xb - 2.2, yb + 2.65, 0, 0.05);
  ropeCoil(bk, xb - 0.7, yb + 0.5, 0.0, 0.26);
  // rudder head + tiller aft
  const [xs, ys] = deck.edge(0.03); bx(bk, xs - 0.1, ys + 0.3, 0, 0.12, 0.8, 0.08, C.black, 0, S.gloss);
  for (const [u, s] of [[0.25, 1], [0.42, 1], [0.6, 1], [0.76, 1], [0.25, -1], [0.42, -1], [0.6, -1], [0.76, -1]]) tyre(bk, Hh, u, s, 0.42);
  return { geo: bk.build(), hp, cleats: [[L * 0.4, hp.Fb - 0.1, 0], [-L * 0.42, hp.Fs - 0.1, 0]], kind: 'barge' };
}

function buildTug() {
  const bk = new Bucket();
  const hp = { L: 15.5, B: 4.5, D: 1.3, F: 0.85, Fb: 2.2, Fs: 1.15, um: 0.45, pb: 2.2, qb: 0.75, transom: 0, ps: 2.6, qs: 0.5, e: 0.6, eBow: 1.2, f: 0.8, fBow: 1.0, rakeBow: 0.5, rakeStern: 0.9, ub: 0.6, kb: 1, us: 0.3, ks: 0.9, sheerPow: 2.2 };
  const Hh = makeHull(hp); const NU = 21, NV = 7, L = hp.L;
  addHull(bk, Hh, NU, NV, P.A);
  const deck = addDeck(bk, Hh, NU, 0.42, 0.05, [0.12, 0.05, 0.04], S.gloss);
  addBulwark(bk, Hh, NU, deck, true, 0.05, C.black, 0, S.gloss);
  const yd = u => deck.y(u);
  for (const s of [-1, 1]) tb(bk, Hh.stations(NU).map(u => { const p = Hh.point(u, 0.8, s); return [p[0], p[1], p[2] + s * 0.03]; }), 0.085, C.rubber, 0, S.rubber, 5);
  // deckhouse + wheelhouse
  const [xh, yh] = deck.edge(0.52);
  const dh = [{ x: xh - 3.4, w: 1.3, h: 2.1, y: yh - 0.05 }, { x: xh + 1.9, w: 1.3, h: 2.1, y: yh + 0.05 }];
  const c1 = cabin(bk, dh, { tin: 0.96, camber: 0.05, part: P.B });
  for (let i = 0; i < 4; i++) { const x = xh - 2.9 + i * 1.15; bk.add(cyl(10), M(x, yh + 1.35, 1.275, 0.16, 0.03, 0.16, Math.PI / 2, 0, 0), WH, P.win, 0); bk.add(cyl(10), M(x, yh + 1.35, -1.275, 0.16, 0.03, 0.16, Math.PI / 2, 0, 0), WH, P.win, 0); bk.add(torus(0.17, 0.025, 4, 10), M(x, yh + 1.35, 1.29), C.brass, 0, S.metal); bk.add(torus(0.17, 0.025, 4, 10), M(x, yh + 1.35, -1.29), C.brass, 0, S.metal); }
  bx(bk, xh - 0.75, yh + 2.13, 0, 5.7, 0.06, 3.1, C.black, 0, S.gloss);
  const wh = [{ x: xh - 0.3, w: 1.0, h: 2.0, y: yh + 2.13 }, { x: xh + 1.7, w: 1.05, h: 2.0, y: yh + 2.13 }];
  const c2 = cabin(bk, wh, { tin: 0.93, camber: 0.08, part: P.B });
  c2.sideWin(xh - 0.15, xh + 0.7, 0.5, 0.9); c2.sideWin(xh + 0.8, xh + 1.6, 0.5, 0.9);
  for (const [a, b] of [[-0.9, -0.34], [-0.28, 0.28], [0.34, 0.9]]) c2.endWin(1, a, b, 0.5, 0.9);
  c2.endWin(-1, -0.85, -0.1, 0.5, 0.9); c2.endWin(-1, 0.1, 0.85, 0.5, 0.9);
  bx(bk, xh + 0.7, yh + 4.2, 0, 2.5, 0.06, 2.5, C.black, 0, S.gloss);
  // funnel (accent paint with a black top), vents, mast with lights
  bk.add(cyl(28, 0.92), M(xh - 2.0, yh + 3.45, 0, 0.48, 2.7, 0.56), WH, P.B, S.gloss);
  bk.add(cyl(28, 1, true), M(xh - 2.0, yh + 4.55, 0, 0.46, 0.55, 0.53), C.black, 0, S.gloss);
  bk.add(cyl(28, 1, true), M(xh - 2.0, yh + 3.9, 0, 0.475, 0.3, 0.55), C.cream, 0, S.gloss);
  for (const s of [-1, 1]) { bk.add(cyl(7), M(xh - 3.0, yh + 2.5, s * 0.8, 0.11, 0.8, 0.11), C.cream, 0, S.gloss); bk.add(sphere(7, 5), M(xh - 3.0, yh + 2.95, s * 0.8, 0.17, 0.17, 0.17), C.cream, 0, S.gloss); }
  bk.add(cyl(6, 0.6), M(xh + 0.4, yh + 5.6, 0, 0.05, 2.8, 0.05), C.cream, 0, S.gloss);
  bx(bk, xh + 0.4, yh + 6.2, 0, 0.04, 0.04, 1.3, C.cream, 0, S.gloss);
  navLight(bk, xh + 0.45, yh + 6.9, 0, 0.06); navLight(bk, xh + 0.48, yh + 6.25, 0, 0.05);
  tb(bk, [[xh + 0.4, yh + 6.95, 0], [xh - 6.2, yd(0.08) + 1.0, 0]], 0.006, C.steel, 0, S.metal, 3);
  tb(bk, [[xh + 0.4, yh + 6.95, 0], [Hh.point(0.97, 1, 1)[0], Hh.sheer(0.97) + 0.1, 0]], 0.006, C.steel, 0, S.metal, 3);
  // towing bitts + hook aft, capstan forward, rope coils
  const [xa, ya] = deck.edge(0.2);
  for (const s of [-1, 1]) bk.add(cyl(16, 0.9), M(xa, ya + 0.35, s * 0.45, 0.1, 0.7, 0.1), C.black, 0, S.gloss);
  bx(bk, xa, ya + 0.55, 0, 0.1, 0.1, 1.3, C.black, 0, S.gloss);
  ropeCoil(bk, xa - 1.0, ya, 0.6, 0.42); ropeCoil(bk, xa - 1.2, ya, -0.7, 0.36);
  const [xc, yc] = deck.edge(0.84); bk.add(cyl(18, 0.7), M(xc, yc + 0.3, 0, 0.22, 0.6, 0.22), C.black, 0, S.gloss);
  // bow pudding fender (rope) + tyres along both sides
  const bp = []; for (let i = -4; i <= 4; i++) { const u = 0.985 - Math.abs(i) * 0.012; const p = Hh.point(u, 0.92, i < 0 ? -1 : 1); bp.push([p[0] + 0.1, p[1] - 0.15, p[2] * 1.15]); }
  bk.add(tubeGeo(bp, 0.2, 6), null, C.hemp, 0, S.rope);
  for (const [u, s] of [[0.2, 1], [0.32, 1], [0.44, 1], [0.56, 1], [0.68, 1], [0.8, 1], [0.2, -1], [0.32, -1], [0.44, -1], [0.56, -1], [0.68, -1], [0.8, -1]]) tyre(bk, Hh, u, s, 0.5);
  return { geo: bk.build(), hp, cleats: [[L * 0.36, hp.Fb - 0.5, 0], [-L * 0.36, hp.Fs - 0.2, 0]], kind: 'tug' };
}

function buildFisher(variant) {
  const bk = new Bucket();
  const hp = variant === 0
    ? { L: 8.4, B: 2.9, D: 0.75, F: 0.72, Fb: 1.45, Fs: 0.85, um: 0.42, pb: 2.0, qb: 0.8, transom: 0.72, e: 0.65, eBow: 1.2, f: 0.85, fBow: 1.0, rakeBow: 0.7, rakeStern: 0.1, ub: 0.6, kb: 1, us: 0.3, ks: 0.5, sheerPow: 2.2 }
    : { L: 6.4, B: 2.3, D: 0.55, F: 0.6, Fb: 1.15, Fs: 0.7, um: 0.45, pb: 2.0, qb: 0.8, transom: 0, ps: 2.2, qs: 0.7, e: 0.7, eBow: 1.2, f: 0.9, rakeBow: 0.55, rakeStern: 0.45, ub: 0.6, kb: 1, us: 0.3, ks: 0.9, sheerPow: 2.2 };
  const Hh = makeHull(hp); const NU = 17, NV = 6, L = hp.L;
  addHull(bk, Hh, NU, NV, P.A);
  const deck = addDeck(bk, Hh, NU, 0.3, 0.04, C.rawwood, S.deck);
  addBulwark(bk, Hh, NU, deck, true, 0.035, C.varnish, 0, S.wood, P.B);
  for (const s of [-1, 1]) tb(bk, Hh.stations(NU).map(u => { const p = Hh.point(u, 0.78, s); return [p[0], p[1], p[2] + s * 0.015]; }), 0.03, C.white, 0, S.gloss, 4);
  // wheelhouse (forward on the big one, aft on the small double-ender)
  const uw = variant === 0 ? 0.64 : 0.24, [xw, yw, ww] = deck.edge(uw);
  const hl = variant === 0 ? 0.95 : 0.7, hh = variant === 0 ? 1.95 : 1.75, wk = variant === 0 ? 0.55 : 0.6;
  const st = [{ x: xw - hl, w: ww * wk, h: hh, y: yw }, { x: xw + hl, w: ww * wk * 0.96, h: hh, y: yw }];
  const cb = cabin(bk, st, { tin: 0.93, camber: 0.08, part: P.B });
  cb.sideWin(xw - hl * 0.75, xw - 0.05, 0.55, 0.9); cb.sideWin(xw + 0.05, xw + hl * 0.75, 0.55, 0.9);
  cb.endWin(1, -0.85, -0.06, 0.55, 0.9); cb.endWin(1, 0.06, 0.85, 0.55, 0.9); cb.endWin(-1, -0.8, -0.2, 0.55, 0.9);
  bx(bk, xw - hl - 0.012, yw + 0.8, ww * wk * 0.4, 0.03, 1.55, 0.55, C.varnish, 0, S.wood);
  bx(bk, xw, yw + hh + 0.1, 0, hl * 2 + 0.5, 0.05, ww * wk * 2.2, C.white, 0, S.gloss);
  { const ra = hl + 0.25, rb = ww * wk * 1.1, yr = yw + hh + 0.1; tb(bk, [[xw - ra, yr, -rb], [xw + ra, yr, -rb], [xw + ra, yr, rb], [xw - ra, yr, rb], [xw - ra, yr, -rb]], 0.032, C.white, 0, S.gloss, 6); }
  bk.add(cyl(12, 0.25), M(xw - (variant === 0 ? 1 : -1) * (hl + 0.16), yw + hh - 0.02, 0.38, 0.1, 0.07, 0.1), C.black, 0, S.gloss); navLight(bk, xw - (variant === 0 ? 1 : -1) * (hl + 0.16), yw + hh - 0.07, 0.38, 0.035);
  navLight(bk, xw, yw + hh + 0.75, 0, 0.05);
  bk.add(cyl(5, 0.6), M(xw, yw + hh + 0.4, 0, 0.02, 0.7, 0.02), C.white, 0, S.gloss);
  // mast + derrick boom over the working deck
  const wd = variant === 0 ? -1 : 1;        // direction from the wheelhouse to the working deck
  const xmst = xw + wd * (hl + 0.25), ymst = yw;
  bk.add(cyl(14, 0.6), M(xmst, ymst + 2.3, 0, 0.06, 4.6, 0.06), C.varnish, 0, S.wood);
  tb(bk, [[xmst, ymst + 1.2, 0], [xmst + wd * 2.6, ymst + 2.9, 0]], 0.04, C.varnish, 0, S.wood, 5);
  tb(bk, [[xmst, ymst + 4.5, 0], [xmst + wd * 2.6, ymst + 2.9, 0]], 0.006, C.steel, 0, S.metal, 3);
  tb(bk, [[xmst + wd * 2.5, ymst + 2.85, 0], [xmst + wd * 2.5, ymst + 1.7, 0]], 0.007, C.hemp, 0, S.rope, 3);
  bx(bk, xmst + wd * 2.5, ymst + 1.62, 0, 0.1, 0.16, 0.06, C.steel, 0, S.metal);
  tb(bk, [[xmst, ymst + 4.55, 0], [Hh.point(wd < 0 ? 0.97 : 0.03, 1, 1)[0], Hh.sheer(wd < 0 ? 0.97 : 0.03) + 0.05, 0]], 0.006, C.steel, 0, S.metal, 3);
  // net heap, fish boxes, floats, pots on the working deck
  const uA = variant === 0 ? 0.1 : 0.45, uB = variant === 0 ? 0.46 : 0.8;
  const nx = deck.edge(lerp(uA, uB, 0.3)), heap = [];
  for (let i = 0; i <= 6; i++) { const a = i / 6; const r = 0.8 * Math.pow(Math.cos(a * Math.PI / 2), 0.7) + 0.02; const ring = []; for (let j = 0; j <= 10; j++) { const an = j / 10 * Math.PI * 2; const lump = 1 + 0.2 * Math.sin(an * 3 + i) + 0.12 * Math.sin(an * 5 + i * 2); ring.push([nx[0] + Math.cos(an) * r * lump * 1.2, nx[1] + 0.01 + 0.55 * Math.sin(a * Math.PI / 2), Math.sin(an) * r * lump * 0.8]); } heap.push(ring); }
  bk.add(loftGeo(heap, { flip: false }), null, variant ? [0.45, 0.2, 0.05] : C.net, 0, S.net);
  for (let i = 0; i < 5; i++) bk.add(sphere(7, 5), M(nx[0] + 0.5 * Math.cos(i * 2.2), nx[1] + 0.3 + 0.05 * (i % 2), 0.45 * Math.sin(i * 2.2), 0.11, 0.11, 0.11), i % 2 ? C.orange : [0.8, 0.6, 0.05], 0, S.rubber);
  const bxp = deck.edge(lerp(uA, uB, 0.78));
  const cols = [[0.08, 0.2, 0.45], [0.6, 0.25, 0.04], [0.5, 0.5, 0.48], [0.08, 0.2, 0.45]];
  for (let i = 0; i < 4; i++) { const k = i < 3 ? 0 : 1; bx(bk, bxp[0] + (i % 2) * 0.05 - (k ? 0.5 : 0), bxp[1] + 0.11 + (k ? 0 : i * 0.2), (k ? -0.3 : 0.25), 0.68, 0.19, 0.42, cols[i], 0, S.gloss, 0, i * 0.08, 0); }
  ropeCoil(bk, bxp[0] - 0.2, bxp[1], -0.45 * (variant ? -1 : 1), 0.24, [0.2, 0.3, 0.45]);
  // winch
  { const [x, y] = deck.edge(lerp(uA, uB, 0.55)); bk.add(cyl(8), M(x + (variant ? 0.3 : -0.3), y + 0.3, -0.55, 0.14, 0.5, 0.14, Math.PI / 2, 0, 0), C.grey, 0, S.gloss); bx(bk, x + (variant ? 0.3 : -0.3), y + 0.15, -0.55, 0.3, 0.3, 0.6, C.grey, 0, S.gloss); }
  for (const [u, s] of [[0.3, 1], [0.52, 1], [0.72, 1], [0.3, -1], [0.52, -1], [0.72, -1]]) tyre(bk, Hh, u, s, 0.4);
  return { geo: bk.build(), hp, cleats: [[L * 0.4, hp.Fb - 0.3, 0], [-L * 0.42, hp.Fs - 0.2, 0]], kind: 'fishing' };
}

// ------------------------------------------------------------------------------------------------ fleet
const HULLS = {
  white: [0.74, 0.73, 0.68], cream: [0.66, 0.58, 0.42], navy: [0.028, 0.05, 0.12], green: [0.035, 0.105, 0.065], black: [0.022, 0.022, 0.025],
  oxblood: [0.27, 0.04, 0.03], sky: [0.17, 0.33, 0.46], ochre: [0.56, 0.38, 0.07], grey: [0.28, 0.3, 0.31], teal: [0.04, 0.22, 0.23], red: [0.5, 0.09, 0.03],
  varnish: [0.3, 0.15, 0.055], paleBlue: [0.42, 0.55, 0.62], paleGreen: [0.38, 0.5, 0.4], buff: [0.6, 0.48, 0.29], tan: [0.5, 0.4, 0.26], rust: [0.33, 0.13, 0.06],
};
const pick = (R, arr) => arr[Math.floor(R() * arr.length) % arr.length];

export function buildBoats(H) {
  const { L, THREE: _T } = H; const R = H.rng('harbor-boats');
  const types = {
    row: buildRowboat(0), skiff: buildRowboat(1), covered: buildRowboat(2),
    cruiser: buildCruiser(0), dayboat: buildCruiser(1),
    sloop: buildYacht(0), yawl: buildYacht(1),
    barge: buildBarge(), tug: buildTug(), fisher: buildFisher(0), fisherS: buildFisher(1),
  };
  const fleet = [];   // { type, x, z, ry, s, colA, colB, lights, wear, stripe, name }
  const add = (type, x, z, ry, o = {}) => {
    const T = types[type]; let colA, colB, stripe = 1, wear = 0.15 + R() * 0.5;
    if (type === 'row') { colA = H2(R, ['white', 'green', 'sky', 'oxblood', 'varnish', 'navy', 'ochre', 'grey', 'teal', 'cream']); colB = H2(R, ['cream', 'paleBlue', 'white', 'paleGreen', 'grey', 'buff']); stripe = R() < 0.4 ? 1 : 0; }
    else if (type === 'skiff') { colA = H2(R, ['white', 'grey', 'sky', 'red', 'green', 'white', 'cream']); colB = H2(R, ['grey', 'paleBlue', 'cream', 'white']); stripe = 0; }
    else if (type === 'covered') { colA = H2(R, ['white', 'green', 'navy', 'oxblood', 'varnish', 'black']); colB = H2(R, ['tan', 'navy', 'green', 'rust', 'grey', 'buff']); stripe = R() < 0.5 ? 1 : 0; }
    else if (type === 'cruiser' || type === 'dayboat') { colA = H2(R, ['white', 'white', 'navy', 'cream', 'green', 'varnish', 'sky']); colB = H2(R, ['white', 'cream', 'white', 'paleBlue']); if (colA === HULLS.white && R() < 0.5) colB = pick(R, [HULLS.navy, HULLS.tan, HULLS.green, HULLS.cream]); wear = 0.05 + R() * 0.35; }
    else if (type === 'sloop' || type === 'yawl') { colA = H2(R, ['white', 'navy', 'green', 'black', 'white', 'oxblood', 'cream']); colB = H2(R, ['white', 'cream', 'tan', 'navy', 'white']); wear = 0.03 + R() * 0.25; }
    else if (type === 'barge') { colA = H2(R, ['black', 'green', 'oxblood', 'navy']); colB = H2(R, ['tan', 'green', 'rust', 'grey']); wear = 0.5 + R() * 0.4; stripe = 0; }
    else if (type === 'tug') { colA = HULLS.black; colB = HULLS.buff; wear = 0.6; stripe = 1; }
    else { colA = H2(R, ['sky', 'red', 'green', 'white', 'ochre', 'teal', 'navy']); colB = H2(R, ['white', 'cream', 'paleBlue', 'white']); wear = 0.45 + R() * 0.5; stripe = R() < 0.5 ? 1 : 0; }
    const hasCabin = !['row', 'skiff', 'covered'].includes(type);
    const lights = hasCabin ? (R() < 0.34 ? 1 : (R() < 0.55 ? 0.5 : 0)) : 0;
    const b = { type, x, z, ry, s: 0.94 + R() * 0.12, colA, colB, lights, wear, stripe, seed: R() * 10, ph: [R() * 6.28, R() * 6.28, R() * 6.28, R() * 6.28], per: [2.3 + R() * 1.6, 3.1 + R() * 2.2, 3.6 + R() * 1.8], ...o };
    fleet.push(b); return b;
  };
  const H2 = (R_, names) => HULLS[pick(R_, names)];
  const W = H.walls;
  // --- along a wall: boats alongside, heading along the wall
  const alongside = (w, t, type, flipDir, gap = 0.3, o = {}) => {
    const T = types[type]; const off = T.hp.B / 2 + gap;
    const p = wpt(w, t, off);
    const dirx = w.d[0] * (flipDir ? -1 : 1), dirz = w.d[1] * (flipDir ? -1 : 1);
    return add(type, p[0], p[1], Math.atan2(-dirz, dirx), { wall: w, t, ...o });
  };
  const fillWall = (w, t0, t1, mix, density, reserved = []) => {
    let t = t0 + R() * 6;
    while (t < t1) {
      const type = pick(R, mix); const len = types[type].hp.L;
      const a = t, b = t + len;
      if (b < t1 && !isBlocked(w, a - 0.8, b + 0.8) && !reserved.some(r => a < r[1] && b > r[0])) { alongside(w, t + len / 2, type, R() < 0.5); t = b + 1.2 + R() * R() * density; }
      else t += 2.5;
    }
  };
  const small = ['row', 'row', 'skiff', 'covered', 'row', 'covered', 'skiff', 'dayboat'];
  // canal: barges first (reserved berths), then the small craft
  const bargeN = [332, 356], bargeS = [530, 553];
  alongside(W.canN, 344, 'barge', false, 0.42, { lights: 1, name: 'barge "Marigold"' });
  alongside(W.canS, 541.5, 'barge', true, 0.42, { lights: 0.5, name: 'barge "Old Tom"' });
  alongside(W.canN, 112, 'fisherS', true, 0.3, { lights: 0.5 }); alongside(W.canS, 70, 'fisherS', false, 0.3, { lights: 1, name: 'small fishing boat in the canal mouth' });
  fillWall(W.canN, 34, 660, small, 27, [bargeN, [107, 117]]);
  fillWall(W.canS, 34, 660, small, 27, [bargeS, [65, 75]]);
  // basin: cruisers on the north wall, a barge + small craft south, rowing boats east
  fillWall(W.basN, 4, 86, ['cruiser', 'dayboat', 'cruiser', 'dayboat', 'covered'], 6);
  alongside(W.basS, 62, 'barge', false, 0.42, { lights: 1, name: 'basin barge "Lantern Lass"' });
  fillWall(W.basS, 3, 46, ['skiff', 'row', 'covered', 'dayboat'], 5);
  fillWall(W.basE, 3, 80, ['row', 'skiff', 'covered', 'row', 'dayboat'], 6);
  fillWall(W.basWn, 3, 24, ['row', 'covered'], 4); fillWall(W.basWs, 3, 24, ['skiff', 'row'], 4);
  // bay jetties: yachts and cruisers alongside both faces
  const J = L.harbor.jetties;
  const berth = (j, side, xc, type, bowOut, o = {}) => { const T = types[type]; const z = side < 0 ? j.z0 - T.hp.B / 2 - 0.4 : j.z1 + T.hp.B / 2 + 0.4; return add(type, xc, z, bowOut ? Math.PI : 0, { jetty: j, ...o }); };
  berth(J[0], -1, -186, 'yawl', true, { lights: 1, name: 'yawl at north jetty' }); berth(J[0], -1, -170.5, 'dayboat', false);
  berth(J[0], 1, -187, 'sloop', false, { lights: 0.5 }); berth(J[0], 1, -173, 'sloop', true, { name: 'sloop (north jetty, south face)' });
  berth(J[1], -1, -187.5, 'sloop', true, { lights: 1, name: 'sloop with lit cabin' }); berth(J[1], -1, -172.5, 'cruiser', false, { lights: 0.5 });
  berth(J[1], 1, -186, 'yawl', false, { name: 'yawl (second jetty)' }); berth(J[1], 1, -171, 'sloop', true, { lights: 0.5 });
  berth(J[2], -1, -180, 'sloop', true, { lights: 0.5, name: 'sloop at south jetty' }); berth(J[2], -1, -166.5, 'fisherS', false);
  berth(J[2], 1, -179, 'cruiser', true, { lights: 1 }); berth(J[2], 1, -166, 'skiff', false);
  // bay quay: tug at the fender berth, fishing boats along the fish dock, work skiffs
  const bayX = type => L.QUAY_X - 0.62 - types[type].hp.B / 2 - 0.25;
  add('tug', bayX('tug'), -334, Math.PI / 2, { lights: 1, name: 'tug "Bruno"' });
  const fishZ = [352, 368, 388, 408, 466, 484, 506, 528, 550];
  fishZ.forEach((z, i) => add(i % 3 === 1 ? 'fisherS' : 'fisher', bayX(i % 3 === 1 ? 'fisherS' : 'fisher'), z + (R() - 0.5) * 2, R() < 0.5 ? Math.PI / 2 : -Math.PI / 2, i === 2 || i === 6 ? { lights: 1, name: 'fishing boat with lit wheelhouse' } : {}));
  // pier (south side): skiffs, a cruiser, a yacht near the head; a fishing boat on the north side near the root
  const Pp = L.harbor.pier;
  const pierS = (x, type, o = {}) => add(type, x, Pp.z1 + types[type].hp.B / 2 + 0.45, R() < 0.5 ? 0 : Math.PI, o);
  pierS(-300, 'sloop', { lights: 1, name: 'sloop at the pier head' }); pierS(-281, 'cruiser', { lights: 0.5 }); pierS(-262, 'row'); pierS(-254, 'skiff'); pierS(-236, 'fisherS'); pierS(-212, 'covered'); pierS(-196, 'row'); pierS(-178, 'dayboat');
  add('fisher', -205, Pp.z0 - types.fisher.hp.B / 2 - 0.5, 0, { lights: 0.5 });
  // rowing boats at the stair feet
  for (const w of Object.values(W)) for (const st of (w.stairs || [])) {
    const type = R() < 0.6 ? 'row' : 'skiff'; const T = types[type];
    const p = wpt(w, (st.t0 + st.t1) / 2 + (R() < 0.5 ? 1 : -1) * 0.5, 1.7 + T.hp.B / 2 + 0.3);
    add(type, p[0], p[1], Math.atan2(-w.d[1], w.d[0]) + (R() < 0.5 ? Math.PI : 0), {});
  }

  // --- instanced meshes
  const group = new THREE.Group(); group.name = 'boats';
  const meshes = {}; const byType = {};
  for (const b of fleet) (byType[b.type] = byType[b.type] || []).push(b);
  let tris = 0;
  for (const [type, list] of Object.entries(byType)) {
    const T = types[type]; const n = list.length;
    const geo = T.geo;
    const cA = new Float32Array(n * 3), cB = new Float32Array(n * 3), mi = new Float32Array(n * 4);
    list.forEach((b, i) => { cA.set(b.colA, i * 3); cB.set(b.colB, i * 3); mi.set([b.seed, b.lights, b.wear, b.stripe], i * 4); b.index = i; });
    geo.setAttribute('iColA', new THREE.InstancedBufferAttribute(cA, 3)); geo.setAttribute('iColB', new THREE.InstancedBufferAttribute(cB, 3)); geo.setAttribute('iMisc', new THREE.InstancedBufferAttribute(mi, 4));
    const mesh = new THREE.InstancedMesh(geo, H.mats.boat, n);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'boats_' + type;
    meshes[type] = mesh; group.add(mesh); tris += geo.index.count / 3 * n; (H.stats.boatTypes = H.stats.boatTypes || {})[type] = [geo.index.count / 3, n];
  }
  H.stats.boatTris = tris; H.stats.boats = fleet.length;

  // --- motion: rigid bob / roll / pitch, pure function of t
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const amp = b => { const Lb = types[b.type].hp.L; return Math.min(1, 4.2 / Lb); };
  const matrixAt = (b, t, out) => {
    const a = amp(b), w = 2 * Math.PI;
    const heave = a * (0.035 * Math.sin(w * t / b.per[1] + b.ph[0]) + 0.015 * Math.sin(w * t / (b.per[1] * 0.37) + b.ph[1]));
    const roll = a * (0.045 * Math.sin(w * t / b.per[0] + b.ph[1]) + 0.018 * Math.sin(w * t / (b.per[0] * 0.43) + b.ph[2]));
    const pitch = a * (0.014 * Math.sin(w * t / b.per[2] + b.ph[2]) + 0.006 * Math.sin(w * t / (b.per[2] * 0.4) + b.ph[3]));
    const yaw = a * 0.012 * Math.sin(w * t / 11.0 + b.ph[3]);
    const sway = a * 0.03 * Math.sin(w * t / 7.3 + b.ph[0]);
    e.set(roll, b.ry + yaw, pitch, 'YXZ'); q.setFromEuler(e);
    pos.set(b.x + Math.sin(b.ry) * sway, heave + (b.dy || 0), b.z + Math.cos(b.ry) * sway);
    return out.compose(pos, q, scl.set(b.s, b.s, b.s));
  };
  const update = t => {
    for (const [type, list] of Object.entries(byType)) {
      const mesh = meshes[type];
      for (const b of list) mesh.setMatrixAt(b.index, matrixAt(b, t, m4));
      mesh.instanceMatrix.needsUpdate = true;
    }
  };
  update(0);
  for (const m of Object.values(meshes)) { m.computeBoundingSphere(); m.computeBoundingBox(); }

  // --- mooring lines (static): bow and stern to the nearest bollard / ring / cleat / pile
  const rest = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const b of fleet) {
    e.set(0, b.ry, 0, 'YXZ'); q.setFromEuler(e); rest.compose(pos.set(b.x, 0, b.z), q, scl.set(b.s, b.s, b.s));
    const used = new Set();
    for (const c of types[b.type].cleats) {
      v.set(c[0], c[1], c[2]).applyMatrix4(rest);
      let best = -1, bd = 9.5 * 9.5;
      H.moor.forEach((m, i) => { if (used.has(i)) return; const d = (m[0] - v.x) ** 2 + (m[2] - v.z) ** 2 + (m[1] - v.y) ** 2 * 0.3; if (d < bd) { bd = d; best = i; } });
      if (best < 0) continue;
      used.add(best); const m = H.moor[best]; const d = Math.sqrt(bd);
      const thick = types[b.type].hp.L > 12 ? 0.028 : (types[b.type].hp.L > 6 ? 0.017 : 0.012);
      H.B.add('matte', tubeGeo(catenary([v.x, v.y + 0.02, v.z], m, Math.min(0.5, 0.05 + d * 0.035 + R() * 0.1), 8), thick, 4), null, R() < 0.3 ? [0.2, 0.28, 0.4] : COL.hemp, 0);
    }
  }
  const notable = fleet.filter(b => b.name).map(b => ({ name: b.name, type: types[b.type].kind, pos: [Math.round(b.x * 10) / 10, 0, Math.round(b.z * 10) / 10], heading: b.ry, lit: b.lights >= 1 }));
  return { group, update, fleet, notable, types };
}
