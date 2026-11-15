// Parked cars: smooth lofted bodies generated from a few side-view / plan-view curves, in three levels of detail
// ('hi' ~6k triangles with wheel arches, shut lines, lights, trim; 'mid' ~1k; 'lo' ~100) that all come from the same
// generator so their silhouettes and colours agree. Forward = +X, origin on the road under the centre of the car.
// Generic, timeless shapes — no real makes or models.
import * as THREE from 'three';
import { Geo, S, xf, box, sph } from './kit.js';

// surface flag t (aSurf.w): 0 = plain, 1 = body paint (instance tint + clearcoat), 2 = clearcoat without tint (glass, lenses)
const PAINT = S([1, 1, 1], 0.5, 0.0, 0, 1);
const GLASS = S([0.010, 0.012, 0.014], 0.03, 0.0, 0, 2);
const UNDER = S(0x070708, 0.95, 0);
const TYRE = S(0x0b0b0c, 0.9, 0);
const RIM = S(0x8f9396, 0.32, 0.9);
const RIMDARK = S(0x0e0f10, 0.7, 0.2);
const STEEL = S(0x55585b, 0.5, 0.7);
const CHROME = S(0xc9cdd0, 0.1, 1.0);
const TRIM = S(0x101112, 0.6, 0.0);          // black plastic / rubber
const SHUT = S(0x030303, 0.9, 0);
const HEAD = S([0.4, 0.41, 0.41], 0.16, 0.75, 12, 2);
const TAIL = S([0.3, 0.012, 0.012], 0.12, 0.0, 11, 2);
const AMBER = S([0.55, 0.2, 0.015], 0.15, 0.0, 0, 2);
const PLATE = S(0xd6d3c6, 0.55, 0);
const SIGN = S([0.9, 0.8, 0.45], 0.4, 0, 14);

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** monotone cubic interpolation through [[x, y], ...] (x ascending) */
function pchip(pts) {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const d = []; for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n); m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]);
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

/** centripetal Catmull-Rom point on the span K[i+1] -> K[i+2] of the 2D polyline K */
function cr(K, i, u) {
  const p0 = K[i], p1 = K[i + 1], p2 = K[i + 2], p3 = K[i + 3];
  const dt = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t1 = dt(p0, p1), t2 = t1 + dt(p1, p2), t3 = t2 + dt(p2, p3), t = t1 + (t2 - t1) * u;
  const L = (a, b, ta, tb) => { const f = (t - ta) / (tb - ta); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
  const A1 = L(p0, p1, 0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, 0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

// ---- body description -> evaluators ---------------------------------------------------------------------
function prep(sp) {
  const Lh = sp.L / 2, Wh = sp.W / 2, p = sp.planP || 3.2;
  const top = pchip(sp.top), beltL = pchip(sp.belt), sill = pchip(sp.sill);
  const hw = x => {
    let t = 1; if (x > Lh - sp.capF) t = (Lh - x) / sp.capF; else if (x < -Lh + sp.capR) t = (x + Lh) / sp.capR;
    t = clamp(t, 1e-6, 1);
    return Wh * Math.pow(1 - Math.pow(1 - t, p), 1 / p);
  };
  // section key points [z, y]: ghost, A sill, B widest, C belt, D top of the side glass, E roof edge, F centre, ghost
  const keys = x => {
    const w = hw(x), k = w / Wh, yb = sill(x), yt = top(x), yc = Math.min(beltL(x), yt - 0.045);
    const A = [w * 0.958, yb], B = [w, yb + 0.45 * (yc - yb)], C = [w * 0.974, yc];
    const hC = yt - yc, rc = Math.min(sp.roofR, hC * 0.5);
    const Dz = C[0] - (sp.tumble * (hC - rc) + 0.008) * k;
    const D = [Dz, yt - rc], E = [Math.max(Dz - (rc * 1.25 + 0.015) * k, Dz * 0.55), yt], F = [0, yt + sp.crown * k];
    return [[A[0] - 0.05 * k, yb - 0.09], A, B, C, D, E, F, [-E[0], E[1]]];
  };
  const sideAt = (K, t) => { const s = t >= 1 ? 1 : 0; return cr(K, s, t - s); };
  const tForY = (K, y) => {
    if (y <= K[1][1]) return 0; if (y >= K[3][1]) return 2;
    let a = 0, b = 2; for (let i = 0; i < 22; i++) { const m = (a + b) / 2; if (sideAt(K, m)[1] < y) a = m; else b = m; }
    return (a + b) / 2;
  };
  const arches = sp.axles.map(cx => ({ cx, cy: sp.rw, R: sp.rw + (sp.archGap || 0.075) }));
  /** height of the wheel-arch opening at x (0 = none) */
  const archY = x => { for (const a of arches) { const dx = x - a.cx; if (Math.abs(dx) < a.R) return a.cy + Math.sqrt(a.R * a.R - dx * dx); } return 0; };
  const orient = (p, n) => { if (n[0] * p[0] + n[1] * (p[1] - 0.6) + n[2] * p[2] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; } return n; };
  const nrmOf = (p, a, b) => {
    const ux = a[0] - p[0], uy = a[1] - p[1], uz = a[2] - p[2], vx = b[0] - p[0], vy = b[1] - p[1], vz = b[2] - p[2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return orient(p, [n[0] / l, n[1] / l, n[2] / l]);
  };
  /** point + normal on the body side (z > 0) at station x and height y */
  const side = (x, y) => {
    const K = keys(x), t = tForY(K, y), q = sideAt(K, t), q2 = sideAt(K, Math.min(2, t + 0.02) === t ? t - 0.02 : Math.min(2, t + 0.02));
    const dx = x > 0 ? -0.012 : 0.012, K2 = keys(x + dx), q3 = sideAt(K2, tForY(K2, y));
    const pt = [x, q[1], q[0]];
    return { p: pt, n: nrmOf(pt, [x, q2[1], q2[0]], [x + dx, q3[1], q3[0]]) };
  };
  /** point + normal on the upper parts: seg 2 = side glass, 3 = roof corner, 4 = roof / windscreen */
  const upper = (x, seg, u) => {
    const K = keys(x), q = cr(K, seg, u), u2 = u > 0.5 ? u - 0.03 : u + 0.03, q2 = cr(K, seg, u2);
    const dx = x > 0 ? -0.012 : 0.012, q3 = cr(keys(x + dx), seg, u);
    const pt = [x, q[1], q[0]];
    return { p: pt, n: nrmOf(pt, [x, q2[1], q2[0]], [x + dx, q3[1], q3[0]]) };
  };
  /** point on the rounded nose (front = true) or tail at half-width z and height y */
  const tipX = front => front ? Lh - sp.capF * 1e-4 : -Lh + sp.capR * 1e-4;
  const nose = (front, z, y) => {
    let a = front ? Lh - sp.capF : -Lh + sp.capR, b = tipX(front);
    const zAt = x => { const K = keys(x); return sideAt(K, tForY(K, y))[0]; };
    if (zAt(b) >= z) { const yy = clamp(y, sill(b), Math.min(beltL(b), top(b) - 0.045)); return { p: [b, yy, z], n: [front ? 1 : -1, 0, 0] }; }
    for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (zAt(m) > z) a = m; else b = m; }
    return side((a + b) / 2, y);
  };
  return { sp, Lh, Wh, top, beltL, sill, hw, keys, sideAt, tForY, arches, archY, side, upper, nose, tipX, belt: x => Math.min(beltL(x), top(x) - 0.045) };
}

// ---- low-level emit helpers -------------------------------------------------------------------------------
function vert(g, p, n, s) { g.pos.push(p[0], p[1], p[2]); g.nrm.push(n[0], n[1], n[2]); g.col.push(s.c[0], s.c[1], s.c[2]); g.surf.push(s.r, s.m, s.e, s.t); return g.pos.length / 3 - 1; }
/** quad a-b-c-d (a->b and d->c are the two rails); wound so that it faces along `want` */
function quad(g, pa, pb, pc, pd, na, nb, nc, nd, s, want) {
  const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pd[0] - pa[0], vy = pd[1] - pa[1], vz = pd[2] - pa[2];
  let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
  if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) < 1e-12) {      // a == d (fan): use the other corner
    const wx = pc[0] - pa[0], wy = pc[1] - pa[1], wz = pc[2] - pa[2];
    fx = uy * wz - uz * wy; fy = uz * wx - ux * wz; fz = ux * wy - uy * wx;
  }
  const w = want || na;
  const a = vert(g, pa, na, s), b = vert(g, pb, nb, s), c = vert(g, pc, nc, s), d = vert(g, pd, nd, s);
  if (fx * w[0] + fy * w[1] + fz * w[2] >= 0) g.idx.push(a, b, c, a, c, d); else g.idx.push(a, c, b, a, d, c);
}
const mir = v => [v[0], v[1], -v[2]];

/** surface of revolution around local +Y: prof = [[radius, y], ...]; normals from the profile; M places it */
function revolve(g, prof, seg, M, surfAt) {
  const n = prof.length; const N = [];
  for (let k = 0; k < n; k++) {
    const a = prof[Math.max(0, k - 1)], b = prof[Math.min(n - 1, k + 1)]; const tr = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tr, ty) || 1;
    N.push([ty / l, -tr / l]);
  }
  const v = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(M);
  const P = (k, j) => { const a = j / seg * Math.PI * 2; v.set(prof[k][0] * Math.cos(a), prof[k][1], prof[k][0] * Math.sin(a)).applyMatrix4(M); return [v.x, v.y, v.z]; };
  const Nn = (k, j) => { const a = j / seg * Math.PI * 2; v.set(N[k][0] * Math.cos(a), N[k][1], N[k][0] * Math.sin(a)).applyMatrix3(nm).normalize(); return [v.x, v.y, v.z]; };
  for (let k = 0; k < n - 1; k++) for (let j = 0; j < seg; j++) {
    const s = surfAt(k, j); if (!s) continue;
    const na = Nn(k, j), nb = Nn(k + 1, j), nc = Nn(k + 1, j + 1), nd = Nn(k, j + 1);
    const want = [na[0] + nb[0] + nc[0] + nd[0], na[1] + nb[1] + nc[1] + nd[1], na[2] + nb[2] + nc[2] + nd[2]];
    if (prof[k][0] < 1e-6) { const a = vert(g, P(k, j), na, s), b = vert(g, P(k + 1, j), nb, s), c = vert(g, P(k + 1, j + 1), nc, s); tri(g, a, b, c, want); }
    else if (prof[k + 1][0] < 1e-6) { const a = vert(g, P(k, j), na, s), b = vert(g, P(k + 1, j), nb, s), c = vert(g, P(k, j + 1), nd, s); tri(g, a, b, c, want); }
    else quad(g, P(k, j), P(k + 1, j), P(k + 1, j + 1), P(k, j + 1), na, nb, nc, nd, s, want);
  }
}
function tri(g, a, b, c, want) {
  const P = g.pos, ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
  const ux = P[b * 3] - ax, uy = P[b * 3 + 1] - ay, uz = P[b * 3 + 2] - az, vx = P[c * 3] - ax, vy = P[c * 3 + 1] - ay, vz = P[c * 3 + 2] - az;
  const f = (uy * vz - uz * vy) * want[0] + (uz * vx - ux * vz) * want[1] + (ux * vy - uy * vx) * want[2];
  if (f >= 0) g.idx.push(a, b, c); else g.idx.push(a, c, b);
}

