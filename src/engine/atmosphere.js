// Physically based sky (Rayleigh + Mie + ozone, earth shadow for twilight) rendered into a small LUT,
// plus sun/moon light colors, the sky dome material and the PMREM environment map.
import * as THREE from 'three';
import { G, COMMON_GLSL } from './globals.js';
import { FSQ, passMaterial } from './fsq.js';

const RG = 6360, RT = 6460; // km
const DEG = Math.PI / 180;

const LUT_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform vec3 uSunDir;
uniform float uSunE;
uniform vec3 uBetaR; uniform float uBetaMs; uniform float uBetaMe; uniform vec3 uBetaO;
uniform float uHR; uniform float uHM; uniform float uG;
uniform float uAlt;
uniform vec3 uMsColor;        // multiple-scattering / twilight fill colour (already scaled)
uniform vec3 uGroundAlbedo;
uniform vec3 uNightSky;       // floor radiance
uniform vec3 uGlowColor;      // horizon glow (city light pollution / art)
uniform vec3 uTint;
uniform vec3 uGlowLow; uniform vec3 uGlowHigh; uniform vec3 uGlowAnti;
#define PI 3.141592653589793
#define VS 40
#define LS 8
const float RG = 6360.0; const float RT = 6460.0;

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd); float c = dot(ro, ro) - r * r; float d = b * b - c;
  if (d < 0.0) return vec2(-1.0);
  d = sqrt(d); return vec2(-b - d, -b + d);
}
vec3 dens(float h) { h = max(h, 0.0); return vec3(exp(-h / uHR), exp(-h / uHM), max(0.0, 1.0 - abs(h - 25.0) / 15.0)); }
vec3 extinction(vec3 od) { return uBetaR * od.x + vec3(uBetaMe) * od.y + uBetaO * od.z; }
vec3 sunTrans(vec3 p, vec3 sd) {
  vec2 tg = raySphere(p, sd, RG);
  if (tg.x > 0.0) return vec3(0.0);            // earth shadow
  vec2 t = raySphere(p, sd, RT);
  float ds = t.y / float(LS); vec3 od = vec3(0.0);
  for (int i = 0; i < LS; i++) { vec3 q = p + sd * ((float(i) + 0.5) * ds); od += dens(length(q) - RG) * ds; }
  return exp(-extinction(od));
}
void main() {
  float az = (vUv.x - 0.5) * 2.0 * PI;
  float c = vUv.y * 2.0 - 1.0;
  float el = sign(c) * c * c * 0.5 * PI;
  vec3 rd = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  vec3 ro = vec3(0.0, RG + uAlt, 0.0);
  float tmax = raySphere(ro, rd, RT).y;
  vec2 tg = raySphere(ro, rd, RG);
  bool ground = tg.x > 0.0;
  if (ground) tmax = tg.x;

  float mu = dot(rd, uSunDir);
  float phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  float g = uG; float g2 = g * g;
  // Cornette-Shanks + a small wide lobe so haze glows around the sun without a hard core
  float phM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
  float gw = 0.35; float phMw = (1.0 - gw * gw) / (4.0 * PI * pow(1.0 + gw * gw - 2.0 * gw * mu, 1.5));
  phM = mix(phM, phMw, 0.35);

  vec3 L = vec3(0.0); vec3 od = vec3(0.0); float prevT = 0.0;
  for (int i = 0; i < VS; i++) {
    float u1 = (float(i) + 1.0) / float(VS);
    float tEnd = tmax * u1 * u1;
    float dt = tEnd - prevT; float tm = prevT + 0.5 * dt; prevT = tEnd;
    vec3 p = ro + rd * tm; float h = length(p) - RG;
    vec3 d = dens(h);
    od += d * (dt * 0.5);
    vec3 Tv = exp(-extinction(od));
    vec3 Ts = sunTrans(p, uSunDir);
    vec3 sR = uBetaR * d.x; float sM = uBetaMs * d.y;
    vec3 single = Ts * (sR * phR + sM * phM);
    vec3 multi = uMsColor * (sR + vec3(sM)) * (1.0 / (4.0 * PI));
    L += Tv * (single + multi) * dt;
    od += d * (dt * 0.5);
  }
  if (ground) {
    vec3 pg = ro + rd * tmax; vec3 n = normalize(pg);
    vec3 Tv = exp(-extinction(od));
    vec3 E = sunTrans(pg + n * 0.01, uSunDir) * max(dot(n, uSunDir), 0.0) + uMsColor * 0.5;
    L += Tv * uGroundAlbedo / PI * E;
  }
  L *= uSunE;
  float hz = exp(-abs(el) * 9.0);
  L += uNightSky * (0.6 + 0.4 * hz) + uGlowColor * hz;
  {
    vec2 sxz = normalize(uSunDir.xz + vec2(1e-5)); vec2 rxz = normalize(rd.xz + vec2(1e-5));
    float ca = dot(rxz, sxz);
    float e = max(el, 0.0);
    float toward = pow(max(ca * 0.5 + 0.5, 0.0), 2.6);
    float away = pow(max(-ca * 0.5 + 0.5, 0.0), 2.0);
    L += uGlowLow * toward * exp(-e * 7.5);
    L += uGlowHigh * (0.35 + 0.65 * toward) * exp(-pow((e - 0.16) / 0.15, 2.0));
    L += uGlowAnti * away * exp(-pow((e - 0.11) / 0.085, 2.0));
  }
  gl_FragColor = vec4(L * uTint, 1.0);
}
`;

// Standard equirect (three.js convention) for PMREM: sky above, soft ground bounce below.
const ENV_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uSkyLUT;
uniform vec3 uGroundColor;
${COMMON_GLSL}
void main() {
  float lon = (vUv.x - 0.5) * 2.0 * PI; float lat = (vUv.y - 0.5) * PI;
  vec3 d = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
  vec3 up = skyLUT(uSkyLUT, normalize(vec3(d.x, max(d.y, 0.004), d.z)));
  float t = smoothstep(0.03, -0.12, d.y);
  vec3 col = mix(up, uGroundColor, t);
  gl_FragColor = vec4(min(col, vec3(60.0)), 1.0);
}
`;

