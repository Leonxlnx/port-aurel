// Tiny immediate-mode geometry builder used by the transit module. Everything is appended into flat arrays and
// turned into ONE non-indexed BufferGeometry per material (few draw calls). Vertex format:
//   position, normal, color (rgb tint), aFace (vec4, meaning depends on the material), uv (for the print atlas).
// For the fixed structures aFace = (u, v, W, H): face coordinates in metres + face size (edge-aware rivets / rust).
// For the trams aFace = (z, y, x, class) in tram-local metres (stable procedural detail on a moving body).
import * as THREE from 'three';

const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3();
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export class Geo {
  constructor({ local = false } = {}) {
    this.pos = []; this.nor = []; this.fac = []; this.col = []; this.uvs = [];
    this.c = [1, 1, 1];
    this.m = null; this.nm = null; this.flip = false;
    this.local = local;          // aFace = (z, y, x, cls) from the transformed position
    this.cls = 0;                // material class for local mode
    this.uvRect = null;          // [u0, v0, u1, v1] atlas rect for quads (print material)
    this.fo = null;              // if set: aFace override [x, y, z, w] for everything that follows (lamps / prints)
  }
  get count() { return this.pos.length / 3; }
  get tris() { return this.pos.length / 9; }
  color(r, g, b) { if (g === undefined) { const c = new THREE.Color(r); this.c = [c.r, c.g, c.b]; } else this.c = [r, g, b]; return this; }
  setClass(c) { this.cls = c; return this; }
  /** transform applied to everything that follows (Matrix4 or null) */
  matrix(m) {
    if (!m) { this.m = null; this.nm = null; this.flip = false; return this; }
    this.m = m.clone(); this.nm = new THREE.Matrix3().getNormalMatrix(this.m); this.flip = this.m.determinant() < 0; return this;
  }
  _v(p, n, fu, fv, fw, fh, u, v) {
    let x = p.x, y = p.y, z = p.z, nx = n.x, ny = n.y, nz = n.z;
    if (this.m) {
      _q.set(x, y, z).applyMatrix4(this.m); x = _q.x; y = _q.y; z = _q.z;
      _q.set(nx, ny, nz).applyMatrix3(this.nm).normalize(); nx = _q.x; ny = _q.y; nz = _q.z;
    }
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(this.c[0], this.c[1], this.c[2]);
    if (this.fo) this.fac.push(this.fo[0], this.fo[1], this.fo[2], this.fo[3]);
    else if (this.local) this.fac.push(z, y, x, this.cls); else this.fac.push(fu, fv, fw, fh);
    this.uvs.push(u, v);
  }
  /** triangle with explicit per-vertex normals (or a flat normal if n is a single vector) */
  tri(a, b, c, na, nb, nc, f) {
    if (!na) { _n.subVectors(b, a).cross(_r.subVectors(c, a)).normalize(); na = nb = nc = _n.clone(); }
    else if (!nb) { nb = nc = na; }
    f = f || [0, 0, 0, 0, 0, 0, 0, 0];
    if (this.flip) { this._v(a, na, f[0], f[1], f[6], f[7], 0, 0); this._v(c, nc, f[4], f[5], f[6], f[7], 0, 0); this._v(b, nb, f[2], f[3], f[6], f[7], 0, 0); }
    else { this._v(a, na, f[0], f[1], f[6], f[7], 0, 0); this._v(b, nb, f[2], f[3], f[6], f[7], 0, 0); this._v(c, nc, f[4], f[5], f[6], f[7], 0, 0); }
  }
  /** triangle wound so that its normal points along `dir` */
  triDir(a, b, c, dir) {
    _n.subVectors(b, a).cross(_r.subVectors(c, a));
    if (_n.dot(dir) < 0) this.tri(a, c, b); else this.tri(a, b, c);
  }
  /** quad a,b,c,d counter-clockwise seen from the front. Face coords: a=(0,0) b=(W,0) c=(W,H) d=(0,H). */
  quad(a, b, c, d, n, W, H) {
    if (!n) { n = V3().subVectors(b, a).cross(_r.subVectors(d, a)).normalize(); if (n.lengthSq() < 0.5) n = V3().subVectors(c, b).cross(_r.subVectors(d, b)).normalize(); }
    if (W === undefined) { W = a.distanceTo(b); H = a.distanceTo(d); }
    const r = this.uvRect;
    const A = [a, 0, 0, r ? r[0] : 0, r ? r[1] : 0], B = [b, W, 0, r ? r[2] : 1, r ? r[1] : 0];
    const C = [c, W, H, r ? r[2] : 1, r ? r[3] : 1], D = [d, 0, H, r ? r[0] : 0, r ? r[3] : 1];
    const order = this.flip ? [A, C, B, A, D, C] : [A, B, C, A, C, D];
    for (const o of order) this._v(o[0], n, o[1], o[2], W, H, o[3], o[4]);
    return this;
  }
  /** quad with per-vertex normals (smooth surfaces) */
  quadN(a, b, c, d, na, nb, nc, nd) {
    const f = [0, 0, 0, 0, 0, 0, 0, 0];
    this.tri(a, b, c, na, nb, nc, f); this.tri(a, c, d, na, nc, nd, f);
    return this;
  }
  /** axis-aligned box centred at (cx,cy,cz). skip: string of faces to omit, e.g. 'b' bottom, 't' top */
  box(cx, cy, cz, sx, sy, sz, skip = '') {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    if (!skip.includes('e')) this.quad(V3(x1, y0, z1), V3(x1, y0, z0), V3(x1, y1, z0), V3(x1, y1, z1), V3(1, 0, 0), sz, sy);
    if (!skip.includes('w')) this.quad(V3(x0, y0, z0), V3(x0, y0, z1), V3(x0, y1, z1), V3(x0, y1, z0), V3(-1, 0, 0), sz, sy);
    if (!skip.includes('t')) this.quad(V3(x0, y1, z1), V3(x1, y1, z1), V3(x1, y1, z0), V3(x0, y1, z0), V3(0, 1, 0), sx, sz);
    if (!skip.includes('b')) this.quad(V3(x0, y0, z0), V3(x1, y0, z0), V3(x1, y0, z1), V3(x0, y0, z1), V3(0, -1, 0), sx, sz);
    if (!skip.includes('s')) this.quad(V3(x0, y0, z1), V3(x1, y0, z1), V3(x1, y1, z1), V3(x0, y1, z1), V3(0, 0, 1), sx, sy);
    if (!skip.includes('n')) this.quad(V3(x1, y0, z0), V3(x0, y0, z0), V3(x0, y1, z0), V3(x1, y1, z0), V3(0, 0, -1), sx, sy);
    return this;
  }
  /** box given by min/max corners */
  boxMM(x0, y0, z0, x1, y1, z1, skip = '') { return this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), skip); }
  /** rectangular bar from p0 to p1: w = size along the side axis (perpendicular to `up` and the bar), h = size along the bar's up axis */
  beam(p0, p1, w, h, up = null, caps = true) {
    const dir = V3().subVectors(p1, p0); const len = dir.length(); if (len < 1e-6) return this; dir.multiplyScalar(1 / len);
    let u = up ? up.clone() : V3(0, 1, 0);
    if (Math.abs(u.dot(dir)) > 0.999) u = V3(1, 0, 0);
    const side = V3().crossVectors(u, dir).normalize(); const upv = V3().crossVectors(dir, side).normalize();
    const c = (p, a, b) => V3().copy(p).addScaledVector(side, a * w / 2).addScaledVector(upv, b * h / 2);
    const a0 = c(p0, -1, -1), b0 = c(p0, 1, -1), c0 = c(p0, 1, 1), d0 = c(p0, -1, 1);
    const a1 = c(p1, -1, -1), b1 = c(p1, 1, -1), c1 = c(p1, 1, 1), d1 = c(p1, -1, 1);
    this.quad(b0, a0, a1, b1, upv.clone().negate(), w, len);          // bottom
    this.quad(d0, c0, c1, d1, upv.clone(), w, len);                   // top
    this.quad(a0, d0, d1, a1, side.clone().negate(), h, len);         // -side
    this.quad(c0, b0, b1, c1, side.clone(), h, len);                  // +side
    if (caps) { this.quad(a0, b0, c0, d0, dir.clone().negate(), w, h); this.quad(b1, a1, d1, c1, dir.clone(), w, h); }
    return this;
  }
  /** cylinder / cone between two points (smooth normals) */
  cyl(p0, p1, r0, r1 = r0, seg = 8, caps = false) {
    const dir = V3().subVectors(p1, p0); const len = dir.length(); if (len < 1e-6) return this; dir.multiplyScalar(1 / len);
    let u = Math.abs(dir.y) > 0.99 ? V3(1, 0, 0) : V3(0, 1, 0);
    const s = V3().crossVectors(u, dir).normalize(); const t = V3().crossVectors(dir, s).normalize();
    const ring = (p, r, i) => { const a = i / seg * Math.PI * 2; return V3().copy(p).addScaledVector(s, Math.cos(a) * r).addScaledVector(t, Math.sin(a) * r); };
    const nrm = i => { const a = i / seg * Math.PI * 2; return V3().addScaledVector(s, Math.cos(a)).addScaledVector(t, Math.sin(a)); };
    for (let i = 0; i < seg; i++) {
      const a = ring(p0, r0, i), b = ring(p0, r0, i + 1), c = ring(p1, r1, i + 1), d = ring(p1, r1, i);
      const n0 = nrm(i), n1 = nrm(i + 1);
      this.quadN(a, d, c, b, n0, n0, n1, n1);
    }
    if (caps) for (let i = 0; i < seg; i++) {
      if (r0 > 0) this.tri(p0.clone(), ring(p0, r0, i), ring(p0, r0, i + 1), dir.clone().negate());
      if (r1 > 0) this.tri(p1.clone(), ring(p1, r1, i + 1), ring(p1, r1, i), dir.clone());
    }
    return this;
  }
  /** surface of revolution around the Y axis through centre c. pts: [[r, y], ...] bottom -> top */
  lathe(c, pts, seg = 12) {
    const P = (i, k) => { const a = k / seg * Math.PI * 2; return V3(c.x + Math.cos(a) * pts[i][0], c.y + pts[i][1], c.z + Math.sin(a) * pts[i][0]); };
    for (let i = 0; i < pts.length - 1; i++) {
      const dr = pts[i + 1][0] - pts[i][0], dy = pts[i + 1][1] - pts[i][1];
      for (let k = 0; k < seg; k++) {
        const a0 = k / seg * Math.PI * 2, a1 = (k + 1) / seg * Math.PI * 2;
        const n0 = V3(Math.cos(a0) * dy, -dr, Math.sin(a0) * dy).normalize(), n1 = V3(Math.cos(a1) * dy, -dr, Math.sin(a1) * dy).normalize();
        this.quadN(P(i, k), P(i + 1, k), P(i + 1, k + 1), P(i, k + 1), n0, n0, n1, n1);
      }
    }
    return this;
  }
  sphere(c, r, ws = 10, hs = 6, sy = 1) {
    const pts = []; for (let i = 0; i <= hs; i++) { const a = -Math.PI / 2 + i / hs * Math.PI; pts.push([Math.max(1e-4, Math.cos(a) * r), Math.sin(a) * r * sy]); }
    return this.lathe(c, pts, ws);
  }
  /** append another builder (same vertex format) */
  add(g) { for (const k of ['pos', 'nor', 'fac', 'col', 'uvs']) { const a = this[k], b = g[k]; for (let i = 0; i < b.length; i++) a.push(b[i]); } return this; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('aFace', new THREE.BufferAttribute(new Float32Array(this.fac), 4));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uvs), 2));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** rounded rectangle outline (counter-clockwise), n segments per corner */