/**
 * surface-conforming patch: fn(a, b) (a, b in 0..1) -> { p, n } on the z >= 0 side; the patch floats `off` above the
 * body. skirt: close the rim down to the body. mirror: also emit the z < 0 copy.
 */
function patch(g, nu, nv, fn, off, surf, { skirt = false, mirror = true } = {}) {
  const pts = [], nrm = [], base = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const r = fn(i / nu, j / nv); nrm.push(r.n); base.push(r.p);
    pts.push([r.p[0] + r.n[0] * off, r.p[1] + r.n[1] * off, r.p[2] + r.n[2] * off]);
  }
  const at = (i, j) => j * (nu + 1) + i;
  const emit = (m) => {
    const T = m ? mir : (v => v);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      quad(g, T(pts[a]), T(pts[b]), T(pts[c]), T(pts[d]), T(nrm[a]), T(nrm[b]), T(nrm[c]), T(nrm[d]), surf);
    }
    if (skirt) {
      const cen = pts[at(nu >> 1, nv >> 1)];
      const wall = (a, b) => {
        const mx = (pts[a][0] + pts[b][0]) / 2 - cen[0], my = (pts[a][1] + pts[b][1]) / 2 - cen[1], mz = (pts[a][2] + pts[b][2]) / 2 - cen[2];
        const d = mx * nrm[a][0] + my * nrm[a][1] + mz * nrm[a][2];
        let o = [mx - nrm[a][0] * d, my - nrm[a][1] * d, mz - nrm[a][2] * d]; const l = Math.hypot(o[0], o[1], o[2]) || 1; o = [o[0] / l, o[1] / l, o[2] / l];
        const lo = k => [base[k][0] - nrm[k][0] * 0.004, base[k][1] - nrm[k][1] * 0.004, base[k][2] - nrm[k][2] * 0.004];
        const on = T(o);
        quad(g, T(pts[a]), T(pts[b]), T(lo(b)), T(lo(a)), on, on, on, on, surf, on);
      };
      for (let i = 0; i < nu; i++) { wall(at(i, 0), at(i + 1, 0)); wall(at(i, nv), at(i + 1, nv)); }
      for (let j = 0; j < nv; j++) { wall(at(0, j), at(0, j + 1)); wall(at(nu, j), at(nu, j + 1)); }
    }
  };
  emit(false); if (mirror) emit(true);
}