const SKY_VERT = /* glsl */`
varying vec2 vNdc;
uniform float uFarZ;
void main() { vNdc = position.xy; gl_Position = vec4(position.xy, uFarZ, 1.0); }
`;

const SKY_FRAG = /* glsl */`
precision highp float;
varying vec2 vNdc;
uniform sampler2D uSkyLUT;
uniform mat4 uProjInv; uniform mat4 uCamWorld;
uniform vec3 uSunDir; uniform vec3 uSunDisk; uniform float uSunCos; uniform float uSunSoft;
uniform vec3 uMoonDir; uniform vec3 uMoonDisk;
uniform float uStars; uniform float uTime; uniform float uFrame;
${COMMON_GLSL}
__CLOUD_PARS__
void main() {
  vec4 v = uProjInv * vec4(vNdc, 0.5, 1.0);
  vec3 dv = normalize(v.xyz / v.w);
  vec3 dir = normalize((uCamWorld * vec4(dv, 0.0)).xyz);
  vec3 sdir = normalize(vec3(dir.x, max(dir.y, -0.02), dir.z));
  vec3 col = skyLUT(uSkyLUT, sdir);
  // sun disc with limb darkening
  float mu = dot(dir, uSunDir);
  float disc = smoothstep(uSunCos - uSunSoft, uSunCos + uSunSoft, mu);
  if (disc > 0.0) {
    float r = clamp(sqrt(max(1.0 - mu * mu, 0.0)) / sqrt(max(1.0 - uSunCos * uSunCos, 1e-9)), 0.0, 1.0);
    float limb = 1.0 - 0.55 * (1.0 - sqrt(max(1.0 - r * r, 0.0)));
    col += uSunDisk * disc * limb * smoothstep(-0.012, 0.0, dir.y);
  }
  // moon (simple soft disc)
  float mm = dot(dir, uMoonDir);
  col += uMoonDisk * smoothstep(0.99994, 0.99997, mm);
  // stars
  if (uStars > 0.001 && dir.y > 0.0) {
    vec3 sp = dir * 420.0; vec3 cell = floor(sp); vec3 f = fract(sp) - 0.5;
    vec3 h = hash33(cell);
    float d2 = dot(f - (h - 0.5) * 0.7, f - (h - 0.5) * 0.7);
    float star = smoothstep(0.012, 0.0, d2) * step(0.86, h.x) * (0.3 + 3.0 * pow(h.y, 6.0));
    col += star * uStars * mix(vec3(0.8, 0.9, 1.2), vec3(1.2, 1.0, 0.8), h.z) * smoothstep(0.0, 0.25, dir.y);
  }
  __CLOUD_MAIN__
  gl_FragColor = vec4(col, 1.0);
}
`;

