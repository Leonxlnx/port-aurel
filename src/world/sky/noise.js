// Noise resources for the cloud shader, generated once at build time (no downloads):
//  - a tileable 128^3 RGBA8 Perlin-Worley volume (rendered on the GPU into a 2D atlas, read back, uploaded with mips)
//  - a tileable 512^2 RGBA8 weather / fibre texture (GPU, mipmapped, anisotropic)
//  - a small CPU LUT with the sun's transmittance as seen from cloud altitude (works below the ground horizon)
import * as THREE from 'three';
import { FSQ, passMaterial } from '../../engine/fsq.js';

const NOISE_GLSL = /* glsl */`
precision highp float; precision highp int;
varying vec2 vUv;
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 h3(ivec3 p, int per, uint seed) {
  p = ((p % per) + per) % per;
  return vec3(pcg3d(uvec3(p) + seed * uvec3(7919u, 104729u, 1299709u))) * (1.0 / 4294967295.0);
}
float grad(ivec3 c, vec3 d, int per, uint seed) { return dot(normalize(h3(c, per, seed) * 2.0 - 1.0), d); }
// periodic gradient noise, x in lattice units, period 'per' lattice cells; ~[-0.8, 0.8]
float perlin(vec3 x, int per, uint seed) {
  vec3 fl = floor(x); vec3 f = x - fl; ivec3 i = ivec3(fl);
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = grad(i, f, per, seed),                         b = grad(i + ivec3(1, 0, 0), f - vec3(1, 0, 0), per, seed);
  float c = grad(i + ivec3(0, 1, 0), f - vec3(0, 1, 0), per, seed), d = grad(i + ivec3(1, 1, 0), f - vec3(1, 1, 0), per, seed);
  float e = grad(i + ivec3(0, 0, 1), f - vec3(0, 0, 1), per, seed), g = grad(i + ivec3(1, 0, 1), f - vec3(1, 0, 1), per, seed);
  float h = grad(i + ivec3(0, 1, 1), f - vec3(0, 1, 1), per, seed), k = grad(i + ivec3(1, 1, 1), f - vec3(1, 1, 1), per, seed);
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z);
}
// p in [0,1)^3 ; returns roughly [-1, 1]
float pfbm(vec3 p, int per, int oct, uint seed) {
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < oct; i++) { s += a * perlin(p * float(per), per, seed + uint(i) * 17u); n += a; per *= 2; a *= 0.5; }
  return clamp(s / n * 1.9, -1.0, 1.0);
}
// inverted periodic Worley (1 at feature points), x in cell units
float worley(vec3 x, int per, uint seed) {
  vec3 fl = floor(x); vec3 f = x - fl; ivec3 i = ivec3(fl); float d = 9.0;
  for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) for (int c = -1; c <= 1; c++) {
    ivec3 o = ivec3(a, b, c);
    vec3 r = vec3(o) + h3(i + o, per, seed) - f;
    d = min(d, dot(r, r));
  }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}
float wfbm(vec3 p, int per, uint seed) {
  return worley(p * float(per), per, seed) * 0.625 + worley(p * float(per * 2), per * 2, seed + 1u) * 0.25 + worley(p * float(per * 4), per * 4, seed + 2u) * 0.125;
}
`;

// 16 x 8 tiles of 128^2 -> 128 slices
const VOLUME_FRAG = NOISE_GLSL + /* glsl */`
void main() {
  vec2 fc = gl_FragCoord.xy;
  ivec2 tile = ivec2(fc) / 128;
  float slice = float(tile.y * 16 + tile.x);
  vec3 p = vec3(fract(fc / 128.0), (slice + 0.5) / 128.0);
  float pf = abs(pfbm(p, 4, 6, 3u));                       // billowy perlin
  float g = wfbm(p, 4, 11u);
  float b = wfbm(p, 8, 23u);
  float a = worley(p * 16.0, 16, 37u) * 0.6 + worley(p * 32.0, 32, 41u) * 0.4;
  float r = g + pf * (1.0 - g);                            // perlin-worley
  gl_FragColor = vec4(r, g, b, a);
}
`;

const WEATHER_FRAG = NOISE_GLSL + /* glsl */`
void main() {
  vec3 p = vec3(vUv, 0.37);
  float r = 0.5 + 0.5 * pfbm(p, 4, 7, 101u);
  float g = 0.5 + 0.5 * pfbm(p + vec3(0.0, 0.0, 0.31), 4, 7, 211u);
  float pw = 0.5 + 0.5 * pfbm(p, 6, 5, 307u);
  float w = wfbm(p * vec3(1.0, 1.0, 0.0) + vec3(0.0, 0.0, 0.5 / 6.0), 6, 401u);
  float b = clamp(w * 0.72 + pw * 0.42 - 0.07, 0.0, 1.0);  // cumulus clumps
  float a = 0.5 + 0.5 * pfbm(p + vec3(0.0, 0.0, 0.63), 8, 6, 503u);
  gl_FragColor = vec4(r, g, b, a);
}
`;