export function roundRect(u0, v0, u1, v1, r, n = 5) {
  const pts = []; r = Math.min(r, (u1 - u0) / 2, (v1 - v0) / 2);
  const corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  if (r <= 1e-5) return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
  corner(u1 - r, v0 + r, -Math.PI / 2); corner(u1 - r, v1 - r, 0); corner(u0 + r, v1 - r, Math.PI / 2); corner(u0 + r, v0 + r, Math.PI);
  return pts;
}

/**
 * Plate with holes. contour / holes are 2D outlines [[u,v],...]; map(u, v, d) -> Vector3 places them in space, d = depth.
 * Faces at depth d1 go to gFront (normal toward +d), faces at d0 to gBack, hole + outline reveals to gSide (any may be null).
 */
export function plate(contour, holes, map, d0, d1, gFront, gBack, gSide, { outerSide = true } = {}) {
  const C = contour.map(p => new THREE.Vector2(p[0], p[1])); const Hs = holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1])));
  // ShapeUtils wants the contour CCW and the holes CW
  if (THREE.ShapeUtils.isClockWise(C)) C.reverse();
  for (const h of Hs) if (!THREE.ShapeUtils.isClockWise(h)) h.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(C, Hs);
  const all = C.concat(...Hs);
  const dirF = V3().subVectors(map(all[0].x, all[0].y, d1), map(all[0].x, all[0].y, d0)).normalize();
  const dirB = dirF.clone().negate();
  for (const t of tris) {
    const a = all[t[0]], b = all[t[1]], c = all[t[2]];
    if (gFront) gFront.triDir(map(a.x, a.y, d1), map(b.x, b.y, d1), map(c.x, c.y, d1), dirF);
    if (gBack) gBack.triDir(map(a.x, a.y, d0), map(b.x, b.y, d0), map(c.x, c.y, d0), dirB);
  }
  if (gSide) {
    const loop = (L, outward) => {
      // centroid to orient the reveal normals
      let cu = 0, cv = 0; for (const p of L) { cu += p.x; cv += p.y; } cu /= L.length; cv /= L.length;
      const cen = map(cu, cv, (d0 + d1) / 2);
      for (let i = 0; i < L.length; i++) {
        const p = L[i], q = L[(i + 1) % L.length];
        const a = map(p.x, p.y, d0), b = map(q.x, q.y, d0), c = map(q.x, q.y, d1), d = map(p.x, p.y, d1);
        const mid = V3().addVectors(a, c).multiplyScalar(0.5);
        const want = outward ? V3().subVectors(mid, cen) : V3().subVectors(cen, mid);
        const n = V3().subVectors(b, a).cross(V3().subVectors(d, a));
        if (n.dot(want) >= 0) gSide.quad(a, b, c, d); else gSide.quad(b, a, d, c);
      }
    };
    if (outerSide) loop(C, true);
    for (const h of Hs) loop(h, false);
  }
}

