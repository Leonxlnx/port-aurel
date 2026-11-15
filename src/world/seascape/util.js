// Shared helpers for the seascape module: JS noise, merged-geometry builder, materials, light sprites.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------------------------
export function hash2(x, z, s = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, z, s = 0) {
  const ix = Math.floor(x), iz = Math.floor(z); let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export function fbm(x, z, o = 4, s = 0) {
  let a = 0.5, sum = 0, n = 0;
  for (let i = 0; i < o; i++) { sum += a * vnoise(x, z, s + i * 17); n += a; x = x * 2.03 + 11.3; z = z * 2.03 + 7.1; a *= 0.5; }
  return sum / n;
}
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
/** sRGB hex -> linear [r,g,b] */
export const C = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };

// ---------------------------------------------------------------------------------------------
// Merged geometry builder: every part gets a vertex colour and an `aE` tag (emissive strength at night; >0 = lamp/window glass).
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
export class Geo {
  constructor() { this.parts = []; this.tris = 0; }
  add(g, color, m = null, e = 0) {
    if (g.index) g = g.toNonIndexed();
    if (m) g.applyMatrix4(m);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3), ae = new Float32Array(n).fill(e);
    for (let i = 0; i < n; i++) { col[i * 3] = color[0]; col[i * 3 + 1] = color[1]; col[i * 3 + 2] = color[2]; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aE', new THREE.BufferAttribute(ae, 1));
    return this.raw(g);
  }
  /** geometry that already has color + aE */
  raw(g) {
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'aE'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    this.tris += g.attributes.position.count / 3; this.parts.push(g); return this;
  }
  static mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  }
  /** box centred at (x,y,z) */
  box(w, h, d, x, y, z, color, { rx = 0, ry = 0, rz = 0, e = 0 } = {}) { return this.add(new THREE.BoxGeometry(w, h, d), color, Geo.mat(x, y, z, rx, ry, rz), e); }
  /** vertical cylinder/frustum with its base at (x,y,z) */
  cyl(rt, rb, h, x, y, z, color, { seg = 12, e = 0, open = false, rx = 0, ry = 0, rz = 0, sx = 1, sz = 1 } = {}) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open); g.translate(0, h / 2, 0);
    return this.add(g, color, Geo.mat(x, y, z, rx, ry, rz, sx, 1, sz), e);
  }
  /** thin member between two points */
  tube(p0, p1, r, color, { seg = 5, e = 0, r1 = null } = {}) {
    const a = _v.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); const len = a.length(); if (len < 1e-4) return this;
    const g = new THREE.CylinderGeometry(r1 ?? r, r, len, seg, 1, true); g.translate(0, len / 2, 0);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.clone().normalize());
    return this.add(g, color, new THREE.Matrix4().compose(new THREE.Vector3(p0[0], p0[1], p0[2]), _q, _s), e);
  }
  /** box-section member between two points (cheap lattice) */
  beam(p0, p1, w, color, h = w) {
    const a = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]); const len = a.length(); if (len < 1e-4) return this;
    const g = new THREE.BoxGeometry(w, len, h); g.translate(0, len / 2, 0);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.normalize());
    return this.add(g, color, new THREE.Matrix4().compose(new THREE.Vector3(p0[0], p0[1], p0[2]), _q, _s), 0);
  }
  /** lathe of [[r,y],...] around the vertical axis through (x,·,z) */
  lathe(pts, x, y, z, color, { seg = 24, e = 0, sx = 1, sz = 1 } = {}) {
    return this.add(new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(Math.max(p[0], 1e-4), p[1])), seg), color, Geo.mat(x, y, z, 0, 0, 0, sx, 1, sz), e);
  }
  sphere(r, x, y, z, color, { e = 0, ws = 10, hs = 7, sy = 1, sx = 1, sz = 1 } = {}) { return this.add(new THREE.SphereGeometry(r, ws, hs), color, Geo.mat(x, y, z, 0, 0, 0, sx, sy, sz), e); }
  build() { const g = mergeGeometries(this.parts, false); g.computeBoundingSphere(); g.computeBoundingBox(); this.parts = []; return g; }
}

