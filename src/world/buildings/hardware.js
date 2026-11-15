// Facade hardware: the iron, tin and enamel that hangs on old street walls and catches the low sun —
// fire-escape stacks, window air-conditioners, balcony railings, downpipes, cable runs, roller-shutter boxes,
// gooseneck lamps, hanging / neon blade signs, bracket clocks, flagpoles.
// Everything is placed on the bay grid recorded by geometry.js (info.walls) and merged into ONE mesh (layer 0).
// Placement rules are pure integer arithmetic on (bay, floor, wall seed) so that GLSL can mirror them exactly:
//   fire escape : building flag FLAG.fireEsc, wall nb >= 3 (2 for paired windows), wseed % 5 < 3, first bay = wseed % (nb-1)
//   AC unit     : building flag FLAG.ac, (bay*7 + floor*13 + wseed) % 23 < 2 + wseed % 3   (the facade shader mirrors this
//                 one: filler panel in the sash, drip stain under the sill)
import { mulberry32 } from '../layout.js';
import { FLAG } from './params.js';

export const HK = { IRON: 0, AC: 1, SIGN: 2, NEON: 3, CLOCK: 4, LAMP: 5, PIPE: 6, TIN: 7 };
const FRONT = 1, BACK = 2, LEFT = 4, RIGHT = 8, TOP = 16, BOTTOM = 32, SIDES5 = FRONT | LEFT | RIGHT | TOP | BOTTOM;

const C = {
  black: [0.016, 0.017, 0.019], green: [0.02, 0.045, 0.032], oxide: [0.15, 0.042, 0.028], grey: [0.17, 0.18, 0.19],
  cream: [0.46, 0.42, 0.34], galv: [0.30, 0.32, 0.34], lead: [0.10, 0.105, 0.11], verdigris: [0.16, 0.30, 0.25],
  acA: [0.50, 0.48, 0.43], acB: [0.33, 0.34, 0.35], acC: [0.42, 0.37, 0.28], white: [0.62, 0.60, 0.55],
};
const NEONC = [[1.0, 0.16, 0.10], [1.0, 0.55, 0.16], [0.22, 0.85, 1.0], [1.0, 0.25, 0.55], [0.35, 1.0, 0.45], [1.0, 0.86, 0.6]];
const SIGNC = [[0.02, 0.06, 0.04], [0.13, 0.02, 0.02], [0.015, 0.03, 0.09], [0.012, 0.012, 0.014], [0.40, 0.36, 0.26], [0.30, 0.08, 0.04]];

