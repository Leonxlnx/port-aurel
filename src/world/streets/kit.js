// Small geometry kit for the streets module: merged, vertex-coloured prop geometry + instancing helpers.
// Every prop vertex carries: color (linear rgb), aSurf = (roughness, metalness, emissive code, tint mask).
// Every instance carries: aInst = (tint rgb, w = per-instance seed / phase / flag).
import * as THREE from 'three';

export const lin = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
export const WHITE = [1, 1, 1];

const _v = new THREE.Vector3(), _n3 = new THREE.Matrix3();

/** compose a transform: position, euler rotation, scale */
export function xf(px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  return new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
}

/** surface description: c = linear rgb, r = roughness, m = metalness, e = emissive code, t = tint mask (1 = multiply by instance tint) */
export const S = (c, r = 0.7, m = 0, e = 0, t = 0) => ({ c: typeof c === 'number' ? lin(c) : c, r, m, e, t });

export class Geo {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.surf = []; this.idx = []; this.extra = null; }
  get tris() { return this.idx.length / 3; }
  /** add a THREE.BufferGeometry with a surface and an optional transform */
  add(g, s, m = null, inside = false) {
    const base = this.pos.length / 3;
    const P = g.attributes.position, N = g.attributes.normal;
    let flip = m ? m.determinant() < 0 : false; if (inside) flip = !flip;
    if (m) _n3.getNormalMatrix(m);
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i); if (m) _v.applyMatrix4(m); this.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(N, i); if (m) _v.applyMatrix3(_n3).normalize(); if (inside) _v.negate(); this.nrm.push(_v.x, _v.y, _v.z);
      this.col.push(s.c[0], s.c[1], s.c[2]); this.surf.push(s.r, s.m, s.e, s.t);
    }
    const I = g.index;
    const n = I ? I.count : P.count;
    for (let i = 0; i < n; i += 3) {
      const a = I ? I.getX(i) : i, b = I ? I.getX(i + 1) : i + 1, c = I ? I.getX(i + 2) : i + 2;
      if (flip) this.idx.push(base + a, base + c, base + b); else this.idx.push(base + a, base + b, base + c);
    }
    g.dispose();
    return this;
  }
  /** append another Geo (optionally transformed; mirrored transforms flip the winding) */
  merge(o, m = null) {
    const base = this.pos.length / 3;
    const flip = m ? m.determinant() < 0 : false;
    if (m) _n3.getNormalMatrix(m);
    for (let i = 0; i < o.pos.length; i += 3) {
      _v.set(o.pos[i], o.pos[i + 1], o.pos[i + 2]); if (m) _v.applyMatrix4(m); this.pos.push(_v.x, _v.y, _v.z);
      _v.set(o.nrm[i], o.nrm[i + 1], o.nrm[i + 2]); if (m) _v.applyMatrix3(_n3).normalize(); this.nrm.push(_v.x, _v.y, _v.z);
    }
    for (const v of o.col) this.col.push(v);
    for (const v of o.surf) this.surf.push(v);
    for (let i = 0; i < o.idx.length; i += 3) {
      if (flip) this.idx.push(base + o.idx[i], base + o.idx[i + 2], base + o.idx[i + 1]); else this.idx.push(base + o.idx[i], base + o.idx[i + 1], base + o.idx[i + 2]);
    }
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSurf', new THREE.Float32BufferAttribute(this.surf, 4));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    // optional coarser stand-ins: this.lods = [{ geo: Geo, from: apparent distance in m }] (consumed by TileLOD.add)
    if (this.lods) g.userData.lods = this.lods.map(l => ({ geometry: l.geo.build(), tris: l.geo.tris, from: l.from }));
    return g;
  }
}