export { V3 };

// ---- smooth / bevelled helpers ------------------------------------------------------------------------
function quadSmooth(g, a, b, c, d, na, nb, nc, nd) {
  const n = V3().subVectors(b, a).cross(V3().subVectors(d, a)); if (n.lengthSq() < 1e-14) n.subVectors(c, b).cross(V3().subVectors(d, b));
  if (n.lengthSq() < 1e-16) return;
  const ref = V3().add(na).add(nb).add(nc).add(nd);
  if (n.dot(ref) >= 0) g.quadN(a, b, c, d, na, nb, nc, nd); else g.quadN(a, d, c, b, na, nd, nc, nb);
}
export { quadSmooth };

/** rounded rectangle loop WITH outward normals: [[u, v, nu, nv], ...] counter-clockwise, n segments per corner */
export function roundRectN(u0, v0, u1, v1, r, n = 8) {
  const pts = []; r = Math.max(1e-4, Math.min(r, (u1 - u0) / 2, (v1 - v0) / 2));
  const corner = (cx, cy, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI / 2, c = Math.cos(a), s = Math.sin(a); pts.push([cx + c * r, cy + s * r, c, s]); } };
  corner(u1 - r, v0 + r, -Math.PI / 2); corner(u1 - r, v1 - r, 0); corner(u0 + r, v1 - r, Math.PI / 2); corner(u0 + r, v0 + r, Math.PI);
  return pts;
}
/** arc of a profile: [[o, d, no, nd], ...] around (co, cd), radius r, angles a0 -> a1 (radians), n segments */
export function profArc(co, cd, r, a0, a1, n = 4) {
  const p = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, c = Math.cos(a), s = Math.sin(a); p.push([co + c * r, cd + s * r, c, s]); } return p;
}
/** polyline [[x, y], ...] -> [[x, y, nx, ny], ...] with averaged normals (left of the travel direction; pass flip to reverse) */
export function polyProf(pts, flip = false, closed = false) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i + n - 1) % n] : pts[Math.max(0, i - 1)], b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0], dy = b[1] - a[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    out.push([pts[i][0], pts[i][1], flip ? dy : -dy, flip ? -dx : dx]);
  }
  return out;
}
/**
 * Sweep a profile around a closed loop (window frames, gaskets). loop: [[u, v, nu, nv]], prof: [[o, d, no, nd]] where o is the
 * offset along the loop's outward normal and d the depth; map(u, v, d) -> Vector3 must be affine. Smooth normals.
 */