export class HwMesher {
  // Geometry is collected into several buffers (spatial chunk x shadow caster or not): off-screen chunks are frustum
  // culled, and only the pieces whose shadows read (fire escapes, signs, clocks, poles) go into the shadow maps.
  constructor() { this.bufs = new Map(); this.cur = null; this.F = null; this.keyBase = 0; this.sel(0); }
  /** choose the shadow-casting (true) or the non-casting buffer of the current chunk */
  cast(on) { this.sel(this.keyBase + (on ? 1 : 0)); }
  sel(key) {
    let b = this.bufs.get(key);
    if (!b) { b = { key, pos: [], nrm: [], col: [], hw: [], idx: [], nv: 0 }; this.bufs.set(key, b); }
    this.cur = b;
  }
  tris() { let n = 0; for (const b of this.bufs.values()) n += b.idx.length / 3; return n; }
  /** quad in frame coordinates (u along the wall, y above the street, p out of the wall); n = frame-space normal */
  quad(a, b, c, d, n, col, kind = 0, prm = 0, uvs = null) {
    const F = this.F, B = this.cur;
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const P = flip ? [a, d, c, b] : [a, b, c, d];
    const U = uvs ? (flip ? [uvs[0], uvs[3], uvs[2], uvs[1]] : uvs) : null;
    const nw = F.dir(n[0], n[1], n[2]);
    for (let i = 0; i < 4; i++) {
      const w = F.P(P[i][0], P[i][1], P[i][2]);
      B.pos.push(w[0], w[1], w[2]); B.nrm.push(nw[0], nw[1], nw[2]); B.col.push(col[0], col[1], col[2]);
      B.hw.push(U ? U[i][0] : -1, U ? U[i][1] : P[i][1], kind, prm);
    }
    const o = B.nv; B.idx.push(o, o + 1, o + 2, o, o + 2, o + 3); B.nv += 4;
  }
  /** rectangular bar from a to b; hs = half size sideways (horizontal for sloped bars), ht = half size the other way.
   *  faces: 1 +s, 2 -s, 4 +t, 8 -t.  vertical bars: s = +u, t = +p.  bars along u: s = +p, t = up.  bars along p: s = -u, t = up. */
  beam(a, b, hs, ht, col, faces = 15, kind = 0, prm = 0) {
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2]; const l = Math.hypot(dx, dy, dz); if (l < 1e-5) return;
    dx /= l; dy /= l; dz /= l;
    const r = Math.abs(dy) < 0.9 ? [0, 1, 0] : [0, 0, 1];
    let sx = dy * r[2] - dz * r[1], sy = dz * r[0] - dx * r[2], sz = dx * r[1] - dy * r[0];
    const sl = Math.hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl;
    const tx = sy * dz - sz * dy, ty = sz * dx - sx * dz, tz = sx * dy - sy * dx;
    const pt = (e, i, j) => [e[0] + sx * hs * i + tx * ht * j, e[1] + sy * hs * i + ty * ht * j, e[2] + sz * hs * i + tz * ht * j];
    if (faces & 1) this.quad(pt(a, 1, -1), pt(b, 1, -1), pt(b, 1, 1), pt(a, 1, 1), [sx, sy, sz], col, kind, prm);
    if (faces & 2) this.quad(pt(a, -1, -1), pt(b, -1, -1), pt(b, -1, 1), pt(a, -1, 1), [-sx, -sy, -sz], col, kind, prm);
    if (faces & 4) this.quad(pt(a, -1, 1), pt(b, -1, 1), pt(b, 1, 1), pt(a, 1, 1), [tx, ty, tz], col, kind, prm);
    if (faces & 8) this.quad(pt(a, -1, -1), pt(b, -1, -1), pt(b, 1, -1), pt(a, 1, -1), [-tx, -ty, -tz], col, kind, prm);
  }
  /** axis-aligned box in frame space. uvF: give the +-u faces a 0..1 uv (reading left to right from outside) */
  box(u0, u1, y0, y1, p0, p1, col, faces = SIDES5, kind = 0, prm = 0, uvFront = false, uvSides = false, edgeKind = kind) {
    const fuv = uvFront ? [[0, 0], [1, 0], [1, 1], [0, 1]] : null;
    if (faces & FRONT) this.quad([u0, y0, p1], [u1, y0, p1], [u1, y1, p1], [u0, y1, p1], [0, 0, 1], col, uvFront || !uvSides ? kind : edgeKind, prm, fuv);
    if (faces & BACK) this.quad([u0, y0, p0], [u1, y0, p0], [u1, y1, p0], [u0, y1, p0], [0, 0, -1], col, edgeKind, prm);
    // +u face is seen looking along -u: the viewer's right is -p.  -u face: right is +p.
    if (faces & RIGHT) this.quad([u1, y0, p1], [u1, y0, p0], [u1, y1, p0], [u1, y1, p1], [1, 0, 0], col, uvSides ? kind : edgeKind, prm, uvSides ? [[0, 0], [1, 0], [1, 1], [0, 1]] : null);
    if (faces & LEFT) this.quad([u0, y0, p0], [u0, y0, p1], [u0, y1, p1], [u0, y1, p0], [-1, 0, 0], col, uvSides ? kind : edgeKind, prm, uvSides ? [[0, 0], [1, 0], [1, 1], [0, 1]] : null);
    if (faces & TOP) this.quad([u0, y1, p0], [u1, y1, p0], [u1, y1, p1], [u0, y1, p1], [0, 1, 0], col, edgeKind, prm);
    if (faces & BOTTOM) this.quad([u0, y0, p0], [u1, y0, p0], [u1, y0, p1], [u0, y0, p1], [0, -1, 0], col, edgeKind, prm);
  }
}

/** number of window floors above the ground floor on a tier-0 wall (same test as the shader / balcony builder) */
export function upperFloors(P, yDeck) { let n = 0; while (P.groundH + n * P.floorH + P.sill + P.winH <= yDeck - 0.4) n++; return n; }
export function hasFireEscape(w, P) {
  if (!(P.flags & FLAG.fireEsc) || w.tier !== 0 || !w.facade) return false;
  return w.nb >= (P.winType === 1 ? 2 : 3) && w.wseed % 5 < 3;
}
export function acAt(bi, fl, wseed) { return (bi * 7 + fl * 13 + wseed) % 23 < 2 + (wseed % 3); }

function ladder(M, u, y0, y1, p, col, hw = 0.19) {
  M.beam([u - hw, y0, p], [u - hw, y1, p], 0.016, 0.016, col);
  M.beam([u + hw, y0, p], [u + hw, y1, p], 0.016, 0.016, col);
  const n = Math.max(2, Math.round((y1 - y0) / 0.3));
  for (let k = 1; k < n; k++) { const y = y0 + (y1 - y0) * k / n; M.beam([u - hw, y, p], [u + hw, y, p], 0.011, 0.011, col, 1 | 4 | 8); }
}

