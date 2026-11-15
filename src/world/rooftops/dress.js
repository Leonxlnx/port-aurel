// Roofscape pass 2: the lived-in layer on top of populate.js — felt patches and tar strips, upstand flashing, duckboards,
// chimney stacks with pots, soil stacks and goosenecks, hatches, flat / lantern skylights, old AC units on frames, ducts,
// cable trays, wall conduits, aerial poles, washing lines, sitting corners with dim string lights, pigeon lofts,
// tower penthouses and a few dim work lights so the roofs are not black voids from the air.
// Runs AFTER populate with its own RNG stream and its own copy of the occupancy lists: nothing placed by pass 1 moves,
// and the module's return value (roofs[].used, vantage points, tanks ...) is untouched.
import { mulberry32 } from '../layout.js';
import { lin, mul, mixc, TRS } from './kit.js';
import { M } from './materials.js';

const D2R = Math.PI / 180;
const hexes = a => a.map(lin);
const PAL = {
  brick: hexes([0x8a4a3a, 0x7a3f33, 0x9b5a44, 0x6e3b30, 0xa4674e, 0x8d5b45]),
  coping: hexes([0xb5b0a5, 0xa9a295, 0xc0bbb0, 0x9d978c]),
  felt: [[0.03, 0.03, 0.032], [0.055, 0.053, 0.052], [0.1, 0.097, 0.092], [0.16, 0.155, 0.15], [0.045, 0.04, 0.038], [0.2, 0.075, 0.05], [0.26, 0.26, 0.255]],
  unit: hexes([0xc9c6bc, 0xb9b2a0, 0xa7abad, 0x8f989b, 0x9aa39a, 0x7d8a84]),
  pipe: hexes([0x8a3a22, 0xb08a2e, 0x9a9da0, 0x556a5a, 0x7a2f24, 0x3c3f42]),
  pot: hexes([0xa8563a, 0x94482f, 0xb5674a, 0x8a5a42, 0xc07a55]),
  wood: hexes([0x8a6a4c, 0x6b5a48, 0x9a8468, 0x5c4a3a]),
  furn: hexes([0x2f4a3a, 0x24313f, 0x8c8a84, 0x7a2f24, 0xd4d0c4, 0x1e1e1e]),
  cloth: [[0.78, 0.76, 0.7], [0.82, 0.8, 0.77], [0.55, 0.64, 0.72], [0.74, 0.6, 0.55], [0.72, 0.66, 0.45], [0.6, 0.68, 0.6]],
  leaf: [[0.55, 0.62, 0.5], [0.7, 0.66, 0.45], [0.5, 0.6, 0.55], [0.75, 0.6, 0.5], [0.6, 0.7, 0.42]],
  planter: hexes([0x9a958c, 0xa8593c, 0x6b5a48, 0x8c8a84]),
};
const GALV = lin(0xa9adb0), IRON = lin(0x3a3835), DARK = [0.035, 0.034, 0.034];

// film cameras standing on / looking across the roofs (kept clear; see the brief)
const FILM_CAMS = [
  { p: [73, 23.6, 77], t: [30.5, 29.8, 87.5], half: 34 * D2R, near: 0 },                  // shot 7 (no tower / sign in view: clear radius only)
  { p: [82, 33.4, 116.4], t: [668, 150, 153], half: 38 * D2R, far: 500 },                 // shot 14
  { p: [104.5, 33.4, 125.5], t: [668, 150, 153], half: 30 * D2R, far: 500 },              // shot 20
];
for (const c of FILM_CAMS) { const dx = c.t[0] - c.p[0], dz = c.t[2] - c.p[2], l = Math.hypot(dx, dz); c.d = [dx / l, dz / l]; }