// ---- hull -------------------------------------------------------------------------------------------------
const ROWS = {
  hi: { side: 6, glass: [0.08, 0.38, 0.68, 0.93, 1], corner: [0.5, 1], roof: [0.12, 0.42, 0.72, 1] },
  mid: { side: 2, glass: [1], corner: [1], roof: [0.5, 1] },
  lo: { side: 1, glass: [1], corner: [], roof: [1] },
};

function stationsFor(P, lod) {
  const { sp, Lh } = P; const list = [];           // [x, priority]
  const add = (x, pr) => list.push([x, pr]);
  const caps = lod === 'hi' ? [1e-4, 0.004, 0.02, 0.06, 0.14, 0.28, 0.5, 1] : lod === 'mid' ? [0.004, 0.08, 0.4, 1] : [0.2];
  caps.forEach((t, k) => { add(Lh - sp.capF * t, k ? 2 : 9); add(-Lh + sp.capR * t, k ? 2 : 9); });
  for (const x of [sp.cowl, sp.wsTop, sp.rwTop, sp.rwBase]) add(x, 3);
  if (lod !== 'lo') {
    add(sp.xA, 3); add(sp.xC, 3);
    if (lod === 'hi') {
      for (const xp of sp.pillars) { add(xp - sp.pillarW / 2, 3); add(xp + sp.pillarW / 2, 3); }
      add(sp.cowl + (sp.wsTop - sp.cowl) * 0.5, 1); add(sp.rwBase + (sp.rwTop - sp.rwBase) * 0.5, 1);
      add(sp.cowl + 0.03, 1); add(sp.wsTop - 0.035, 1); add(sp.rwBase - 0.03, 1); add(sp.rwTop + 0.035, 1);
    }
    const steps = lod === 'hi' ? 10 : 4;
    for (const a of P.arches) {
      for (let k = 0; k <= steps; k++) { const th = Math.PI * k / steps; add(a.cx + a.R * Math.cos(th) * (k === 0 || k === steps ? 1.0005 : 1), 4); }
    }
  }
  list.sort((a, b) => a[0] - b[0]);
  // merge near-duplicates (keep the more important one), then fill long gaps
  const eps = lod === 'hi' ? 0.016 : lod === 'mid' ? 0.05 : 0.01, out = [];
  for (const s of list) {
    const last = out[out.length - 1];
    if (last && s[0] - last[0] < eps) { if (s[1] > last[1]) out[out.length - 1] = s; } else out.push(s);
  }
  const gap = lod === 'hi' ? 0.2 : lod === 'mid' ? 0.7 : 1e9, xs = [];
  for (let i = 0; i < out.length; i++) {
    xs.push(out[i][0]);
    if (i + 1 < out.length) { const d = out[i + 1][0] - out[i][0], n = Math.ceil(d / gap); for (let k = 1; k < n; k++) xs.push(out[i][0] + d * k / n); }
  }
  return xs;
}

function hull(g, P, lod) {
  const { sp } = P, R = ROWS[lod], xs = stationsFor(P, lod), n = xs.length;
  const cats = [];
  for (let k = 0; k < R.side; k++) cats.push('side');
  R.glass.forEach((u, k) => cats.push(lod === 'hi' ? (k === 0 ? 'belt' : k === R.glass.length - 1 ? 'frame' : 'glass') : 'glass'));
  R.corner.forEach(() => cats.push('corner'));
  R.roof.forEach((u, k) => cats.push(lod === 'hi' && k === 0 ? 'edge' : 'roof'));
  const m = cats.length;                             // quads per half ring
  const U = [], Lw = [];                             // upper half rings [z, y][], lower strip points
  for (const x of xs) {
    const K = P.keys(x), ya = lod === 'lo' ? 0 : P.archY(x), ta = ya > K[1][1] + 0.004 ? P.tForY(K, ya) : 0;
    const pts = [];
    for (let k = 0; k <= R.side; k++) pts.push(P.sideAt(K, ta + (2 - ta) * k / R.side));
    for (const u of R.glass) pts.push(cr(K, 2, u));
    for (const u of R.corner) pts.push(cr(K, 3, u));
    for (const u of R.roof) pts.push(cr(K, 4, u));
    pts[m][0] = 0;
    U.push(pts);
    const lip = pts[0], yb = K[1][1], k = P.hw(x) / P.Wh, zi = Math.max(lip[0] - 0.27 * k, lip[0] * 0.3);
    if (lod === 'lo') Lw.push([lip, [lip[0] * 0.97, 0.03]]);
    else Lw.push([lip, [zi, ta > 0 ? lip[1] : yb + 0.004], [zi, yb + 0.03]]);
  }
  // --- upper skin: smooth normals on the shared grid, materials per quad
  const ringN = 2 * m + 1;
  const node = (i, j) => { const q = j <= m ? U[i][j] : U[i][2 * m - j]; return [xs[i], q[1], j <= m ? q[0] : -q[0]]; };
  const pos = []; for (let i = 0; i < n; i++) for (let j = 0; j < ringN; j++) pos.push(...node(i, j));
  const idx = [];
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < ringN - 1; j++) { const a = i * ringN + j, b = a + 1, c = a + ringN, d = c + 1; idx.push(a, c, b, b, c, d); }
  const tmp = new THREE.BufferGeometry(); tmp.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tmp.setIndex(idx); tmp.computeVertexNormals();
  const NA = tmp.attributes.normal;
  // orientation: the normal in the middle of the roof must point up
  const flip = NA.getY(Math.floor(n / 2) * ringN + m) < 0 ? -1 : 1;
  const nrm = (i, j) => { const q = i * ringN + j; return [NA.getX(q) * flip, NA.getY(q) * flip, NA.getZ(q) * flip]; };
  tmp.dispose();
  const Lh = P.Lh, pw = sp.pillarW / 2;
  const surfOf = (cat, r, xm) => {
    const inWS = xm < sp.cowl && xm > sp.wsTop, inRW = xm > sp.rwBase && xm < sp.rwTop;
    const inSide = xm < sp.xA && xm > sp.xC, pillar = sp.pillars.some(xp => Math.abs(xm - xp) < pw);
    const capF = xm > Lh - sp.capF * 0.52, capR = xm < -Lh + sp.capR * 0.52;
    switch (cat) {
      case 'side': {
        if (sp.clad && r === 0 && lod !== 'lo') return TRIM;
        if ((capF || capR) && lod !== 'lo') {
          if (sp.bumper === 'black' && r < (lod === 'hi' ? 3 : 1)) return TRIM;
        }
        if (sp.bed && xm > sp.bed[0] && xm < sp.bed[1]) return PAINT;
        return PAINT;
      }
      case 'belt': return inSide ? TRIM : PAINT;
      case 'frame': return inSide ? TRIM : PAINT;
      case 'glass': return inSide ? (pillar ? TRIM : GLASS) : PAINT;
      case 'corner': return PAINT;
      case 'edge': return inWS || inRW ? TRIM : (sp.bed && xm > sp.bed[0] && xm < sp.bed[1] ? PAINT : PAINT);
      default: return inWS || inRW ? GLASS : (sp.bed && xm > sp.bed[0] && xm < sp.bed[1] ? TRIM : (sp.roofSurf || PAINT));
    }
  };
  for (let i = 0; i < n - 1; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2;
    for (let j = 0; j < ringN - 1; j++) {
      const r = j < m ? j : 2 * m - 1 - j;
      const s = surfOf(cats[r], r, xm);
      const na = nrm(i, j), nb = nrm(i, j + 1), nc = nrm(i + 1, j + 1), nd = nrm(i + 1, j);
      quad(g, node(i, j), node(i, j + 1), node(i + 1, j + 1), node(i + 1, j), na, nb, nc, nd, s, [na[0] + nc[0], na[1] + nc[1], na[2] + nc[2]]);
    }
  }
  // --- underside: sill -> wheel-well wall -> floor (hi / mid), dark skirt to the road (lo)
  for (let i = 0; i < n - 1; i++) {
    const a = Lw[i], b = Lw[i + 1], x0 = xs[i], x1 = xs[i + 1];
    const P3 = (x, q, sgn) => [x, q[1], q[0] * sgn];
    for (const sgn of [1, -1]) {
      for (let k = 0; k < a.length - 1; k++) {
        const p0 = P3(x0, a[k], sgn), p1 = P3(x0, a[k + 1], sgn), p2 = P3(x1, b[k + 1], sgn), p3 = P3(x1, b[k], sgn);
        // face away from the solid: down / outward for the skirt, into the wheel well otherwise
        const dz = a[k + 1][0] - a[k][0], dy = a[k + 1][1] - a[k][1];
        const want = lod === 'lo' ? [0, 0, sgn] : (Math.abs(dy) > Math.abs(dz) ? [0, 0, sgn] : [0, -1, 0]);
        quad(g, p0, p1, p2, p3, want, want, want, want, UNDER, want);
      }
    }
    if (lod !== 'lo') {
      const k = a.length - 1, dn = [0, -1, 0];
      quad(g, P3(x0, a[k], 1), P3(x0, a[k], -1), P3(x1, b[k], -1), P3(x1, b[k], 1), dn, dn, dn, dn, UNDER, dn);
    }
  }
  // --- end caps
  for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
    const nn = [dir, 0, 0];
    for (let j = 0; j < m; j++) {                 // horizontal bands between the two halves of the ring
      const sf = lod === 'lo' ? PAINT : surfOf(cats[j], j, xs[i] + dir * 0.001);
      quad(g, node(i, j), node(i, j + 1), node(i, 2 * m - j - 1), node(i, 2 * m - j), nn, nn, nn, nn, sf, nn);
    }
  }
  return xs;
}

