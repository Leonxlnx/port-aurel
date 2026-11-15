// Per-building roof dressing: finish layer, parapets, terraces and the equipment kit.
// Everything is derived from ctx.layout.buildings (tiers) + the building seed.
import { mulberry32 } from '../layout.js';
import { lin, mul, mixc } from './kit.js';
import { M } from './materials.js';

const hexes = a => a.map(lin);
const PAL = {
  brick: hexes([0x8a4a3a, 0x7a3f33, 0x9b5a44, 0x6e3b30, 0xa4674e, 0x8d5b45, 0xb08968]),
  stone: hexes([0xb7ab98, 0xa89e8c, 0xc2b8a6, 0x9c958a]),
  stucco: hexes([0xd2c3a8, 0xc9b59a, 0xd8cbb5, 0xc4a88e, 0xb9c0b6]),
  concrete: hexes([0x9a9a96, 0x8c8d8b, 0xa6a49e]),
  deco: hexes([0xc8bca6, 0xb9ad98, 0xcfc4b0]),
  glass: hexes([0x3a4046, 0x4a4f52]),
  coping: hexes([0xb5b0a5, 0xa9a295, 0xc0bbb0, 0x9d978c]),
  door: hexes([0x2f4a3a, 0x5a2a22, 0x3a4350, 0x6b6558, 0x24313f, 0x7a3b24]),
  unit: hexes([0xc9c6bc, 0xb9b2a0, 0xa7abad, 0x8f989b, 0xd4d0c4, 0x9aa39a]),
  pipe: hexes([0x8a3a22, 0xb08a2e, 0x9a9da0, 0x556a5a, 0x7a2f24]),
  pot: hexes([0xa8563a, 0x94482f, 0xb5674a]),
  planter: hexes([0x9a958c, 0xa8593c, 0x6b5a48, 0x8c8a84]),
  leaf: [[0.55, 0.62, 0.5], [0.7, 0.66, 0.45], [0.5, 0.6, 0.55], [0.75, 0.6, 0.5], [0.6, 0.7, 0.42]],
};
const pick = (R, a) => a[Math.floor(R() * a.length) % a.length];
const rr = (R, a, b) => a + (b - a) * R();

function makePlacer(x0, x1, z0, z1, R) {
  const used = [];
  const free = (cx, cz, w, d, pad) => used.every(u => Math.abs(cx - u.x) > (w + u.w) / 2 + pad || Math.abs(cz - u.z) > (d + u.d) / 2 + pad);
  return {
    x0, x1, z0, z1, used, w: x1 - x0, d: z1 - z0,
    place(w, d, { pad = 0.5, tries = 14, edge = null } = {}) {
      if (w > x1 - x0 || d > z1 - z0) return null;
      for (let i = 0; i < tries; i++) {
        let cx = x0 + w / 2 + R() * (x1 - x0 - w), cz = z0 + d / 2 + R() * (z1 - z0 - d);
        if (edge === 'w') cx = x0 + w / 2; else if (edge === 'e') cx = x1 - w / 2; else if (edge === 'n') cz = z0 + d / 2; else if (edge === 's') cz = z1 - d / 2;
        if (free(cx, cz, w, d, pad)) { used.push({ x: cx, z: cz, w, d }); return { x: cx, z: cz }; }
      }
      return null;
    },
    reserve(cx, cz, w, d) { used.push({ x: cx, z: cz, w, d }); },
  };
}

/** detail level: 2 = film zone (full kit), 1 = far districts (reduced) */
function detailOf(b) {
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  if (b.district === 'east') return 1;
  if (cx > 800 || cz < -520 || cz > 640) return 1;
  return 2;
}

function wallLook(b, R) {
  const st = b.style;
  if (st === 'brick') return { mat: M.BRICK, color: pick(R, PAL.brick), coping: pick(R, PAL.coping), copMat: M.CONCRETE };
  if (st === 'stone') { const c = pick(R, PAL.stone); return { mat: M.ASHLAR, color: c, coping: mul(c, 1.08), copMat: M.CONCRETE }; }
  if (st === 'stucco') { const c = pick(R, PAL.stucco); return { mat: M.CONCRETE, color: c, coping: pick(R, PAL.coping), copMat: M.CONCRETE }; }
  if (st === 'deco') { const c = pick(R, PAL.deco); return { mat: M.ASHLAR, color: c, coping: mul(c, 1.1), copMat: M.CONCRETE }; }
  if (st === 'glass') { const c = pick(R, PAL.glass); return { mat: M.PAINT, color: c, coping: mul(c, 1.3), copMat: M.GALV }; }
  const c = pick(R, PAL.concrete); return { mat: M.CONCRETE, color: c, coping: mul(c, 1.1), copMat: M.CONCRETE };
}

function roofType(b, R, top) {
  const u = R();
  if (!top) return b.style === 'glass' ? 3 : (u < 0.6 ? 4 : (u < 0.85 ? 3 : 1));
  if (b.district === 'quay' || b.district === 'old') return u < 0.42 ? 0 : (u < 0.68 ? 5 : (u < 0.9 ? 1 : 3));
  if (b.style === 'brick' || b.style === 'stone' || b.style === 'stucco') return u < 0.38 ? 0 : (u < 0.72 ? 1 : (u < 0.87 ? 2 : 5));
  return u < 0.42 ? 2 : (u < 0.7 ? 1 : (u < 0.9 ? 3 : 0));
}