/** irregular boulder (unit-ish radius), flat shaded */
export function rockGeometry(detail, seed) {
  let g = new THREE.IcosahedronGeometry(1, detail); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-3);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.72 + 0.6 * vnoise(x * 1.7 + 9, z * 1.7 + y * 2.3, seed) ;
    p.setXYZ(i, x * k, y * k * 0.72, z * k);
  }
  g = g.toNonIndexed(); g.computeVertexNormals(); return g;
}

/** concrete tetrapod, legs of length ~1 from the centre */
export function tetrapodGeometry() {
  const parts = []; const up = new THREE.Vector3(0, 1, 0);
  const dirs = [new THREE.Vector3(0, 1, 0)];
  for (let i = 0; i < 3; i++) { const a = i * 2.0944; dirs.push(new THREE.Vector3(0.9428 * Math.cos(a), -1 / 3, 0.9428 * Math.sin(a))); }
  for (const d of dirs) {
    const qd = new THREE.Quaternion().setFromUnitVectors(up, d);
    const g = new THREE.CylinderGeometry(0.27, 0.43, 1.05, 11, 1, true); g.translate(0, 0.525, 0); g.applyQuaternion(qd); parts.push(g.toNonIndexed());
    const cap = new THREE.CircleGeometry(0.27, 11); cap.rotateX(-Math.PI / 2); cap.translate(0, 1.05, 0); cap.applyQuaternion(qd); parts.push(cap.toNonIndexed());
  }
  parts.push(new THREE.IcosahedronGeometry(0.47, 0));
  for (const g of parts) g.deleteAttribute('uv');
  const g = mergeGeometries(parts, false); g.computeBoundingSphere(); return g;
}

// ---------------------------------------------------------------------------------------------
// Materials
const VPARS = /* glsl */`attribute float aE; varying float vE;`;
const PAINT_COLOR = /* glsl */`
  vec3 paintC_ = diffuseColor.rgb; float e_ = vE; float wet_ = 0.0;
  if (e_ > 0.001) diffuseColor.rgb = vec3(0.02, 0.025, 0.03);
  else {
    float gn_ = fbm3(vWPos * 0.9); float gn2_ = vnoise3(vWPos * vec3(6.0, 1.3, 6.0));
    diffuseColor.rgb *= 1.0 + uGrime * ((gn_ - 0.5) * 0.9 + (gn2_ - 0.5) * 0.35);
    wet_ = smoothstep(1.3, 0.3, vWPos.y + (gn_ - 0.5) * 0.6) * uWet;
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.4 + vec3(0.0, 0.012, 0.004) * smoothstep(0.9, 0.2, vWPos.y), wet_);
  }
`;
/** vertex-coloured painted metal / plaster / wood; aE>0 parts are dark glass by day and glow with their vertex colour at night */
export function paintMaterial(ctx, { roughness = 0.62, metalness = 0, grime = 0.5, wet = 1, extraColor = '', extraPars = '', extraSurface = '', extraEmissive = '', uniforms = {}, side = THREE.FrontSide } = {}) {
  return ctx.makeMaterial({ color: 0xffffff, vertexColors: true, roughness, metalness, side }, {
    uniforms: { uGrime: { value: grime }, uWet: { value: wet }, ...uniforms },
    defines: { NO_CITY_LIGHTS: 1 },
    vertexPars: VPARS, vertex: 'vE = aE;',
    fragPars: `varying float vE; uniform float uGrime; uniform float uWet;\n${extraPars}`,
    color: PAINT_COLOR + extraColor,
    surface: 'if (e_ > 0.001) roughnessFactor = 0.12; else roughnessFactor = mix(roughnessFactor, 0.3, wet_);' + extraSurface,
    emissive: 'totalEmissiveRadiance += paintC_ * max(e_, 0.0) * smoothstep(0.03, 0.45, uNight) * (e_ > 40.0 ? mix(0.07, 1.0, smoothstep(-1.0, -5.0, uSunElev)) : 1.0);' + extraEmissive,
  });
}