// ---- wheels -----------------------------------------------------------------------------------------------
function wheels(g, P, lod) {
  const { sp } = P, r = sp.rw, tw = sp.tw || 0.2, rimR = r * 0.63;
  for (const cx of sp.axles) for (const sgn of [1, -1]) {
    const zo = P.hw(cx) * 0.985 - 0.045;                              // outer face of the tyre
    // local +Y = outward axle direction; y = 0 is the inner face, y = tw the outer face
    const M = xf(cx, r, sgn * (zo - tw), sgn * Math.PI / 2, 0, 0);
    if (lod === 'hi') {
      const seg = 28, cap = sp.hubcap;             // round at 4K; the spoke / hubcap pattern keeps its 14 sectors (j >> 1)
      const prof = [[r - 0.03, 0], [r, 0.035], [r, tw - 0.035], [r - 0.028, tw], [rimR + 0.004, tw - 0.01], [rimR - 0.012, tw - 0.002], [rimR - 0.03, tw - 0.03],
        [rimR * 0.42, tw - (cap ? 0.012 : 0.05)], [rimR * 0.2, tw - (cap ? 0.004 : 0.03)], [0, tw - (cap ? 0.0 : 0.026)]];
      revolve(g, prof, seg, M, (k, j) => k < 4 ? TYRE : k === 6 ? (cap ? ((j >> 1) % 7 === 3 ? RIMDARK : CHROME) : ((((j >> 1) + 1) % 14) % 3 === 0 ? RIM : RIMDARK)) : k === 5 ? (cap ? STEEL : RIM) : (cap ? CHROME : RIM));
      revolve(g, [[r - 0.03, 0.0], [0, 0.0]], seg, xf(cx, r, sgn * (zo - tw), -sgn * Math.PI / 2, 0, 0), () => TYRE);
    } else {
      revolve(g, [[r, 0], [r, tw - 0.02], [rimR, tw - 0.008], [0, tw - 0.03]], 12, M, k => k < 2 ? TYRE : (sp.hubcap ? CHROME : RIM));
    }
  }
}