export function populate(ctx, K, plan) {
  const L = ctx.layout, GY = ctx.GROUND_Y;
  const out = { tanks: [], bulkheads: [], gardens: [], coolers: [], tallTops: [], roofs: new Map(), masts: [] };
  // Soft dependency on the buildings module (never for positions): it already builds 1.3 m parapet slabs
  // (0.10 m proud of the wall, 0.42 m deep) on every tier, and gives some low-rises a real pitched roof that must stay bare.
  const BM = ctx.modules && ctx.modules.buildings;
  const pitched = plan.pitched || new Set();
  const ownParapets = !BM;
  const PIN = 0.42, POUT = 0.10, HP = 1.3;
  out.parapetH = HP;
  const heroId = new Map();                                 // roofs that must be interesting (planned by the entry file)
  if (plan.heroGarden) heroId.set(plan.heroGarden.id, 'garden');

  for (const b of L.buildings) {
    const R = mulberry32((b.seed ^ 0x5bd1e995) >>> 0);
    const lod = detailOf(b);
    const look = wallLook(b, R);
    const isLantern = b.landmark === 'lantern';
    const nT = b.tiers.length;
    const tp = PIN;
    for (let ti = 0; ti < nT; ti++) {
      const t = b.tiers[ti]; const top = ti === nT - 1;
      const x0 = b.x0 + t.inset, x1 = b.x1 - t.inset, z0 = b.z0 + t.inset, z1 = b.z1 - t.inset;
      if (x1 - x0 < 3 || z1 - z0 < 3) continue;
      if (top && pitched.has(b.id)) continue;                    // real pitched roof: nothing of ours belongs on it
      const y = GY + t.y1;
      const rt = isLantern ? 4 : roofType(b, R, top);
      K.roof(x0 + 0.02, x1 - 0.02, z0 + 0.02, z1 - 0.02, y + 0.04, rt, R() * 10);
      // ---- parapet + coping (only when the buildings module is absent; same dimensions as its slabs)
      const hp = isLantern ? 1.45 : HP;
      if (ownParapets) {
        const W = x1 - x0, D = z1 - z0, th = PIN + POUT, c = (PIN - POUT) / 2;
        K.box((x0 + x1) / 2, y, z0 + c, W + 2 * POUT, hp, th, look.color, look.mat, true);
        K.box((x0 + x1) / 2, y, z1 - c, W + 2 * POUT, hp, th, look.color, look.mat, true);
        K.box(x0 + c, y, (z0 + z1) / 2, th, hp, D - 2 * PIN, look.color, look.mat, true);
        K.box(x1 - c, y, (z0 + z1) / 2, th, hp, D - 2 * PIN, look.color, look.mat, true);
        const ct = 0.1, cw = th + 0.1;
        K.box((x0 + x1) / 2, y + hp, z0 + c, W + 2 * POUT + 0.1, ct, cw, look.coping, look.copMat, false);
        K.box((x0 + x1) / 2, y + hp, z1 - c, W + 2 * POUT + 0.1, ct, cw, look.coping, look.copMat, false);
        K.box(x0 + c, y + hp, (z0 + z1) / 2, cw, ct, D + 2 * POUT + 0.1, look.coping, look.copMat, false);
        K.box(x1 - c, y + hp, (z0 + z1) / 2, cw, ct, D + 2 * POUT + 0.1, look.coping, look.copMat, false);
      }

      if (!top) {
        const tn = b.tiers[ti + 1]; const wr = tn.inset - t.inset;
        if (isLantern) lanternTerrace(K, b, x0, x1, z0, z1, y, wr, look, ti);
        else if (lod === 2 && wr > 2.1 && R() < 0.6) terracePlanters(K, R, x0, x1, z0, z1, y, wr, tp);
        continue;
      }
      const P = makePlacer(x0 + tp + 0.45, x1 - tp - 0.45, z0 + tp + 0.45, z1 - tp - 0.45, R);
      out.roofs.set(b.id, { x0, x1, z0, z1, y, hp, used: P.used });
      if (isLantern) continue;        // the crown is built separately
      dressTop(K, out, b, R, P, y, lod, look, heroId.get(b.id));
    }
  }
  return out;

  // -------------------------------------------------------------------------------------------------------------
  function terracePlanters(K, R, x0, x1, z0, z1, y, wr, tp) {
    const col = pick(R, PAL.planter), pm = R() < 0.5 ? M.CONCRETE : M.PLANKS;
    const sides = [];
    if (R() < 0.8) sides.push('w'); if (R() < 0.6) sides.push('s'); if (R() < 0.6) sides.push('n'); if (R() < 0.4) sides.push('e');
    for (const s of sides) {
      const len = (s === 'w' || s === 'e') ? z1 - z0 : x1 - x0;
      const n = Math.min(5, Math.floor(len / 7));
      for (let i = 0; i < n; i++) {
        const u = (i + 0.5 + rr(R, -0.2, 0.2)) / n; const pl = rr(R, 1.6, 2.6), pw = 0.55, ph = rr(R, 0.4, 0.6);
        let cx, cz, sx, sz;
        if (s === 'w') { cx = x0 + tp + 0.1 + pw / 2; cz = z0 + len * u; sx = pw; sz = pl; }
        else if (s === 'e') { cx = x1 - tp - 0.1 - pw / 2; cz = z0 + len * u; sx = pw; sz = pl; }
        else if (s === 'n') { cz = z0 + tp + 0.1 + pw / 2; cx = x0 + len * u; sx = pl; sz = pw; }
        else { cz = z1 - tp - 0.1 - pw / 2; cx = x0 + len * u; sx = pl; sz = pw; }
        planter(K, R, cx, cz, y, sx, sz, ph, col, pm);
      }
    }
  }

  function planter(K, R, cx, cz, y, sx, sz, ph, col, pm, big = false) {
    K.box(cx, y, cz, sx, ph, sz, col, pm, false);
    K.box(cx, y + ph - 0.03, cz, sx - 0.12, 0.05, sz - 0.12, [1, 1, 1], M.SOIL, false);
    const long = Math.max(sx, sz), n = Math.max(1, Math.round(long / 0.9));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n - 0.5; const s = rr(R, 0.55, 1.0) * Math.min(1.3, Math.min(sx, sz) / 0.5);
      const px = cx + (sx > sz ? u * (sx - 0.4) : 0), pz = cz + (sx > sz ? 0 : u * (sz - 0.4));
      K.put('shrub', px, y + ph - 0.1, pz, R() * 6.28, s, pick(R, PAL.leaf), s * rr(R, 0.8, 1.5));
    }
    if (big) K.put('tree', cx, y + ph - 0.05, cz, R() * 6.28, rr(R, 0.8, 1.25), pick(R, PAL.leaf));
  }

  function lanternTerrace(K, b, x0, x1, z0, z1, y, wr, look, ti) {
    // stepped corner pylons with pyramid finials + intermediate piers on the parapet (deco massing)
    const s = [2.6, 2.3, 2.0][ti] || 2.0, h = [5.5, 6.5, 7.5][ti] || 6;
    const stone = look.color;
    for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) {
      const px = cx + (cx === x0 ? s / 2 - 0.25 : -s / 2 + 0.25), pz = cz + (cz === z0 ? s / 2 - 0.25 : -s / 2 + 0.25);
      K.box(px, y, pz, s, h * 0.5, s, stone, M.ASHLAR, true);
      K.box(px, y + h * 0.5, pz, s + 0.3, 0.22, s + 0.3, mul(stone, 1.08), M.CONCRETE, false);
      K.box(px, y + h * 0.5 + 0.22, pz, s * 0.72, h * 0.3, s * 0.72, stone, M.ASHLAR, true);
      K.box(px, y + h * 0.8 + 0.22, pz, s * 0.72 + 0.24, 0.18, s * 0.72 + 0.24, mul(stone, 1.08), M.CONCRETE, false);
      K.box(px, y + h * 0.8 + 0.4, pz, s * 0.46, h * 0.2, s * 0.46, stone, M.ASHLAR, true);
      K.cone4(px, y + h + 0.4, pz, s * 0.3, s * 0.95, mul(stone, 1.05), M.CONCRETE);
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  function dressTop(K, out, b, R, P, y, lod, look, heroKind) {
    const A = P.w * P.d; const h = b.h; const old = b.district === 'old' || b.district === 'quay';
    const cxR = (P.x0 + P.x1) / 2, czR = (P.z0 + P.z1) / 2;
    if (P.w < 2.5 || P.d < 2.5) return;
    const tall = h > 110;
    const res = plan.reserve.get(b.id); if (res) for (const q of res) P.reserve(q.x, q.z, q.w, q.d);
    if (plan.masts.has(b.id)) {
      const s = rr(R, 0.95, 1.3); const p = P.place(3.4 * s, 3.4 * s, { pad: 0.3, tries: 30 });
      if (p) { K.put('mast', p.x, y, p.z, rr(R, 0, 0.5), s); out.masts.push({ id: b.id, x: p.x, y, z: p.z, top: y + 28 * s }); }
    }

    // ---- hero roof garden first so it gets the space
    let garden = false;
    if (heroKind === 'garden' || (lod === 2 && b.roof === 'plain' && h > 16 && h < 75 && A > 240 && R() < 0.3)) garden = roofGarden(K, out, b, R, P, y, heroKind === 'garden');

    // ---- stair / elevator bulkhead
    let bulk = null;
    if (R() < (h > 20 ? 0.93 : 0.75) && A > 60) {
      const big = A > 520 || h > 70;
      const bw = big ? rr(R, 5, 7.5) : rr(R, 3.0, 4.6), bd = big ? rr(R, 4, 5.5) : rr(R, 2.6, 3.6), bh = big ? rr(R, 3.4, 4.6) : rr(R, 2.5, 3.3);
      const swap = R() < 0.5; const sx = swap ? bd : bw, sz = swap ? bw : bd;
      const p = P.place(sx + 1.2, sz + 1.2, { pad: 0.2, tries: 20 });
      if (p) {
        const brick = b.style === 'brick' && R() < 0.8;
        const col = brick ? look.color : (look.mat === M.PAINT ? pick(R, PAL.concrete) : mixc(look.color, pick(R, PAL.stucco), 0.4));
        const bm = brick ? M.BRICK : M.CONCRETE;
        K.box(p.x, y, p.z, sx, bh, sz, col, bm, true);
        K.box(p.x, y + bh, p.z, sx + 0.36, 0.16, sz + 0.36, pick(R, PAL.coping), R() < 0.5 ? M.CONCRETE : M.FELT, true);
        if (big && R() < 0.7) {           // elevator overrun
          const ow = sx * rr(R, 0.4, 0.6), od = sz * rr(R, 0.5, 0.8), oh = rr(R, 1.4, 2.4);
          K.box(p.x + (sx - ow) * 0.5 * (R() < 0.5 ? -1 : 1) * 0.9, y + bh + 0.16, p.z, ow, oh, od, col, bm, true);
        }
        // door toward the roof centre
        const dx = cxR - p.x, dz = czR - p.z;
        let nx = 0, nz = 0; if (Math.abs(dx) * sz > Math.abs(dz) * sx) nx = Math.sign(dx) || 1; else nz = Math.sign(dz) || 1;
        const off = rr(R, -0.25, 0.25) * (nx ? sz : sx);
        const fx = p.x + nx * (sx / 2 + 0.03) + (nz ? off : 0), fz = p.z + nz * (sz / 2 + 0.03) + (nx ? off : 0);
        const dcol = pick(R, PAL.door);
        K.box(fx, y + 0.08, fz, nx ? 0.07 : 0.95, 2.02, nx ? 0.95 : 0.07, dcol, M.PAINT, false);
        K.box(fx + nx * 0.02, y, fz + nz * 0.02, nx ? 0.3 : 1.15, 0.08, nx ? 1.15 : 0.3, pick(R, PAL.coping), M.CONCRETE, false);   // step
        if (lod === 2 && R() < 0.34) {    // lamp over the door + pools of light on the wall and the roof
          const lx = fx + nx * 0.16, lz = fz + nz * 0.16, ly = y + 2.42;
          const warm = R() < 0.8 ? [1.0, 0.58, 0.25] : [0.75, 0.9, 1.0];
          K.box(lx - nx * 0.08, ly + 0.05, lz - nz * 0.08, 0.14, 0.1, 0.14, lin(0x2a2a2a), M.IRON, false);
          K.sprites.lamp(lx, ly, lz, 0.11, mul(warm, 26), { minPx: 1.1 });
          const tx = nz ? 1 : 0, tz = nx ? 1 : 0;
          K.sprites.pool(fx + nx * 0.05, y + 1.45, fz + nz * 0.05, [tx * 1.9, 0, tz * 1.9], [0, 1.5, 0], mul(warm, 0.24));
          K.sprites.pool(fx + nx * 1.5, y + 0.09, fz + nz * 1.5, [2.4, 0, 0], [0, 0, 2.4], mul(warm, 0.13));
        }
        if (lod === 2 && R() < 0.4) {     // ladder to the bulkhead roof on a side wall
          const side = R() < 0.5 ? 1 : -1;
          if (nx) K.put('ladder', p.x + rr(R, -0.3, 0.3) * sx, y, p.z + side * (sz / 2), side > 0 ? -Math.PI / 2 : Math.PI / 2, 1, null, bh / 3.0);
          else K.put('ladder', p.x + side * (sx / 2), y, p.z + rr(R, -0.3, 0.3) * sz, side > 0 ? 0 : Math.PI, 1, null, bh / 3.0);
        }
        if (lod === 2) {
          if (R() < 0.6) {                // louvred vent panel on the wall opposite the door
            const lw = rr(R, 0.7, 1.2), lh = rr(R, 0.5, 0.8), ly = y + bh - lh - rr(R, 0.25, 0.6);
            if (nx) K.box(p.x - nx * (sx / 2 + 0.02), ly, p.z + rr(R, -0.25, 0.25) * sz, 0.06, lh, lw, pick(R, PAL.unit), M.LOUVER, false);
            else K.box(p.x + rr(R, -0.25, 0.25) * sx, ly, p.z - nz * (sz / 2 + 0.02), lw, lh, 0.06, pick(R, PAL.unit), M.LOUVER, false);
          }
          if (R() < 0.5) {                // conduit running up a corner and over the roof slab
            const qx = p.x + (R() < 0.5 ? -1 : 1) * (sx / 2 + 0.05), qz = p.z + (R() < 0.5 ? -1 : 1) * (sz / 2 - 0.3);
            K.cyl(qx, y, qz, 0.04, bh + 0.5, pick(R, PAL.pipe), M.PAINT, false);
          }
        }
        bulk = { x: p.x, z: p.z, sx, sz, h: bh, top: y + bh + 0.16 };
        out.bulkheads.push({ id: b.id, ...bulk });
      }
    }

    // ---- tall towers: crown features (mast / mechanical penthouse) + aircraft warning lights
    if (tall) towerTop(K, out, b, R, P, y, bulk);

    // ---- kind-specific kit
    if (b.roof === 'tank') {
      const n = (A > 650 && R() < 0.35) ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const steel = (b.style === 'glass' || b.style === 'concrete') && R() < 0.55;
        const sc = Math.min(1.45, Math.max(0.78, rr(R, 0.85, 1.2) * (A > 500 ? 1.15 : 1) * (Math.min(P.w, P.d) < 9 ? 0.85 : 1)));
        const foot = (steel ? 4.4 : 4.3) * sc;
        if (foot > Math.min(P.w, P.d)) continue;
        const p = P.place(foot, foot, { pad: 0.3, tries: 24 });
        if (!p) continue;
        const ry = Math.floor(R() * 4) * Math.PI / 2 + rr(R, -0.1, 0.1);
        const tint = [rr(R, 0.75, 1.15), rr(R, 0.72, 1.05), rr(R, 0.68, 1.0)];
        K.put(steel ? 'tankSteel' : (lod === 2 ? 'tankHi' : 'tankLo'), p.x, y, p.z, ry, sc, steel ? [1, 1, 1] : tint);
        out.tanks.push({ id: b.id, x: p.x, y, z: p.z, s: sc, steel, h: (steel ? 3.6 : 7.3) * sc });
      }
    }
    if (b.roof === 'mech' || (tall && R() < 0.6)) mechKit(K, out, b, R, P, y, lod, A);

    // ---- skylights
    if (h < 70 && A > 120 && R() < (b.roof === 'plain' ? 0.75 : 0.28)) {
      const n = 1 + Math.floor(R() * (b.roof === 'plain' ? 3 : 1.5));
      const alongX = R() < 0.5;
      for (let i = 0; i < n; i++) {
        const len = rr(R, 2.2, Math.min(6, (alongX ? P.w : P.d) * 0.5)), wid = rr(R, 1.2, 2.0), hh = rr(R, 0.4, 0.75);
        const p = P.place(alongX ? len + 0.6 : wid + 0.6, alongX ? wid + 0.6 : len + 0.6, { pad: 0.3 });
        if (!p) continue;
        K.box(p.x, y, p.z, alongX ? len : wid, 0.32, alongX ? wid : len, lin(0x77797a), R() < 0.5 ? M.GALV : M.CONCRETE, false);
        K.skylight(p.x, y + 0.32, p.z, len - 0.12, hh, wid - 0.12, alongX ? 0 : Math.PI / 2);
      }
    }

    // ---- chimneys (masonry buildings)
    if ((old || b.district === 'east' || h < 34) && b.style !== 'glass' && b.style !== 'concrete' && R() < 0.8) {
      const n = 1 + Math.floor(R() * (old ? 3 : 2));
      for (let i = 0; i < n; i++) {
        const cw = rr(R, 0.8, 1.5), cd = rr(R, 0.55, 0.75), ch = rr(R, 1.5, 3.3);
        const e = pick(R, ['w', 'e', 'n', 's']); const sw = (e === 'n' || e === 's');
        const p = P.place(sw ? cw : cd, sw ? cd : cw, { pad: 0.25, edge: e, tries: 8 });
        if (!p) continue;
        const brick = b.style === 'brick' || R() < 0.5;
        const col = brick ? mul(pick(R, PAL.brick), 0.85) : look.color;
        const sx = sw ? cw : cd, sz = sw ? cd : cw;
        K.box(p.x, y, p.z, sx, ch, sz, col, brick ? M.BRICK : M.CONCRETE, true);
        K.box(p.x, y + ch, p.z, sx + 0.16, 0.12, sz + 0.16, pick(R, PAL.coping), M.CONCRETE, false);
        const pots = 1 + Math.floor(R() * 3);
        if (lod === 2) for (let k = 0; k < pots; k++) {
          const u = (k + 0.5) / pots - 0.5;
          K.cyl(p.x + (sw ? u * (cw - 0.3) : 0), y + ch + 0.12, p.z + (sw ? 0 : u * (cw - 0.3)), 0.12, rr(R, 0.35, 0.6), pick(R, PAL.pot), M.PAINT, false);
        }
      }
    }

    // ---- solar
    if (lod === 2 && !tall && A > 200 && R() < (b.roof === 'plain' ? 0.22 : 0.07)) {
      const rows = 1 + Math.floor(R() * 2), per = 2 + Math.floor(R() * 3);
      const w = per * 3.3, d = rows * 2.6;
      const p = P.place(w + 0.5, d + 0.5, { pad: 0.4 });
      if (p) for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) K.put('solar', p.x - w / 2 + 1.65 + i * 3.3, y, p.z - d / 2 + 1.3 + r * 2.6, 0, 1);
    }

    // ---- shed
    if (lod === 2 && !tall && A > 180 && R() < 0.13) {
      const p = P.place(3.6, 3.0, { pad: 0.4 });
      if (p) K.put('shed', p.x, y, p.z, Math.floor(R() * 4) * Math.PI / 2, 1, mixc(pick(R, PAL.planter), pick(R, PAL.door), 0.5));
    }

    // ---- vents
    {
      const n = Math.round(rr(R, 2.2, 6.5) * Math.min(1.6, Math.sqrt(A) / 20) * (lod === 2 ? 1 : 0.45));
      for (let i = 0; i < n; i++) {
        const p = P.place(0.9, 0.9, { pad: 0.2, tries: 5 }); if (!p) continue;
        const u = R();
        if (u < 0.5) K.put('mushroom', p.x, y, p.z, R() * 6.28, rr(R, 0.8, 1.5));
        else if (u < 0.68 && lod === 2) K.put('turbine', p.x, y, p.z, R() * 6.28, rr(R, 0.9, 1.4));
        else K.cyl(p.x, y, p.z, rr(R, 0.05, 0.1), rr(R, 0.5, 1.5), pick(R, PAL.pipe), R() < 0.5 ? M.GALV : M.PAINT, false);
      }
    }

    // ---- pipe run along a parapet
    if (lod === 2 && R() < 0.3 && A > 100) {
      const alongX = R() < 0.5; const n = 1 + Math.floor(R() * 2.5);
      const col = pick(R, PAL.pipe); const pm = R() < 0.4 ? M.GALV : M.PAINT;
      const side = R() < 0.5 ? 0 : 1;
      const a0 = (alongX ? P.x0 : P.z0) + rr(R, 0.2, 2), a1 = (alongX ? P.x1 : P.z1) - rr(R, 0.2, 2);
      for (let k = 0; k < n; k++) {
        const off = 0.12 + k * 0.2; const c = alongX ? (side ? P.z1 - off : P.z0 + off) : (side ? P.x1 - off : P.x0 + off);
        const py = y + 0.3 + 0.03 * k;
        if (alongX) K.pipe([a0, py, c], [a1, py, c], 0.045 + 0.015 * (k % 2), col, pm); else K.pipe([c, py, a0], [c, py, a1], 0.045 + 0.015 * (k % 2), col, pm);
      }
      const ns = Math.max(2, Math.round((a1 - a0) / 3.2));
      for (let i = 0; i <= ns; i++) {
        const a = a0 + (a1 - a0) * i / ns; const c = alongX ? (side ? P.z1 - 0.3 : P.z0 + 0.3) : (side ? P.x1 - 0.3 : P.x0 + 0.3);
        K.box(alongX ? a : c, y, alongX ? c : a, alongX ? 0.1 : 0.7, 0.25, alongX ? 0.7 : 0.1, lin(0x555555), M.CONCRETE, false);
      }
    }

    // ---- aerials & dishes (older low buildings)
    if (lod === 2 && h < 48 && (old || R() < 0.35)) {
      const n = Math.floor(R() * (old ? 3.4 : 2));
      for (let i = 0; i < n; i++) {
        const p = P.place(0.5, 0.5, { pad: 0.1, tries: 6, edge: pick(R, ['w', 'e', 'n', 's', null]) }); if (!p) continue;
        K.put('aerial', p.x, y, p.z, rr(R, -0.35, 0.35) + (R() < 0.2 ? 1.57 : 0), rr(R, 0.85, 1.3));
      }
      const nd = Math.floor(R() * 2.2);
      for (let i = 0; i < nd; i++) {
        const p = P.place(1.1, 1.1, { pad: 0.1, tries: 6 }); if (!p) continue;
        K.put('dish', p.x, y, p.z, -1.27 + rr(R, -0.18, 0.18), rr(R, 0.9, 1.5));
      }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  function roofGarden(K, out, b, R, P, y, heroic) {
    let w = Math.min(P.w - 1, rr(R, 6.5, 10)), d = Math.min(P.d - 1, rr(R, 5, 8));
    if (w < 5 || d < 4.2) return false;
    let p, view = null;
    if (heroic) {
      // the garden flanks the sight line from the viewing spot on the west edge to the Lantern crown
      const hg = plan.heroGarden; const sx = P.x0 + 0.6, sz = hg.spot[2];
      let dx = hg.crown[0] - sx, dz = hg.crown[2] - sz; const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
      w = Math.min(P.w - 9, 8.5); d = Math.min((P.d - 3) / 2, 6.5);
      const side = (sz - P.z0) > (P.z1 - sz) + 0.01 ? -1 : (dz > 0 ? -1 : 1);          // put it on the roomier side (north by default)
      const cx = sx + dx * (7.5 + w / 2), cz = sz + dz * (7.5 + w / 2) + side * (d / 2 + 1.3);
      p = { x: Math.min(P.x1 - w / 2 - 0.3, Math.max(P.x0 + w / 2 + 0.3, cx)), z: Math.min(P.z1 - d / 2 - 0.3, Math.max(P.z0 + d / 2 + 0.3, cz)) };
      P.reserve(p.x, p.z, w, d);
      { const len = P.x1 - sx, slope = dz / Math.max(dx, 0.2);                         // keep the whole sight line free of equipment
        P.reserve(sx + len / 2, sz + slope * len / 2, len, 3.2 + Math.abs(slope) * len); }
      view = [sx, y + 1.7, sz];
    } else p = P.place(w, d, { pad: 0.3, tries: 20 });
    if (!p) return false;
    K.box(p.x, y, p.z, w, 0.1, d, lin(0x8a6a4c), M.PLANKS, false);                       // timber deck
    const pry = w > d ? 0 : Math.PI / 2;
    const px = p.x + (w > d ? -w / 2 + 2.3 : 0), pz = p.z + (w > d ? 0 : -d / 2 + 2.3);
    K.put('pergola', px, y + 0.1, pz, pry, 1, R() < 0.5 ? [1, 1, 1] : [1.5, 1.45, 1.35]);
    // festoon lights under the pergola beams
    for (let k = 0; k < 2; k++) for (let i = 0; i < 6; i++) {
      const u = (i + 0.5) / 6 - 0.5, side = k ? 1.1 : -1.1;
      const lx = px + (pry ? side : u * 3.6), lz = pz + (pry ? u * 3.6 : side);
      K.sprites.lamp(lx, y + 2.25 - 0.12 * Math.cos(u * 6.28), lz, 0.075, [26, 15, 6], { minPx: 1.3 });
    }
    K.sprites.pool(px, y + 0.18, pz, [4.4, 0, 0], [0, 0, 4.4], [0.46, 0.27, 0.11]);
    K.sprites.pool(px, y + 2.52, pz, [pry ? 1.5 : 2.0, 0, 0], [0, 0, pry ? 2.0 : 1.5], [0.22, 0.13, 0.05]);
    // planters round the deck + a tree or two
    const col = pick(R, PAL.planter), pm = R() < 0.5 ? M.CONCRETE : M.PLANKS;
    const n = 3 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const s = i % 4; const u = rr(R, -0.35, 0.35);
      const long = rr(R, 1.6, 2.8);
      if (s === 0) planter(K, R, p.x + u * w, p.z - d / 2 + 0.35, y + 0.1, long, 0.6, 0.5, col, pm);
      else if (s === 1) planter(K, R, p.x + w / 2 - 0.35, p.z + u * d, y + 0.1, 0.6, long, 0.5, col, pm);
      else if (s === 2) planter(K, R, p.x + u * w, p.z + d / 2 - 0.35, y + 0.1, long, 0.6, 0.5, col, pm);
      else planter(K, R, p.x - w / 2 + 0.35, p.z + u * d, y + 0.1, 0.6, long, 0.5, col, pm);
    }
    const nt = 1 + Math.floor(R() * 2);
    for (let i = 0; i < nt; i++) planter(K, R, p.x + (i ? -1 : 1) * (w / 2 - 0.8), p.z + (i ? 1 : -1) * (d / 2 - 0.8) * (w > d ? -1 : 1), y + 0.1, 1.1, 1.1, 0.7, col, pm, true);
    out.gardens.push({ id: b.id, x: p.x, y, z: p.z, w, d, hero: heroic, view });
    return true;
  }

  // -------------------------------------------------------------------------------------------------------------
  function mechKit(K, out, b, R, P, y, lod, A) {
    const h = b.h; const ucol = pick(R, PAL.unit);
    // cooling towers on bigger / taller buildings
    if ((h > 42 || A > 560) && R() < 0.8) {
      const n = 1 + Math.floor(R() * (A > 500 ? 2.6 : 1.3)); const box = R() < 0.45;
      const sc = rr(R, 0.85, 1.2) * (h > 100 ? 1.25 : 1);
      const fw = (box ? 4.0 : 3.6) * sc; const alongX = P.w > P.d;
      const p = P.place(alongX ? fw * n : fw, alongX ? fw : fw * n, { pad: 0.4, tries: 20 });
      if (p) for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * fw; const cx = p.x + (alongX ? o : 0), cz = p.z + (alongX ? 0 : o);
        K.put(box ? 'coolBox' : 'coolRound', cx, y, cz, Math.floor(R() * 4) * Math.PI / 2, sc, mixc(ucol, [0.8, 0.8, 0.78], 0.5));
        out.coolers.push({ id: b.id, x: cx, y: y + (box ? 4.1 : 3.4) * sc, z: cz, r: (box ? 1.2 : 1.15) * sc, h: b.h, district: b.district });
      }
    }
    // large units with duct runs
    if (A > 260 && R() < 0.7) {
      const n = 1 + Math.floor(R() * 2);
      for (let i = 0; i < n; i++) {
        const alongX = R() < 0.5; const dl = rr(R, 3, 8);
        const p = P.place(alongX ? 3.6 + dl : 2.2, alongX ? 2.2 : 3.6 + dl, { pad: 0.4 });
        if (!p) continue;
        const dir = R() < 0.5 ? 1 : -1;
        const ux = p.x + (alongX ? -dir * dl / 2 : 0), uz = p.z + (alongX ? 0 : -dir * dl / 2);
        // prototype's long axis is X; duct leaves from its -X end (the hood is at +X)
        K.put('acLarge', ux, y, uz, alongX ? (dir > 0 ? Math.PI : 0) : (dir > 0 ? Math.PI / 2 : -Math.PI / 2), 1, ucol);
        const dcol = lin(0xa9adb0);
        const d0 = 1.5, d1 = 1.5 + dl - 0.4;
        const dc = (d0 + d1) / 2, dlen = d1 - d0;
        K.box(ux + (alongX ? dir * dc : 0), y + 0.5, uz + (alongX ? 0 : dir * dc), alongX ? dlen : 0.7, 0.55, alongX ? 0.7 : dlen, dcol, M.GALV, true);
        K.box(ux + (alongX ? dir * d1 : 0), y, uz + (alongX ? 0 : dir * d1), 0.74, 1.09, 0.74, dcol, M.GALV, true);
        const ns = Math.max(1, Math.round(dlen / 2.5));
        for (let k = 0; k < ns; k++) { const a = d0 + (k + 0.5) * dlen / ns; K.box(ux + (alongX ? dir * a : 0), y, uz + (alongX ? 0 : dir * a), alongX ? 0.12 : 0.9, 0.5, alongX ? 0.9 : 0.12, lin(0x444444), M.IRON, false); }
      }
    }
    // rows of small condensers
    {
      const n = 2 + Math.floor(R() * (lod === 2 ? 4.5 : 2)); const alongX = R() < 0.5; const sp = 2.0;
      const p = P.place(alongX ? n * sp : 1.6, alongX ? 1.6 : n * sp, { pad: 0.3 });
      if (p) for (let i = 0; i < n; i++) {
        const o = (i - (n - 1) / 2) * sp;
        K.put('acSmall', p.x + (alongX ? o : 0), y, p.z + (alongX ? 0 : o), alongX ? 0 : Math.PI / 2, rr(R, 0.9, 1.1), mul(ucol, rr(R, 0.85, 1.1)));
      }
      const extra = Math.floor(R() * 3);
      for (let i = 0; i < extra; i++) { const q = P.place(1.9, 1.5, { pad: 0.3, tries: 6 }); if (q) K.put('acSmall', q.x, y, q.z, Math.floor(R() * 4) * Math.PI / 2, rr(R, 0.9, 1.2), mul(ucol, rr(R, 0.8, 1.1))); }
    }
  }

  // -------------------------------------------------------------------------------------------------------------
  function towerTop(K, out, b, R, P, y, bulk) {
    const h = b.h; const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
    const rec = { id: b.id, x: cx, z: cz, y, h, beacons: [] };
    let topY = y + 1.2, bx = cx, bz = cz;
    const sm = Math.min(P.w, P.d);
    if (R() < 0.55 && sm > 7) {
      // stepped plinth + slender mast
      const pw = Math.min(sm * 0.45, rr(R, 3, 5)); const ph = rr(R, 2.5, 4.5);
      const p = P.place(pw + 0.6, pw + 0.6, { pad: 0.2, tries: 20 }) || { x: cx, z: cz };
      const col = pick(R, PAL.concrete);
      K.box(p.x, y, p.z, pw, ph, pw, col, M.CONCRETE, true);
      K.box(p.x, y + ph, p.z, pw * 0.6, ph * 0.5, pw * 0.6, col, M.CONCRETE, true);
      const mh = rr(R, 14, 30) * (h > 160 ? 1.2 : 1); const y0 = y + ph * 1.5;
      const white = lin(0xd6d2c6), red = lin(0xb5301f); const painted = R() < 0.5;
      const segs = 4;
      for (let i = 0; i < segs; i++) {
        const r = 0.3 - 0.06 * i;
        K.cyl(p.x, y0 + mh * i / segs, p.z, r, mh / segs, painted ? (i % 2 ? white : red) : lin(0x9aa0a4), painted ? M.PAINT : M.GALV, true);
      }
      K.box(p.x, y0 + mh * 0.5, p.z, 1.3, 0.06, 1.3, lin(0x777777), M.GALV, false);
      topY = y0 + mh; bx = p.x; bz = p.z;
      rec.beacons.push([bx, y0 + mh * 0.5 + 0.25, bz, 0.7]);
      rec.mast = { x: p.x, z: p.z, top: topY };
    } else if (bulk) { topY = bulk.top + 0.5; bx = bulk.x; bz = bulk.z; K.cyl(bx, bulk.top, bz, 0.06, 0.5, lin(0x777777), M.GALV, false); }
    else K.cyl(bx, y, bz, 0.07, 1.2, lin(0x777777), M.GALV, false);
    rec.beacons.unshift([bx, topY + 0.18, bz, 1]);
    if (h > 135) for (const [qx, qz] of [[P.x0 - 0.7, P.z0 - 0.7], [P.x1 + 0.7, P.z0 - 0.7], [P.x1 + 0.7, P.z1 + 0.7], [P.x0 - 0.7, P.z1 + 0.7]]) {
      K.cyl(qx, y + HP, qz, 0.05, 0.6, lin(0x666666), M.GALV, false);        // on top of the parapet corners
      rec.beacons.push([qx, y + HP + 0.72, qz, 0.45]);
    }
    out.tallTops.push(rec);
  }
}