export function makeVolumeNoise(renderer) {
  const N = 128, AW = 2048, AH = 1024;
  const rt = new THREE.WebGLRenderTarget(AW, AH, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, generateMipmaps: false });
  const pass = new FSQ(passMaterial({ fragmentShader: VOLUME_FRAG }));
  const prev = renderer.getRenderTarget();
  pass.render(renderer, rt);
  const atlas = new Uint8Array(AW * AH * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, AW, AH, atlas);
  renderer.setRenderTarget(prev);
  rt.dispose(); pass.material.dispose();
  const data = new Uint8Array(N * N * N * 4);
  for (let z = 0; z < N; z++) {
    const tx = (z % 16) * N, ty = Math.floor(z / 16) * N;
    for (let y = 0; y < N; y++) {
      const src = ((ty + y) * AW + tx) * 4;
      data.set(atlas.subarray(src, src + N * 4), ((z * N + y) * N) * 4);
    }
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat; tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.unpackAlignment = 1; tex.needsUpdate = true;
  return tex;
}

export function makeWeatherNoise(renderer) {
  const rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: true });
  rt.texture.wrapS = rt.texture.wrapT = THREE.RepeatWrapping;
  rt.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const pass = new FSQ(passMaterial({ fragmentShader: WEATHER_FRAG }));
  const prev = renderer.getRenderTarget();
  pass.render(renderer, rt);
  renderer.setRenderTarget(prev);
  pass.material.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------------------------------------
// Sun transmittance seen from altitude h (0..12 km) at local elevation th (-6..26 deg), same medium as the sky LUT.
// u = sqrt((th + 6) / 32), v = h / 12. Zero in the earth's shadow.
export const SUN_LUT_W = 64, SUN_LUT_H = 16;
export function sunLutKey(p) { return [p.rayleighScale, p.mieScale, p.ozoneScale, p.HR, p.HM, p.betaMs, p.betaMa, ...p.betaR, ...p.betaO].join(','); }
export function fillSunLUT(tex, p) {
  const W = SUN_LUT_W, H = SUN_LUT_H, RG = 6360, RT = 6460, N = 160;
  const data = tex.image.data;
  const bR = p.betaR.map(v => v * p.rayleighScale), bM = (p.betaMs + p.betaMa) * p.mieScale, bO = p.betaO.map(v => v * p.ozoneScale);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let j = 0; j < H; j++) {
    const alt = j / (H - 1) * 12, r0 = RG + alt;
    for (let i = 0; i < W; i++) {
      const u = i / (W - 1), th = (-6 + 32 * u * u) * Math.PI / 180;
      const cs = Math.cos(th), sn = Math.sin(th);
      const hmin = th < 0 ? r0 * cs - RG : alt;
      let T = [0, 0, 0];
      if (hmin > 0) {
        const b = r0 * sn, tEnd = -b + Math.sqrt(b * b - (r0 * r0 - RT * RT)), ds = tEnd / N;
        let oR = 0, oM = 0, oO = 0;
        for (let k = 0; k < N; k++) {
          const s = (k + 0.5) * ds, x = cs * s, y = r0 + sn * s;
          const h = Math.max(0, Math.sqrt(x * x + y * y) - RG);
          oR += Math.exp(-h / p.HR) * ds; oM += Math.exp(-h / p.HM) * ds; oO += Math.max(0, 1 - Math.abs(h - 25) / 15) * ds;
        }
        const pen = sm(0, 0.4, hmin);
        T = [0, 1, 2].map(c => Math.exp(-(bR[c] * oR + bM * oM + bO[c] * oO)) * pen);
      }
      const o = (j * W + i) * 4;
      data[o] = THREE.DataUtils.toHalfFloat(T[0]); data[o + 1] = THREE.DataUtils.toHalfFloat(T[1]); data[o + 2] = THREE.DataUtils.toHalfFloat(T[2]); data[o + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  tex.needsUpdate = true;
}
export function makeSunLUT(p) {
  const tex = new THREE.DataTexture(new Uint16Array(SUN_LUT_W * SUN_LUT_H * 4), SUN_LUT_W, SUN_LUT_H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = false;
  fillSunLUT(tex, p);
  return tex;
}
