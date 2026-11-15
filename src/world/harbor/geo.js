// Harbor geometry toolkit: merged-geometry buckets (per material + region) and a few primitive generators.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3(), _c = new THREE.Vector3();
const WHITE = [1, 1, 1];
export const IDENT = new THREE.Matrix4();

/** Accumulates transformed geometries into one big indexed geometry: position, normal, color, uv, aK (kind, param). */
export class Bucket {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = []; this.k = []; this.idx = []; this.n = 0; }
  /**
   * geo: BufferGeometry; m: Matrix4 (or null); color: [r,g,b] or fn(x,y,z)->[r,g,b] (world/merged space);
   * kind/param: written to aK; uvScale: optional [su, sv] multiplier for the geometry's uv.
   */
  add(geo, m = null, color = WHITE, kind = 0, param = 0, uvScale = null) {
    const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, I = geo.index;
    const base = this.n, cnt = P.count;
    let flip = false;
    if (m) { _nm.getNormalMatrix(m); flip = m.determinant() < 0; }
    const fn = typeof color === 'function' ? color : null;
    const pos = this.pos, nor = this.nor, col = this.col, uv = this.uv, k = this.k;
    for (let i = 0; i < cnt; i++) {
      _v.fromBufferAttribute(P, i); _n.fromBufferAttribute(N, i);
      if (m) { _v.applyMatrix4(m); _n.applyMatrix3(_nm).normalize(); }
      pos.push(_v.x, _v.y, _v.z); nor.push(_n.x, _n.y, _n.z);
      const c = fn ? fn(_v.x, _v.y, _v.z) : color; col.push(c[0], c[1], c[2]);
      if (U) uv.push(U.getX(i) * (uvScale ? uvScale[0] : 1), U.getY(i) * (uvScale ? uvScale[1] : 1)); else uv.push(0, 0);
      k.push(kind, param);
    }
    const idx = this.idx;
    if (I) {
      const a = I.array;
      if (flip) for (let i = 0; i < a.length; i += 3) idx.push(base + a[i], base + a[i + 2], base + a[i + 1]);
      else for (let i = 0; i < a.length; i++) idx.push(base + a[i]);
    } else {
      if (flip) for (let i = 0; i < cnt; i += 3) idx.push(base + i, base + i + 2, base + i + 1);
      else for (let i = 0; i < cnt; i++) idx.push(base + i);
    }
    this.n += cnt;
    return this;
  }
  get tris() { return this.idx.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    g.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(this.k), 2));
    g.setIndex(this.n > 65535 ? new THREE.BufferAttribute(new Uint32Array(this.idx), 1) : new THREE.BufferAttribute(new Uint16Array(this.idx), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Buckets keyed by material name + spatial region (for frustum culling). */
export class Builder {
  constructor(regionFn) { this.regionFn = regionFn; this.buckets = new Map(); }
  bucket(mat, region) {
    const key = mat + '|' + region;
    let b = this.buckets.get(key);
    if (!b) { b = new Bucket(); b.mat = mat; b.region = region; this.buckets.set(key, b); }
    return b;
  }
  add(mat, geo, m = null, color = WHITE, kind = 0, param = 0, uvScale = null) {
    if (!geo.boundingBox) geo.computeBoundingBox();
    geo.boundingBox.getCenter(_c); if (m) _c.applyMatrix4(m);
    this.bucket(mat, this.regionFn(_c.x, _c.z)).add(geo, m, color, kind, param, uvScale);
  }
}

// ---------------------------------------------------------------------------------------------------------------
const cache = new Map();
function cached(key, make) { let g = cache.get(key); if (!g) { g = make(); g.computeBoundingBox(); cache.set(key, g); } return g; }
export const box = () => cached('box', () => new THREE.BoxGeometry(1, 1, 1));
/** unit cylinder along Y (height 1, centred), bottom radius 1, top radius `top` */
export const cyl = (sides = 8, top = 1, open = false) => cached(`cyl${sides}_${top}_${open}`, () => new THREE.CylinderGeometry(top, 1, 1, sides, 1, open));
export const sphere = (w = 8, h = 6) => cached(`sph${w}_${h}`, () => new THREE.SphereGeometry(1, w, h));
export const torus = (R, r, rs = 6, ts = 12, arc = Math.PI * 2) => cached(`tor${R}_${r}_${rs}_${ts}_${arc}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
export const lathe = (key, profile, sides = 12) => cached('lathe' + key, () => new THREE.LatheGeometry(profile.map(p => new THREE.Vector2(p[0], p[1])), sides));

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
/** TRS matrix (rotation as XYZ euler, applied Y first then X then Z via order 'YXZ') */
export function M(px, py, pz, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(px, py, pz), _q, _s.set(sx, sy, sz));
}
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
/** Matrix mapping the unit box/cylinder (long axis = local Y) to a beam from a to b with cross-section (w along the side axis, d along the other). */
export function beam(a, b, w, d = w, upRef = null) {
  _y.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = _y.length(); _y.multiplyScalar(1 / len);
  const ref = upRef ? _p.set(upRef[0], upRef[1], upRef[2]) : (Math.abs(_y.y) > 0.9 ? _p.set(1, 0, 0) : _p.set(0, 1, 0));
  _x.crossVectors(_y, ref).normalize(); _z.crossVectors(_x, _y).normalize();
  const m = new THREE.Matrix4().makeBasis(_x.clone().multiplyScalar(w), _y.clone().multiplyScalar(len), _z.clone().multiplyScalar(d));
  m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return m;
}

/** Tube along a polyline (array of [x,y,z]); uv = (metres along, 0..1 around). radius may be fn(i, t). */
export function tubeGeo(points, radius = 0.02, sides = 5, closed = false) {
  const n = points.length, P = points.map(p => new THREE.Vector3(p[0], p[1], p[2]));
  const pos = [], nor = [], uv = [], idx = [];
  const T = new THREE.Vector3(), Nn = new THREE.Vector3(), B = new THREE.Vector3(), prevT = new THREE.Vector3(), ax = new THREE.Vector3();
  let len = 0;
  for (let i = 0; i < n; i++) {
    const a = P[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = P[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    T.subVectors(b, a).normalize();
    if (i === 0) { Nn.set(0, 1, 0); if (Math.abs(T.y) > 0.9) Nn.set(1, 0, 0); B.crossVectors(T, Nn).normalize(); Nn.crossVectors(B, T).normalize(); }
    else {
      _q.setFromUnitVectors(prevT, T); Nn.applyQuaternion(_q);
      B.crossVectors(T, Nn).normalize(); Nn.crossVectors(B, T).normalize();
      len += P[i].distanceTo(P[i - 1]);
    }
    prevT.copy(T);
    const r = typeof radius === 'function' ? radius(i, i / (n - 1)) : radius;
    for (let j = 0; j <= sides; j++) {
      const a2 = (j / sides) * Math.PI * 2, cx = Math.cos(a2), sy = Math.sin(a2);
      const nx = Nn.x * cx + B.x * sy, ny = Nn.y * cx + B.y * sy, nz = Nn.z * cx + B.z * sy;
      pos.push(P[i].x + nx * r, P[i].y + ny * r, P[i].z + nz * r); nor.push(nx, ny, nz); uv.push(len, j / sides);
    }
  }
  const row = sides + 1, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) for (let j = 0; j < sides; j++) {
    const a = i * row + j, b = ((i + 1) % n) * row + j;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return g;
}

/** Sagging rope/chain between two points; returns polyline points. */
export function catenary(a, b, sag, n = 8) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]); }
  return pts;
}

/**
 * Loft through rings (array of arrays of [x,y,z], all the same length). Smooth normals.
 * opts: flip (reverse winding), closed (rings are closed loops: last point joins the first), capStart/capEnd (fan caps, flat).
 */
export function loftGeo(rings, { flip = false, closed = false, capStart = false, capEnd = false, crease = null } = {}) {
  const nr = rings.length, m = rings[0].length;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < nr; i++) for (let j = 0; j < m; j++) { const p = rings[i][j]; pos.push(p[0], p[1], p[2]); uv.push(i / (nr - 1), j / (m - 1)); }
  const mj = closed ? m : m - 1;
  for (let i = 0; i < nr - 1; i++) for (let j = 0; j < mj; j++) {
    const a = i * m + j, b = i * m + (j + 1) % m, c = (i + 1) * m + j, d = (i + 1) * m + (j + 1) % m;
    if (flip) idx.push(a, b, c, c, b, d); else idx.push(a, c, b, b, c, d);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  if (closed) {   // average seam normals are already shared (indices wrap) -> nothing to do
  }
  if (capStart || capEnd) {
    const parts = [g];
    const cap = (ring, rev) => {
      const cp = [], ci = []; let cx = 0, cy = 0, cz = 0;
      for (const p of ring) { cx += p[0]; cy += p[1]; cz += p[2]; }
      cx /= ring.length; cy /= ring.length; cz /= ring.length; cp.push(cx, cy, cz);
      for (const p of ring) cp.push(p[0], p[1], p[2]);
      const L = ring.length, lim = L;
      for (let j = 0; j < lim; j++) { const a = 1 + j, b = 1 + (j + 1) % L; if (rev) ci.push(0, b, a); else ci.push(0, a, b); }
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      cg.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((L + 1) * 2).fill(0), 2)); cg.setIndex(ci); cg.computeVertexNormals();
      return cg;
    };
    if (capStart) parts.push(cap(rings[0], flip));
    if (capEnd) parts.push(cap(rings[nr - 1], !flip));
    g = mergeGeos(parts);
  }
  return g;
}

/** Merge geometries (position, normal, uv) into one indexed geometry. */
export function mergeGeos(list) {
  const b = new Bucket(); for (const g of list) b.add(g);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2)); g.setIndex(b.idx);
  return g;
}

/** Flat-shaded polyhedron from quads: verts = [[x,y,z]...], quads = [[a,b,c,d]...] (CCW seen from outside); triangles allowed ([a,b,c]). */
export function polyGeo(verts, faces, uvFn = null) {
  const pos = [], uv = [], idx = []; let n = 0;
  for (const f of faces) {
    for (const i of f) { const v = verts[i]; pos.push(v[0], v[1], v[2]); const t = uvFn ? uvFn(v, f) : [0, 0]; uv.push(t[0], t[1]); }
    for (let i = 1; i < f.length - 1; i++) idx.push(n, n + i, n + i + 1);
    n += f.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** Hexahedron from 8 corners: 0-3 bottom ring, 4-7 top ring (same order), outward faces when the bottom ring is CCW seen from below... use hexFaces. */
export const HEX_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
export function hexGeo(v) { return polyGeo(v, HEX_FACES); }

/** Prism: closed 2D profile [[a,b]...] (CCW) in the local XY plane extruded along +Z from 0 to len. Flat side faces + caps. uv = (z metres, profile metres). */
export function prismGeo(profile, len, caps = true) {
  const n = profile.length, pos = [], uv = [], idx = []; let k = 0, acc = 0;
  for (let i = 0; i < n; i++) {
    const a = profile[i], b = profile[(i + 1) % n]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    pos.push(a[0], a[1], 0, b[0], b[1], 0, b[0], b[1], len, a[0], a[1], len);
    uv.push(0, acc, 0, acc + l, len, acc + l, len, acc); acc += l;
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3); k += 4;
  }
  if (caps) {
    const tri = THREE.ShapeUtils.triangulateShape(profile.map(p => new THREE.Vector2(p[0], p[1])), []);
    for (const z of [0, len]) {
      for (const p of profile) { pos.push(p[0], p[1], z); uv.push(p[0], p[1]); }
      for (const t of tri) { if (z === 0) idx.push(k + t[0], k + t[2], k + t[1]); else idx.push(k + t[0], k + t[1], k + t[2]); }   // fixed below by normals
      k += n;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Simple quad (two triangles) from 4 corners (CCW from the visible side); uv given per corner or default 0..1. */
export function quadGeo(a, b, c, d, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** Strip between two polylines A[i], B[i] (same length). Front face: A->B on the left when walking i (use flip to reverse). Smooth normals. */
export function stripGeo(A, B, flip = false, uvFn = null) {
  const pos = [], uv = [], idx = [], n = A.length;
  for (let i = 0; i < n; i++) {
    pos.push(...A[i], ...B[i]);
    if (uvFn) { uv.push(...uvFn(A[i], i, 0), ...uvFn(B[i], i, 1)); } else uv.push(i / (n - 1), 0, i / (n - 1), 1);
  }
  for (let i = 0; i < n - 1; i++) { const a = i * 2, b = a + 1, c = a + 2, d = a + 3; if (flip) idx.push(a, b, c, c, b, d); else idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
