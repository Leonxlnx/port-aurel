// Merged building geometry: tier walls, roof slabs, parapets, gables and pitched roofs, cornices, string courses,
// deco piers, awnings, balconies. Every vertex carries the wall-space data the facade shader needs.
import { mulberry32 } from '../layout.js';
import { bayGrid, FLAG } from './params.js';

// kinds (aFWall.w): 0 facade with windows, 1 plain wall, 2 flat roof deck, 3 trim (stone/plaster, colB),
// 4 pitched roof covering, 5 awning canvas, 6 dark metal, 7 gable front (plain wall + attic oculus)
export const KIND = { FACADE: 0, WALL: 1, DECK: 2, TRIM: 3, ROOF: 4, AWNING: 5, METAL: 6, GABLE: 7 };

const SIDES = {
  s: { n: [0, 1], t: [1, 0], o: (X0, X1, Z0, Z1) => [X0, Z1], W: (X0, X1, Z0, Z1) => X1 - X0, L: 'w', R: 'e', i: 0 },
  n: { n: [0, -1], t: [-1, 0], o: (X0, X1, Z0, Z1) => [X1, Z0], W: (X0, X1, Z0, Z1) => X1 - X0, L: 'e', R: 'w', i: 1 },
  w: { n: [-1, 0], t: [0, 1], o: (X0, X1, Z0, Z1) => [X0, Z0], W: (X0, X1, Z0, Z1) => Z1 - Z0, L: 'n', R: 's', i: 2 },
  e: { n: [1, 0], t: [0, -1], o: (X0, X1, Z0, Z1) => [X1, Z1], W: (X0, X1, Z0, Z1) => Z1 - Z0, L: 's', R: 'n', i: 3 },
};
export const SIDE_KEYS = ['w', 'e', 'n', 's'];

export function makeFrame(s, X0, X1, Z0, Z1, G) {
  const d = SIDES[s]; const o = d.o(X0, X1, Z0, Z1);
  return {
    s, W: d.W(X0, X1, Z0, Z1), n: d.n, t: d.t, o, L: d.L, R: d.R, i: d.i,
    P(u, y, p = 0) { return [o[0] + d.t[0] * u + d.n[0] * p, G + y, o[1] + d.t[1] * u + d.n[1] * p]; },
    dir(nu, ny, np) { return [d.t[0] * nu + d.n[0] * np, ny, d.t[1] * nu + d.n[1] * np]; },
  };
}

export class Mesher {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.wall = []; this.tier = []; this.idx = []; this.nv = 0; }
  /** convex polygon (3..n world points); winding is fixed so that it faces along n. A = {wall, tier, opp} */
  poly(pts, uvs, n, A) {
    const a = pts[0], b = pts[1], c = pts[2];
    const cx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const cy = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const k = pts.length, base = this.nv;
    for (let i = 0; i < k; i++) {
      const j = flip ? k - 1 - i : i; const p = pts[j], q = uvs[j];
      this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(q[0], q[1], A.opp[0], A.opp[1]);
      this.wall.push(A.wall[0], A.wall[1], A.wall[2], A.wall[3]);
      this.tier.push(A.tier[0], A.tier[1], A.tier[2], A.tier[3]);
    }
    for (let i = 1; i < k - 1; i++) this.idx.push(base, base + i, base + i + 1);
    this.nv += k;
  }
}