// ---- primitives (THREE geometries, consumed by Geo.add) -------------------------------------------
export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
export const sph = (r, ws = 8, hs = 6) => new THREE.SphereGeometry(r, ws, hs);
export const hemi = (r, ws = 8, hs = 4) => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2);
export const cone = (r, h, seg = 8, open = false) => new THREE.ConeGeometry(r, h, seg, 1, open);
export const torus = (R, r, rs = 4, ts = 12, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc);
export const plane = (w, h) => new THREE.PlaneGeometry(w, h);
export const ring = (ri, ro, seg = 12) => new THREE.RingGeometry(ri, ro, seg, 1);
export function tube(pts, r, tseg = 8, rseg = 5, tension = 0.5) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p[0], p[1], p[2])), false, 'catmullrom', tension);
  return new THREE.TubeGeometry(curve, tseg, r, rseg, false);
}
/** lathe profile [[radius, y], ...] -> surface of revolution with outward-facing triangles */
export function lathe(pts, seg = 10) {
  const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(Math.max(p[0], 1e-4), p[1])), seg);
  // make sure faces point away from the axis (independent of profile direction)
  const P = g.attributes.position, I = g.index; const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let vote = 0;
  for (let i = 0; i < I.count; i += 3) {
    a.fromBufferAttribute(P, I.getX(i)); b.fromBufferAttribute(P, I.getX(i + 1)); c.fromBufferAttribute(P, I.getX(i + 2));
    n.subVectors(b, a).cross(c.clone().sub(a)); const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3;
    vote += n.x * cx + n.z * cz;
  }
  if (vote < 0) {
    const arr = I.array; for (let i = 0; i < arr.length; i += 3) { const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t; }
  }
  g.computeVertexNormals();
  // weld the seam normals (first/last column share positions)
  const N = g.attributes.normal; const cols = seg + 1, rows = pts.length;
  for (let j = 0; j < rows; j++) {
    const i0 = j, i1 = seg * rows + j;
    const x = N.getX(i0) + N.getX(i1), y = N.getY(i0) + N.getY(i1), z = N.getZ(i0) + N.getZ(i1); const l = Math.hypot(x, y, z) || 1;
    N.setXYZ(i0, x / l, y / l, z / l); N.setXYZ(i1, x / l, y / l, z / l);
  }
  return g;
}

// ---- instancing ------------------------------------------------------------------------------------
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();

export class Scatter {
  constructor() { this.items = new Map(); }
  /** queue one instance: position, yaw, scale (number or [x,y,z]), tint rgb, w, pitch/roll */
  put(name, x, y, z, ry = 0, s = 1, tint = WHITE, w = 0, rx = 0, rz = 0) {
    let a = this.items.get(name); if (!a) { a = []; this.items.set(name, a); }
    a.push({ x, y, z, ry, s, tint, w, rx, rz });
  }
  count(name) { const a = this.items.get(name); return a ? a.length : 0; }
  list(name) { return this.items.get(name) || []; }
  /** build an InstancedMesh for all queued instances of `name` */
  make(name, geometry, material, { cast = true, receive = true, layer = 0 } = {}) {
    const a = this.items.get(name); if (!a || !a.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, a.length);
    const inst = new Float32Array(a.length * 4);
    for (let i = 0; i < a.length; i++) {
      const o = a[i];
      _e.set(o.rx, o.ry, o.rz, 'YXZ'); _q.setFromEuler(_e); _p.set(o.x, o.y, o.z);
      if (typeof o.s === 'number') _s.set(o.s, o.s, o.s); else _s.set(o.s[0], o.s[1], o.s[2]);
      _m4.compose(_p, _q, _s); mesh.setMatrixAt(i, _m4);
      inst[i * 4] = o.tint[0]; inst[i * 4 + 1] = o.tint[1]; inst[i * 4 + 2] = o.tint[2]; inst[i * 4 + 3] = o.w;
    }
    geometry.setAttribute('aInst', new THREE.InstancedBufferAttribute(inst, 4));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = cast; mesh.receiveShadow = receive;
    if (layer) mesh.layers.set(layer);
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    mesh.name = name; mesh.matrixAutoUpdate = false;
    return mesh;
  }
}

/** deterministic helpers on top of a mulberry rng */
export function rtools(R) {
  return {
    R,
    rr: (a, b) => a + (b - a) * R(),
    ri: (a, b) => a + Math.floor(R() * (b - a + 1)),
    pick: arr => arr[Math.floor(R() * arr.length)],
    chance: p => R() < p,
  };
}