function railing(M, uA, uB, yD, pIn, pOut, col, { h = 0.98, step = 0.45, sideN = 2, low = 0.10, casts = false } = {}) {
  const yR = yD + h, pf = pOut - 0.02;
  M.beam([uA, yR, pf], [uB, yR, pf], 0.02, 0.016, col, 1 | 4 | 8);
  M.beam([uA, yR, pIn], [uA, yR, pf], 0.02, 0.016, col, 1 | 2 | 4);
  M.beam([uB, yR, pIn], [uB, yR, pf], 0.02, 0.016, col, 1 | 2 | 4);
  M.beam([uA, yD + low, pf], [uB, yD + low, pf], 0.011, 0.011, col, 1 | 4 | 8);
  M.beam([uA, yD + low, pIn], [uA, yD + low, pf], 0.011, 0.011, col, 1 | 2);
  M.beam([uB, yD + low, pIn], [uB, yD + low, pf], 0.011, 0.011, col, 1 | 2);
  M.beam([uA, yD, pf], [uA, yR, pf], 0.02, 0.02, col, 2 | 4 | 8);
  M.beam([uB, yD, pf], [uB, yR, pf], 0.02, 0.02, col, 1 | 4 | 8);
  if (casts) M.cast(false);                    // balusters are finer than a shadow-map texel: keep them out of the shadow pass
  const n = Math.max(2, Math.round((uB - uA) / step));
  for (let k = 1; k < n; k++) { const u = uA + (uB - uA) * k / n; M.beam([u, yD + low, pf], [u, yR, pf], 0.009, 0.009, col, 1 | 2 | 4); }
  for (let k = 1; k <= sideN; k++) {
    const p = pIn + (pf - pIn) * k / (sideN + 1);
    M.beam([uA, yD + low, p], [uA, yR, p], 0.009, 0.009, col, 1 | 2); M.beam([uB, yD + low, p], [uB, yR, p], 0.009, 0.009, col, 1 | 2);
  }
  if (casts) M.cast(true);
}

function fireEscape(M, w, P, col, flatRoof) {
  const { nb, margin: mg, bw, W, yDeck } = w;
  const paired = P.winType === 1;
  const i0 = paired ? w.wseed % nb : w.wseed % (nb - 1), i1 = paired ? i0 : i0 + 1;
  const half = paired ? P.winW + 0.17 : P.winW / 2;
  const uA = Math.max(mg + (i0 + 0.5) * bw - half - 0.32, 0.12), uB = Math.min(mg + (i1 + 0.5) * bw + half + 0.32, W - 0.12);
  const nF = upperFloors(P, yDeck); if (nF < 2) return 0;
  const p0 = 0.02, dp = 1.02, dir = (w.wseed >> 1) % 2 ? 1 : -1;
  const uc = (uA + uB) / 2, fH = P.floorH;
  const run = Math.min(uB - uA - 1.3, fH * 0.82);
  const uLo = uc - dir * run / 2, uHi = uc + dir * run / 2;
  const deckY = fl => P.groundH + fl * fH + P.sill - 0.30;
  for (let fl = 0; fl < nF; fl++) {
    const yD = deckY(fl);
    M.box(uA, uB, yD - 0.05, yD, p0, dp, col, SIDES5);
    for (const u of (uB - uA > 4.2 ? [uA + 0.12, uc, uB - 0.12] : [uA + 0.12, uB - 0.12])) M.beam([u, yD - 0.82, p0 + 0.02], [u, yD - 0.05, dp - 0.1], 0.018, 0.022, col);
    railing(M, uA, uB, yD, p0, dp, col, { casts: true });
    if (fl < nF - 1 && run > 1.2) {            // stair to the next landing
      for (const ps of [0.15, 0.62]) M.beam([uLo, yD, ps], [uHi, yD + fH, ps], 0.012, 0.055, col);
      const n = Math.round(fH / 0.28);
      for (let k = 1; k < n; k++) {
        const f = k / n, u = uLo + (uHi - uLo) * f, y = yD + fH * f;
        M.box(u - 0.1, u + 0.1, y - 0.012, y + 0.012, 0.15, 0.62, col, TOP | BOTTOM);
      }
      M.beam([uLo, yD + 0.86, 0.63], [uHi, yD + fH + 0.86, 0.63], 0.012, 0.014, col);
    } else if (fl < nF - 1) ladder(M, uc, yD, yD + fH, 0.3, col);
  }
  // drop ladder, parked upright outside the lowest landing
  ladder(M, dir > 0 ? uA + 0.4 : uB - 0.4, deckY(0) - 0.55, deckY(0) + 2.2, dp + 0.045, col);
  // gooseneck ladder over the parapet
  if (flatRoof) {
    const u = dir > 0 ? uB - 0.42 : uA + 0.42, pl = Math.max(P.corniceP, 0.1) + 0.16, yT = w.yTop + 0.8;
    ladder(M, u, deckY(nF - 1), yT, pl, col, 0.2);
    for (const s of [-0.2, 0.2]) { M.beam([u + s, yT, pl], [u + s, yT, -0.3], 0.016, 0.016, col); M.beam([u + s, yT, -0.3], [u + s, w.yTop + 0.02, -0.3], 0.016, 0.016, col); }
  }
  return 1;
}