// ---- frame-space face helpers (u along the wall, y height above street, p out of the wall) ----------------
function wallQ(M, F, u0, u1, y0, y1, p, A) {
  M.poly([F.P(u0, y0, p), F.P(u1, y0, p), F.P(u1, y1, p), F.P(u0, y1, p)], [[u0, y0], [u1, y0], [u1, y1], [u0, y1]], F.dir(0, 0, 1), A);
}
function backQ(M, F, u0, u1, y0, y1, p, A) {
  M.poly([F.P(u0, y0, p), F.P(u1, y0, p), F.P(u1, y1, p), F.P(u0, y1, p)], [[u0, y0], [u1, y0], [u1, y1], [u0, y1]], F.dir(0, 0, -1), A);
}
// horizontal face between depths p0 (inner) and p1 (outer); m0/m1 extend the outer edge (mitres)
function horizQ(M, F, u0, u1, y, p0, p1, up, A, m0 = 0, m1 = 0) {
  M.poly([F.P(u0, y, p0), F.P(u1, y, p0), F.P(u1 + m1, y, p1), F.P(u0 - m0, y, p1)], [[u0, p0], [u1, p0], [u1 + m1, p1], [u0 - m0, p1]], [0, up ? 1 : -1, 0], A);
}
function sideQ(M, F, u, y0, y1, p0, p1, sgn, A) {
  M.poly([F.P(u, y0, p0), F.P(u, y0, p1), F.P(u, y1, p1), F.P(u, y1, p0)], [[p0, y0], [p1, y0], [p1, y1], [p0, y1]], F.dir(sgn, 0, 0), A);
}
/** projecting band (cornice / string course): front, top, bottom and end caps (or mitres into the next side) */
function band(M, F, u0, u1, y0, y1, p0, p1, mitL, mitR, A, { top = true, bottom = true } = {}) {
  const d = p1 - p0;
  const a = u0 - (mitL ? d : 0), b = u1 + (mitR ? d : 0);
  wallQ(M, F, a, b, y0, y1, p1, A);
  if (top) horizQ(M, F, u0, u1, y1, p0, p1, true, A, mitL ? d : 0, mitR ? d : 0);
  if (bottom) horizQ(M, F, u0, u1, y0, p0, p1, false, A, mitL ? d : 0, mitR ? d : 0);
  if (!mitL) sideQ(M, F, u0, y0, y1, p0, p1, -1, A);
  if (!mitR) sideQ(M, F, u1, y0, y1, p0, p1, 1, A);
}
function fbox(M, F, u0, u1, y0, y1, p0, p1, A, { front = true, back = false, left = true, right = true, top = true, bottom = false } = {}) {
  if (front) wallQ(M, F, u0, u1, y0, y1, p1, A);
  if (back) backQ(M, F, u0, u1, y0, y1, p0, A);
  if (left) sideQ(M, F, u0, y0, y1, p0, p1, -1, A);
  if (right) sideQ(M, F, u1, y0, y1, p0, p1, 1, A);
  if (top) horizQ(M, F, u0, u1, y1, p0, p1, true, A);
  if (bottom) horizQ(M, F, u0, u1, y0, p0, p1, false, A);
}

/** who stands across the street from a wall: [height of its street wall, distance] */
export function makeOppFinder(buildings) {
  const cell = 64; const grid = new Map();
  const key = (i, j) => i * 4096 + j;
  for (const b of buildings) {
    for (let i = Math.floor(b.x0 / cell); i <= Math.floor(b.x1 / cell); i++) for (let j = Math.floor(b.z0 / cell); j <= Math.floor(b.z1 / cell); j++) {
      const k = key(i + 64, j + 64); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(b);
    }
  }
  const at = (x, z) => { const l = grid.get(key(Math.floor(x / cell) + 64, Math.floor(z / cell) + 64)); if (l) for (const b of l) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b; return null; };
  return (b, F) => {
    for (let d = 5; d <= 80; d += 2.5) {
      const p = F.P(F.W / 2, 0, d); const o = at(p[0], p[2]);
      if (o && o !== b) return [o.tiers[0].y1, d];
    }
    return [0, 80];
  };
}