// ---- trim, lights, shut lines -----------------------------------------------------------------------------
function details(g, P, lod) {
  const { sp, Lh, Wh } = P, hi = lod === 'hi';
  const zy = (front, z0, z1, y0, y1, slant = 0) => (a, b) => P.nose(front, (z0 + (z1 - z0) * a) * Wh, y0 + (y1 - y0) * b + slant * a);
  const xy = (x0, x1, y0, y1) => (a, b) => P.side(x0 + (x1 - x0) * a, y0 + (y1 - y0) * b);
  // lights (also on the mid level so the night lights survive the switch)
  const hl = sp.head, tl = sp.tail;
  if (!sp.roundLights) patch(g, hi ? 4 : 2, hi ? 2 : 1, zy(true, hl[0], hl[1], hl[2], hl[3], hl[4] || 0), hi ? 0.007 : 0.012, HEAD, { skirt: hi });
  patch(g, hi ? 4 : 2, hi ? 2 : 1, zy(false, tl[0], tl[1], tl[2], tl[3], tl[4] || 0), hi ? 0.007 : 0.012, TAIL, { skirt: hi });
  if (sp.roundLights) {
    for (const s of [-1, 1]) {
      const c = P.nose(true, hl[0] * Wh, hl[2]).p;
      g.add(sph(hl[1], hi ? 10 : 6, hi ? 6 : 4), HEAD, xf(c[0] - hl[1] * 0.45, c[1], s * c[2], 0, 0, 0, 0.75, 1, 1));
      if (hi) g.add(new THREE.TorusGeometry(hl[1] * 1.02, 0.014, 4, 12), CHROME, xf(c[0] - hl[1] * 0.2, c[1], s * c[2], 0, Math.PI / 2, 0));
    }
  }
  if (sp.sign) g.add(box(0.26, 0.12, 0.5), SIGN, xf(sp.sign, P.top(sp.sign) + 0.085, 0));
  if (!hi) return;
  // amber indicators beside the headlights, reversing lights inboard of the tail lights
  if (sp.amber) patch(g, 1, 1, zy(true, sp.amber[0], sp.amber[1], sp.amber[2], sp.amber[3]), 0.008, AMBER, { skirt: true });
  // grille + lower intake + plates
  if (sp.grille) patch(g, 3, 2, zy(true, 0, sp.grille[0], sp.grille[1], sp.grille[2]), 0.004, sp.grilleSurf || TRIM);
  if (sp.intake) patch(g, 4, 1, zy(true, 0, sp.intake[0], sp.intake[1], sp.intake[2]), 0.004, UNDER);
  g.add(box(0.016, 0.11, 0.5), PLATE, xf(P.nose(true, 0.1, sp.plateF).p[0] + 0.006, sp.plateF, 0));
  g.add(box(0.016, 0.11, 0.5), PLATE, xf(P.nose(false, 0.1, sp.plateR).p[0] - 0.006, sp.plateR, 0));
  // bumper bars
  if (sp.bar) for (const front of [true, false]) {
    const y = front ? sp.bar[0] : sp.bar[1];
    patch(g, 10, 1, zy(front, 0, 0.94, y - sp.bar[2] / 2, y + sp.bar[2] / 2), sp.bar[3], sp.barSurf || TRIM, { skirt: true });
  }
  // rub strip along the doors
  const arF = P.arches[P.arches.length - 1], arR = P.arches[0];
  if (sp.strip) patch(g, 8, 1, xy(arR.cx + arR.R + 0.05, arF.cx - arF.R - 0.05, sp.strip - 0.022, sp.strip + 0.022), 0.008, sp.stripSurf || TRIM, { skirt: true });
  // shut lines: doors, bonnet, boot
  const line = (fn, nu, nv) => patch(g, nu, nv, fn, 0.0016, SHUT);
  const yTop = x => P.belt(x) - 0.012, yBot = x => Math.max(P.sill(x) + 0.035, P.archY(x) + 0.012);
  for (const x of sp.doors) line((a, b) => P.side(x - 0.005 + 0.01 * a, yBot(x) + (yTop(x) - yBot(x)) * b), 1, 5);
  if (sp.doors.length > 1) {
    const x0 = sp.doors[0], x1 = sp.doors[sp.doors.length - 1];
    line((a, b) => { const x = x0 + (x1 - x0) * a; return P.side(x, yBot(x) + 0.009 * b); }, 8, 1);
    // handles just behind each door's leading shut line... (doors are listed rear -> front; handles sit near the rear edge)
    for (let i = 0; i < sp.doors.length - 1; i++) {
      const xr = sp.doors[i], yh = P.belt(xr + 0.2) - (sp.handleDrop || 0.1);
      patch(g, 2, 1, xy(xr + 0.07, xr + 0.21, yh - 0.014, yh + 0.014), 0.013, sp.handleSurf || PAINT, { skirt: true });
    }
  }
  if (sp.hoodLine) {
    line((a, b) => P.upper(sp.cowl + 0.05 + 0.01 * b, 4, 0.02 + 0.98 * (1 - a)), 6, 1);
    line((a, b) => P.upper(sp.cowl + 0.055 + (Lh - sp.capF * 0.12 - sp.cowl - 0.055) * a, 3, 0.45 + 0.1 * b), 8, 1);
  }
  if (sp.bootLine) {
    line((a, b) => P.upper(sp.rwBase - 0.05 - 0.01 * b, 4, 0.02 + 0.98 * (1 - a)), 6, 1);
    line((a, b) => P.upper(sp.rwBase - 0.055 + (-Lh + sp.capR * 0.12 - sp.rwBase + 0.055) * a, 3, 0.45 + 0.1 * b), 6, 1);
  }
  for (const x of [sp.gateLine, ...(sp.vlines || [])]) if (x) line((a, b) => P.side(x - 0.005 + 0.01 * a, yBot(x) + (yTop(x) - yBot(x)) * b), 1, 5);
  for (const x of sp.ulines || []) line((a, b) => P.upper(x - 0.005 + 0.01 * a, 2, 0.02 + 0.96 * b), 1, 4);
  // wipers
  patch(g, 1, 3, (a, b) => P.upper(sp.cowl - 0.035 - 0.012 * a - 0.03 * b, 4, 0.2 + 0.7 * b), 0.012, TRIM);
  // door mirrors
  for (const s of [-1, 1]) {
    const c = P.side(sp.xA + 0.02, P.belt(sp.xA) + 0.005).p;
    g.add(sph(1, 7, 5), sp.mirrorSurf || PAINT, xf(c[0] - 0.02, c[1] + 0.075, s * (c[2] + 0.085), 0, 0, 0, 0.075, 0.06, 0.1));
    g.add(box(0.05, 0.022, 0.08), TRIM, xf(c[0] - 0.02, c[1] + 0.03, s * (c[2] + 0.02)));
  }
  // roof rails
  if (sp.rails) for (const s of [-1, 1]) {
    const x0 = sp.rails[0], x1 = sp.rails[1], q = P.upper((x0 + x1) / 2, 4, 0.12).p;
    g.add(box(x1 - x0, 0.022, 0.03), TRIM, xf((x0 + x1) / 2, q[1] + 0.035, s * q[2]));
    for (const x of [x0 + 0.05, x1 - 0.05]) g.add(box(0.05, 0.04, 0.03), TRIM, xf(x, q[1] + 0.015, s * q[2]));
  }
}

// ---- body styles ------------------------------------------------------------------------------------------
const BASE = {
  planP: 3.2, capF: 0.75, capR: 0.62, tumble: 0.31, crown: 0.045, roofR: 0.07, rw: 0.315, tw: 0.2, pillarW: 0.075,
  bumper: 'body', hoodLine: true, bootLine: false, amber: null, strip: 0, bar: null, rails: null, hubcap: false,
};

