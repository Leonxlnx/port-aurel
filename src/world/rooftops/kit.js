// Rooftops kit: tiny triangle-soup builder (prototype / merged geometry) and instanced batches.
// Every vertex carries: position, normal, colour (linear), uv and a material id `aMat` (see materials.js).
import * as THREE from 'three';

const _v = new THREE.Vector3(), _n = new THREE.Vector3();
const _c = new THREE.Color();
export function lin(hex) { _c.set(hex); return [_c.r, _c.g, _c.b]; }
export function mul(c, k) { return [c[0] * k, c[1] * k, c[2] * k]; }
export function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

/** matrix helper: translate, rotate about Y, (non)uniform scale */
export function TRS(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4();
  const c = Math.cos(ry), s = Math.sin(ry);
  m.set(c * sx, 0, s * sz, x, 0, sy, 0, y, -s * sx, 0, c * sz, z, 0, 0, 0, 1);
  return m;
}
/** matrix whose local +Z axis runs from p0 to p1 (x = side, y = "up"-ish); origin at p0 */
export function frameZ(p0, p1, up = [0, 1, 0]) {
  const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); const L = d.length(); d.multiplyScalar(1 / (L || 1));
  let u = new THREE.Vector3(up[0], up[1], up[2]);
  if (Math.abs(d.dot(u)) > 0.995) u = new THREE.Vector3(1, 0, 0);
  const x = new THREE.Vector3().crossVectors(u, d).normalize();
  const y = new THREE.Vector3().crossVectors(d, x);
  const m = new THREE.Matrix4().makeBasis(x, y, d); m.setPosition(p0[0], p0[1], p0[2]);
  return { m, L };
}

