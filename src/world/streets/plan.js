// Street plan derived deterministically from layout.js: street cross-sections, the ground cell grid
// (roads / sidewalks / paving / parks with real curb geometry) and placement helpers for furniture.
import { GROUND_Y } from '../layout.js';

export const CURB_H = 0.15;

const AVE_NAMES = ['Harbor Ave', 'Viaduct Ave', 'Mercer Ave', 'Orchard Ave', 'Foundry Ave', 'Beacon Ave', 'Basin Ave', 'Lantern Ave', 'Kiln Ave', 'Aster Ave', 'Juniper Ave', 'Hill Ave', 'East Rd'];
const ST_NAMES_N = ['Rope St', 'Lamp St', 'Anchor St', 'Salt St', 'Market St', 'Cooper St', 'Sailmaker St', 'Pier St', 'Tanner St', 'Gull St'];   // going north from the canal
const ST_NAMES_S = ['Ferry St', 'Amber St', 'Dock St', 'Chandler St', 'Tide St', 'Mill St', 'Vesper St', 'Dusk St'];                               // going south

/** signed distance to the gravel paths of a park block (local coords l = (x,z) from centre, h = half size); < 0 on a path */
export function parkPathDist(lx, lz, hx, hz) {
  const rad = 6, inset = 8;
  const qx = Math.abs(lx) - (hx - inset - rad), qz = Math.abs(lz) - (hz - inset - rad);
  const dr = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - rad;
  let d = Math.abs(dr) - 1.3;
  d = Math.min(d, Math.max(Math.abs(lx) - 1.3, Math.abs(lz) - hz));
  d = Math.min(d, Math.max(Math.abs(lz) - 1.3, Math.abs(lx) - hx));
  d = Math.min(d, Math.hypot(lx, lz) - 6.5);
  return d;
}
export const PARK_PATH_GLSL = /* glsl */`
float parkPathDist(vec2 l, vec2 h) {
  vec2 q = abs(l) - (h - 8.0 - 6.0);
  float dr = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 6.0;
  float d = abs(dr) - 1.3;
  d = min(d, max(abs(l.x) - 1.3, abs(l.y) - h.y));
  d = min(d, max(abs(l.y) - 1.3, abs(l.x) - h.x));
  d = min(d, length(l) - 6.5);
  return d;
}`;