/** rock / concrete armour with strata, tide line, weed. kind: 'rock' | 'concrete' */
export function rockMaterial(ctx, { kind = 'rock', color = 0x8d8478, grass = 0 } = {}) {
  return ctx.makeMaterial({ color, roughness: 0.93, metalness: 0 }, {
    uniforms: { uGrass: { value: grass }, uBump: { value: kind === 'concrete' ? 0.3 : 0.55 } },
    defines: kind === 'concrete' ? { NO_CITY_LIGHTS: 1, CONCRETE: 1 } : { NO_CITY_LIGHTS: 1 },
    fragPars: 'uniform float uGrass; uniform float uBump;',
    color: /* glsl */`
      vec3 p_ = vWPos;
      float n1_ = fbm3(p_ * 0.35); float n2_ = fbm3(p_ * 2.3 + 7.0);
      #ifdef CONCRETE
        vec3 base_ = diffuseColor.rgb * (0.66 + 0.62 * n2_) * (0.86 + 0.28 * vnoise3(p_ * 13.0));
        base_ *= 1.0 - 0.3 * smoothstep(0.45, 0.7, fbm3(p_ * vec3(1.6, 0.35, 1.6) + 11.0));                 // rain streaks
        base_ = mix(base_, base_ * vec3(0.55, 0.6, 0.42), smoothstep(0.5, 0.75, n1_) * 0.6);         // algae / staining patches
      #else
        float bed_ = p_.y * 1.5 + p_.x * 0.16 - p_.z * 0.07 + n1_ * 2.4;                             // tilted strata
        float strata_ = mix(0.25, 1.0, uGrass);                                                        // loose rubble shows less bedding than the islet
        float band_ = mix(0.5, hash11(floor(bed_) * 7.31 + 1.7), strata_);
        float seam_ = mix(1.0, smoothstep(0.0, 0.14, fract(bed_)), strata_);
        vec3 base_ = diffuseColor.rgb * mix(vec3(0.55, 0.5, 0.45), vec3(1.05, 0.98, 0.88), band_) * (0.72 + 0.56 * n2_) * mix(0.5, 1.0, seam_);
        float lich_ = smoothstep(0.6, 0.72, fbm3(p_ * 0.9 + 31.0)) * smoothstep(2.6, 4.5, p_.y);
        base_ = mix(base_, vec3(0.38, 0.31, 0.09), lich_ * 0.45);
        float gr_ = smoothstep(0.78, 0.95, vWNormal.y) * smoothstep(4.0, 6.5, p_.y + n1_ * 3.0) * uGrass;
        base_ = mix(base_, vec3(0.12, 0.13, 0.045) * (0.6 + 0.8 * n2_), gr_);
      #endif
      float tide_ = p_.y + (n1_ - 0.5) * 0.9;
      float wet_ = smoothstep(1.7, 0.6, tide_);
      float weed_ = smoothstep(1.3, 0.75, tide_) * smoothstep(0.3, 0.55, n2_ + 0.25 * n1_);
      float barn_ = smoothstep(0.3, 0.0, abs(tide_ - 1.55)) * step(0.45, n2_);
      base_ = mix(base_, base_ * 0.36, wet_);
      base_ = mix(base_, vec3(0.03, 0.045, 0.015), weed_ * 0.85);
      base_ = mix(base_, vec3(0.5, 0.5, 0.46), barn_ * 0.3);
      diffuseColor.rgb = base_;`,
    surface: 'roughnessFactor = mix(0.94, 0.3, wet_ * (1.0 - weed_ * 0.6));',
    normal: /* glsl */`{
      float bf_ = uBump * (1.0 - smoothstep(0.03, 0.35, fwidth(p_.x) + fwidth(p_.y) + fwidth(p_.z)));
      float bh_ = n2_ * 0.45 + vnoise3(p_ * 15.0) * 0.07;
      vec3 dpx_ = dFdx(p_), dpy_ = dFdy(p_); float dhx_ = dFdx(bh_), dhy_ = dFdy(bh_);
      vec3 nW_ = viewToWorldDir(normal);
      vec3 r1_ = cross(dpy_, nW_), r2_ = cross(nW_, dpx_); float det_ = dot(dpx_, r1_);
      vec3 grad_ = sign(det_) * (dhx_ * r1_ + dhy_ * r2_);
      normal = worldToViewDir(normalize(abs(det_) * nW_ - bf_ * grad_)); }`,
  });
}