export class Geo {
  constructor() {
    this.p = []; this.n = []; this.c = []; this.u = []; this.m = [];
    this.stack = [new THREE.Matrix4()]; this.nm = new THREE.Matrix3();
    this.color = [1, 1, 1]; this.mat = 0;
  }
  get tris() { return this.p.length / 9; }
  push(m) { const x = this.stack[this.stack.length - 1].clone().multiply(m); this.stack.push(x); this.nm.getNormalMatrix(x); return this; }
  pop() { this.stack.pop(); this.nm.getNormalMatrix(this.stack[this.stack.length - 1]); return this; }
  /** set current colour (linear rgb array) and material id */
  set(color, mat) { if (color) this.color = color; if (mat != null) this.mat = mat; return this; }
  vert(px, py, pz, nx, ny, nz, u, v) {
    _v.set(px, py, pz).applyMatrix4(this.stack[this.stack.length - 1]);
    _n.set(nx, ny, nz).applyMatrix3(this.nm).normalize();
    this.p.push(_v.x, _v.y, _v.z); this.n.push(_n.x, _n.y, _n.z);
    this.c.push(this.color[0], this.color[1], this.color[2]); this.u.push(u, v); this.m.push(this.mat);
  }
  /** quad a,b,c,d (counter-clockwise seen from the front), flat normal; uv rect [u0,v0,u1,v1] */
  quad(a, b, c, d, uv = [0, 0, 1, 1], nrm = null) {
    let nx, ny, nz;
    if (nrm) { nx = nrm[0]; ny = nrm[1]; nz = nrm[2]; }
    else {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    }
    const [u0, v0, u1, v1] = uv;
    this.vert(a[0], a[1], a[2], nx, ny, nz, u0, v0); this.vert(b[0], b[1], b[2], nx, ny, nz, u1, v0); this.vert(c[0], c[1], c[2], nx, ny, nz, u1, v1);
    this.vert(a[0], a[1], a[2], nx, ny, nz, u0, v0); this.vert(c[0], c[1], c[2], nx, ny, nz, u1, v1); this.vert(d[0], d[1], d[2], nx, ny, nz, u0, v1);
    return this;
  }
  tri(a, b, c, ua = [0, 0], ub = [1, 0], uc = [0.5, 1]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.vert(a[0], a[1], a[2], nx, ny, nz, ua[0], ua[1]); this.vert(b[0], b[1], b[2], nx, ny, nz, ub[0], ub[1]); this.vert(c[0], c[1], c[2], nx, ny, nz, uc[0], uc[1]);
    return this;
  }
  /** axis-aligned box centred at (cx,cy,cz); skip: string of faces to omit among 'x','X','y','Y','z','Z' (lower = negative side) */
  box(cx, cy, cz, sx, sy, sz, skip = '') {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    if (!skip.includes('X')) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    if (!skip.includes('x')) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    if (!skip.includes('Y')) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    if (!skip.includes('y')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    if (!skip.includes('Z')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    if (!skip.includes('z')) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    return this;
  }
  /** box sitting on y0 (base centre at cx,y0,cz) */
  boxB(cx, y0, cz, sx, sy, sz, skip = '') { return this.box(cx, y0 + sy / 2, cz, sx, sy, sz, skip); }
  /**
   * vertical frustum: base centre (cx,y0,cz), radii r0 (bottom) r1 (top), height h.
   * opt: capT, capB, smooth (default true), a0 (start angle), v0,v1 (uv v range), capMat (material id for caps)
   */
  cyl(cx, y0, cz, r0, r1, h, seg = 12, opt = {}) {
    const { capT = true, capB = false, smooth = true, a0 = 0, v0 = 0, v1 = 1, capMat = null, arc = Math.PI * 2 } = opt;
    const y1 = y0 + h; const sl = (r0 - r1) / (h || 1);
    for (let i = 0; i < seg; i++) {
      const aa = a0 + (i / seg) * arc, ab = a0 + ((i + 1) / seg) * arc;
      const ca = Math.cos(aa), sa = Math.sin(aa), cb = Math.cos(ab), sb = Math.sin(ab);
      const A = [cx + ca * r0, y0, cz + sa * r0], B = [cx + cb * r0, y0, cz + sb * r0], C = [cx + cb * r1, y1, cz + sb * r1], D = [cx + ca * r1, y1, cz + sa * r1];
      const ua = i / seg, ub = (i + 1) / seg;
      // winding: outward (a increases counter-clockwise seen from above -> order A, D, C, B faces outward)
      if (smooth) {
        const na = [ca, sl, sa], nb = [cb, sl, sb];
        this.vert(A[0], A[1], A[2], na[0], na[1], na[2], ua, v0); this.vert(D[0], D[1], D[2], na[0], na[1], na[2], ua, v1); this.vert(C[0], C[1], C[2], nb[0], nb[1], nb[2], ub, v1);
        this.vert(A[0], A[1], A[2], na[0], na[1], na[2], ua, v0); this.vert(C[0], C[1], C[2], nb[0], nb[1], nb[2], ub, v1); this.vert(B[0], B[1], B[2], nb[0], nb[1], nb[2], ub, v0);
      } else {
        const am = (aa + ab) / 2; const nn = [Math.cos(am), sl, Math.sin(am)];
        if (r1 > 1e-6) this.quad(A, D, C, B, [ua, v0, ub, v1], nn);
        else { this.vert(A[0], A[1], A[2], nn[0], nn[1], nn[2], ua, v0); this.vert(D[0], D[1], D[2], nn[0], nn[1], nn[2], (ua + ub) / 2, v1); this.vert(B[0], B[1], B[2], nn[0], nn[1], nn[2], ub, v0); }
      }
    }
    const pm = this.mat; if (capMat != null) this.mat = capMat;
    for (let i = 0; i < seg && (capT || capB); i++) {
      const aa = a0 + (i / seg) * arc, ab = a0 + ((i + 1) / seg) * arc;
      const ca = Math.cos(aa), sa = Math.sin(aa), cb = Math.cos(ab), sb = Math.sin(ab);
      if (capT && r1 > 1e-6) {
        this.vert(cx, y1, cz, 0, 1, 0, 0.5, 0.5); this.vert(cx + cb * r1, y1, cz + sb * r1, 0, 1, 0, 0.5 + 0.5 * cb, 0.5 + 0.5 * sb); this.vert(cx + ca * r1, y1, cz + sa * r1, 0, 1, 0, 0.5 + 0.5 * ca, 0.5 + 0.5 * sa);
      }
      if (capB && r0 > 1e-6) {
        this.vert(cx, y0, cz, 0, -1, 0, 0.5, 0.5); this.vert(cx + ca * r0, y0, cz + sa * r0, 0, -1, 0, 0.5 + 0.5 * ca, 0.5 + 0.5 * sa); this.vert(cx + cb * r0, y0, cz + sb * r0, 0, -1, 0, 0.5 + 0.5 * cb, 0.5 + 0.5 * sb);
      }
    }
    this.mat = pm;
    return this;
  }
  /** surface of revolution through profile points [[r,y],...] (bottom to top), no caps */
  lathe(cx, cz, profile, seg = 12, opt = {}) {
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
      if (Math.abs(y1 - y0) < 1e-6) {       // flat ring
        this.ring(cx, y0, cz, Math.min(r0, r1), Math.max(r0, r1), seg, r1 < r0 ? 1 : -1, opt.a0 || 0);
      } else this.cyl(cx, y0, cz, r0, r1, y1 - y0, seg, { ...opt, capT: false, capB: false, v0: i / (profile.length - 1), v1: (i + 1) / (profile.length - 1) });
    }
    return this;
  }
  /** flat annulus at height y; dir = +1 faces up, -1 faces down */
  ring(cx, y, cz, ri, ro, seg = 12, dir = 1, a0 = 0) {
    for (let i = 0; i < seg; i++) {
      const aa = a0 + (i / seg) * Math.PI * 2, ab = a0 + ((i + 1) / seg) * Math.PI * 2;
      const ca = Math.cos(aa), sa = Math.sin(aa), cb = Math.cos(ab), sb = Math.sin(ab);
      const A = [cx + ca * ri, y, cz + sa * ri], B = [cx + cb * ri, y, cz + sb * ri], C = [cx + cb * ro, y, cz + sb * ro], D = [cx + ca * ro, y, cz + sa * ro];
      if (dir > 0) this.quad(A, B, C, D, [0, 0, 1, 1], [0, 1, 0]); else this.quad(A, D, C, B, [0, 0, 1, 1], [0, -1, 0]);
    }
    return this;
  }
  sphere(cx, cy, cz, r, segW = 8, segH = 5, sy = 1, jitter = null) {
    const P = (i, j) => {
      const th = (i / segW) * Math.PI * 2, ph = (j / segH) * Math.PI;
      let rr = r; if (jitter) rr *= 1 + jitter(i % segW, j) * (j > 0 && j < segH ? 1 : 0);
      const n = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
      return { p: [cx + n[0] * rr, cy + n[1] * rr * sy, cz + n[2] * rr], n, u: [i / segW, 1 - j / segH] };
    };
    const V = q => this.vert(q.p[0], q.p[1], q.p[2], q.n[0], q.n[1], q.n[2], q.u[0], q.u[1]);
    for (let j = 0; j < segH; j++) for (let i = 0; i < segW; i++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (j > 0) { V(a); V(b); V(c); }
      if (j < segH - 1) { V(a); V(c); V(d); }
    }
    return this;
  }
  /** box of cross-section w (side) x h (up) stretched from p0 to p1 */
  beam(p0, p1, w, h, up, skip = '') {
    const { m, L } = frameZ(p0, p1, up || undefined);
    this.push(m); this.box(0, 0, L / 2, w, h, L, skip); this.pop();
    return this;
  }
  /** round tube from p0 to p1 */
  tube(p0, p1, r0, r1 = r0, seg = 6, opt = {}) {
    const { m, L } = frameZ(p0, p1);
    // rotate so the cylinder's Y axis maps onto local Z
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    this.push(m.multiply(rot)); this.cyl(0, 0, 0, r0, r1, L, seg, { capT: false, ...opt }); this.pop();
    return this;
  }
  /** append another Geo transformed by matrix m */
  add(g, m = null) {
    const nm = new THREE.Matrix3(); if (m) nm.getNormalMatrix(m);
    for (let i = 0; i < g.p.length; i += 3) {
      _v.set(g.p[i], g.p[i + 1], g.p[i + 2]); _n.set(g.n[i], g.n[i + 1], g.n[i + 2]);
      if (m) { _v.applyMatrix4(m); _n.applyMatrix3(nm).normalize(); }
      this.p.push(_v.x, _v.y, _v.z); this.n.push(_n.x, _n.y, _n.z);
    }
    for (let i = 0; i < g.c.length; i++) this.c.push(g.c[i]);
    for (let i = 0; i < g.u.length; i++) this.u.push(g.u[i]);
    for (let i = 0; i < g.m.length; i++) this.m.push(g.m[i]);
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.u), 2));
    g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(this.m), 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Instanced batch of one prototype geometry. opt.instMat: per-instance material id instead of per-vertex. */