function gableOutline(shape, W, yTop, R) {
  const E = 0.10;
  if (shape === 0) {            // pediment
    const rise = Math.min(4.6, Math.max(2.5, W * 0.24));
    return { rise, pts: [[-E, yTop], [W * 0.08, yTop], [W / 2, yTop + rise], [W * 0.92, yTop], [W + E, yTop]] };
  }
  if (shape === 1) {            // crow steps
    const n = W > 15 ? 5 : 4; const rise = Math.min(5.2, Math.max(2.8, W * 0.27));
    const plat = Math.min(1.8, W * 0.14); const sw = (W / 2 - plat / 2 - W * 0.05) / n, sh = rise / n;
    const pts = [[-E, yTop]]; let x = W * 0.05, y = yTop;
    for (let i = 0; i < n; i++) { pts.push([x, y]); y += sh; pts.push([x, y]); x += sw; }
    pts.push([W / 2 - plat / 2, y]);
    const left = pts.slice(1);
    for (let i = left.length - 1; i >= 0; i--) pts.push([W - left[i][0], left[i][1]]);
    pts.push([W + E, yTop]);
    return { rise, pts };
  }
  // raised centre block with shoulders
  const rise = 1.5 + R() * 0.7; const a = W * (0.24 + R() * 0.08);
  return { rise: 0, pts: [[-E, yTop], [a - 0.9, yTop], [a - 0.9, yTop + rise * 0.45], [a, yTop + rise * 0.45], [a, yTop + rise], [W - a, yTop + rise], [W - a, yTop + rise * 0.45], [W - a + 0.9, yTop + rise * 0.45], [W - a + 0.9, yTop], [W + E, yTop]] };
}

/**
 * Build every building into the mesher. Returns per-building info (bay grids, roofs) for other modules.
 */