export function buildPlan(L) {
  const QX = L.QUAY_X, B = L.bounds, cols = L.cols, rows = L.rows;
  const EXT = { x0: QX, x1: L.hills.x0 + 16, z0: B.z0 - 150, z1: B.z1 + 150 };
  const PROM = { x0: QX, x1: cols[0].x0, z0: B.z0 - 40, z1: B.z1 + 40 };
  const PLAZA = { x0: L.basin.x0 - 14, x1: 0, z0: L.basin.z0 - 14, z1: L.basin.z1 + 14 };
  const MED = { z0: L.canal.z0, z1: L.canal.z1, p0: (L.canal.z0 + L.canal.z1) / 2 - 1.5, p1: (L.canal.z0 + L.canal.z1) / 2 + 1.5 };

  // ---- street cross-sections -------------------------------------------------------------------
  const aves = [];
  const mkAve = (id, x0, x1, tram, perim = false) => {
    const w = x1 - x0, sw = w >= 24 ? 4.5 : 4.0;
    return { id, x0, x1, cx: (x0 + x1) / 2, w, sw, hw: w / 2 - sw, tram, perim, medHW: tram ? 4.4 : 0, parkW: tram ? 2.4 : 2.3, center: w >= 24 ? 1 : 0, wide: w >= 24 };
  };
  for (const s of L.streets) if (s.dir === 'NS' && s.kind !== 'promenade') aves.push(mkAve(s.id, s.x0, s.x1, s.kind === 'tramAvenue'));
  aves.push(mkAve('aveE', B.x1, B.x1 + 20, false, true));
  aves.forEach((a, i) => { a.idx = i; a.name = AVE_NAMES[i] || `Ave ${i + 1}`; });
  PLAZA.x1 = aves.find(a => a.x0 > L.lantern.x + L.lantern.w / 2 + 16).x0;

  const sts = [];
  const QSW = 3.4;
  const mkSt = (id, z0, z1, quay = null, perim = false) => {
    const w = z1 - z0;
    if (quay === 'N') return { id, z0, z1, w, quay, sw: QSW, rz0: z0 + QSW, rz1: z1, cz: (z0 + QSW + z1) / 2, hw: (w - QSW) / 2, oneWay: -1, parkW: 2.2, center: 2, wide: false };
    if (quay === 'S') return { id, z0, z1, w, quay, sw: QSW, rz0: z0, rz1: z1 - QSW, cz: (z0 + z1 - QSW) / 2, hw: (w - QSW) / 2, oneWay: 1, parkW: 2.2, center: 2, wide: false };
    const sw = w >= 20 ? 4.0 : 3.5;
    return { id, z0, z1, w, quay: null, perim, sw, rz0: z0 + sw, rz1: z1 - sw, cz: (z0 + z1) / 2, hw: w / 2 - sw, oneWay: 0, parkW: w >= 20 ? 2.3 : 2.2, center: 2, wide: w >= 20 };
  };
  sts.push(mkSt('stN', B.z0 - 20, B.z0, null, true));
  for (const s of L.streets) if (s.dir === 'EW') sts.push(mkSt(s.id, s.z0, s.z1, s.kind === 'canalQuay' ? (s.id === 'canalN' ? 'N' : 'S') : null));
  sts.push(mkSt('stS', B.z1, B.z1 + 20, null, true));
  sts.sort((a, b) => a.z0 - b.z0);
  {
    let k = 0;
    const north = sts.filter(s => !s.quay && s.z1 <= L.canal.z0).reverse(), south = sts.filter(s => !s.quay && s.z0 >= L.canal.z1);
    north.forEach((s, i) => { s.name = s.perim ? 'North Rd' : (ST_NAMES_N[i] || `N ${i + 1} St`); });
    south.forEach((s, i) => { s.name = s.perim ? 'South Rd' : (ST_NAMES_S[i] || `S ${i + 1} St`); });
    sts.forEach((s, i) => { s.idx = i; if (s.quay) s.name = s.quay === 'N' ? 'North Quay' : 'South Quay'; if (!s.quay && !s.wide) s.oneWay = (k++ % 2) ? 1 : -1; });
  }

  // ---- bands -----------------------------------------------------------------------------------
  const xB = [{ a: QX, b: QX + 1.2, k: 'coping' }, { a: QX + 1.2, b: cols[0].x0, k: 'prom' }];
  for (let i = 0; i < cols.length; i++) {
    xB.push({ a: cols[i].x0, b: cols[i].x1, k: 'col', i });
    const av = aves[i];
    xB.push({ a: av.x0, b: av.x0 + av.sw, k: 'ave', ref: av, part: 'swW' });
    if (av.tram) {
      xB.push({ a: av.x0 + av.sw, b: av.cx - av.medHW, k: 'ave', ref: av, part: 'roadW' });
      xB.push({ a: av.cx - av.medHW, b: av.cx + av.medHW, k: 'ave', ref: av, part: 'median' });
      xB.push({ a: av.cx + av.medHW, b: av.x1 - av.sw, k: 'ave', ref: av, part: 'roadE' });
    } else xB.push({ a: av.x0 + av.sw, b: av.x1 - av.sw, k: 'ave', ref: av, part: 'road' });
    xB.push({ a: av.x1 - av.sw, b: av.x1, k: 'ave', ref: av, part: 'swE' });
  }
  xB.push({ a: aves[aves.length - 1].x1, b: EXT.x1, k: 'out' });

  const zB = [{ a: EXT.z0, b: sts[0].z0, k: 'out' }, { a: sts[sts.length - 1].z1, b: EXT.z1, k: 'out' }, { a: L.canal.z0, b: L.canal.z1, k: 'canal' }];
  for (const r of rows) zB.push({ a: r.z0, b: r.z1, k: 'row', j: r.j });
  for (const s of sts) {
    if (s.rz0 > s.z0) zB.push({ a: s.z0, b: s.rz0, k: 'st', ref: s, part: 'swN' });
    zB.push({ a: s.rz0, b: s.rz1, k: 'st', ref: s, part: 'road' });
    if (s.rz1 < s.z1) zB.push({ a: s.rz1, b: s.z1, k: 'st', ref: s, part: 'swS' });
  }
  zB.sort((p, q) => p.a - q.a);

  const uniq = arr => [...new Set(arr.map(v => Math.round(v * 1000) / 1000))].sort((p, q) => p - q);
  const xs = uniq([...xB.flatMap(b => [b.a, b.b]), PLAZA.x0, PLAZA.x1, L.basin.x0, L.basin.x1]);
  const zs = uniq([...zB.flatMap(b => [b.a, b.b]), PLAZA.z0, PLAZA.z1, L.basin.z0, L.basin.z1, MED.p0, MED.p1, PROM.z0, PROM.z1]);
  const bandOf = (bands, v) => bands.find(b => v > b.a && v < b.b);

  // ---- blocks ----------------------------------------------------------------------------------
  const blocks = L.blocks.filter(b => b.kind === 'built' || b.kind === 'park' || b.kind === 'square').map(b => ({ ...b }));
  // left-over lots next to the basin become pocket parks
  for (const b of L.blocks) {
    const c = cols[b.col], r = rows.find(q => q.j === b.row);
    if (b.kind !== 'built') continue;
    if (b.x1 < c.x1 - 20 && b.z0 === r.z0 && b.z1 === r.z1) {
      // clipped in x: the remainder outside the plaza zone
      const z0 = r.z0 < PLAZA.z0 ? r.z0 : PLAZA.z1, z1 = r.z0 < PLAZA.z0 ? PLAZA.z0 : r.z1;
      if (z1 - z0 > 12) blocks.push({ id: b.id + 'p', col: b.col, row: b.row, x0: b.x1, x1: c.x1, z0, z1, kind: 'park', pocket: true, district: b.district, lots: [] });
    }
  }
  const blockAt = (x, z) => blocks.find(b => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1);
  const inRect = (r, x, z) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

  // ---- ground cells ------------------------------------------------------------------------------
  const mk = () => ({ pos: [], nrm: [], a: [], b: [], c: [], idx: [] });
  const bufs = { A: mk(), P: mk(), S: mk() };
  const vert = (buf, x, y, z, nx, ny, nz, f) => {
    buf.pos.push(x, y, z); buf.nrm.push(nx, ny, nz);
    buf.a.push(f[0], f[1], f[2], f[3]); buf.b.push(f[4], f[5], f[6], f[7]); buf.c.push(f[8], f[9], f[10], f[11]);
    return buf.pos.length / 3 - 1;
  };
  const quad = (buf, x0, z0, x1, z1, h, f) => {
    const y = GROUND_Y + h;
    const i0 = vert(buf, x0, y, z0, 0, 1, 0, f(x0, z0)), i1 = vert(buf, x0, y, z1, 0, 1, 0, f(x0, z1)), i2 = vert(buf, x1, y, z1, 0, 1, 0, f(x1, z1)), i3 = vert(buf, x1, y, z0, 0, 1, 0, f(x1, z0));
    buf.idx.push(i0, i1, i2, i0, i2, i3);
  };
  const CURBF = [0, 0, 0, 0, 4, 0, 0, 0, 1, 1, 0, 0];
  const wall = (xA, zA, xB_, zB_, nx, nz, y0, y1, nA = null, nB = null) => {
    const buf = bufs.P;
    const tx = xB_ - xA, tz = zB_ - zA;
    if (tz * nx - tx * nz < 0) { const t1 = xA; xA = xB_; xB_ = t1; const t2 = zA; zA = zB_; zB_ = t2; const t3 = nA; nA = nB; nB = t3; }
    const na = nA || [nx, nz], nb = nB || [nx, nz];
    const fa = CURBF.slice(), fb = CURBF.slice(); fa[0] = xA + zA; fb[0] = xB_ + zB_;
    const fat = fa.slice(), fbt = fb.slice(); fat[1] = 1; fbt[1] = 1;
    const a0 = vert(buf, xA, GROUND_Y + y0, zA, na[0], 0, na[1], fa), a1 = vert(buf, xA, GROUND_Y + y1, zA, na[0], 0, na[1], fat);
    const b0 = vert(buf, xB_, GROUND_Y + y0, zB_, nb[0], 0, nb[1], fb), b1 = vert(buf, xB_, GROUND_Y + y1, zB_, nb[0], 0, nb[1], fbt);
    buf.idx.push(a0, a1, b1, a0, b1, b0);
  };

  const fPlainAsph = () => [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0];
  const OUT = { m: 'S', h: 0, f: () => [0, 0, 0, 0, 2, 0, 0, 0, 1, 1, 0, 0] };
  const fWalk = (dfn, ox, oz) => (x, z) => [dfn(x, z), 0, 0, 0, 0, 0, 0, 0, ox, oz, 0.0, 0];
  const fCobble = (style, ox, oz, wet) => () => [0, 0, 0, 0, 2, style, 0, 0, ox, oz, wet, 0];

  const clipSeg = (a, b, other, mid, alongZ) => {
    // clip a road segment [a,b] where the plaza zone interrupts it
    if (alongZ) { if (other > PLAZA.x0 && other < PLAZA.x1 && a < PLAZA.z1 && b > PLAZA.z0) return mid < PLAZA.z0 ? [a, PLAZA.z0] : [PLAZA.z1, b]; }
    else if (other > PLAZA.z0 && other < PLAZA.z1 && a < PLAZA.x1 && b > PLAZA.x0) return mid < PLAZA.x0 ? [a, PLAZA.x0] : [PLAZA.x1, b];
    return [a, b];
  };

  function classify(xb, zb, xc, zc) {
    if (L.isWater(xc, zc)) return null;
    if (inRect(PLAZA, xc, zc)) return { m: 'P', h: 0, f: () => [0, 0, 0, 0, 3, 0, 0, 0, 1, 1, 0.0, 0] };
    if (xb.k === 'coping' || xb.k === 'prom') {
      if (zc < PROM.z0 || zc > PROM.z1) return OUT;
      return { m: 'P', h: 0, f: (x) => [x - QX, 0, 0, 0, 1, 0, 0, 0, 2, 1, 0.15, 0] };
    }
    if (xb.k === 'out' || zb.k === 'out') return OUT;
    const av = xb.k === 'ave' ? xb.ref : null, st = zb.k === 'st' ? zb.ref : null;
    if (zb.k === 'canal') {
      if (av) return xb.part.startsWith('sw') ? { m: 'P', h: CURB_H, f: fWalk(() => 10, 1, 1) } : { m: 'A', h: 0, f: fPlainAsph };
      if (zc > MED.p0 && zc < MED.p1) return { m: 'S', h: CURB_H, f: () => [0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0] };
      return { m: 'S', h: CURB_H, f: () => [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0] };
    }
    if (xb.k === 'col' && zb.k === 'row') {
      const b = blockAt(xc, zc);
      if (!b) return { m: 'P', h: 0, f: () => [0, 0, 0, 0, 3, 0, 0, 0, 1, 1, 0.03, 0] };
      if (b.kind === 'park') { const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, hx = (b.x1 - b.x0) / 2, hz = (b.z1 - b.z0) / 2; return { m: 'S', h: CURB_H, f: (x, z) => [x - cx, z - cz, hx, hz, 0, b.pocket ? 2 : 1, 0, 0, 1, 1, 0, 0] }; }
      if (b.kind === 'square') return { m: 'P', h: CURB_H, f: fCobble(1, 1, 1, -0.01) };
      return { m: 'P', h: CURB_H, f: fWalk(() => 10, 1, 1) };
    }
    if (xb.k === 'col' && st) {
      if (zb.part === 'road') {
        if (st.quay && xc < PLAZA.x0) return { m: 'P', h: 0, f: fCobble(0, 1, 0.6, 0.0) };
        const seg = clipSeg(xb.a, xb.b, zc, xc, false);
        const kind = st.oneWay ? 2 : 1, p2 = st.oneWay ? st.oneWay : st.center;
        return { m: 'A', h: 0, f: (x, z) => [z - st.cz, x - seg[0], seg[1] - seg[0], st.hw, kind, st.parkW, p2, 0, 1, 0, 0, 0] };
      }
      const curbZ = zb.part === 'swN' ? zb.b : zb.a;
      return { m: 'P', h: CURB_H, f: fWalk((x, z) => Math.abs(z - curbZ), 1, 0) };
    }
    if (av && zb.k === 'row') {
      if (xb.part === 'median') return { m: 'P', h: 0, f: fCobble(2, 0, 1, 0) };
      if (xb.part.startsWith('road')) {
        const seg = clipSeg(zb.a, zb.b, xc, zc, true);
        const kind = av.tram ? 4 : 1, p2 = av.tram ? av.medHW : av.center;
        return { m: 'A', h: 0, f: (x, z) => [-(x - av.cx), z - seg[0], seg[1] - seg[0], av.hw, kind, av.parkW, p2, 0, 0, 1, 0, 0] };
      }
      const curbX = xb.part === 'swW' ? xb.b : xb.a;
      return { m: 'P', h: CURB_H, f: fWalk((x) => Math.abs(x - curbX), 0, 1) };
    }
    if (av && st) {
      const xsw = xb.part.startsWith('sw'), zsw = zb.part.startsWith('sw');
      if (xsw && zsw) return { m: 'P', h: CURB_H, corner: { ox: xb.part === 'swW' ? 1 : -1, oz: zb.part === 'swN' ? 1 : -1 } };
      if (xsw) {
        if (st.quay && xc < PLAZA.x0) return { m: 'P', h: 0, f: fCobble(0, 1, 1, 0.0) };
        return { m: 'A', h: 0, f: (x, z) => [z - st.cz, x - xb.a, xb.b - xb.a, st.hw, 5, 0, 0, 0, 1, 1, 0, 0] };
      }
      if (zsw) return { m: 'A', h: 0, f: (x, z) => [-(x - av.cx), z - zb.a, zb.b - zb.a, av.hw, 5, 0, 0, 0, 1, 1, 0, 0] };
      return { m: 'A', h: 0, f: fPlainAsph };
    }
    return OUT;
  }

  const nx = xs.length - 1, nz = zs.length - 1;
  const grid = new Array(nx * nz).fill(null);
  for (let i = 0; i < nx; i++) {
    const xc = (xs[i] + xs[i + 1]) / 2; const xb = bandOf(xB, xc); if (!xb) continue;
    for (let j = 0; j < nz; j++) {
      const zc = (zs[j] + zs[j + 1]) / 2; const zb = bandOf(zB, zc); if (!zb) continue;
      const c = classify(xb, zb, xc, zc); if (!c) continue;
      grid[i * nz + j] = c;
      const x0 = xs[i], x1 = xs[i + 1], z0 = zs[j], z1 = zs[j + 1];
      if (!c.corner) { quad(bufs[c.m], x0, z0, x1, z1, c.h, c.f); continue; }
      // rounded sidewalk corner with a curved curb
      const { ox, oz } = c.corner; const a = x1 - x0, b = z1 - z0, R = 0.72 * Math.min(a, b);
      const Ix = ox > 0 ? x0 : x1, Iz = oz > 0 ? z0 : z1, Ox = ox > 0 ? x1 : x0, Oz = oz > 0 ? z1 : z0;
      const Cx = Ox - ox * R, Cz = Oz - oz * R; const NSEG = 7;
      const P = bufs.P, A = bufs.A, y = GROUND_Y + CURB_H;
      const fs = d => [d, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0];
      const ring = [[Ox, Iz]];
      for (let s = 0; s <= NSEG; s++) { const th = (s / NSEG) * Math.PI / 2; ring.push([Cx + ox * R * Math.cos(th), Cz + oz * R * Math.sin(th)]); }
      ring.push([Ix, Oz]);
      const ic = vert(P, Ix, y, Iz, 0, 1, 0, fs(Math.min(a, b)));
      const ids = ring.map(p => vert(P, p[0], y, p[1], 0, 1, 0, fs(0)));
      for (let s = 0; s < ids.length - 1; s++) { if (ox * oz > 0) P.idx.push(ic, ids[s + 1], ids[s]); else P.idx.push(ic, ids[s], ids[s + 1]); }
      // road filler outside the arc
      const fa = fPlainAsph();
      const oc = vert(A, Ox, GROUND_Y, Oz, 0, 1, 0, fa);
      const ia = []; for (let s = 1; s <= NSEG + 1; s++) ia.push(vert(A, ring[s][0], GROUND_Y, ring[s][1], 0, 1, 0, fa));
      for (let s = 0; s < ia.length - 1; s++) { if (ox * oz > 0) A.idx.push(oc, ia[s], ia[s + 1]); else A.idx.push(oc, ia[s + 1], ia[s]); }
      // curb faces: two straight parts + the arc
      wall(ring[0][0], ring[0][1], ring[1][0], ring[1][1], ox, 0, 0, CURB_H);
      wall(ring[NSEG + 1][0], ring[NSEG + 1][1], ring[NSEG + 2][0], ring[NSEG + 2][1], 0, oz, 0, CURB_H);
      for (let s = 0; s < NSEG; s++) {
        const t0 = (s / NSEG) * Math.PI / 2, t1 = ((s + 1) / NSEG) * Math.PI / 2, tm = (t0 + t1) / 2;
        wall(ring[s + 1][0], ring[s + 1][1], ring[s + 2][0], ring[s + 2][1], ox * Math.cos(tm), oz * Math.sin(tm), 0, CURB_H, [ox * Math.cos(t0), oz * Math.sin(t0)], [ox * Math.cos(t1), oz * Math.sin(t1)]);
      }
    }
  }
  // straight curb faces between cells of different height
  const cellH = c => (c ? c.h : null);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const c = grid[i * nz + j]; if (!c) continue;
    if (i + 1 < nx) {
      const d = grid[(i + 1) * nz + j];
      if (d && d.h !== c.h && !(c.corner && c.corner.ox > 0) && !(d.corner && d.corner.ox < 0)) wall(xs[i + 1], zs[j], xs[i + 1], zs[j + 1], c.h > d.h ? 1 : -1, 0, Math.min(c.h, d.h), Math.max(c.h, d.h));
    }
    if (j + 1 < nz) {
      const d = grid[i * nz + j + 1];
      if (d && d.h !== c.h && !(c.corner && c.corner.oz > 0) && !(d.corner && d.corner.oz < 0)) wall(xs[i], zs[j + 1], xs[i + 1], zs[j + 1], 0, c.h > d.h ? 1 : -1, Math.min(c.h, d.h), Math.max(c.h, d.h));
    }
  }

  // ---- frontages: every block edge that faces a street -----------------------------------------------
  const frontages = [];
  for (const b of blocks) {
    if (b.pocket) continue;
    const c = cols[b.col], r = rows.find(q => q.j === b.row);
    const add = (side, st, type) => {
      const f = { block: b, side, st, type, district: b.district };
      if (side === 'W' || side === 'E') { f.along = 'z'; f.a0 = b.z0; f.a1 = b.z1; f.c = side === 'W' ? b.x0 : b.x1; f.nx = side === 'W' ? -1 : 1; f.nz = 0; }
      else { f.along = 'x'; f.a0 = b.x0; f.a1 = b.x1; f.c = side === 'N' ? b.z0 : b.z1; f.nx = 0; f.nz = side === 'N' ? -1 : 1; }
      f.sw = st ? st.sw : 0;
      frontages.push(f);
    };
    if (b.x0 === c.x0) { if (b.col === 0) add('W', null, 'prom'); else add('W', aves[b.col - 1], 'ave'); }
    if (b.x1 === c.x1) add('E', aves[b.col], 'ave');
    if (b.z0 === r.z0) { const s = sts.find(q => q.z1 === r.z0); if (s) add('N', s, s.quay ? (b.x0 > PLAZA.x1 - 1 ? 'blvd' : 'quay') : 'st'); }
    if (b.z1 === r.z1) { const s = sts.find(q => q.z0 === r.z1); if (s) add('S', s, s.quay ? (b.x0 > PLAZA.x1 - 1 ? 'blvd' : 'quay') : 'st'); }
  }

  // ---- intersections ------------------------------------------------------------------------------------
  const inters = [];
  for (const av of aves) for (const st of sts) {
    const x = av.cx, z = st.cz;
    if (inRect(PLAZA, x, z)) continue;
    const signal = !st.quay && !av.perim && !st.perim && (st.wide || av.wide || av.tram);
    inters.push({ av, st, signal, quay: !!st.quay && x < PLAZA.x0, blvd: !!st.quay && x > PLAZA.x1 });
  }

  return { L, QX, EXT, PROM, PLAZA, MED, aves, sts, xB, zB, blocks, blockAt, bufs, frontages, inters, inRect };
}