export class Batch {
  constructor(name, geometry, material, opt = {}) {
    this.name = name; this.geometry = geometry; this.material = material; this.opt = opt;
    this.mx = []; this.col = []; this.ids = []; this.count = 0;
    this.tri = (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
  }
  add(m, color = null, id = 0) {
    const e = m.elements; for (let i = 0; i < 16; i++) this.mx.push(e[i]);
    if (color) this.col.push(color[0], color[1], color[2]); else this.col.push(1, 1, 1);
    this.ids.push(id); this.count++;
  }
  finish(group) {
    if (!this.count) return null;
    const geo = this.geometry;
    if (this.opt.instMat) geo.setAttribute('aMat', new THREE.InstancedBufferAttribute(new Float32Array(this.ids), 1));
    const mesh = new THREE.InstancedMesh(geo, this.material, this.count);
    mesh.instanceMatrix.array.set(this.mx); mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.col), 3);
    mesh.castShadow = !!this.opt.cast; mesh.receiveShadow = this.opt.receive !== false;
    if (this.opt.layer) mesh.layers.set(this.opt.layer);
    mesh.name = 'roof_' + this.name;
    mesh.computeBoundingSphere(); mesh.computeBoundingBox();
    this.mx = this.col = this.ids = null;
    group.add(mesh);
    this.mesh = mesh;
    return mesh;
  }
}

/** unit box (1x1x1 centred) and unit cylinder (r=1, y 0..1) with white vertex colours */
export function unitBox() {
  const g = new Geo(); g.box(0, 0, 0, 1, 1, 1); const b = g.build(); b.deleteAttribute('aMat'); return b;
}
export function unitCyl(seg = 8, capT = true) {
  const g = new Geo(); g.cyl(0, 0, 0, 1, 1, 1, seg, { capT }); const b = g.build(); b.deleteAttribute('aMat'); return b;
}