const SEDAN = {
  ...BASE, L: 4.5, W: 1.78,
  top: [[-2.25, 0.85], [-2.12, 0.95], [-1.9, 0.985], [-1.3, 1.01], [-1.18, 1.035], [-0.52, 1.4], [-0.05, 1.435], [0.42, 1.42], [0.62, 1.385], [1.22, 1.0], [1.38, 0.975], [1.9, 0.915], [2.12, 0.84], [2.25, 0.74]],
  belt: [[-2.25, 0.8], [-1.9, 0.93], [-1.2, 0.955], [1.2, 0.935], [1.9, 0.87], [2.25, 0.7]],
  sill: [[-2.25, 0.27], [-1.95, 0.225], [-1.75, 0.215], [1.8, 0.215], [2.05, 0.225], [2.25, 0.25]],
  axles: [-1.33, 1.37], cowl: 1.22, wsTop: 0.6, rwTop: -0.5, rwBase: -1.18, xA: 0.98, xC: -0.9, pillars: [0.02],
  doors: [-0.84, 0.02, 0.9], bootLine: true,
  head: [0.42, 0.9, 0.57, 0.68], tail: [0.4, 0.92, 0.68, 0.8], amber: [0.9, 0.94, 0.57, 0.66],
  grille: [0.36, 0.56, 0.67], intake: [0.6, 0.3, 0.37], plateF: 0.46, plateR: 0.6, strip: 0.52,
  bar: [0.46, 0.5, 0.13, 0.022], barSurf: PAINT,
};

const WAGON = {
  ...BASE, L: 4.6, W: 1.78, capR: 0.5,
  top: [[-2.3, 0.9], [-2.24, 1.0], [-2.08, 1.36], [-1.9, 1.44], [-1.0, 1.47], [0.0, 1.465], [0.45, 1.44], [0.66, 1.4], [1.26, 1.0], [1.42, 0.975], [1.95, 0.915], [2.17, 0.84], [2.3, 0.74]],
  belt: [[-2.3, 0.84], [-2.0, 0.95], [-1.2, 0.96], [1.2, 0.94], [1.95, 0.87], [2.3, 0.7]],
  sill: [[-2.3, 0.27], [-2.0, 0.225], [-1.8, 0.215], [1.85, 0.215], [2.1, 0.225], [2.3, 0.25]],
  axles: [-1.3, 1.42], cowl: 1.26, wsTop: 0.64, rwTop: -2.07, rwBase: -2.25, xA: 1.02, xC: -2.02, pillars: [0.06, -0.86, -1.72],
  doors: [-0.8, 0.06, 0.94], gateLine: -2.06,
  head: [0.42, 0.9, 0.57, 0.68], tail: [0.72, 0.93, 0.7, 0.93], amber: [0.9, 0.94, 0.57, 0.66],
  grille: [0.36, 0.56, 0.67], intake: [0.6, 0.3, 0.37], plateF: 0.46, plateR: 0.72, strip: 0.52, rails: [-1.75, 0.3],
  bar: [0.46, 0.5, 0.13, 0.022], barSurf: PAINT,
};

const HATCH = {
  ...BASE, L: 4.0, W: 1.74, capF: 0.68, capR: 0.5, rw: 0.3,
  top: [[-2.0, 0.88], [-1.95, 0.98], [-1.86, 1.08], [-1.4, 1.4], [-1.1, 1.465], [-0.3, 1.475], [0.3, 1.455], [0.5, 1.42], [1.08, 1.02], [1.22, 0.99], [1.68, 0.93], [1.88, 0.85], [2.0, 0.75]],
  belt: [[-2.0, 0.84], [-1.75, 0.96], [-1.0, 0.97], [1.05, 0.95], [1.7, 0.88], [2.0, 0.71]],
  sill: [[-2.0, 0.27], [-1.75, 0.225], [-1.6, 0.215], [1.6, 0.215], [1.82, 0.225], [2.0, 0.25]],
  axles: [-1.24, 1.2], cowl: 1.08, wsTop: 0.48, rwTop: -1.38, rwBase: -1.88, xA: 0.85, xC: -1.5, pillars: [-0.12, -1.0],
  doors: [-0.78, -0.12, 0.76], gateLine: 0,
  head: [0.42, 0.92, 0.58, 0.69], tail: [0.62, 0.93, 0.72, 0.9], amber: null,
  grille: [0.34, 0.58, 0.67], intake: [0.62, 0.3, 0.38], plateF: 0.47, plateR: 0.62,
  bar: [0.47, 0.5, 0.14, 0.02], barSurf: PAINT,
};

const SUV = {
  ...BASE, L: 4.45, W: 1.84, capF: 0.62, capR: 0.45, rw: 0.36, tw: 0.23, tumble: 0.26, roofR: 0.08, clad: true, bumper: 'black',
  top: [[-2.225, 1.0], [-2.17, 1.12], [-2.04, 1.52], [-1.85, 1.64], [-1.0, 1.685], [0.0, 1.68], [0.4, 1.655], [0.6, 1.61], [1.12, 1.17], [1.28, 1.13], [1.85, 1.07], [2.08, 1.0], [2.225, 0.92]],
  belt: [[-2.225, 0.95], [-1.95, 1.08], [-1.2, 1.1], [1.1, 1.075], [1.85, 1.01], [2.225, 0.88]],
  sill: [[-2.225, 0.34], [-1.95, 0.31], [-1.75, 0.3], [1.8, 0.3], [2.02, 0.305], [2.225, 0.32]],
  axles: [-1.3, 1.36], cowl: 1.12, wsTop: 0.58, rwTop: -2.03, rwBase: -2.19, xA: 0.9, xC: -1.98, pillars: [0.0, -0.88, -1.68],
  doors: [-0.84, 0.0, 0.88], gateLine: -2.03,
  head: [0.5, 0.92, 0.74, 0.86], tail: [0.74, 0.93, 0.82, 1.06], amber: null,
  grille: [0.46, 0.7, 0.85], intake: [0.6, 0.4, 0.5], plateF: 0.58, plateR: 0.84, rails: [-1.7, 0.3], handleDrop: 0.11,
};

const VAN = {
  ...BASE, L: 4.9, W: 1.9, capF: 0.5, capR: 0.34, rw: 0.34, tw: 0.22, tumble: 0.16, roofR: 0.09, crown: 0.035, planP: 4.2, bumper: 'black', hubcap: true,
  top: [[-2.45, 1.8], [-2.36, 1.91], [-2.0, 1.95], [0.3, 1.95], [0.95, 1.92], [1.2, 1.84], [1.82, 1.14], [1.95, 1.08], [2.25, 1.0], [2.38, 0.96], [2.45, 0.92]],
  belt: [[-2.45, 1.0], [-2.2, 1.12], [1.7, 1.1], [2.2, 0.99], [2.45, 0.9]],
  sill: [[-2.45, 0.32], [-2.2, 0.27], [-2.0, 0.26], [2.05, 0.26], [2.25, 0.27], [2.45, 0.3]],
  axles: [-1.5, 1.55], cowl: 1.82, wsTop: 1.18, rwTop: -2.2, rwBase: -2.2, xA: 1.6, xC: 0.62, pillars: [],
  doors: [0.55, 1.04], gateLine: 0, hoodLine: false, strip: 0.62,
  head: [0.56, 0.92, 0.7, 0.86], tail: [0.84, 0.93, 0.72, 1.08], amber: null,
  grille: [0.5, 0.7, 0.84], intake: [0.6, 0.36, 0.46], plateF: 0.56, plateR: 0.66, mirrorSurf: TRIM, handleSurf: TRIM,
  vlines: [-0.75, -2.0], ulines: [-0.75, 0.55],
};