export function buildAll(M, buildings, params, G, lights) {
  const oppOf = makeOppFinder(buildings);
  const info = new Map();
  const pitchedIds = new Set();
  const PO = 0.10, PI_ = 0.42;        // parapet slab: outer face offset, inner face depth

  buildings.forEach((b, bid) => {
    const P = params[bid];
    const R = mulberry32((b.seed ^ 0x2c1b3c6d) >>> 0);
    const lantern = b.landmark === 'lantern';
    const nT = b.tiers.length;
    const binfo = { id: b.id, roofType: P.roofType, walls: [], parapetTop: [], ridgeY: null, P };
    info.set(b.id, binfo);
    const bx = b.x1 - b.x0, bz = b.z1 - b.z0;
    // main facade (false gable / pitched orientation)
    const ridgeAlongX = bx >= bz;
    const gableSides = ridgeAlongX ? ['w', 'e'] : ['n', 's'];
    let mainSide = b.district === 'quay' ? 'w' : gableSides.find(s => b.open[s]) || SIDE_KEYS.find(s => b.open[s]) || 'w';
    if (P.roofType === 3 && !b.open[mainSide]) P.roofType = 0;
    binfo.roofType = P.roofType;
    const priorityNS = P.roofType === 3 ? (mainSide === 'n' || mainSide === 's') : true;
    const signRoll = R();

    for (let ti = 0; ti < nT; ti++) {
      const t = b.tiers[ti], top = ti === nT - 1;
      const X0 = b.x0 + t.inset, X1 = b.x1 - t.inset, Z0 = b.z0 + t.inset, Z1 = b.z1 - t.inset;
      if (X1 - X0 < 1 || Z1 - Z0 < 1) continue;
      const yBase = ti === 0 ? -1.2 : t.y0, yDeck = t.y1;
      const pitched = top && P.roofType === 1;
      const hp = lantern ? 1.45 : 1.3;
      const yTop = yDeck + hp;
      const tY0 = ti === 0 ? 0 : t.y0;
      const isOpen = s => (ti === 0 || t.inset < 0.01) ? !!b.open[s] : true;
      const span = ridgeAlongX ? (Z1 - Z0) : (X1 - X0);
      const rise = Math.min(span * 0.36, 8.5);
      const yRidge = yTop + rise;
      if (pitched) { pitchedIds.add(b.id); binfo.ridgeY = G + yRidge; binfo.eaveY = G + yTop; binfo.ridgeAlongX = ridgeAlongX; }
      binfo.parapetTop.push(G + yTop);

      // flat deck
      if (!pitched) {
        M.poly([[X0, G + yDeck, Z0], [X1, G + yDeck, Z0], [X1, G + yDeck, Z1], [X0, G + yDeck, Z1]], [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]], [0, 1, 0],
          { wall: [0, 0, 0, KIND.DECK], tier: [tY0, yDeck, b.seed % 4093, bid], opp: [0, 80] });
      }

      for (const s of SIDE_KEYS) {
        const F = makeFrame(s, X0, X1, Z0, Z1, G);
        const W = F.W;
        const open = isOpen(s);
        const wseed = (b.seed + F.i * 977 + ti * 311) % 4093;
        let opp = [0, 80];
        if (open) { const F0 = makeFrame(s, b.x0, b.x1, b.z0, b.z1, G); const o = oppOf(b, F0); opp = [o[0], o[1] + t.inset]; }
        const grid = bayGrid(W, P);
        const facade = open && grid.ok;
        const tier = [tY0, yDeck, wseed, bid];
        const A = { wall: facade ? [W, grid.nb, grid.margin, KIND.FACADE] : [W, 0, 0, KIND.WALL], tier, opp };
        const Aw = { wall: [W, 0, 0, KIND.WALL], tier, opp };
        const At = { wall: [W, 0, 0, KIND.TRIM], tier, opp };
        const Am = { wall: [W, 0, 0, KIND.METAL], tier, opp };
        // (awn: shop units with an awning; balc: balcony cells; both read by the hardware builder)
        const wrec = { side: s, tier: ti, open, facade, W, nb: grid.nb, margin: grid.margin, bw: grid.bw, frame: F, yDeck, yTop, wseed, awn: [], balc: [], ironBalc: false };
        binfo.walls.push(wrec);

        // ---- the wall (a few blank party walls carry a faded painted sign near the top)
        const ghost = !facade && !open && ti === 0 && W > 13 && yDeck > 14 && (b.style === 'brick' || b.style === 'stucco') && ((b.seed >> 3) + F.i * 7) % 9 === 0;
        wallQ(M, F, 0, W, yBase, yDeck, 0, ghost ? { wall: [W, 1.5 + (b.seed % 5) * 0.15, yDeck - 2.6, KIND.WALL], tier, opp } : A);

        // ---- parapet slab / gables above the deck
        const isGableSide = gableSides.includes(s);
        let outline = null, gRise = 0;
        if (pitched && isGableSide) { outline = [[-PO, yTop], [W / 2, yRidge], [W + PO, yTop]]; gRise = rise; }
        else if (top && P.roofType === 3 && s === mainSide) { const g = gableOutline(P.gableShape, W, yTop, R); outline = g.pts; gRise = g.rise; binfo.gableTop = G + Math.max(...g.pts.map(q => q[1])); }
        // painted lettering on the parapet band of warehouse fronts
        const signV = (top && open && s === mainSide && (P.flags & FLAG.warehouse) && W > 9 && signRoll < 0.7) ? yDeck + 0.66 : 0;
        if (!outline) {
          wallQ(M, F, -PO, W + PO, yDeck, yTop, PO, signV ? { wall: [W, 0, signV, KIND.WALL], tier, opp } : Aw);
          if (!pitched) {
            backQ(M, F, PI_, W - PI_, yDeck, yTop, -PI_, Aw);
            const full = (s === 'n' || s === 's') === priorityNS;
            horizQ(M, F, full ? -PO : PI_, full ? W + PO : W - PI_, yTop, -PI_, PO, true, At);
          }
        } else {
          const Ag = { wall: [W, gRise, signV, KIND.GABLE], tier: [tY0, yTop, wseed, bid], opp };
          for (let i = 0; i < outline.length - 1; i++) {
            const a = outline[i], c = outline[i + 1];
            if (c[0] - a[0] > 1e-4) {
              const pts = [[a[0], yDeck], [c[0], yDeck], [c[0], c[1]], [a[0], a[1]]];
              M.poly(pts.map(q => F.P(q[0], q[1], PO)), pts, F.dir(0, 0, 1), Ag);
              if (!pitched) {
                const ia = Math.max(a[0], PI_), ic = Math.min(c[0], W - PI_);
                if (ic - ia > 1e-3) {
                  const ya = a[1] + (c[1] - a[1]) * (ia - a[0]) / (c[0] - a[0]), yc = a[1] + (c[1] - a[1]) * (ic - a[0]) / (c[0] - a[0]);
                  const pb = [[ia, yDeck], [ic, yDeck], [ic, yc], [ia, ya]];
                  M.poly(pb.map(q => F.P(q[0], q[1], -PI_)), pb, F.dir(0, 0, -1), Aw);
                }
              }
            }
            if (!pitched) {       // coping strips along the outline (also the vertical step faces)
              const du = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(du, dy); if (len < 1e-4) continue;
              M.poly([F.P(a[0], a[1], -PI_), F.P(c[0], c[1], -PI_), F.P(c[0], c[1], PO), F.P(a[0], a[1], PO)], [[a[0], -PI_], [c[0], -PI_], [c[0], PO], [a[0], PO]], F.dir(-dy / len, du / len, 0), At);
            }
          }
          if (pitched) {          // verge trim along both slopes
            for (let i = 0; i < 2; i++) {
              const a = outline[i], c = outline[i + 1];
              const du = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(du, dy);
              const q0 = PO, q1 = PO + 0.12, lo = -0.28, hi = 0.07;
              M.poly([F.P(a[0], a[1] + lo, q1), F.P(c[0], c[1] + lo, q1), F.P(c[0], c[1] + hi, q1), F.P(a[0], a[1] + hi, q1)], [[a[0], a[1]], [c[0], c[1]], [c[0], c[1] + 0.35], [a[0], a[1] + 0.35]], F.dir(0, 0, 1), At);
              M.poly([F.P(a[0], a[1] + hi, q1), F.P(c[0], c[1] + hi, q1), F.P(c[0], c[1] + hi, q0 - 0.3), F.P(a[0], a[1] + hi, q0 - 0.3)], [[a[0], 0], [c[0], 0], [c[0], 0.4], [a[0], 0.4]], F.dir(-dy / len, du / len, 0), At);
              M.poly([F.P(a[0], a[1] + lo, q0), F.P(c[0], c[1] + lo, q0), F.P(c[0], c[1] + lo, q1), F.P(a[0], a[1] + lo, q1)], [[a[0], 0], [c[0], 0], [c[0], 0.12], [a[0], 0.12]], F.dir(dy / len, -du / len, 0), At);
            }
          }
        }
        // underside of the parapet projection
        { const full = (s === 'n' || s === 's'); horizQ(M, F, full ? -PO : 0, full ? W + PO : W, yDeck, 0, PO, false, At); }

        // ---- pitched roof slope on the eave sides
        if (pitched && !isGableSide) {
          const run = span / 2 + PO, sl = Math.hypot(run, rise);
          M.poly([F.P(-PO, yTop, PO), F.P(W + PO, yTop, PO), F.P(W + PO, yRidge, -span / 2), F.P(-PO, yRidge, -span / 2)],
            [[0, 0], [W + 2 * PO, 0], [W + 2 * PO, sl], [0, sl]], F.dir(0, run / sl, rise / sl),
            { wall: [W, 0, 0, KIND.ROOF], tier, opp });
          band(M, F, -PO, W + PO, yTop - 0.2, yTop + 0.02, PO, PO + 0.16, false, false, At);     // eaves board / gutter
        }

        // ---- cornice at the deck line (open sides)
        if (open && P.corniceP > 0.01) {
          const mL = isOpen(F.L), mR = isOpen(F.R);
          const cp = P.corniceP, ch = P.corniceH;
          if (P.corniceSteps > 1) {
            band(M, F, 0, W, yDeck - ch, yDeck - ch * 0.45, 0, cp * 0.5, mL, mR, At, { top: false });
            band(M, F, 0, W, yDeck - ch * 0.45, yDeck + 0.12, 0, cp, mL, mR, At);
          } else band(M, F, 0, W, yDeck - ch, yDeck + 0.12, 0, cp, mL, mR, At);
        }

        if (ti === 0 && open) {
          // ---- string course above the ground floor
          if (P.stringP > 0.01 || P.groundType === 0) {
            const sp = Math.max(P.stringP, P.groundType === 0 ? 0.14 : 0);
            band(M, F, 0, W, P.groundH - 0.12, P.groundH + 0.16, 0, sp, isOpen(F.L), isOpen(F.R), At);
          }
        }

        if (facade) {
          const { nb, margin, bw } = grid;
          // ---- deco piers
          if (P.finW > 0) {
            const fy0 = ti === 0 ? P.groundH + 0.16 : t.y0;
            const fy1 = yTop + (top || lantern ? P.finTop : P.finTop * 0.5);
            for (let i = 0; i <= nb; i++) {
              const uc = margin + i * bw;
              fbox(M, F, uc - P.finW / 2, uc + P.finW / 2, fy0, fy1, 0, P.finD, At);
            }
            if (lantern) {       // corner buttresses and base plinths under the piers
              fbox(M, F, 0, margin - P.finW / 2 - 0.25, fy0, yTop + 0.9, 0, 0.22, At);
              fbox(M, F, W - (margin - P.finW / 2 - 0.25), W, fy0, yTop + 0.9, 0, 0.22, At);
            }
          }
          if (ti === 0) {
            // ---- awnings over shopfronts
            if (P.groundType === 0 && P.awnProb > 0) {
              const span_ = P.shopSpan, nU = Math.ceil(nb / span_);
              for (let un = 0; un < nU; un++) {
                const ub0 = un * span_, n = Math.min(span_, nb - ub0);
                if (R() >= P.awnProb) { R(); R(); continue; }
                wrec.awn.push(un);
                const u0 = margin + ub0 * bw + 0.22, u1 = margin + (ub0 + n) * bw - 0.22;
                const ya = P.groundH - 1.3, aw = 1.15 + R() * 0.5, drop = 0.6 + R() * 0.25, yf = ya - drop;
                const Aa = { wall: [W, 0, 0, KIND.AWNING], tier: [tY0, yDeck, (b.seed + un * 131 + F.i * 17) % 4093, bid], opp };
                const sl = Math.hypot(aw, drop);
                const pts = [F.P(u0, ya, 0.03), F.P(u1, ya, 0.03), F.P(u1, yf, aw), F.P(u0, yf, aw)], uvs = [[u0, 0], [u1, 0], [u1, sl], [u0, sl]];
                M.poly(pts, uvs, F.dir(0, aw / sl, drop / sl), Aa);
                M.poly(pts, uvs, F.dir(0, -aw / sl, -drop / sl), Aa);
                wallQ(M, F, u0, u1, yf - 0.22, yf, aw, Aa);
                backQ(M, F, u0, u1, yf - 0.22, yf, aw, Aa);
              }
            }
            // ---- lobby canopy on towers
            if (P.groundType === 1 && !lantern && nb >= 3 && R() < 0.6) {
              const c = Math.floor(nb / 2), u0 = margin + c * bw - 0.2, u1 = margin + (c + 1) * bw + 0.2;
              fbox(M, F, u0, u1, P.groundH - 1.05, P.groundH - 0.85, 0, 2.2, Am, { bottom: true });
            }
            // ---- balconies in front of french windows
            if (P.balcony > 0) {
              const hw = Math.min(P.winW / 2 + 0.32, bw / 2 - 0.06);
              const iron = (b.seed % 5) < 2;        // iron railings (built by hardware.js) instead of masonry parapets
              wrec.ironBalc = iron;
              // whole columns of bays carry balconies (occasionally skipping a floor)
              const cols = []; for (let i = 0; i < nb; i++) cols.push(R() < P.balcony);
              if (nb >= 3 && !cols.some(c => c)) cols[Math.floor(nb / 2)] = true;
              for (let fl = 0; P.groundH + fl * P.floorH + P.sill + P.winH <= yDeck - 0.4; fl++) {
                const yf = P.groundH + fl * P.floorH;
                for (let i = 0; i < nb; i++) {
                  if (!cols[i] || R() < 0.12) continue;
                  const uc = margin + (i + 0.5) * bw, d = 0.78;
                  fbox(M, F, uc - hw, uc + hw, yf - 0.16, yf + 0.02, 0, d, At, { bottom: true });
                  wrec.balc.push({ fl, i, uc, hw, yf, d });
                  if (iron) continue;
                  fbox(M, F, uc - hw, uc + hw, yf + 0.02, yf + 0.95, d - 0.1, d, At, { back: true });
                  fbox(M, F, uc - hw, uc - hw + 0.1, yf + 0.02, yf + 0.95, 0, d - 0.1, At, { front: false });
                  fbox(M, F, uc + hw - 0.1, uc + hw, yf + 0.02, yf + 0.95, 0, d - 0.1, At, { front: false });
                }
              }
            }
            // ---- night light pools in front of shops and lobbies
            if (lights && (P.groundType === 0 || P.groundType === 1)) {
              const n = Math.max(1, Math.round(W / 9));
              for (let i = 0; i < n; i++) {
                if (R() < 0.3) continue;
                const p = F.P((i + 0.5) * W / n, 0, 2.2);
                const warm = R() < 0.75;
                lights.add({ x: p[0], z: p[2], y: G + 3.0, color: warm ? [1.0, 0.76, 0.5] : [0.82, 0.9, 1.0], intensity: P.groundType === 1 ? 0.6 : 0.45 + R() * 0.3, radius: 6.5 });
              }
            }
          }
        }
        // ---- warehouse hoist beam on the gable
        if (outline && gRise > 2.3 && (P.flags & FLAG.warehouse) && open) {
          const apex = Math.max(...outline.map(q => q[1]));
          fbox(M, F, W / 2 - 0.11, W / 2 + 0.11, apex - 1.25, apex - 1.0, PO, PO + 1.5, Am, { bottom: true });
          fbox(M, F, W / 2 - 0.05, W / 2 + 0.05, apex - 1.75, apex - 1.25, PO + 1.25, PO + 1.35, Am, { back: true, bottom: true });
        }
      }

      // ---- chimneys on pitched roofs
      if (pitched) {
        const len = ridgeAlongX ? X1 - X0 : Z1 - Z0;
        const n = len > 30 ? 3 : 2;
        for (let i = 0; i < n; i++) {
          const f = (i + 0.5) / n + (R() - 0.5) * 0.25, off = (R() - 0.5) * span * 0.35;
          const cw = 0.9 + R() * 0.5, cd = 0.7;
          const cx = ridgeAlongX ? X0 + len * f : (X0 + X1) / 2 + off, cz = ridgeAlongX ? (Z0 + Z1) / 2 + off : Z0 + len * f;
          const hx = (ridgeAlongX ? cw : cd) / 2, hz = (ridgeAlongX ? cd : cw) / 2;
          const y0 = yRidge - Math.abs(off) * rise / (span / 2) - 0.6, y1 = yRidge + 1.1 + R() * 0.8;
          for (const s of SIDE_KEYS) {
            const F = makeFrame(s, cx - hx, cx + hx, cz - hz, cz + hz, G);
            const A = { wall: [F.W, 0, 0, KIND.WALL], tier: [0, y1, (b.seed + i * 53) % 4093, bid], opp: [0, 80] };
            wallQ(M, F, 0, F.W, y0, y1, 0, A);
            band(M, F, 0, F.W, y1 - 0.18, y1 + 0.02, 0, 0.07, true, true, { ...A, wall: [F.W, 0, 0, KIND.TRIM] });
          }
          M.poly([[cx - hx, G + y1, cz - hz], [cx + hx, G + y1, cz - hz], [cx + hx, G + y1, cz + hz], [cx - hx, G + y1, cz + hz]], [[0, 0], [1, 0], [1, 1], [0, 1]], [0, 1, 0],
            { wall: [1, 0, 0, KIND.METAL], tier: [0, y1, 1, bid], opp: [0, 80] });
        }
      }
    }
  });
  return { info, pitchedIds };
}