// ---------------------------------------------------------------------------------------------
// Light sprites: camera-facing additive points with a minimum on-screen size (energy conserving), blink modes and haze extinction.
// blink = [period, duty | floor, phase, mode]  mode 0 steady, 1 flashing (duty), 2 rotating double beam (flash when the beam sweeps the camera), 3 rotating single beam
export class Sprites {
  constructor(ctx, capacity = 256) {
    this.ctx = ctx; this.n = 0; this.cap = capacity;
    this.pos = new Float32Array(capacity * 3); this.col = new Float32Array(capacity * 3); this.size = new Float32Array(capacity); this.blink = new Float32Array(capacity * 4);
  }
  add(x, y, z, color, intensity = 10, size = 0.3, blink = [0, 0, 0, 0]) {
    if (this.n >= this.cap) { console.warn('[seascape] sprite capacity'); return -1; }
    const i = this.n++;
    this.pos.set([x, y, z], i * 3); this.col.set([color[0] * intensity, color[1] * intensity, color[2] * intensity], i * 3);
    this.size[i] = size; this.blink.set(blink, i * 4); return i;
  }
  setPos(i, x, y, z) { this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; }
  setCol(i, color, intensity) { this.col[i * 3] = color[0] * intensity; this.col[i * 3 + 1] = color[1] * intensity; this.col[i * 3 + 2] = color[2] * intensity; }
  commit() { this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; }
  build() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3); this.aCol = new THREE.InstancedBufferAttribute(this.col, 3);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol);
    g.setAttribute('iSize', new THREE.InstancedBufferAttribute(this.size, 1)); g.setAttribute('iBlink', new THREE.InstancedBufferAttribute(this.blink, 4));
    g.instanceCount = this.n;
    const mat = this.ctx.makeShaderMaterial({
      vertexShader: /* glsl */`
        attribute vec3 iPos; attribute vec3 iCol; attribute float iSize; attribute vec4 iBlink;
        varying vec2 vQ; varying vec3 vCol;
        void main() {
          vec4 wp = modelMatrix * vec4(iPos, 1.0);
          vec4 mv = viewMatrix * wp;
          float dist = length(mv.xyz);
          float pxw = 2.0 * dist / (projectionMatrix[1][1] * uResolution.y);      // metres per pixel at this distance
          float s = max(iSize, 1.7 * pxw);
          float gain = (iSize * iSize) / (s * s);
          float b = 1.0;
          if (iBlink.w > 0.5 && iBlink.w < 1.5) {
            float ph = fract(uTime / iBlink.x + iBlink.z);
            b = smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(iBlink.y, iBlink.y + 0.05, ph));
          } else if (iBlink.w > 1.5) {
            vec3 tc = uCamPos - wp.xyz; float a = atan(tc.z, tc.x);
            float c = cos(a - (uTime * 6.2831853 / iBlink.x + iBlink.z));
            float k = iBlink.w > 2.5 ? max(c, 0.0) : abs(c);
            float fl = pow(k, 600.0);
            b = iBlink.y + fl + 0.06 * pow(k, 40.0);
            s *= 1.0 + 7.0 * fl;                                                   // the glare swells as the beam sweeps the lens
            b *= mix(0.05, 1.0, smoothstep(-1.0, -5.0, uSunElev));                  // not night yet: the lamp must not outshine the setting sun
          }
          // haze extinction (same model as the aerial-perspective pass)
          vec3 wd = (wp.xyz - uCamPos) / max(dist, 1e-3);
          float a_ = uFogA.y; float dy = wd.y;
          float kk = abs(dy) > 1e-5 ? (1.0 - exp(-a_ * dy * dist)) / (a_ * dy) : dist;
          float od = uFogA.x * exp(-a_ * max(uCamPos.y - uFogA.z, -40.0)) * kk + uFogB.x * dist;
          vCol = iCol * gain * b * exp(-od) * smoothstep(0.03, 0.4, uNight);
          vQ = position.xy;
          mv.xy += position.xy * s;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec2 vQ; varying vec3 vCol;
        void main() { float d2 = dot(vQ, vQ); float a = exp(-d2 * 7.0) + 0.06 * exp(-d2 * 1.6); a *= smoothstep(1.0, 0.7, d2); gl_FragColor = vec4(vCol * a, 1.0); }`,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true,
    });
    const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; mesh.layers.set(1); mesh.renderOrder = 50; mesh.name = 'seaLights';
    this.mesh = mesh; return mesh;
  }
}