function raySphere(ro, rd, r) {
  const b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2];
  const c = ro[0] * ro[0] + ro[1] * ro[1] + ro[2] * ro[2] - r * r;
  let d = b * b - c; if (d < 0) return [-1, -1];
  d = Math.sqrt(d); return [-b - d, -b + d];
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** piecewise-linear keyframe lookup over sun elevation; keys: [[elevDeg, [..values]], ...] ascending */
function keyLerp(keys, x) {
  if (x <= keys[0][0]) return keys[0][1].slice();
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const t = (x - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return keys[i - 1][1].map((v, j) => lerp(v, keys[i][1][j], t));
    }
  }
  return keys[keys.length - 1][1].slice();
}

export class Atmosphere {
  constructor(renderer, { reversed = false } = {}) {
    this.renderer = renderer;
    this.p = {
      sunE: 12.0,
      betaR: [5.802e-3, 13.558e-3, 33.1e-3], rayleighScale: 1.0,
      betaMs: 3.996e-3, betaMa: 4.4e-3, mieScale: 2.2, mieG: 0.80,
      betaO: [0.650e-3, 1.881e-3, 0.085e-3], ozoneScale: 1.15,
      HR: 8.0, HM: 1.2,
      altitude: 0.06,
      groundAlbedo: [0.07, 0.08, 0.09],
      // multiple-scattering / twilight fill colour over sun elevation (deg): [r,g,b] relative to sunE
      msKeys: [
        [-18, [0.0004, 0.0007, 0.0018]],
        [-12, [0.0020, 0.0038, 0.0100]],
        [-8,  [0.0058, 0.0125, 0.0350]],
        [-5,  [0.0140, 0.0290, 0.0740]],
        [-2,  [0.0350, 0.0600, 0.1300]],
        [1,   [0.0780, 0.1080, 0.1900]],
        [6,   [0.1700, 0.2000, 0.2500]],
        [20,  [0.2600, 0.3000, 0.3600]],
        [60,  [0.3000, 0.3400, 0.4000]],
      ],
      // twilight arch (art direction on top of the physical sky): radiance scale over sun elevation
      glowLowColor: [1.0, 0.40, 0.10], glowLowKeys: [[-13, [0]], [-9, [0.015]], [-6, [0.09]], [-4, [0.30]], [-2, [0.85]], [0, [0.75]], [1.5, [0.42]], [3.5, [0.22]], [6, [0.06]], [9, [0.01]], [12, [0]]],
      glowHighColor: [1.0, 0.30, 0.42], glowHighKeys: [[-11, [0]], [-8, [0.005]], [-6, [0.022]], [-4, [0.06]], [-2, [0.13]], [0, [0.11]], [2, [0.03]], [4, [0]]],
      glowAntiColor: [0.95, 0.46, 0.56], glowAntiKeys: [[-9, [0]], [-7, [0.004]], [-5, [0.018]], [-3, [0.04]], [-1, [0.045]], [1, [0.012]], [2.5, [0]]],
      glowGain: 1.0,
      nightSky: [0.00035, 0.0006, 0.0014],
      cityGlow: [0.010, 0.0065, 0.0040],    // scaled by G.night
      tint: [1, 1, 1],
      sunAngularRadius: 0.2666 * DEG,
      sunDiskScale: 1.0,            // visual radius multiplier
      sunDiskMax: 900.0,            // clamp for the visible disc radiance
      moonDir: new THREE.Vector3(0.45, 0.62, 0.64).normalize(),
      moonColor: [0.55, 0.68, 1.0], moonE: 0.012,
    };
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.elev = 30; this.azim = 0;

    const lutOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.lut = new THREE.WebGLRenderTarget(512, 256, lutOpts);
    this.lut.texture.wrapS = THREE.RepeatWrapping; this.lut.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.envEquirect = new THREE.WebGLRenderTarget(256, 128, lutOpts);
    this.envEquirect.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.envEquirect.texture.wrapS = THREE.RepeatWrapping;
    this.probe = new THREE.WebGLRenderTarget(16, 8, { ...lutOpts, type: THREE.FloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.probeBuf = new Float32Array(16 * 8 * 4);

    this.lutPass = new FSQ(passMaterial({
      fragmentShader: LUT_FRAG,
      uniforms: {
        uSunDir: { value: new THREE.Vector3() }, uSunE: { value: 1 },
        uBetaR: { value: new THREE.Vector3() }, uBetaMs: { value: 0 }, uBetaMe: { value: 0 }, uBetaO: { value: new THREE.Vector3() },
        uHR: { value: 8 }, uHM: { value: 1.2 }, uG: { value: 0.8 }, uAlt: { value: 0.05 },
        uMsColor: { value: new THREE.Vector3() }, uGroundAlbedo: { value: new THREE.Vector3() },
        uNightSky: { value: new THREE.Vector3() }, uGlowColor: { value: new THREE.Vector3() }, uTint: { value: new THREE.Vector3(1, 1, 1) },
        uGlowLow: { value: new THREE.Vector3() }, uGlowHigh: { value: new THREE.Vector3() }, uGlowAnti: { value: new THREE.Vector3() },
      },
    }));
    this.envPass = new FSQ(passMaterial({
      fragmentShader: ENV_FRAG,
      uniforms: { uSkyLUT: { value: this.lut.texture }, uGroundColor: { value: new THREE.Vector3() } },
    }));
    this.probePass = new FSQ(passMaterial({
      fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; uniform sampler2D tEnv;
        void main(){ vec3 s = vec3(0.0); for (int y=0;y<4;y++) for (int x=0;x<4;x++) s += texture2D(tEnv, vUv + (vec2(float(x),float(y)) - 1.5) / vec2(64.0, 32.0)).rgb; gl_FragColor = vec4(s / 16.0, 1.0); }`,
      uniforms: { tEnv: { value: this.envEquirect.texture } },
    }));

    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmremRT = null;

    // dome (fullscreen triangle at the far plane)
    this.cloudHook = { pars: '', main: '', uniforms: {} };
    this.skyUniforms = {
      uSkyLUT: { value: this.lut.texture }, uProjInv: G.projInv, uCamWorld: G.camWorld,
      uSunDir: G.sunDir, uSunDisk: { value: new THREE.Vector3() }, uSunCos: { value: 0.9999 }, uSunSoft: { value: 0.000003 },
      uMoonDir: { value: this.p.moonDir.clone() }, uMoonDisk: { value: new THREE.Vector3() },
      uStars: { value: 0 }, uTime: G.time, uFrame: G.frame, uFarZ: { value: reversed ? 0.0 : 1.0 },
    };
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.dome = new THREE.Mesh(geo, this._makeSkyMaterial());
    this.dome.frustumCulled = false;
    this.dome.renderOrder = 900;
    this.dome.layers.set(1);
    this.dome.name = 'skyDome';

    G.skyLUT.value = this.lut.texture;
    this.sunColor = new THREE.Color(); this.lightDir = new THREE.Vector3(); this.lightColor = new THREE.Color();
    this.night = 0;
  }

  _makeSkyMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.skyUniforms, ...this.cloudHook.uniforms },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG.replace('__CLOUD_PARS__', this.cloudHook.pars).replace('__CLOUD_MAIN__', this.cloudHook.main),
      depthWrite: false, depthTest: true, toneMapped: false,
    });
  }
  /** Install cloud code into the sky shader: {pars, main, uniforms}. `main` may modify `col` using `dir`. */
  setCloudHook(hook) {
    this.cloudHook = hook;
    this.dome.material.dispose();
    this.dome.material = this._makeSkyMaterial();
  }

  /** Transmittance from the observer toward `dir` (CPU, same model as the LUT). */
  transmittance(dir) {
    const p = this.p;
    const ro = [0, RG + p.altitude, 0], rd = [dir.x, dir.y, dir.z];
    const tg = raySphere(ro, rd, RG);
    const t = raySphere(ro, rd, RT)[1];
    const N = 64; const ds = t / N; let oR = 0, oM = 0, oO = 0;
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) * ds;
      const x = ro[0] + rd[0] * s, y = ro[1] + rd[1] * s, z = ro[2] + rd[2] * s;
      const h = Math.max(0, Math.sqrt(x * x + y * y + z * z) - RG);
      oR += Math.exp(-h / p.HR) * ds; oM += Math.exp(-h / p.HM) * ds; oO += Math.max(0, 1 - Math.abs(h - 25) / 15) * ds;
    }
    const bMe = (p.betaMs + p.betaMa) * p.mieScale;
    const out = [0, 1, 2].map(i => Math.exp(-(p.betaR[i] * p.rayleighScale * oR + bMe * oM + p.betaO[i] * p.ozoneScale * oO)));
    out.hitsGround = tg[0] > 0;
    return out;
  }

  /** Set sun position (degrees) and rebuild LUT / env / light colours. */
  setSun(elevDeg, azimDeg, { force = false } = {}) {
    if (!force && elevDeg === this.elev && azimDeg === this.azim && this.pmremRT) return false;
    this.elev = elevDeg; this.azim = azimDeg;
    const el = elevDeg * DEG, az = azimDeg * DEG;
    this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    this.update();
    return true;
  }

  update() {
    const p = this.p, r = this.renderer, elev = this.elev;
    // --- night factor (city lights): starts a little before sunset, full at civil twilight end
    this.night = smooth(3.0, -6.5, elev);

    // --- LUT
    const u = this.lutPass.material.uniforms;
    u.uSunDir.value.copy(this.sunDir); u.uSunE.value = p.sunE;
    u.uBetaR.value.fromArray(p.betaR).multiplyScalar(p.rayleighScale);
    u.uBetaMs.value = p.betaMs * p.mieScale; u.uBetaMe.value = (p.betaMs + p.betaMa) * p.mieScale;
    u.uBetaO.value.fromArray(p.betaO).multiplyScalar(p.ozoneScale);
    u.uHR.value = p.HR; u.uHM.value = p.HM; u.uG.value = p.mieG; u.uAlt.value = p.altitude;
    u.uMsColor.value.fromArray(keyLerp(p.msKeys, elev));
    u.uGroundAlbedo.value.fromArray(p.groundAlbedo);
    u.uNightSky.value.fromArray(p.nightSky).multiplyScalar(smooth(2, -10, elev));
    u.uGlowColor.value.fromArray(p.cityGlow).multiplyScalar(this.night);
    u.uTint.value.fromArray(p.tint);
    u.uGlowLow.value.fromArray(p.glowLowColor).multiplyScalar(keyLerp(p.glowLowKeys, elev)[0] * p.glowGain);
    u.uGlowHigh.value.fromArray(p.glowHighColor).multiplyScalar(keyLerp(p.glowHighKeys, elev)[0] * p.glowGain);
    u.uGlowAnti.value.fromArray(p.glowAntiColor).multiplyScalar(keyLerp(p.glowAntiKeys, elev)[0] * p.glowGain);
    this.lutPass.render(r, this.lut);

    // --- sun light colour
    const T = this.transmittance(new THREE.Vector3(this.sunDir.x, Math.max(this.sunDir.y, 0.0005), this.sunDir.z).normalize());
    const sunFade = smooth(-1.1, 0.5, elev);
    this.sunColor.setRGB(T[0] * p.sunE * sunFade, T[1] * p.sunE * sunFade, T[2] * p.sunE * sunFade);
    // visible disc: physical radiance clamped so film/halation does the rest
    const omega = 2 * Math.PI * (1 - Math.cos(p.sunAngularRadius));
    const disc = [0, 1, 2].map(i => T[i] * p.sunE / omega);
    const mx = Math.max(disc[0], disc[1], disc[2], 1e-9); const k = Math.min(1, p.sunDiskMax / mx);
    this.skyUniforms.uSunDisk.value.set(disc[0] * k, disc[1] * k, disc[2] * k);
    const rad = p.sunAngularRadius * p.sunDiskScale;
    this.skyUniforms.uSunCos.value = Math.cos(rad);
    this.skyUniforms.uSunSoft.value = (1 - Math.cos(rad)) * 0.12;

    // --- key light: sun, cross-fading to moon after dusk
    const moonAmt = smooth(-3.5, -9, elev);
    if (sunFade > 0.0005 || moonAmt <= 0) {
      this.lightDir.copy(this.sunDir); if (this.lightDir.y < 0.012) { this.lightDir.y = 0.012; this.lightDir.normalize(); }
      this.lightColor.copy(this.sunColor);
    } else {
      this.lightDir.copy(p.moonDir);
      this.lightColor.setRGB(p.moonColor[0] * p.moonE * moonAmt, p.moonColor[1] * p.moonE * moonAmt, p.moonColor[2] * p.moonE * moonAmt);
    }
    this.skyUniforms.uMoonDisk.value.set(p.moonColor[0], p.moonColor[1], p.moonColor[2]).multiplyScalar(0.25 * moonAmt);
    this.skyUniforms.uMoonDir.value.copy(p.moonDir);
    this.skyUniforms.uStars.value = 0.012 * smooth(-4, -12, elev);

    // --- env map: sky + ground bounce
    r.setRenderTarget(this.probe);
    const ground = this.envPass.material.uniforms.uGroundColor.value;
    // first pass with neutral ground to measure the sky, then final
    ground.set(0, 0, 0);
    this.envPass.render(r, this.envEquirect);
    this.probePass.render(r, this.probe);
    r.readRenderTargetPixels(this.probe, 0, 0, 16, 8, this.probeBuf);
    let sr = 0, sg = 0, sb = 0, sw = 0;       // cosine-weighted irradiance of the upper hemisphere
    let hr = 0, hg = 0, hb = 0, hw = 0;       // horizon average
    for (let y = 4; y < 8; y++) {
      const lat = ((y + 0.5) / 8 - 0.5) * Math.PI; const w = Math.cos(lat) * Math.sin(lat);
      for (let x = 0; x < 16; x++) {
        const i = (y * 16 + x) * 4;
        sr += this.probeBuf[i] * w; sg += this.probeBuf[i + 1] * w; sb += this.probeBuf[i + 2] * w; sw += w;
        if (y === 4) { hr += this.probeBuf[i]; hg += this.probeBuf[i + 1]; hb += this.probeBuf[i + 2]; hw++; }
      }
    }
    // E = integral L cos dw ; mean radiance weighted by cos*solid angle -> E = PI * mean
    this.skyIrradiance = [Math.PI * sr / sw, Math.PI * sg / sw, Math.PI * sb / sw];
    this.horizonColor = [hr / hw, hg / hw, hb / hw];
    const alb = 0.22;
    const ndl = Math.max(this.sunDir.y, 0);
    ground.set(
      alb / Math.PI * (this.skyIrradiance[0] + this.sunColor.r * ndl),
      alb / Math.PI * (this.skyIrradiance[1] + this.sunColor.g * ndl),
      alb / Math.PI * (this.skyIrradiance[2] + this.sunColor.b * ndl));
    this.envPass.render(r, this.envEquirect);
    this.pmremRT = this.pmrem.fromEquirectangular(this.envEquirect.texture, this.pmremRT);
    r.setRenderTarget(null);

    // --- publish globals
    G.sunDir.value.copy(this.sunDir); G.sunColor.value.copy(this.sunColor);
    G.lightDir.value.copy(this.lightDir); G.lightColor.value.copy(this.lightColor);
    G.ambient.value.setRGB(this.skyIrradiance[0] / Math.PI, this.skyIrradiance[1] / Math.PI, this.skyIrradiance[2] / Math.PI);
    G.night.value = this.night; G.sunElev.value = elev;
  }

  get envMap() { return this.pmremRT ? this.pmremRT.texture : null; }
}