export function sweepLoop(g, loop, prof, map) {
  const O = map(0, 0, 0), eu = map(1, 0, 0).sub(O).normalize(), ev = map(0, 1, 0).sub(O).normalize(), ed = map(0, 0, 1).sub(O).normalize();
  const n = loop.length, m = prof.length, P = [], N = [];
  for (let i = 0; i < n; i++) {
    const L = loop[i]; P.push([]); N.push([]);
    for (let k = 0; k < m; k++) {
      const q = prof[k];
      P[i].push(map(L[0] + L[2] * q[0], L[1] + L[3] * q[0], q[1]));
      N[i].push(V3().addScaledVector(eu, L[2] * q[2]).addScaledVector(ev, L[3] * q[2]).addScaledVector(ed, q[3]).normalize());
    }
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    for (let k = 0; k < m - 1; k++) quadSmooth(g, P[i][k], P[j][k], P[j][k + 1], P[i][k + 1], N[i][k], N[j][k], N[j][k + 1], N[i][k + 1]);
  }
}
/** extrude a profile [[x, y, nx, ny], ...] along z (z0 -> z1); sx mirrors x. Optional flat end caps (closed convex-ish profiles). */
export function extrudeZ(g, prof, z0, z1, sx = 1, caps = false) {
  for (let k = 0; k < prof.length - 1; k++) {
    const p = prof[k], q = prof[k + 1];
    const np = V3(sx * p[2], p[3], 0), nq = V3(sx * q[2], q[3], 0);
    quadSmooth(g, V3(sx * p[0], p[1], z0), V3(sx * p[0], p[1], z1), V3(sx * q[0], q[1], z1), V3(sx * q[0], q[1], z0), np, np, nq, nq);
  }
  if (caps) {
    let cx = 0, cy = 0; for (const p of prof) { cx += p[0]; cy += p[1]; } cx /= prof.length; cy /= prof.length;
    for (const [z, dz] of [[z0, -1], [z1, 1]]) for (let k = 0; k < prof.length - 1; k++)
      g.triDir(V3(sx * cx, cy, z), V3(sx * prof[k][0], prof[k][1], z), V3(sx * prof[k + 1][0], prof[k + 1][1], z), V3(0, 0, dz * Math.sign(z1 - z0)));
  }
}
/** rectangular bar with rounded (bevelled) edges between two points: w along the side axis, h along `up`, edge radius r */
Geo.prototype.rbeam = function (p0, p1, w, h, r = 0.004, up = null, seg = 2, caps = true) {
  const dir = V3().subVectors(p1, p0); const len = dir.length(); if (len < 1e-6) return this; dir.multiplyScalar(1 / len);
  let u = up ? up.clone() : V3(0, 1, 0);
  if (Math.abs(u.dot(dir)) > 0.999) u = V3(1, 0, 0);
  const side = V3().crossVectors(u, dir).normalize(); const upv = V3().crossVectors(dir, side).normalize();
  const loop = roundRectN(-w / 2, -h / 2, w / 2, h / 2, r, seg);
  const P = (p, L) => V3().copy(p).addScaledVector(side, L[0]).addScaledVector(upv, L[1]);
  const Nn = L => V3().addScaledVector(side, L[2]).addScaledVector(upv, L[3]);
  for (let i = 0; i < loop.length; i++) {
    const A = loop[i], B = loop[(i + 1) % loop.length];
    quadSmooth(this, P(p0, A), P(p1, A), P(p1, B), P(p0, B), Nn(A), Nn(A), Nn(B), Nn(B));
  }
  if (caps) for (const [p, d] of [[p0, dir.clone().negate()], [p1, dir.clone()]]) for (let i = 0; i < loop.length; i++) this.triDir(p.clone(), P(p, loop[i]), P(p, loop[(i + 1) % loop.length]), d);
  return this;
};
/** torus (ring) around centre c with axis `ax`: major radius R, tube radius r */
Geo.prototype.torus = function (c, ax, R, r, NS = 32, NT = 10) {
  const a = ax.clone().normalize(); let u = Math.abs(a.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0);
  const e1 = V3().crossVectors(u, a).normalize(), e2 = V3().crossVectors(a, e1).normalize();
  const tp = (i, j) => {
    const t = i / NS * Math.PI * 2, b = j / NT * Math.PI * 2, e = V3().addScaledVector(e1, Math.cos(t)).addScaledVector(e2, Math.sin(t));
    const n = e.clone().multiplyScalar(Math.cos(b)).addScaledVector(a, Math.sin(b));
    return [c.clone().addScaledVector(e, R).addScaledVector(n, r), n];
  };
  for (let i = 0; i < NS; i++) for (let j = 0; j < NT; j++) {
    const A = tp(i, j), B = tp(i + 1, j), C = tp(i + 1, j + 1), D = tp(i, j + 1);
    quadSmooth(this, A[0], B[0], C[0], D[0], A[1], B[1], C[1], D[1]);
  }
  return this;
};