export function buildHardware(M, buildings, params, info, lights) {
  const stats = { fire: 0, ac: 0, balc: 0, juliet: 0, pipes: 0, shutters: 0, lamps: 0, blades: 0, neon: 0, clocks: 0, cables: 0, poles: 0, tris: {} };
  let tMark = 0;
  const T = k => { const n = M.tris(); stats.tris[k] = (stats.tris[k] || 0) + n - tMark; tMark = n; };
  // spatial chunks: 2 x 3 over the built-up area
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const b of buildings) { bx0 = Math.min(bx0, b.x0); bx1 = Math.max(bx1, b.x1); bz0 = Math.min(bz0, b.z0); bz1 = Math.max(bz1, b.z1); }
  const NX = 2, NZ = 3;
  buildings.forEach((b, bid) => {
    const P = params[bid]; const binfo = info.get(b.id);
    if (!binfo || b.landmark) return;
    const R = mulberry32((b.seed ^ 0x6a09e667) >>> 0);
    const d = b.district, st = b.style, quay = d === 'quay', old = d === 'old';
    const gH = P.groundH, fH = P.floorH;
    const ironCol = [C.black, C.black, C.black, C.green, C.oxide, C.grey, C.black, C.cream][Math.floor(R() * 8)];
    const pipeCol = [C.lead, C.galv, C.black, C.galv, C.verdigris, C.lead][Math.floor(R() * 6)];
    const french = !!(P.flags & FLAG.french);
    const flatRoof = binfo.roofType === 0;
    const midrise = b.tiers[0].y1 < 50;
    const masonry = st === 'brick' || st === 'stone' || st === 'stucco';
    const wantPipes = masonry && midrise && P.finW === 0 && R() < (quay || old ? 0.6 : 0.25);
    const wantCables = masonry && midrise && !french && R() < (quay || old ? 0.45 : (d === 'east' ? 0.3 : 0.12));
    const clockRoll = R(), poleRoll = R();
    const near = quay || old;                    // the districts the camera walks through carry most of the street furniture
    let clockDone = false, poleDone = false;
    const chunk = Math.min(NX - 1, Math.floor(((b.x0 + b.x1) / 2 - bx0) / (bx1 - bx0) * NX)) + NX * Math.min(NZ - 1, Math.floor(((b.z0 + b.z1) / 2 - bz0) / (bz1 - bz0) * NZ));
    M.keyBase = chunk * 2;
    const sel = cast => M.cast(cast);

    for (const w of binfo.walls) {
      if (w.tier !== 0 || !w.open || !w.facade) { R(); continue; }
      M.F = w.frame;
      const { nb, margin: mg, bw, W, yDeck } = w;
      const nF = upperFloors(P, yDeck);
      const strP = Math.max(P.stringP, P.groundType === 0 ? 0.14 : 0);

      // ---- fire escape
      sel(true);
      if (hasFireEscape(w, P)) stats.fire += fireEscape(M, w, P, ironCol, flatRoof);
      sel(false);

      T('fire');
      // ---- window air conditioners
      if ((P.flags & FLAG.ac) && P.winType === 0) {
        for (let fl = 0; fl < nF; fl++) for (let bi = 0; bi < nb; bi++) {
          if (!acAt(bi, fl, w.wseed)) continue;
          const hsh = (bi * 31 + fl * 17 + w.wseed) % 7;
          const cu = mg + (bi + 0.5) * bw, y0 = gH + fl * fH + P.sill;
          const hw_ = Math.min(0.33, P.winW / 2 - 0.1), h = 0.37 + 0.012 * hsh, dd = 0.3 + 0.015 * hsh;
          const col = [C.acA, C.acB, C.acC, C.acA, C.white, C.acB, C.acA][hsh];
          M.box(cu - hw_, cu + hw_, y0 + 0.012, y0 + h, 0, dd, col, SIDES5, HK.AC, hsh, true);
          stats.ac++;
        }
      }

      T('ac');
      // ---- french windows: iron balcony railings and juliet rails
      if (french) {
        const cells = new Set();
        for (const c of w.balc) {
          cells.add(c.fl * 64 + c.i);
          if (!w.ironBalc) continue;
          railing(M, c.uc - c.hw + 0.03, c.uc + c.hw - 0.03, c.yf + 0.02, 0.02, c.d, ironCol, { h: 0.95, step: 0.42, sideN: 1, low: 0.08 });
          stats.balc++;
        }
        const hw_ = P.winW / 2 + 0.04;
        for (let fl = 0; fl < nF; fl++) for (let i = 0; i < nb; i++) {
          if (cells.has(fl * 64 + i)) continue;
          const uc = mg + (i + 0.5) * bw, y0 = gH + fl * fH + P.sill;
          M.beam([uc - hw_, y0 + 0.95, 0.05], [uc + hw_, y0 + 0.95, 0.05], 0.02, 0.018, ironCol, 1 | 4);
          M.beam([uc - hw_, y0 + 0.07, 0.05], [uc + hw_, y0 + 0.07, 0.05], 0.012, 0.012, ironCol, 1);
          const n = 2;
          for (let k = 0; k <= n; k++) { const u = uc - hw_ + 2 * hw_ * k / n; M.beam([u, y0 + 0.07, 0.05], [u, y0 + 0.95, 0.05], 0.011, 0.009, ironCol, k === 0 ? 2 | 4 : (k === n ? 1 | 4 : 4)); }
          stats.juliet++;
        }
      }

      T('french');
      // ---- downpipe at one end of the wall
      if (wantPipes && W > 6 && mg > 0.32) {
        const left = w.wseed % 2 === 0, u = left ? 0.2 : W - 0.2;
        const pp = strP + 0.015, top = yDeck - (P.corniceP > 0.01 ? P.corniceH : 0) - 0.12;
        M.beam([u, 0.3, pp + 0.05], [u, top - 0.25, pp + 0.05], 0.05, 0.05, pipeCol, 1 | 2 | 4, HK.PIPE, w.wseed % 16);
        M.box(u - 0.13, u + 0.13, top - 0.3, top, 0, pp + 0.19, pipeCol, FRONT | LEFT | RIGHT | BOTTOM, HK.PIPE, w.wseed % 16);
        M.beam([u, 0.32, pp + 0.05], [u, 0.06, pp + 0.3], 0.05, 0.05, pipeCol, 15, HK.PIPE, w.wseed % 16);
        const n = Math.max(2, Math.round(top / 3.2));
        for (let k = 0; k < n; k++) { const y = 0.9 + (top - 1.6) * k / (n - 1); M.box(u - 0.08, u + 0.08, y - 0.03, y + 0.03, 0, pp + 0.115, pipeCol, FRONT, HK.PIPE, w.wseed % 16); }
        stats.pipes++;
      }

      T('pipes');
      // ---- cable run under the first-floor sills
      const cableRoll = R();
      if (wantCables && cableRoll < 0.55 && nb >= 2 && P.sill > 0.6) {
        const y = gH + 0.33 + 0.1 * cableRoll, cc = C.black;
        const ua = Math.min(0.6, mg), ub = W - Math.min(0.6, mg), n = nb;
        for (let k = 0; k < n; k++) {
          const a = ua + (ub - ua) * k / n, c = ua + (ub - ua) * (k + 1) / n, sag = 0.02 + 0.025 * ((k * 5 + w.wseed) % 3);
          M.beam([a, y - (k % 2 ? sag : 0), 0.035], [c, y - (k % 2 ? 0 : sag), 0.035], 0.011, 0.011, cc, 1 | 8);
        }
        const ue = w.wseed % 2 === 0 ? ub : ua;
        M.box(ue - 0.13, ue + 0.13, y - 0.1, y + 0.28, 0, 0.1, C.grey, SIDES5);
        if (P.groundType !== 0) M.beam([ue, 0.6, 0.03], [ue, y - 0.1, 0.03], 0.012, 0.012, cc, 1 | 2 | 4);
        else M.beam([ue, y + 0.28, 0.03], [ue, Math.min(y + 0.28 + fH * 1.6, yDeck - 1.5), 0.03], 0.012, 0.012, cc, 1 | 2 | 4);
        stats.cables++;
      }

      T('cables');
      // ---- shopfront hardware
      if (P.groundType === 0) {
        const span = P.shopSpan, nU = Math.ceil(nb / span);
        let lastBlade = -9;
        for (let un = 0; un < nU; un++) {
          const ub0 = un * span, n = Math.min(span, nb - ub0);
          const u0 = mg + ub0 * bw, u1 = u0 + n * bw;
          const r1 = R(), r2 = R(), r3 = R(), r4 = R();
          const awn = w.awn.includes(un);
          if (!awn && r1 < (near ? 0.5 : 0.16)) {               // roller-shutter box with guide rails
            const sc = r4 < 0.5 ? C.galv : (r4 < 0.8 ? C.grey : C.cream);
            M.box(u0 + 0.2, u1 - 0.2, gH - 1.37, gH - 1.1, 0, 0.23, sc, SIDES5, HK.TIN, 0);
            M.box(u0 + 0.2, u0 + 0.26, 0.05, gH - 1.37, 0, 0.05, sc, FRONT | RIGHT, HK.TIN, 1);
            M.box(u1 - 0.26, u1 - 0.2, 0.05, gH - 1.37, 0, 0.05, sc, FRONT | LEFT, HK.TIN, 1);
            stats.shutters++;
          }
          if (r2 < (near ? 0.36 : 0.05)) {        // gooseneck lamps washing the fascia
            const us = n === 1 ? [0.5] : [0.3, 0.7];
            const warm = r4 < 0.8 ? [1.0, 0.74, 0.42] : [0.9, 0.95, 1.0];
            for (const f of us) {
              const u = u0 + (u1 - u0) * f, pa = strP + 0.42, ys = gH - 0.06;
              M.beam([u, gH + 0.34, 0.0], [u, gH + 0.44, pa - 0.08], 0.013, 0.013, C.black, 1 | 2 | 8);
              M.beam([u, gH + 0.44, pa - 0.08], [u, ys, pa], 0.013, 0.013, C.black, 1 | 2 | 4);
              const a = 0.045, c = 0.15, yb = ys - 0.17;
              M.quad([u - a, ys, pa + a], [u + a, ys, pa + a], [u + c, yb, pa + c], [u - c, yb, pa + c], [0, 0.6, 0.8], C.green);
              M.quad([u - a, ys, pa - a], [u + a, ys, pa - a], [u + c, yb, pa - c], [u - c, yb, pa - c], [0, 0.6, -0.8], C.green);
              M.quad([u - a, ys, pa - a], [u - a, ys, pa + a], [u - c, yb, pa + c], [u - c, yb, pa - c], [-0.8, 0.6, 0], C.green);
              M.quad([u + a, ys, pa - a], [u + a, ys, pa + a], [u + c, yb, pa + c], [u + c, yb, pa - c], [0.8, 0.6, 0], C.green);
              M.quad([u - c, yb, pa - c], [u + c, yb, pa - c], [u + c, yb, pa + c], [u - c, yb, pa + c], [0, -1, 0], warm, HK.LAMP, 1, [[0, 0], [1, 0], [1, 1], [0, 1]]);
              stats.lamps++;
            }
          }
          if (un > 0 && un - lastBlade > 1 && r3 < (near ? 0.34 : 0.07) && nF >= 1) {
            lastBlade = un;    // blade sign on the pier between two shops
            const u = u0, cell = Math.floor(r4 * 31.99);
            if (r3 < (near ? 0.085 : 0.03) && nF >= 2) {          // vertical neon blade
              const y0 = gH + 0.55, y1 = Math.min(y0 + 2.5, yDeck - 1.2), pa = strP + 0.12, pb = pa + 0.62;
              const gc = NEONC[Math.floor(r1 * 5.99)];
              M.box(u - 0.07, u + 0.07, y0, y1, pa, pb, gc, SIDES5 | BACK, HK.NEON, Math.floor(r2 * 7.99), false, true, HK.NEON);
              M.beam([u, y1 - 0.25, 0], [u, y1 - 0.25, pa], 0.02, 0.02, C.black, 1 | 2 | 8);
              M.beam([u, y0 + 0.25, 0], [u, y0 + 0.25, pa], 0.02, 0.02, C.black, 1 | 2 | 8);
              if (lights) { const p = w.frame.P(u, 0, pb + 0.6); lights.add({ x: p[0], z: p[2], y: p[1] + (y0 + y1) / 2, color: gc, intensity: 0.32, radius: 5.5 }); }
              stats.neon++;
            } else {                              // painted board hanging from a bracket
              const yb = gH + 0.9, pa = strP + 0.1, pb = pa + 0.86;
              M.beam([u, yb, 0], [u, yb, pb + 0.06], 0.014, 0.02, C.black, 1 | 2 | 8);
              M.beam([u, yb - 0.42, 0], [u, yb - 0.02, pa + 0.36], 0.012, 0.012, C.black, 1 | 2 | 8);
              for (const pl of [pa + 0.1, pb - 0.1]) M.beam([u, yb - 0.02, pl], [u, yb - 0.1, pl], 0.008, 0.008, C.black, 1 | 2);
              M.box(u - 0.022, u + 0.022, yb - 0.62, yb - 0.1, pa, pb, SIGNC[Math.floor(r1 * 5.99)], SIDES5 | BACK, HK.SIGN, cell, false, true, HK.IRON);
              stats.blades++;
            }
          }
        }
      }

      T('shop');
      // ---- a bracket clock on a corner pier
      if (!clockDone && clockRoll < 0.07 && (P.groundType === 0 || P.groundType === 1) && st !== 'glass' && nF >= 2 && mg > 0.4) {
        const u = Math.min(mg * 0.5, 0.6), y0 = gH + 1.0, pa = strP + 0.3 + (P.finW > 0 ? P.finD : 0), pb = pa + 0.84;
        M.box(u - 0.11, u + 0.11, y0, y0 + 0.84, pa, pb, C.black, SIDES5 | BACK, HK.CLOCK, 0, false, true, HK.IRON);
        M.beam([u, y0 + 0.62, 0], [u, y0 + 0.62, pa], 0.025, 0.03, C.black);
        M.beam([u, y0 + 0.2, 0], [u, y0 + 0.2, pa], 0.025, 0.03, C.black);
        M.beam([u, y0 - 0.25, 0], [u, y0 + 0.2, pa - 0.02], 0.014, 0.014, C.black);
        clockDone = true; stats.clocks++;
      }

      // ---- flagpole over the entrance of larger stone buildings
      if (!poleDone && poleRoll < 0.75 && (st === 'stone' || st === 'deco' || st === 'brick') && P.groundType === 1 && nb >= 3 && W > 12) {
        const u = mg + Math.round(nb / 2) * bw, pw = P.finW > 0 ? P.finD : 0, y0 = gH + Math.min(0.45, P.sill * 0.5) + 0.2;
        M.box(u - 0.09, u + 0.09, y0 - 0.12, y0 + 0.12, pw, pw + 0.1, C.black, SIDES5);
        M.beam([u, y0, pw + 0.05], [u, y0 + 2.5, pw + 3.0], 0.032, 0.032, C.white);
        M.box(u - 0.06, u + 0.06, y0 + 2.5 - 0.02, y0 + 2.5 + 0.1, pw + 2.96, pw + 3.08, [0.5, 0.36, 0.1], SIDES5 | BACK);
        poleDone = true; stats.poles++;
      }
      T('misc');
    }
  });
  return stats;
}