export function dress(ctx, K, out, plan, vantage = []) {
  const L = ctx.layout;
  const st = { roofs: 0, chimneys: 0, lines: 0, sheets: 0, seats: 0, lofts: 0, lights: 0, skylights: 0, penthouses: 0, rejected: 0 };
  const bulkById = new Map(); for (const k of out.bulkheads) bulkById.set(k.id, k);
  const gardenById = new Map(); for (const g of out.gardens) gardenById.set(g.id, g);

  /** may something whose top is at world height `top` stand at (x,z) (radius rad) on a roof at roofY? */
  const camOK = (x, z, top, rad, roofY) => {
    const tall = top > roofY + 0.09;
    for (const c of FILM_CAMS) {
      const dx = x - c.p[0], dz = z - c.p[2], d = Math.hypot(dx, dz);
      if (d < 7.5 + rad) { if (tall) return false; continue; }
      const cs = (dx * c.d[0] + dz * c.d[1]) / d, sgn = Math.asin(Math.min(1, Math.max(-1, (c.d[0] * dz - c.d[1] * dx) / d)));
      const pad = Math.atan2(rad, d);
      if (cs < 0 || Math.acos(Math.min(1, cs)) > c.half + pad) continue;
      if (c.far) {
        if (d > 70 && (sgn < -18 * D2R - pad || sgn > 6 * D2R + pad)) continue;      // far field: tower + sign sector only
        if (d < c.far && top > Math.max(c.p[1] - 0.25, roofY + 1.2)) return false;
      }
      else if (d < c.near && top > c.p[1] - 0.25) return false;
    }
    if (tall) for (const v of vantage) {
      const dx = x - v.pos[0], dz = z - v.pos[2], d = Math.hypot(dx, dz);
      if (Math.abs(v.pos[1] - roofY) > 4 || d > 16 + rad) continue;
      if (d < 4.5 + rad) return false;
      const tx = v.target[0] - v.pos[0], tz = v.target[2] - v.pos[2], tl = Math.hypot(tx, tz) || 1;
      const along = (dx * tx + dz * tz) / tl, side = Math.abs(dx * tz - dz * tx) / tl;
      if (along > 0 && side < 2.0 + rad + along * 0.25 && top > v.pos[1] - 0.6) return false;
    }
    return true;
  };

  for (const b of L.buildings) {
    const r = out.roofs.get(b.id); if (!r || b.landmark === 'lantern') continue;
    const R = mulberry32((b.seed ^ 0x7f4a7c15) >>> 0);
    const rr = (a, c) => a + (c - a) * R();
    const pick = a => a[Math.floor(R() * a.length) % a.length];
    const y = r.y;
    const X0 = r.x0 + 0.47, X1 = r.x1 - 0.47, Z0 = r.z0 + 0.47, Z1 = r.z1 - 0.47;       // inner faces of the parapet
    const W = X1 - X0, D = Z1 - Z0; if (W < 3 || D < 3) continue;
    const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2, A = W * D, h = b.h;
    const lod1 = b.district === 'east' || cx > 800 || cz < -520 || cz > 640;
    const near = Math.hypot(cx - 90, cz - 110) < 190;
    const aerial = Math.hypot(cx - 668, cz - 153) < 300;
    const nearV = vantage.some(v => Math.abs(v.pos[1] - r.y) < 30 && Math.hypot(cx - v.pos[0], cz - v.pos[2]) < 45);
    const lvl = (near || nearV) ? 2 : (lod1 ? 0 : 1);
    if (lvl === 0) continue;                                              // far districts: the roof finish shader is enough
    // level 1 roofs are only ever seen as a skyline from the bay or from the air around the tower
    const seen1 = b.district === 'quay' || (b.district === 'old' && cx < 140) || aerial;
    const old = b.district === 'old' || b.district === 'quay';
    const masonry = b.style !== 'glass' && b.style !== 'concrete';
    const tall = h > 110, low = h < 48;
    const bulk = bulkById.get(b.id);
    st.roofs++;

    // ---- occupancy (own copy; pass 1 lists stay as they are) ------------------------------------------------
    const film = FILM_CAMS.findIndex(c => c.p[0] > r.x0 && c.p[0] < r.x1 && c.p[2] > r.z0 && c.p[2] < r.z1);
    const used = r.used.filter(u => !(film > 0 && u.w > W * 0.7 && u.d < D * 0.6)).map(u => ({ x: u.x, z: u.z, w: u.w, d: u.d }));
    const free = (px, pz, w, d, pad = 0.25) => px - w / 2 > X0 && px + w / 2 < X1 && pz - d / 2 > Z0 && pz + d / 2 < Z1
      && used.every(u => Math.abs(px - u.x) > (w + u.w) / 2 + pad || Math.abs(pz - u.z) > (d + u.d) / 2 + pad);
    const place = (w, d, { pad = 0.3, tries = 12, edge = null, hgt = 1, box = null } = {}) => {
      if (w > W - 0.1 || d > D - 0.1) return null;
      if (box) tries = Math.max(tries, 40);
      for (let i = 0; i < tries; i++) {
        let px = X0 + w / 2 + 0.04 + R() * (W - w - 0.08), pz = Z0 + d / 2 + 0.04 + R() * (D - d - 0.08);
        if (box) { px = box[0] + R() * (box[1] - box[0]); pz = box[2] + R() * (box[3] - box[2]); }
        if (edge === 'w') px = X0 + w / 2 + 0.04; else if (edge === 'e') px = X1 - w / 2 - 0.04; else if (edge === 'n') pz = Z0 + d / 2 + 0.04; else if (edge === 's') pz = Z1 - d / 2 - 0.04;
        if (!free(px, pz, w, d, pad)) continue;
        if (!camOK(px, pz, y + hgt, Math.max(w, d) / 2, y)) { st.rejected++; continue; }
        used.push({ x: px, z: pz, w, d });
        return { x: px, z: pz };
      }
      return null;
    };
    /** oriented box: len along X (ax = 0) or Z (ax = 1) */
    const ob = (px, y0, pz, len, hh, wid, ax, col, mat, cast = false) => K.box(px, y0, pz, ax ? wid : len, hh, ax ? len : wid, col, mat, cast);
    const leafCol = () => pick(PAL.leaf);

    // =========================================================================================================
    // surface dressing
    // =========================================================================================================
    const baseFelt = pick(PAL.felt.slice(0, 5));
    if (lvl === 2) {
      // felt upstand / flashing against the parapet
      const fh = rr(0.16, 0.3), ft = 0.05, col = mul(baseFelt, rr(0.7, 1.2));
      K.box(cx, y + 0.03, Z0 - 0.05 + ft / 2, W + 0.1, fh, ft, col, M.FELT, false);
      K.box(cx, y + 0.03, Z1 + 0.05 - ft / 2, W + 0.1, fh, ft, col, M.FELT, false);
      K.box(X0 - 0.05 + ft / 2, y + 0.03, cz, ft, fh, D, col, M.FELT, false);
      K.box(X1 + 0.05 - ft / 2, y + 0.03, cz, ft, fh, D, col, M.FELT, false);
    }
    {
      // patched felt: thin sheets of a different age, plus a few tar-mopped strips
      const n = lvl === 2 ? 4 + Math.floor(R() * 5) : Math.floor(R() * 2.2);
      for (let i = 0; i < n; i++) {
        const w = rr(1.0, Math.min(5.5, W * 0.45)), d = rr(0.9, Math.min(4, D * 0.45));
        const px = X0 + w / 2 + R() * (W - w), pz = Z0 + d / 2 + R() * (D - d);
        const col = mul(R() < 0.75 ? mixc(baseFelt, pick(PAL.felt), 0.6) : pick(PAL.felt), rr(0.8, 1.25));
        K.box(px, y + 0.043 + i * 0.0015, pz, w, 0.012, d, col, M.FELT, false);
      }
      const ns = lvl === 2 ? 1 + Math.floor(R() * 3) : 0;
      for (let i = 0; i < ns; i++) {
        const ax = R() < 0.5 ? 1 : 0, len = rr(0.5, 0.95) * (ax ? D : W), o = rr(0.15, 0.85);
        ob(ax ? X0 + W * o : cx + rr(-0.02, 0.02) * W, y + 0.058, ax ? cz + rr(-0.02, 0.02) * D : Z0 + D * o, len, 0.01, rr(0.14, 0.3), ax, [0.018, 0.018, 0.02], M.FELT);
      }
    }
    if (lvl === 1 && !seen1 && !tall) continue;

    // ---- duckboard walkway leading away from the stair bulkhead
    if (bulk && A > 90 && lvl === 2 && R() < 0.8) {
      const dx = cx - bulk.x, dz = cz - bulk.z;
      const ax = Math.abs(dx) * bulk.sz > Math.abs(dz) * bulk.sx ? 0 : 1; const sg = (ax ? Math.sign(dz) : Math.sign(dx)) || 1;
      const s0 = (ax ? bulk.sz : bulk.sx) / 2 + 0.75, wood = mul(pick(PAL.wood), rr(0.7, 1.0));
      const n = 2 + Math.floor(R() * 5), wb = rr(0.6, 0.8), off = rr(-0.2, 0.2);
      for (let i = 0; i < n; i++) {
        const a = s0 + i * 1.52, px = bulk.x + (ax ? off : sg * a), pz = bulk.z + (ax ? sg * a : off);
        if (!free(px, pz, ax ? wb : 1.45, ax ? 1.45 : wb, 0.05)) break;
        ob(px + (ax ? rr(-0.03, 0.03) : 0), y + 0.04, pz + (ax ? 0 : rr(-0.03, 0.03)), 1.45, 0.075, wb, ax, mul(wood, rr(0.85, 1.1)), M.PLANKS);
        used.push({ x: px, z: pz, w: ax ? wb : 1.45, d: ax ? 1.45 : wb });
      }
    }

    // =========================================================================================================
    // element builders
    // =========================================================================================================
    const chimney = (o = {}) => {
      const cw = rr(0.7, 1.7), cd = rr(0.5, 0.72), ch = o.ch || rr(1.3, 3.3) * (h < 26 ? 1 : 0.85);
      const e = o.edge || pick(['w', 'e', 'n', 's']); const ax = (e === 'n' || e === 's') ? 0 : 1;
      const p = place(ax ? cd : cw, ax ? cw : cd, { pad: 0.2, edge: e, tries: 6, hgt: ch + 0.9, ...o }); if (!p) return;
      const brick = b.style === 'brick' ? R() < 0.8 : R() < 0.45;
      const col = brick ? mixc(mul(pick(PAL.brick), rr(0.6, 0.95)), [0.16, 0.15, 0.14], rr(0, 0.55)) : mul(mixc(lin(0xb9ad98), pick(PAL.coping), R()), rr(0.6, 1.0));
      const mat = brick ? M.BRICK : M.CONCRETE;
      ob(p.x, y, p.z, cw, ch, cd, ax, col, mat, true);
      ob(p.x, y + ch, p.z, cw + 0.2, 0.11, cd + 0.2, ax, pick(PAL.coping), M.CONCRETE);
      if (lvl === 2) { ob(p.x, y + ch - 0.3, p.z, cw + 0.1, 0.1, cd + 0.1, ax, mul(col, 0.88), mat); ob(p.x, y + 0.03, p.z, cw + 0.16, 0.16, cd + 0.16, ax, DARK, M.FELT); }
      const pots = 1 + Math.floor(R() * Math.min(lvl === 2 ? 4 : 2, cw / 0.36)), pc = pick(PAL.pot);
      for (let k = 0; k < pots; k++) {
        const u = ((k + 0.5) / pots - 0.5) * (cw - 0.3), s = rr(0.85, 1.2);
        if (lvl < 2) K.cyl(p.x + (ax ? 0 : u), y + ch + 0.11, p.z + (ax ? u : 0), 0.1 * s, 0.6 * s * rr(0.7, 1.3), mul(pc, rr(0.7, 1.1)), M.CONCRETE, false);
        else if (R() < 0.82) K.put('pot', p.x + (ax ? 0 : u), y + ch + 0.11, p.z + (ax ? u : 0), R() * 6.28, s, mul(pc, rr(0.7, 1.1)), s * rr(0.7, 1.5));
        else { K.cyl(p.x + (ax ? 0 : u), y + ch + 0.11, p.z + (ax ? u : 0), 0.07, rr(0.5, 0.9), GALV, M.GALV, false); }
      }
      if ((lvl === 2 || o.aerial) && R() < (o.aerial || 0.3) && camOK(p.x, p.z, y + ch + 2.2, 0.8, y)) K.put('aerial', p.x + (ax ? 0.4 : 0), y + ch - 1.0, p.z + (ax ? 0 : 0.4), rr(-0.4, 0.4) + (R() < 0.3 ? 1.57 : 0), rr(0.8, 1.1));
      st.chimneys++;
    };
    const soilStacks = () => {
      const p = place(1.0, 0.5, { pad: 0.15, tries: 6, hgt: 1.7 }); if (!p) return;
      const n = 1 + Math.floor(R() * 3), col = pick(PAL.pipe), mat = R() < 0.5 ? M.GALV : M.PAINT;
      for (let i = 0; i < n; i++) {
        const px = p.x + (i - (n - 1) / 2) * 0.32, rad = rr(0.04, 0.075), hh = rr(0.5, 1.6);
        K.cyl(px, y, p.z, rad, hh, col, mat, false);
        if (lvl === 2) K.cyl(px, y, p.z, rad + 0.06, 0.1, DARK, M.FELT, false);
        const u = R();
        if (u < 0.35) K.cyl(px, y + hh + 0.04, p.z, rad * 2.1, 0.035, col, mat, false);
        else if (u < 0.6) { const sg = R() < 0.5 ? 1 : -1; K.wire([px, y + hh - 0.01, p.z], [px, y + hh + 0.16, p.z + sg * 0.2], rad, col, mat); K.wire([px, y + hh + 0.16, p.z + sg * 0.2], [px, y + hh - 0.02, p.z + sg * 0.4], rad, col, mat); }
      }
    };
    const hatch = (o = {}) => {
      const p = place(1.1, 1.1, { pad: 0.2, tries: 6, hgt: 1.0, ...o }); if (!p) return;
      const s = rr(0.75, 0.95);
      K.box(p.x, y, p.z, s, 0.26, s, lin(0x77797a), R() < 0.5 ? M.CONCRETE : M.GALV, false);
      const lc = R() < 0.5 ? GALV : mul(pick(PAL.pipe), 0.8);
      if (R() < 0.2) K.beam([p.x - s / 2, y + 0.27, p.z], [p.x - s / 2 - 0.25, y + 0.27 + s * 0.9, p.z], s + 0.06, 0.04, lc, M.GALV, false);
      else K.box(p.x, y + 0.26, p.z, s + 0.08, 0.05, s + 0.08, lc, M.GALV, false);
    };
    const skylight = (lantern, o = {}) => {
      const ax = R() < 0.5 ? 1 : 0;
      const len = lantern ? rr(2.4, Math.min(5.5, (ax ? D : W) * 0.4)) : rr(1.1, 2.6), wid = lantern ? rr(1.4, 2.2) : rr(0.8, 1.5);
      const curb = lantern ? rr(0.45, 0.7) : rr(0.2, 0.32), gh = lantern ? rr(0.45, 0.8) : rr(0.1, 0.2);
      const p = place(ax ? wid + 0.4 : len + 0.4, ax ? len + 0.4 : wid + 0.4, { hgt: curb + gh, ...o }); if (!p) return;
      ob(p.x, y, p.z, len, curb, wid, ax, lantern ? mul(pick(PAL.furn), 1.2) : lin(0x77797a), lantern ? M.PAINT : (R() < 0.5 ? M.GALV : M.CONCRETE));
      ob(p.x, y + 0.03, p.z, len + 0.14, 0.12, wid + 0.14, ax, DARK, M.FELT);
      const lit = film < 0 && R() < (aerial ? 0.65 : 0.34);
      K.skylight(p.x, y + curb, p.z, len - 0.1, gh, wid - 0.1, ax ? Math.PI / 2 : 0, lit ? null : [0.62, 0.64, 0.66]);
      st.skylights++;
    };
    const acOnFrame = () => {
      const ax = R() < 0.5 ? 1 : 0; const p = place(ax ? 1.5 : 2.0, ax ? 2.0 : 1.5, { hgt: 2.1 }); if (!p) return;
      const fh = rr(0.4, 0.95), s = rr(0.9, 1.15);
      for (const [a, c] of [[-0.62, -0.4], [0.62, -0.4], [0.62, 0.4], [-0.62, 0.4]]) K.box(p.x + (ax ? c : a), y, p.z + (ax ? a : c), 0.06, fh, 0.06, IRON, M.IRON, false);
      for (const c of [-0.4, 0.4]) ob(p.x + (ax ? c : 0), y + fh - 0.06, p.z + (ax ? 0 : c), 1.45, 0.06, 0.06, ax, IRON, M.IRON);
      if (lvl === 2) K.beam([p.x + (ax ? 0.4 : -0.62), y + 0.05, p.z + (ax ? -0.62 : 0.4)], [p.x + (ax ? 0.4 : 0.62), y + fh - 0.08, p.z + (ax ? 0.62 : 0.4)], 0.035, 0.035, IRON, M.IRON, false);
      K.put('acSmall', p.x, y + fh, p.z, ax ? Math.PI / 2 : 0, s, mul(pick(PAL.unit), rr(0.6, 0.95)));
      K.box(p.x + rr(-0.3, 0.3), y + 0.045, p.z + rr(-0.3, 0.3), rr(1.0, 1.8), 0.012, rr(0.9, 1.6), [0.03, 0.028, 0.024], M.FELT, false);      // drip stain
    };
    const duct = () => {
      const ax = R() < 0.5 ? 1 : 0, len = rr(3.5, Math.min(11, (ax ? D : W) * 0.6));
      const p = place(ax ? 1.2 : len + 1.2, ax ? len + 1.2 : 1.2, { hgt: 1.5 }); if (!p) return;
      const sw = rr(0.5, 0.75), sh = rr(0.4, 0.55), y0 = y + rr(0.4, 0.6), col = mul(GALV, rr(0.8, 1.05));
      ob(p.x, y0, p.z, len, sh, sw, ax, col, M.GALV, true);
      const nf = Math.round(len / 1.25);
      for (let i = 1; i < nf; i++) { const o = -len / 2 + i * len / nf; ob(p.x + (ax ? 0 : o), y0 - 0.02, p.z + (ax ? o : 0), 0.05, sh + 0.04, sw + 0.05, ax, col, M.GALV); }
      const nsup = Math.max(2, Math.round(len / 2.4));
      for (let i = 0; i < nsup; i++) { const o = -len / 2 + (i + 0.5) * len / nsup; ob(p.x + (ax ? 0 : o), y, p.z + (ax ? o : 0), 0.08, y0 - y, sw + 0.2, ax, IRON, M.IRON); }
      const e0 = -len / 2 - 0.02, e1 = len / 2 + 0.25;
      ob(p.x + (ax ? 0 : e0), y, p.z + (ax ? e0 : 0), sw, y0 - y + sh, sw, ax, col, M.GALV, true);                 // drop into the roof
      ob(p.x + (ax ? 0 : e1), y, p.z + (ax ? e1 : 0), 0.95, y0 - y + sh + 0.5, sw + 0.3, ax, mul(pick(PAL.unit), 0.85), M.LOUVER, true);   // fan box
      ob(p.x + (ax ? 0 : e1), y + y0 - y + sh + 0.5, p.z + (ax ? e1 : 0), 1.05, 0.06, sw + 0.4, ax, col, M.GALV);
    };
    const cableTray = () => {
      if (!bulk) return;
      const dirs = [[1, 0, X1 - (bulk.x + bulk.sx / 2)], [-1, 0, bulk.x - bulk.sx / 2 - X0], [0, 1, Z1 - (bulk.z + bulk.sz / 2)], [0, -1, bulk.z - bulk.sz / 2 - Z0]].filter(q => q[2] > 2.5);
      if (!dirs.length) return;
      const [ux, uz, lmax] = pick(dirs); const ax = uz ? 1 : 0; const len = Math.min(lmax - 0.1, rr(3, 12));
      const off = rr(-0.3, 0.3) * (ax ? bulk.sx : bulk.sz);
      const mx = bulk.x + ux * (bulk.sx / 2 + len / 2) + (ax ? off : 0), mz = bulk.z + uz * (bulk.sz / 2 + len / 2) + (ax ? 0 : off);
      if (!free(mx, mz, ax ? 0.35 : len - 0.2, ax ? len - 0.2 : 0.35, 0.05) || !camOK(mx, mz, y + 0.3, len / 2, y)) return;
      used.push({ x: mx, z: mz, w: ax ? 0.35 : len, d: ax ? len : 0.35 });
      ob(mx, y + 0.17, mz, len, 0.045, 0.24, ax, mul(GALV, 0.9), M.GALV);
      const pc = pick(PAL.pipe);
      for (const o of [-0.06, 0.07]) { const a = [mx - (ax ? -o : len / 2), y + 0.24, mz - (ax ? len / 2 : -o)], c = [mx + (ax ? o : len / 2), y + 0.24, mz + (ax ? len / 2 : o)]; K.wire(a, c, 0.022 + 0.01 * (o > 0 ? 1 : 0), o > 0.05 ? pc : DARK, M.PAINT); }
      const nb = Math.max(2, Math.round(len / 1.6));
      for (let i = 0; i < nb; i++) { const o = -len / 2 + (i + 0.5) * len / nb; ob(mx + (ax ? 0 : o), y + 0.03, mz + (ax ? o : 0), 0.18, 0.14, 0.34, ax, lin(0x666663), M.CONCRETE); }
    };
    const wallConduit = () => {
      const side = Math.floor(R() * 4), ax = side < 2 ? 1 : 0;          // 0 west, 1 east, 2 north, 3 south wall
      const a0 = (ax ? Z0 : X0) + rr(0.3, 0.3 * (ax ? D : W)), a1 = (ax ? Z1 : X1) - rr(0.3, 0.3 * (ax ? D : W)); if (a1 - a0 < 2) return;
      const c = side === 0 ? X0 - 0.045 : side === 1 ? X1 + 0.045 : side === 2 ? Z0 - 0.045 : Z1 + 0.045, inw = (side === 0 || side === 2) ? 1 : -1;
      for (let i = 0; i <= 4; i++) { const a = a0 + (a1 - a0) * i / 4; if (!camOK(ax ? c : a, ax ? a : c, y + 1.0, 0, y)) return; }
      const n = 1 + Math.floor(R() * 3), col = pick(PAL.pipe), mat = R() < 0.5 ? M.GALV : M.PAINT, y0 = y + rr(0.45, 0.85);
      for (let k = 0; k < n; k++) {
        const yy = y0 + k * 0.11, rad = 0.02 + 0.012 * ((k + (b.seed & 1)) % 2), q = c + inw * (rad + 0.012);
        K.wire(ax ? [q, yy, a0] : [a0, yy, q], ax ? [q, yy, a1] : [a1, yy, q], rad * 1.15, col, mat);
      }
      const q = c + inw * 0.035;
      K.wire([ax ? q : a1, y, ax ? a1 : q], [ax ? q : a1, y0 + 0.02, ax ? a1 : q], 0.032, col, mat);
      const jb = a0 + (a1 - a0) * rr(0.2, 0.8);
      ob(ax ? c + inw * 0.06 : jb, y0 - 0.12, ax ? jb : c + inw * 0.06, 0.3, 0.36, 0.11, ax ? 1 : 0, mul(pick(PAL.unit), 0.8), M.PAINT);
    };
    const aerialsOnBulk = () => {
      if (!bulk) return;
      const n = 1 + Math.floor(R() * 2);
      for (let i = 0; i < n; i++) {
        const px = bulk.x + rr(-0.4, 0.4) * bulk.sx, pz = bulk.z + rr(-0.4, 0.4) * bulk.sz;
        if (!camOK(px, pz, bulk.top + 3.3, 0.8, y)) continue;
        if (R() < 0.3 && Math.min(bulk.sx, bulk.sz) > 2.4) K.put('whip', bulk.x, bulk.top, bulk.z, R() * 6.28, Math.min(bulk.sx, bulk.sz) / 2.7 * rr(0.85, 1.0), null, rr(0.8, 1.1));
        else K.put('aerial', px, bulk.top, pz, rr(-0.5, 0.5) + (R() < 0.3 ? 1.57 : 0), rr(0.8, 1.25));
      }
    };
    const whipOnRoof = () => {
      const p = place(2.7, 2.7, { pad: 0.05, tries: 8, hgt: 6 }); if (!p) return;
      K.put('whip', p.x, y, p.z, R() * 6.28, rr(0.9, 1.15));
      used[used.length - 1].w = used[used.length - 1].d = 0.6;          // only the foot blocks other things
    };
    const washing = (o = {}) => {
      const ax = o.ax != null ? o.ax : (R() < 0.5 ? 1 : 0), len = o.len || rr(3.6, Math.min(8, (ax ? D : W) * 0.55));
      const p = place(ax ? 1.7 : len + 0.5, ax ? len + 0.5 : 1.7, { pad: 0.35, tries: 10, hgt: 2.1, ...o }); if (!p) return;
      const pc = mul(pick(PAL.furn), 1.1), nl = 3 + Math.floor(R() * 2), yT = y + rr(1.85, 2.05);
      for (const sg of [-1, 1]) {
        const px = p.x + (ax ? 0 : sg * len / 2), pz = p.z + (ax ? sg * len / 2 : 0);
        K.cyl(px, y, pz, 0.035, yT - y, pc, M.PAINT, false);
        ob(px, yT - 0.05, pz, 0.05, 0.05, 1.3, ax, pc, M.PAINT);
        K.box(px, y, pz, 0.3, 0.1, 0.3, lin(0x666663), M.CONCRETE, false);
        const q = sg * 0.6; K.wire(ax ? [px, y + 0.05, pz - q] : [px - q, y + 0.05, pz], [px, y + 1.1, pz], 0.02, pc, M.PAINT);
      }
      const offs = nl === 3 ? [-0.5, 0, 0.5] : [-0.57, -0.19, 0.19, 0.57];
      for (const o of offs) K.wire(ax ? [p.x + o, yT - 0.01, p.z - len / 2] : [p.x - len / 2, yT - 0.01, p.z + o], ax ? [p.x + o, yT - 0.01, p.z + len / 2] : [p.x + len / 2, yT - 0.01, p.z + o], 0.0075, [0.42, 0.42, 0.4], M.PAINT);
      st.lines++;
      if (R() < 0.55 || o.sheets) {
        const ns = o.sheets || 1 + Math.floor(R() * 3); let t = rr(-0.38, -0.1) * len;
        for (let i = 0; i < ns; i++) {
          const sw = rr(1.1, 2.0), sh = rr(0.85, 1.45), o = pick(offs); t += sw / 2;
          if (t + sw / 2 > len / 2 - 0.2) break;
          K.putM('sheet', TRS(p.x + (ax ? o : t), yT - 0.012, p.z + (ax ? t : o), (ax ? Math.PI / 2 : 0) + (R() < 0.5 ? Math.PI : 0), sw, sh, rr(0.7, 1.5)), mul(pick(PAL.cloth), rr(0.85, 1.05)));
          t += sw / 2 + rr(0.1, 0.5); st.sheets++;
        }
      }
    };
    const pottedPlant = (px, pz) => {
      if (!free(px, pz, 0.5, 0.5, 0.02) || !camOK(px, pz, y + 1.3, 0.3, y)) return;
      const rp = rr(0.15, 0.3), hp = rr(0.25, 0.45), s = rr(0.45, 0.85) * (rp / 0.22);
      K.cyl(px, y, pz, rp, hp, mul(pick(PAL.pot), rr(0.7, 1.1)), M.CONCRETE, false);
      K.put('shrub', px, y + hp - 0.07 * s, pz, R() * 6.28, Math.min(0.9, s), leafCol(), Math.min(1.1, s * rr(0.9, 1.5)));
      used.push({ x: px, z: pz, w: 0.5, d: 0.5 });
    };
    const bench = (px, pz, ax, len) => {
      const wood = mul(pick(PAL.wood), rr(0.7, 1.05));
      for (const sg of [-1, 1]) ob(px + (ax ? 0 : sg * (len / 2 - 0.12)), y, pz + (ax ? sg * (len / 2 - 0.12) : 0), 0.06, 0.42, 0.36, ax, IRON, M.IRON);
      ob(px, y + 0.42, pz, len, 0.04, 0.4, ax, wood, M.PLANKS);
      ob(px + (ax ? -0.2 : 0), y + 0.6, pz + (ax ? 0 : -0.2), len, 0.26, 0.035, ax, wood, M.PLANKS);
      for (const sg of [-1, 1]) ob(px + (ax ? -0.2 : sg * (len / 2 - 0.12)), y + 0.42, pz + (ax ? sg * (len / 2 - 0.12) : -0.2), 0.05, 0.4, 0.04, ax, IRON, M.IRON);
    };
    const stringLights = (x0, z0, x1, z1) => {
      if (!camOK((x0 + x1) / 2, (z0 + z1) / 2, y + 2.6, Math.hypot(x1 - x0, z1 - z0) / 2 + 3, y)) return;
      const H = 2.5, sag = 0.4, len = Math.hypot(x1 - x0, z1 - z0), nb = Math.max(4, Math.round(len / 0.6));
      K.cyl(x0, y, z0, 0.03, H, IRON, M.IRON, false); K.cyl(x1, y, z1, 0.03, H, IRON, M.IRON, false);
      const P = u => [x0 + (x1 - x0) * u, y + H - 0.03 - sag * 4 * u * (1 - u), z0 + (z1 - z0) * u];
      for (let i = 0; i < 5; i++) K.wire(P(i / 5), P((i + 1) / 5), 0.0075, DARK, M.IRON);
      const warm = [9, 5.4, 2.2];
      for (let i = 0; i < nb; i++) { const q = P((i + 0.5) / nb); K.sprites.lamp(q[0], q[1] - 0.06, q[2], 0.045, mul(warm, rr(0.7, 1.1)), { minPx: 1.0 }); }
      K.sprites.pool((x0 + x1) / 2, y + 0.1, (z0 + z1) / 2, [len * 0.5 + 1.2, 0, 0], [0, 0, len * 0.5 + 1.2], [0.085, 0.05, 0.02]);
      st.lights++;
    };
    const sittingCorner = (o = {}) => {
      const w = rr(3.4, 4.6), d = rr(2.8, 3.6); const p = place(w, d, { pad: 0.3, tries: 10, hgt: 1.0, ...o }); if (!p) return false;
      const deck = R() < 0.6;
      if (deck) K.box(p.x, y + 0.04, p.z, w - 0.3, 0.07, d - 0.3, mul(pick(PAL.wood), rr(0.6, 0.9)), M.PLANKS, false);
      if (lvl === 2 || R() < 0.25) K.put('bistro', p.x + rr(-0.5, 0.3), y + (deck ? 0.11 : 0.045), p.z + rr(-0.3, 0.3), R() * 6.28, 1, mul(pick(PAL.furn), rr(0.8, 1.3)));
      if (R() < 0.6) bench(p.x + w / 2 - 0.45, p.z, 1, Math.min(1.7, d - 0.8));
      used.pop();                                                        // let the pots stand inside the corner
      const n = 2 + Math.floor(R() * 4);
      for (let i = 0; i < n; i++) { const a = R() * 6.28; pottedPlant(p.x + Math.cos(a) * (w / 2 - 0.3) * rr(0.8, 1), p.z + Math.sin(a) * (d / 2 - 0.3) * rr(0.8, 1)); }
      if (R() < 0.5) { const s = rr(0.4, 0.55); K.box(p.x - w / 2 + 0.5, y + 0.11, p.z + d / 2 - 0.5, s, s * 0.75, s, mul(pick(PAL.wood), 0.9), M.PLANKS, false); }
      used.push({ x: p.x, z: p.z, w, d });
      if (R() < 0.55) stringLights(p.x - w / 2 + 0.1, p.z - d / 2 + 0.1, p.x + w / 2 - 0.1, p.z + d / 2 - 0.1);
      st.seats++;
      return true;
    };
    const planterBox = (o = {}) => {
      const ax = R() < 0.5 ? 1 : 0, len = rr(1.4, 2.6), ph = rr(0.38, 0.55);
      const p = place(ax ? 0.7 : len + 0.1, ax ? len + 0.1 : 0.7, { pad: 0.15, tries: 6, hgt: 1.38, ...o }); if (!p) return;
      ob(p.x, y, p.z, len, ph, 0.58, ax, pick(PAL.planter), R() < 0.5 ? M.CONCRETE : M.PLANKS);
      ob(p.x, y + ph - 0.03, p.z, len - 0.12, 0.05, 0.46, ax, [1, 1, 1], M.SOIL);
      const n = Math.max(1, Math.round(len / 0.8));
      for (let i = 0; i < n; i++) { const u = ((i + 0.5) / n - 0.5) * (len - 0.4), s = rr(0.6, 0.95); K.put('shrub', p.x + (ax ? 0 : u), y + ph - 0.1, p.z + (ax ? u : 0), R() * 6.28, s, leafCol(), Math.min(0.9, s * rr(0.8, 1.4))); }
    };
    const junk = (o = {}) => {
      const p = place(1.8, 1.4, { pad: 0.15, tries: 6, hgt: 1.0, ...o }); if (!p) return;
      const n = 2 + Math.floor(R() * 3);
      for (let i = 0; i < n; i++) {
        const px = p.x + rr(-0.6, 0.6), pz = p.z + rr(-0.4, 0.4), u = R();
        if (u < 0.35) K.cyl(px, y, pz, rr(0.26, 0.3), rr(0.8, 0.9), mul(pick(PAL.pipe), rr(0.6, 1.0)), M.PAINT, false);                  // drum
        else if (u < 0.7) { const s = rr(0.35, 0.6); K.box(px, y + 0.04, pz, s, s * rr(0.6, 0.9), s * rr(0.7, 1.2), mul(pick(PAL.wood), rr(0.7, 1.1)), M.PLANKS, false); }   // crate
        else K.box(px, y + 0.04, pz, rr(0.9, 1.2), 0.13, rr(0.8, 1.0), mul(pick(PAL.wood), 0.8), M.PLANKS, false);                       // pallet
      }
    };
    const workLight = () => {
      if (!bulk) return;
      const sx = R() < 0.5 ? 1 : -1, sz = R() < 0.5 ? 1 : -1;
      const lx = bulk.x + sx * (bulk.sx / 2 + 0.12), lz = bulk.z + sz * (bulk.sz / 2 + 0.12), ly = y + Math.min(bulk.h - 0.3, 2.5);
      if (!camOK(lx, lz, ly, 9, y)) return;
      const warm = R() < 0.72 ? [1.0, 0.58, 0.25] : [0.7, 0.92, 0.86];
      K.box(lx - sx * 0.06, ly + 0.02, lz - sz * 0.06, 0.12, 0.1, 0.12, DARK, M.IRON, false);
      K.sprites.lamp(lx, ly - 0.05, lz, 0.1, mul(warm, 20), { minPx: 1.1 });
      const pr = aerial ? 3.8 : 2.7;
      K.sprites.pool(lx + sx * pr * 0.48, y + 0.095, lz + sz * pr * 0.48, [pr, 0, 0], [0, 0, pr], mul(warm, aerial ? 0.15 : 0.115));
      st.lights++;
    };
    const penthouse = () => {
      const ax = W > D ? 0 : 1;
      const pw = Math.min((ax ? D : W) * 0.42, rr(5, 11)), pd = Math.min((ax ? W : D) * 0.4, rr(3.5, 6.5)), ph = rr(3.2, 4.8);
      const p = place(ax ? pd + 0.6 : pw + 0.6, ax ? pw + 0.6 : pd + 0.6, { pad: 0.25, tries: 40, hgt: ph + 2 }); if (!p) return;
      const col = mul(lin(pick([0x9a9a96, 0x8c8d8b, 0xa6a49e, 0x7f8588])), rr(0.8, 1.05));
      ob(p.x, y, p.z, pw, ph, pd, ax, col, R() < 0.5 ? M.CONCRETE : M.PAINT, true);
      ob(p.x, y + ph, p.z, pw + 0.4, 0.2, pd + 0.4, ax, mul(baseFelt, 1.2), M.FELT, true);
      const lc = mul(pick(PAL.unit), 0.8), lh = ph * rr(0.35, 0.5), lw = pw * rr(0.55, 0.8), ly = y + ph * 0.3;
      for (const sg of [-1, 1]) ob(p.x + (ax ? sg * (pd / 2 + 0.03) : 0), ly, p.z + (ax ? 0 : sg * (pd / 2 + 0.03)), lw, lh, 0.07, ax, lc, M.LOUVER);
      // door + lamp on one gable end
      const eg = R() < 0.5 ? 1 : -1, ex = p.x + (ax ? 0 : eg * (pw / 2 + 0.03)), ez = p.z + (ax ? eg * (pw / 2 + 0.03) : 0);
      ob(ex, y + 0.08, ez, 0.07, 2.05, 1.0, ax, lin(pick([0x2f4a3a, 0x3a4350, 0x5a2a22, 0x6b6558])), M.PAINT);
      if (R() < (aerial ? 0.75 : 0.4)) {
        const ox = ax ? 0 : eg, oz = ax ? eg : 0, warm = R() < 0.7 ? [1.0, 0.58, 0.25] : [0.75, 0.9, 1.0];
        K.sprites.lamp(ex + ox * 0.16, y + 2.45, ez + oz * 0.16, 0.11, mul(warm, 24), { minPx: 1.1 });
        K.sprites.pool(ex + ox * 0.05, y + 1.45, ez + oz * 0.05, [oz * 1.9, 0, ox * 1.9], [0, 1.5, 0], mul(warm, 0.2));
        K.sprites.pool(ex + ox * 1.6, y + 0.095, ez + oz * 1.6, [2.8, 0, 0], [0, 0, 2.8], mul(warm, 0.13));
        st.lights++;
      }
      // exhaust stacks + plant on the penthouse roof
      const ns = 1 + Math.floor(R() * 3);
      for (let i = 0; i < ns; i++) {
        const u = rr(-0.38, 0.38) * pw, v = rr(-0.25, 0.25) * pd, rad = rr(0.28, 0.5), sh = rr(1.0, 2.4);
        const sx_ = p.x + (ax ? v : u), sz_ = p.z + (ax ? u : v);
        K.cyl(sx_, y + ph + 0.2, sz_, rad, sh, mul(GALV, rr(0.7, 1.0)), M.GALV, true);
        K.cyl(sx_, y + ph + 0.2 + sh + 0.12, sz_, rad * 1.5, 0.06, GALV, M.GALV, false);
        for (let k = 0; k < 3; k++) { const a = k * 2.09; K.box(sx_ + Math.cos(a) * rad, y + ph + 0.2 + sh, sz_ + Math.sin(a) * rad, 0.03, 0.13, 0.03, IRON, M.IRON, false); }
      }
      K.put('ladder', p.x + (ax ? pd / 2 : rr(-0.3, 0.3) * pw), y, p.z + (ax ? rr(-0.3, 0.3) * pw : pd / 2), ax ? 0 : -Math.PI / 2, 1, null, ph / 3.0);
      st.penthouses++;
    };

    // =========================================================================================================
    // what goes on this roof
    // =========================================================================================================
    const k = lvl === 2 ? 1.5 : 0.36;                                      // density
    const chance = pr => R() < pr * (lvl === 2 ? 1 : 0.5);
    const times = (a, c) => Math.round(rr(a, c) * k * Math.min(1.5, Math.sqrt(A) / 16));

    // ---- the roofs the film stands on: composed, low dressing inside the frame, silhouettes where the sky is
    if (film === 0) {
      // shot 7 looks west over this roof's far parapet into the sunset: stacks, pots, an aerial and washing against the sky
      chimney({ edge: 'w', box: [0, 0, Z0 + 1.2, Z0 + 5.5], ch: 2.7, aerial: 1 });
      chimney({ edge: 'w', box: [0, 0, Z0 + 8.5, Z0 + 13.5], ch: 1.9 });
      washing({ ax: 1, len: 5.2, sheets: 2, box: [X0 + 3.2, X0 + 9.5, Z0 + 4, Z0 + 12.5] });
      soilStacks(); hatch({ box: [X0 + 2, X0 + 12, Z0 + 2, Z1 - 2] }); junk({ box: [X0 + 1.5, X0 + 10, Z0 + 1.5, Z1 - 1.5] });
    } else if (film > 0) {
      // shots 14 / 20: the terrace seen across its whole depth at dusk; everything stays below eye level
      sittingCorner({ box: [X0 + 10.5, X0 + 17, Z0 + 5, Z1 - 5.5] });
      { const bx = X1 - 0.5, bz = Z0 + rr(4.5, 9); if (free(bx, bz, 0.9, 2.0, 0.1) && camOK(bx, bz, y + 0.95, 1, y)) { bench(bx + 0.2, bz, 1, 1.7); used.push({ x: bx, z: bz, w: 0.9, d: 2.0 }); } }
      for (let i = 0; i < 3; i++) planterBox({ box: [X0 + 9, X1 - 1.2, Z0 + 1, Z1 - 1] });
      for (let i = 0; i < 2; i++) junk({ box: [X0 + 9, X1 - 1.5, Z0 + 1.2, Z1 - 1.2] });
      hatch({ box: [X0 + 9, X1 - 2, Z0 + 2, Z1 - 2] }); skylight(false, { box: [X0 + 10, X1 - 3, Z0 + 2, Z1 - 2] });
      for (let i = 0; i < 5; i++) pottedPlant(X0 + rr(9, W - 1), Z0 + rr(1, D - 1));
    }

    if (tall) {
      if (A > 300 && R() < 0.7) penthouse();
      for (let i = times(0, 2); i > 0; i--) hatch();
      if (R() < 0.6) cableTray();
      if (A > 400 && R() < 0.5) duct();
      if (aerial && R() < 0.7) skylight(R() < 0.5);
      if (R() < (aerial ? 0.85 : 0.25)) workLight();
      continue;
    }
    const g = gardenById.get(b.id);
    if (g) {
      // furniture on the existing timber deck (pergola sits at the low-x / low-z end)
      const fx = g.x + (g.w > g.d ? g.w * 0.22 : 0), fz = g.z + (g.w > g.d ? 0 : g.d * 0.22);
      if (camOK(fx, fz, y + 1.05, 1.2, y)) K.put('bistro', fx, y + 0.1, fz, R() * 6.28, 1, mul(pick(PAL.furn), rr(0.8, 1.3)));
    }
    if (low && masonry) {
      // ---- old low roofs: dense, domestic
      const quay = b.district === 'quay';
      if (quay) {          // the waterfront skyline (seen from the bay): tall stacks on the bay side, aerial poles
        for (let i = 1 + Math.floor(R() * 2); i > 0; i--) chimney({ edge: 'w', ch: rr(2.4, 3.8), aerial: 0.5, tries: 12 });
        if (R() < 0.5 && A > 100) whipOnRoof();
        if (R() < 0.8) aerialsOnBulk();
      }
      for (let i = Math.round(times(1, 3.4) * (lvl === 2 ? 0.6 : 1)) + (old ? 1 : 0); i > 0; i--) chimney();
      if (lvl === 2 && R() < 0.5 && A > 110) sittingCorner();
      if (lvl === 2 && A > 420 && R() < 0.5) sittingCorner();
      if (chance(0.65) && A > 80) washing();
      if (lvl === 2 && A > 380 && R() < 0.4) washing();
      if (chance(0.28) && A > 150) { const p = place(3.4, 2.8, { pad: 0.4, hgt: 3.1 }); if (p) { K.put('loft', p.x, y, p.z, Math.floor(R() * 4) * Math.PI / 2 + rr(-0.08, 0.08), rr(0.9, 1.08), mixc(pick(PAL.wood), [0.6, 0.62, 0.6], R() * 0.7)); st.lofts++; } }
      if (lvl === 2) for (let i = times(0.6, 2.4); i > 0; i--) soilStacks();
      if (lvl === 2) for (let i = times(0.4, 1.8); i > 0; i--) hatch();
      if (chance(0.7) && A > 100) skylight(R() < 0.6);
      if (chance(0.45) && A > 160) skylight(R() < 0.3);
      if (aerial && R() < 0.6) skylight(false);
      if (chance(0.7)) aerialsOnBulk();
      if (chance(0.22) && A > 120) whipOnRoof();
      if (lvl === 2) {
        for (let i = times(0.2, 1.3); i > 0; i--) acOnFrame();
        if (R() < 0.45) planterBox();
        for (let i = times(0.3, 1.5); i > 0; i--) junk();
        for (let i = times(0.5, 2.2); i > 0; i--) wallConduit();
        if (R() < 0.35) cableTray();
      }
      if (aerial ? R() < 0.6 : chance(0.22)) workLight();
    } else {
      // ---- mid-rise / modern roofs: services
      if (chance(0.55) && A > 200) duct();
      if (chance(0.3) && A > 500) duct();
      if (lvl === 2) {
        for (let i = times(0.6, 3); i > 0; i--) acOnFrame();
        if (R() < 0.7) cableTray();
        for (let i = times(0.5, 2); i > 0; i--) hatch();
        for (let i = times(0.4, 1.6); i > 0; i--) soilStacks();
      } else if (R() < 0.35) acOnFrame();
      if (chance(0.35) && A > 150 && h < 80) skylight(false);
      if (aerial && R() < 0.6) skylight(false);
      if (masonry && chance(0.4)) chimney();
      if (chance(0.4)) aerialsOnBulk();
      if (chance(0.15) && A > 150) whipOnRoof();
      if (lvl === 2 && R() < 0.3) junk();
      if (lvl === 2) for (let i = times(0.3, 1.8); i > 0; i--) wallConduit();
      if (low && chance(0.25)) washing();
      if (aerial ? R() < 0.6 : chance(0.2)) workLight();
    }
  }
  return st;
}