/** gable roof on a box footprint w (x) × d (z): ridge along z at height h above y. Adds roof slabs + gable walls to a Geo. */
export function gableRoof(geo, w, d, h, x, y, z, ry, roofCol, wallCol, over = 0.35) {
  const hw = w / 2, hd = d / 2, ow = hw + over, od = hd + over, oy = -over * h / hw;
  const tri = (a, b, c) => [...a, ...b, ...c];
  const roof = new THREE.BufferGeometry();
  const A = [-ow, oy, -od], B = [-ow, oy, od], R0 = [0, h, -od], R1 = [0, h, od], Cc = [ow, oy, -od], D = [ow, oy, od];
  roof.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    ...tri(A, B, R1), ...tri(A, R1, R0), ...tri(Cc, R0, R1), ...tri(Cc, R1, D),
    ...tri(A, R1, B), ...tri(A, R0, R1), ...tri(Cc, R1, R0), ...tri(Cc, D, R1),          // undersides (eaves)
  ]), 3));
  roof.computeVertexNormals();
  const gab = new THREE.BufferGeometry();
  gab.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    ...tri([-hw, 0, hd], [hw, 0, hd], [0, h, hd]), ...tri([hw, 0, -hd], [-hw, 0, -hd], [0, h, -hd]),
  ]), 3));
  gab.computeVertexNormals();
  const m = Geo.mat(x, y, z, 0, ry, 0);
  geo.add(roof, roofCol, m); geo.add(gab, wallCol, m);
  return geo;
}

/** Height-field mesh over a regular grid. P(x,z) -> [x', y, z'] (may nudge the vertex), col(x,z,y) -> [r,g,b]; skip(i,j,ys) drops a cell. Smooth normals. */
export function gridGeometry(x0, nx, z0, nz, step, P, col, skip) {
  const W = nx + 1, pos = new Float32Array(W * (nz + 1) * 3), cl = new Float32Array(W * (nz + 1) * 3), idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const x = x0 + i * step, z = z0 + j * step; const p = P(x, z); const k = (j * W + i) * 3;
    pos[k] = p[0]; pos[k + 1] = p[1]; pos[k + 2] = p[2];
    const c = col(x, z, p[1]); cl[k] = c[0]; cl[k + 1] = c[1]; cl[k + 2] = c[2];
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    const ys = [pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1], pos[d * 3 + 1]];
    if (skip && skip(x0 + i * step, z0 + j * step, ys)) continue;
    idx.push(a, c, d, a, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
  g.setIndex(idx); g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

/** ground material for coarse terrain: vertex colour = land use, rock on steep faces, dark wet shore */
export function terrainMaterial(ctx, { rock = 1 } = {}) {
  return ctx.makeMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 }, {
    uniforms: { uRock: { value: rock } }, defines: { NO_CITY_LIGHTS: 1 }, fragPars: 'uniform float uRock;',
    color: /* glsl */`
      vec3 p_ = vWPos; float px_ = fwidth(p_.x) + fwidth(p_.z);
      float n1_ = fbm2(p_.xz * 0.011); float n2_ = fbm2(p_.xz * 0.13 + 3.0); float n3_ = vnoise(p_.xz * 1.9);
      float f2_ = 1.0 - smoothstep(2.0, 9.0, px_); float f3_ = 1.0 - smoothstep(0.15, 0.6, px_);
      vec3 c_ = diffuseColor.rgb * (0.7 + 0.6 * n1_) * (1.0 + (n2_ - 0.5) * 0.5 * f2_) * (1.0 + (n3_ - 0.5) * 0.3 * f3_);
      float slope_ = 1.0 - vWNormal.y;
      vec3 rock_ = vec3(0.27, 0.24, 0.21) * (0.6 + 0.8 * n2_) * mix(vec3(1.0), vec3(1.1, 1.0, 0.88), n1_);
      c_ = mix(c_, rock_, smoothstep(0.08, 0.2, slope_ + (n2_ - 0.5) * 0.08) * uRock);
      float sh_ = smoothstep(2.0, 0.5, p_.y + (n2_ - 0.5) * 1.2);
      c_ = mix(c_, vec3(0.045, 0.045, 0.04), sh_ * 0.9);
      diffuseColor.rgb = c_;`,
    surface: 'roughnessFactor = mix(0.95, 0.4, sh_);',
  });
}