// ---------------------------------------------------------------------------------------------------------
// material hooks
export const HW_VERT_PARS = /* glsl */`
attribute vec4 aHw;       // u, v (or height), kind, parameter
varying vec4 vHw;
`;
export const HW_VERT_MAIN = /* glsl */`vHw = aHw;`;

export const HW_FRAG_PARS = /* glsl */`
uniform sampler2D uSignTex;
uniform sampler2D uBladeTex;
varying vec4 vHw;
vec3 H_emis; float H_rough; float H_metal;
float hwSeg(vec2 p, vec2 a, vec2 b) { vec2 pa = p - a, ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)); }
vec3 hwMain(vec3 base) {
  float kind = floor(vHw.z + 0.5), prm = floor(vHw.w + 0.5);
  vec2 uv = vHw.xy; bool hasUv = uv.x > -0.5;
  float px = max(length(fwidth(vWPos)) * 0.7, 1e-4);   // pixel footprint in metres (fades micro detail)
  vec3 wp = vWPos * vec3(7.0, 2.2, 7.0);
  float n1 = vnoise(wp.xy + wp.zz * 1.3), n2 = vnoise(wp.xy * 4.3 + wp.zz * 5.1 + 9.0);
  float nearF = 1.0 - smoothstep(0.02, 0.10, px);
  H_emis = vec3(0.0); H_rough = 0.55; H_metal = 0.0;
  vec3 c = base;
  vec3 rustC = vec3(0.21, 0.075, 0.028);
  if (kind < 0.5) {                               // painted iron, rusting through
    c *= 0.75 + 0.5 * n1;
    float r = smoothstep(0.52, 0.80, n1 * 0.6 + n2 * 0.5);
    c = mix(c, rustC * (0.6 + 0.8 * n2), r * 0.75);
    H_rough = mix(0.5, 0.9, r);
  } else if (kind < 1.5) {                        // window air conditioner
    c *= 0.82 + 0.3 * n1;
    if (hasUv) {
      float gr = step(0.07, uv.x) * step(uv.x, 0.93) * step(0.10, uv.y) * step(uv.y, 0.80);
      float lv = 0.5 + 0.5 * sin(uv.y * 150.0);
      c *= 1.0 - gr * mix(0.38, 0.25 + 0.5 * lv, nearF);
      c = mix(c, c * 0.55, step(0.84, uv.y) * step(uv.x, 0.3) * nearF);
    }
    c = mix(c, rustC, smoothstep(0.62, 0.85, n2) * 0.35);
    H_rough = 0.6;
  } else if (kind < 2.5) {                        // painted hanging sign
    vec2 tuv = vec2((uv.x - 0.06) / 0.88, (uv.y - 0.5) * 2.35 + 0.5);
    float cell = prm;
    float inb = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
    float txt = texture2D(uSignTex, (vec2(mod(cell, 4.0), floor(cell / 4.0)) + clamp(tuv, 0.0, 1.0)) / vec2(4.0, 8.0)).r * inb;
    vec2 bd = min(uv, 1.0 - uv) * vec2(0.86, 0.52);
    float border = step(0.025, min(bd.x, bd.y)) * (1.0 - step(0.045, min(bd.x, bd.y)));
    vec3 ink = luminance(base) > 0.15 ? vec3(0.03, 0.025, 0.02) : vec3(0.62, 0.50, 0.24);
    c = mix(c * (0.8 + 0.35 * n1), ink, max(txt, border) * (1.0 - 0.5 * smoothstep(0.03, 0.12, px)));
    H_rough = 0.5;
  } else if (kind < 3.5) {                        // neon blade: enamelled box, tube lettering
    vec3 glow = base;
    float txt = hasUv ? texture2D(uBladeTex, vec2((prm + clamp(uv.x * 1.1 - 0.05, 0.0, 1.0)) / 8.0, clamp(uv.y * 1.06 - 0.03, 0.0, 1.0))).r : 0.0;
    vec2 bd = min(uv, 1.0 - uv) * vec2(0.62, 2.4);
    float border = hasUv ? step(0.03, min(bd.x, bd.y)) * (1.0 - step(0.055, min(bd.x, bd.y))) : 0.0;
    vec3 body = mix(vec3(0.02, 0.022, 0.03), glow * 0.10, 0.5) * (0.8 + 0.4 * n1);
    c = mix(body, mix(glow * 0.5 + 0.25, vec3(0.7), 0.3), max(txt, border * 0.6));
    float flick = 0.92 + 0.08 * sin(uTime * 37.0 + prm * 11.0);
    H_emis = glow * (txt * 16.0 + border * 5.0 + 0.25) * flick * uNight;
    H_rough = 0.35;
  } else if (kind < 4.5) {                        // bracket clock
    c = vec3(0.02, 0.022, 0.024) * (0.8 + 0.4 * n1);
    if (hasUv) {
      vec2 q = uv * 2.0 - 1.0; float r = length(q);
      float aa = max(px / 0.42, 0.01);
      float dial = 1.0 - smoothstep(0.84 - aa, 0.84 + aa, r);
      float ang = atan(q.x, q.y);
      float tick = (1.0 - smoothstep(0.035, 0.035 + aa * 2.0, abs(fract(ang / 6.2832 * 12.0 + 0.5) - 0.5) * r * 0.52)) * step(0.62, r) * step(r, 0.78);
      float hm = 1.0 - smoothstep(0.022, 0.022 + aa, hwSeg(q, vec2(0.0), 0.66 * vec2(sin(2.618), cos(2.618))));
      float hh = 1.0 - smoothstep(0.035, 0.035 + aa, hwSeg(q, vec2(0.0), 0.42 * vec2(sin(3.883), cos(3.883))));
      float ink = max(max(tick, hm), hh);
      vec3 face = vec3(0.62, 0.58, 0.48) * (0.9 + 0.2 * n1);
      c = mix(c, mix(face, vec3(0.02), ink), dial);
      H_emis = vec3(1.0, 0.80, 0.52) * (dial * (1.0 - 0.93 * ink) * 2.6 * (0.75 + 0.25 * (1.0 - r))) * uNight;
    }
    H_rough = 0.4;
  } else if (kind < 5.5) {                        // lamp: the lit underside of the shade
    float r = hasUv ? length(uv * 2.0 - 1.0) : 1.0;
    float bulb = 1.0 - smoothstep(0.25, 0.42, r);
    c = mix(vec3(0.55, 0.53, 0.48), vec3(0.8), bulb);
    H_emis = base * (bulb * 34.0 + 2.2) * uNight;
  } else if (kind < 6.5) {                        // downpipe
    c *= 0.72 + 0.5 * n1;
    float jt = 1.0 - smoothstep(0.0, 0.05, abs(fract(vHw.y / 1.83) - 0.5) * 1.83);
    c *= 1.0 - 0.3 * jt * nearF;
    c = mix(c, rustC * (0.7 + 0.6 * n2), smoothstep(0.55, 0.8, n1 * 0.55 + n2 * 0.5) * 0.6);
    c *= 1.0 - 0.45 * exp(-max(vHw.y, 0.0) / 0.7);
    H_rough = 0.6; H_metal = 0.15;
  } else {                                        // tin: roller-shutter box
    c *= 0.78 + 0.4 * n1;
    c *= mix(1.0, 0.8 + 0.2 * step(0.5, fract(vHw.y / 0.09)), nearF * (1.0 - step(0.5, prm)));
    c = mix(c, rustC, smoothstep(0.66, 0.9, n2) * 0.3);
    H_rough = 0.5; H_metal = 0.3;
  }
  return c;
}
`;
export const HW_HOOK_COLOR = /* glsl */`diffuseColor.rgb = hwMain(diffuseColor.rgb);`;
export const HW_HOOK_SURFACE = /* glsl */`roughnessFactor = H_rough; metalnessFactor = H_metal;`;
export const HW_HOOK_EMISSIVE = /* glsl */`totalEmissiveRadiance += H_emis;`;
export const HW_DEFINES = { NO_CITY_AO: 1 };
export const HW_HOOK_AO = /* glsl */`
  { float h_ = textureLod(uCityHeight, (vWPos.xz + vWNormal.xz * 16.0 - uCityRect.xy) / uCityRect.zw, 0.0).r;
    float m_ = max(h_ - vWPos.y - 0.5, 0.0) / 16.0; float cv_ = 1.0 / (1.0 + m_ * m_);
    reflectedLight.indirectDiffuse *= mix(1.0, cv_, 0.78); reflectedLight.indirectSpecular *= mix(1.0, cv_, 0.6); }
`;