const PICKUP = {
  ...BASE, L: 5.2, W: 1.9, capF: 0.6, capR: 0.3, rw: 0.37, tw: 0.24, tumble: 0.24, roofR: 0.08, planP: 4.0, bumper: 'body', hubcap: false,
  top: [[-2.6, 1.02], [-2.57, 1.1], [-2.4, 1.12], [-0.72, 1.12], [-0.6, 1.2], [-0.46, 1.7], [-0.3, 1.76], [0.5, 1.765], [0.78, 1.72], [1.34, 1.2], [1.5, 1.16], [2.2, 1.1], [2.45, 1.04], [2.6, 0.96]],
  belt: [[-2.6, 0.98], [-2.3, 1.07], [1.3, 1.07], [2.2, 1.03], [2.6, 0.92]],
  sill: [[-2.6, 0.4], [-2.35, 0.37], [-2.15, 0.36], [2.1, 0.36], [2.35, 0.365], [2.6, 0.38]],
  axles: [-1.62, 1.64], cowl: 1.34, wsTop: 0.76, rwTop: -0.47, rwBase: -0.6, xA: 1.12, xC: -0.42, pillars: [0.1],
  doors: [0.1, 1.08], bed: [-2.5, -0.72], hoodLine: true, gateLine: -0.68,
  head: [0.52, 0.92, 0.76, 0.9], tail: [0.84, 0.93, 0.72, 1.0], amber: null,
  grille: [0.48, 0.74, 0.9], grilleSurf: TRIM, intake: [0.6, 0.52, 0.6], plateF: 0.6, plateR: 0.62,
  bar: [0.6, 0.6, 0.15, 0.03], barSurf: CHROME, mirrorSurf: TRIM, handleDrop: 0.11,
};

const CLASSIC = {
  ...BASE, L: 4.6, W: 1.72, capF: 0.9, capR: 0.85, planP: 2.5, rw: 0.335, tw: 0.185, tumble: 0.34, crown: 0.075, roofR: 0.11, hubcap: true, roundLights: true,
  top: [[-2.3, 0.78], [-2.1, 0.93], [-1.6, 1.0], [-1.18, 1.03], [-0.62, 1.42], [-0.2, 1.5], [0.3, 1.49], [0.52, 1.44], [0.92, 1.06], [1.1, 1.03], [1.7, 0.99], [2.1, 0.88], [2.3, 0.74]],
  belt: [[-2.3, 0.72], [-1.8, 0.92], [-1.0, 0.96], [0.9, 0.96], [1.8, 0.9], [2.3, 0.66]],
  sill: [[-2.3, 0.31], [-2.05, 0.27], [-1.8, 0.25], [1.85, 0.25], [2.1, 0.265], [2.3, 0.3]],
  axles: [-1.35, 1.4], cowl: 0.92, wsTop: 0.5, rwTop: -0.6, rwBase: -1.18, xA: 0.74, xC: -0.92, pillars: [-0.1],
  doors: [-0.1, 0.8], bootLine: true,
  head: [0.66, 0.105, 0.72], tail: [0.62, 0.8, 0.64, 0.76], amber: null,
  grille: [0.4, 0.52, 0.7], grilleSurf: CHROME, intake: null, plateF: 0.42, plateR: 0.58,
  bar: [0.44, 0.46, 0.085, 0.045], barSurf: CHROME, handleSurf: CHROME, mirrorSurf: CHROME, strip: 0.6, stripSurf: CHROME,
};

const TAXI = { ...SEDAN, sign: 0.05 };

export function buildCar(spec, lod = 'hi') {
  const g = new Geo(), P = prep(spec);
  hull(g, P, lod);
  if (lod !== 'lo') { wheels(g, P, lod); details(g, P, lod); }
  else if (spec.sign) g.add(box(0.26, 0.12, 0.5), SIGN, xf(spec.sign, P.top(spec.sign) + 0.085, 0));
  return g;
}

// order + weights: the two new styles split the share of the style listed before them, so every previously placed
// car keeps its slot and (unless it became a wagon / SUV) its style.
export const CAR_TYPES = [
  { name: 'carSedan', spec: SEDAN, L: 4.5, W: 1.78, weight: 0.2 },
  { name: 'carWagon', spec: WAGON, L: 4.6, W: 1.78, weight: 0.1 },
  { name: 'carHatch', spec: HATCH, L: 4.0, W: 1.74, weight: 0.17 },
  { name: 'carSuv', spec: SUV, L: 4.45, W: 1.84, weight: 0.08 },
  { name: 'carVan', spec: VAN, L: 4.9, W: 1.9, weight: 0.12 },
  { name: 'carTaxi', spec: TAXI, L: 4.5, W: 1.78, weight: 0.08 },
  { name: 'carPickup', spec: PICKUP, L: 5.2, W: 1.9, weight: 0.1 },
  { name: 'carClassic', spec: CLASSIC, L: 4.6, W: 1.72, weight: 0.15 },
];
for (const t of CAR_TYPES) t.make = (lod = 'hi') => buildCar(t.spec, lod);

// muted paints (linear rgb): mostly whites, silvers, greys and blacks with a few deep colours
export const CAR_PAINTS = [
  [0.56, 0.56, 0.54], [0.36, 0.37, 0.38], [0.035, 0.038, 0.042], [0.012, 0.012, 0.014], [0.022, 0.036, 0.075], [0.15, 0.018, 0.02],
  [0.024, 0.055, 0.04], [0.33, 0.29, 0.22], [0.12, 0.16, 0.2], [0.17, 0.06, 0.03], [0.46, 0.46, 0.44], [0.075, 0.078, 0.082], [0.22, 0.235, 0.225],
];
export const TAXI_PAINT = [0.58, 0.38, 0.04];

/** car paint: clearcoat over a tinted base, dark glass, dust low on the body, fake street reflections, night lights */
export function makeCarMaterial(ctx) {
  return ctx.makeMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.04 }, {
    key: 'streets-car',
    vertexPars: /* glsl */`attribute vec4 aSurf; attribute vec4 aInst; varying vec4 vSurf; varying vec4 vInst; varying vec3 vObj; varying vec3 vCarAxis; varying float vCarSeed;`,
    vertex: /* glsl */`
      vSurf = aSurf; vInst = aInst; vObj = position;
      #ifdef USE_INSTANCING
        vCarAxis = normalize(instanceMatrix[0].xyz);
        vCarSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
      #else
        vCarAxis = vec3(1.0, 0.0, 0.0); vCarSeed = 0.37;
      #endif`,
    fragPars: /* glsl */`varying vec4 vSurf; varying vec4 vInst; varying vec3 vObj; varying vec3 vCarAxis; varying float vCarSeed;
      float carCoat_ = 0.0; float carDust_ = 0.0; float carPaint_ = 0.0;`,
    color: /* glsl */`
      {
        carPaint_ = step(0.5, vSurf.w) * step(vSurf.w, 1.5);
        carCoat_ = step(0.5, vSurf.w);
        diffuseColor.rgb *= mix(vec3(1.0), vInst.rgb, carPaint_);
        // road dust: a band along the sills and behind the wheels, plus a thin film on the occasional neglected car
        float dirty_ = fract(vCarSeed * 7.31);
        float dn_ = fbm2(vObj.xy * vec2(2.6, 7.0) + vCarSeed * 53.0);
        float low_ = (1.0 - smoothstep(0.1, 0.5, vObj.y)) * (0.25 + 0.75 * dn_);
        float film_ = smoothstep(0.78, 1.0, dirty_) * (0.12 + 0.3 * fbm2(vObj.xz * 5.0 + vCarSeed * 11.0));
        carDust_ = clamp(low_ * (0.1 + 0.5 * dirty_) + film_, 0.0, 0.7) * step(vSurf.z, 0.5) * step(vSurf.y, 0.8);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.19, 0.165, 0.135), carDust_ * 0.5 * (0.4 + 0.6 * carCoat_));
      }`,
    surface: /* glsl */`
      {
        float metallic_ = step(0.45, fract(vCarSeed * 3.17)) * carPaint_;
        roughnessFactor = mix(vSurf.x, 0.42, metallic_);
        metalnessFactor = mix(vSurf.y, 0.6, metallic_);
        roughnessFactor = mix(roughnessFactor, 0.85, carDust_ * 0.8);
        metalnessFactor *= 1.0 - 0.6 * carDust_;
      }`,
    emissive: /* glsl */`
      {
        float code = floor(vSurf.z + 0.5);
        if (code > 0.5) {
          float seed = vInst.w; vec3 e = vec3(0.0);
          if (code < 11.5) e = vec3(1.0, 0.04, 0.02) * step(0.25, seed) * (seed > 0.75 ? 7.0 : 1.6) * smoothstep(0.0, 0.3, uNight);
          else if (code < 12.5) e = (seed > 0.75 ? vec3(1.0, 0.92, 0.78) * 60.0 : vec3(1.0, 0.6, 0.25) * 3.0) * step(0.25, seed) * smoothstep(0.0, 0.3, uNight);
          else e = vec3(1.0, 0.78, 0.28) * 4.0 * uNight;
          totalEmissiveRadiance += e;
        }
      }`,
    ao: /* glsl */`
      {
        // what a parked car mirrors is the street, not an open sky: dim the reflection below a ragged roofline that
        // opens along the street axis; at night add soft streaks of the nearest lamps on the upward-facing panels
        vec3 rw_ = viewToWorldDir(reflect(-geometryViewDir, geometryNormal));
        vec2 rh_ = normalize(rw_.xz + vec2(1e-5));
        float along_ = pow(abs(dot(rh_, normalize(vCarAxis.xz + vec2(1e-5)))), 6.0);
        float az_ = atan(rw_.z, rw_.x) * 6.5 + vCarSeed * 20.0;
        float blk_ = hash11(floor(az_)), blk2_ = hash11(floor(az_ * 3.0) + 71.0);
        float roof_ = (0.1 + 0.42 * blk_ + 0.06 * blk2_) * (1.0 - 0.94 * along_);              // blocky skyline: sin(elevation)
        float open_ = smoothstep(roof_ - 0.012, roof_ + 0.012, rw_.y);
        // facades are darker than the sky they hide, except the odd one that still catches the sun
        float sunny_ = mix(step(0.72, hash11(floor(az_) + 12.0)), step(0.72, hash11(floor(az_) + 13.0)), smoothstep(0.0, 0.22, fract(az_))) * smoothstep(-1.0, 4.0, uSunElev);
        float facade_ = (0.3 + 0.3 * blk2_ + 1.1 * sunny_) * smoothstep(-0.3, 0.04, rw_.y) + 0.12;
        vec3 k_ = mix(facade_ * mix(vec3(1.0), vec3(1.25, 1.0, 0.72), sunny_), vec3(1.0), open_);
        reflectedLight.indirectSpecular *= k_ * (vSurf.w > 1.5 ? 0.3 : 1.0);
        #ifdef USE_CLEARCOAT
          clearcoatSpecularIndirect *= k_ * 1.5;
          if (uNight > 0.001) {
            vec3 cl_ = texture2D(uCityLights, (vWPos.xz - uCityLightRect.xy) / uCityLightRect.zw).rgb;
            float fr_ = 0.04 + 0.96 * pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 5.0);
            // soft streaks of the nearest lamps on the upward-facing panels, a dim warm glow from the mirrored facades
            float blob_ = smoothstep(0.66, 0.9, vnoise(rw_.xz * 2.2 + vCarSeed * 9.0)) * smoothstep(0.2, 0.65, rw_.y);
            float wall_ = (1.0 - open_) * smoothstep(-0.05, 0.1, rw_.y) * (0.5 + blk2_);
            clearcoatSpecularIndirect += (cl_ * 3.0 * blob_ + vec3(1.0, 0.74, 0.46) * 0.22 * wall_) * uNight * fr_ * (1.0 - 0.8 * carDust_);
          }
        #endif
      }`,
    onCompile(shader) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', /* glsl */`#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          material.clearcoat *= carCoat_ * (1.0 - 0.7 * carDust_);
          material.clearcoatRoughness = min(1.0, material.clearcoatRoughness + 0.35 * carDust_);
        #endif`);
    },
  }, THREE.MeshPhysicalMaterial);
}

/** soft contact shadow under a parked car: a multiplicative decal on the road (unit quad scaled to the car's footprint) */
export function makeCarShadow(ctx) {
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2); geo.translate(0, 0.014, 0);
  const mat = ctx.makeShaderMaterial({
    vertexShader: /* glsl */`
      varying vec2 vP; varying vec2 vHalf;
      void main() {
        vec3 p = position;
        #ifdef USE_INSTANCING
          vHalf = 0.5 * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        #else
          vHalf = vec2(0.5); vec4 wp = modelMatrix * vec4(p, 1.0);
        #endif
        vP = position.xz * 2.0 * vHalf;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vP; varying vec2 vHalf;
      void main() {
        vec2 q = abs(vP) - (vHalf - vec2(0.62));
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.62;     // signed distance to the padded footprint edge
        float k = 1.0 - smoothstep(-0.42, 0.0, d);
        gl_FragColor = vec4(vec3(1.0 - 0.8 * k * k), 1.0);
      }`,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    depthWrite: false, depthTest: true, transparent: true,
  });
  return { geo, mat };
}
