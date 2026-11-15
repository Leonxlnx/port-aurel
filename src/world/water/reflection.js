// Planar reflection of the world in the water plane y = 0.
// A virtual camera sits at the mirrored eye position below the surface and looks up at the real scene. Its projection
// has an oblique near plane (the water surface) so nothing below the water leaks in. The raw render (HDR colour +
// float depth) is then resolved into a mip-mapped HDR texture: rgb = radiance with aerial perspective applied along
// the reflected path (the engine fogs only the camera->water segment), a = linear view depth (for parallax-correct,
// distance-dependent distortion in the water shader).
import * as THREE from 'three';
import { G, COMMON_GLSL } from '../../engine/globals.js';
import { FSQ, passMaterial } from '../../engine/fsq.js';

const RESOLVE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D uSkyLUT;
uniform vec4 uRay;        // te0, te5, te8, te9 of the virtual projection
uniform vec4 uPlane;      // clip plane in the virtual camera's view space
uniform float uS;         // oblique depth scale
uniform mat4 uCamW;       // virtual camera world matrix
uniform vec4 uFogA; uniform vec4 uFogB; uniform vec3 uFogTint;
uniform float uFogOn;
${COMMON_GLSL}
void main() {
  vec4 col = texture2D(tColor, vUv);
  float zb = texture2D(tDepth, vUv).x;
#ifdef REVERSED_DEPTH
  float t = 1.0 - zb;
#else
  float t = zb;
#endif
  vec2 ndc = vUv * 2.0 - 1.0;
  vec2 xy = (ndc + uRay.zw) / uRay.xy;                 // view-space ray (x, y) per unit view depth
  float m = dot(uPlane.xy, xy) - uPlane.z;             // height gain above the clip plane per unit view depth
  float d = 6.0e4;
  vec3 c = col.rgb;
  if (t < 0.985) {
    d = clamp(uS * uPlane.w / min(t - uS * m, -1e-9), 0.01, 6.0e4);
    vec3 camP = uCamW[3].xyz;
    vec3 Q = (uCamW * vec4(xy * d, -d, 1.0)).xyz;
    vec3 ray = Q - camP;
    float gain = ray.y / d;                            // world height gain per unit view depth
    float dP = gain > 1e-6 ? clamp(-camP.y / gain, 0.0, d) : d;
    float dist = length(ray) * (1.0 - dP / d);          // length of the reflected path above the water
    vec3 wdir = normalize(ray);
    float a = uFogA.y; float camH = -uFogA.z; float dy = wdir.y;
    float k = abs(dy) > 1e-5 ? (1.0 - exp(-a * dy * dist)) / (a * dy) : dist;
    float od = uFogA.x * exp(-a * max(camH, -40.0)) * k + uFogB.x * dist;
    float T = mix(1.0, max(exp(-od), 1.0 - uFogA.w), uFogOn);
    vec3 fdir = normalize(vec3(wdir.x, 0.035 + 0.5 * max(wdir.y, 0.0), wdir.z));
    vec3 fogCol = skyLUT(uSkyLUT, fdir) * uFogTint * uFogB.y;
    c = c * T + fogCol * (1.0 - T);
  }
  // sanitise (NaN / inf would poison the mip chain) but keep the HDR range
  c = clamp(c, vec3(0.0), vec3(3.0e4));
  if (!(c.r + c.g + c.b < 1.0e9)) c = vec3(0.0);
  gl_FragColor = vec4(c, d);
}
`;

// vertical-only 2x reduction ([1 3 3 1] / 8): builds the "rip" chain used to stretch reflections into streaks
const RIP_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc; uniform float uTexelY;
void main() {
  vec3 a = textureLod(tSrc, vUv + vec2(0.0, 0.75 * uTexelY), 0.0).rgb;
  vec3 b = textureLod(tSrc, vUv - vec2(0.0, 0.75 * uTexelY), 0.0).rgb;
  gl_FragColor = vec4(0.5 * (a + b), 1.0);
}
`;
export const RIP_LEVELS = 4;

export class PlanarReflection {
  constructor(engine, { clipY = -0.12, topMargin = 0.7, sideMargin = 1.12 } = {}) {
    this.engine = engine;
    this.clipY = clipY; this.topMargin = topMargin; this.sideMargin = sideMargin;
    this.cam = new THREE.PerspectiveCamera();
    this.cam.updateProjectionMatrix = () => {};          // the projection is set by hand every sample
    this.cam._reversedDepth = !!engine.reversed;
    this.cam.matrixAutoUpdate = true;
    this.cam.near = 0.05; this.cam.far = 60000;
    this.projPlain = new THREE.Matrix4();                // same frustum, regular depth row (for shaders that unproject)
    this.projPlainInv = new THREE.Matrix4();
    this.vp = new THREE.Matrix4();                       // projPlain * view (lookup matrix for the water shader)
    this.rtRaw = null; this.rtRes = null; this.w = 0; this.h = 0;
    this.ripPass = new FSQ(passMaterial({ fragmentShader: RIP_FRAG, uniforms: { tSrc: { value: null }, uTexelY: { value: 1 } } }));
    this.rips = [];
    this.resolve = new FSQ(passMaterial({
      fragmentShader: RESOLVE_FRAG, defines: { ...engine.defines },
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, uSkyLUT: G.skyLUT,
        uRay: { value: new THREE.Vector4() }, uPlane: { value: new THREE.Vector4() }, uS: { value: 1 },
        uCamW: { value: new THREE.Matrix4() }, uFogA: G.fogA, uFogB: G.fogB, uFogTint: G.fogTint, uFogOn: { value: 1 },
      },
    }));
    // uniforms shared with the water material
    this.uniforms = {
      uRefl: { value: null }, uReflVP: { value: this.vp }, uReflCam: { value: new THREE.Vector3() },
      uReflOn: { value: 0 }, uReflInfo: { value: new THREE.Vector4(1, 1, 1, 0) },   // px per radian (vertical), tex w, tex h, max mip
      uRip1: { value: null }, uRip2: { value: null }, uRip3: { value: null }, uRip4: { value: null },
      uSunUV: { value: new THREE.Vector3(0.5, 0.5, 0) },      // key light in the mirror image (xy), z = 1 when inside
    };
    this._l = new THREE.Vector4();
    this.lastMs = 0;
    this._v = { r: new THREE.Vector3(), u: new THREE.Vector3(), b: new THREE.Vector3(), p: new THREE.Vector3(), m: new THREE.Matrix4() };
  }

  setSize(w, h) {
    w = Math.max(8, Math.round(w)); h = Math.max(8, Math.round(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    if (this.rtRaw) { this.rtRaw.dispose(); this.rtRes.dispose(); this.rips.forEach(r => r.dispose()); }
    const depth = new THREE.DepthTexture(w, h, THREE.FloatType);
    depth.minFilter = depth.magFilter = THREE.NearestFilter;
    this.rtRaw = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, depthTexture: depth, stencilBuffer: false, generateMipmaps: false,
    });
    this.rtRes = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: true,
    });
    this.rtRes.texture.wrapS = this.rtRes.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.uniforms.uRefl.value = this.rtRes.texture;
    this.rips = [];
    for (let i = 1; i <= RIP_LEVELS; i++) {
      const rt = new THREE.WebGLRenderTarget(w, Math.max(2, Math.round(h / Math.pow(2, i))), {
        type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false, generateMipmaps: true,
      });
      rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
      this.rips.push(rt); this.uniforms['uRip' + i].value = rt.texture;
    }
  }

  /**
   * Set up the virtual camera from the (already jittered / lens-shifted) main camera.
   * Returns false when no water can be visible (camera looks above the horizon everywhere).
   */
  setup(camera) {
    const { r, u, b, p, m } = this._v;
    const e = camera.matrixWorld.elements;
    // mirror about y = 0; flip the up vector so the basis stays right-handed (upright camera below the surface)
    r.set(e[0], -e[1], e[2]); u.set(-e[4], e[5], -e[6]); b.set(e[8], -e[9], e[10]); p.set(e[12], -e[13], e[14]);
    if (p.y > -0.02) p.y = -0.02;
    m.makeBasis(r, u, b);
    const cam = this.cam;
    cam.position.copy(p); cam.quaternion.setFromRotationMatrix(m); cam.scale.set(1, 1, 1);
    cam.updateMatrixWorld(true);

    const pm = camera.projectionMatrix.elements;
    const a0 = pm[0], a5 = pm[5], o8 = pm[8], o9 = -pm[9];       // y offset mirrors with the image
    // rows of the base virtual projection: X = a0 x + o8 z, Y = a5 y + o9 z, w = -z
    // vertical range actually needed: from the (mirrored) horizon up to the top of the frame plus a margin for distortion
    let ymin = -1.05;
    {
      let lo = Infinity, any = false;
      for (const X of [-1, 1]) {
        const x = (X + o8) / a0; const c1 = u.y / a5, c0 = x * r.y + (o9 / a5) * u.y - b.y;   // ray.y = c0 + c1 * Y
        if (c1 > 1e-5) { lo = Math.min(lo, -c0 / c1); any = true; } else if (c0 > 0) { lo = -Infinity; any = true; }
      }
      if (!any) return false;                                // every ray points down: mirror camera sees no world
      ymin = Math.max(-1.05, lo - 0.06);
    }
    const ymax = 1 + this.topMargin;
    if (ymin > 0.98) return false;                           // horizon below the bottom of the frame: no water in view
    const sy = 2 / (ymax - ymin), ty = -(ymax + ymin) / (ymax - ymin), sx = 1 / this.sideMargin;
    const te = cam.projectionMatrix.elements;
    te.fill(0);
    te[0] = a0 * sx; te[8] = o8 * sx;
    te[5] = a5 * sy; te[9] = o9 * sy - ty;
    te[11] = -1;
    // regular reversed/standard depth row for the plain version
    const n = 0.3, f = 60000;
    this.projPlain.copy(cam.projectionMatrix); const pe = this.projPlain.elements;
    if (this.engine.reversed) { pe[10] = n / (f - n); pe[14] = f * n / (f - n); } else { pe[10] = -(f + n) / (f - n); pe[14] = -2 * f * n / (f - n); }
    this.projPlainInv.copy(this.projPlain).invert();

    // clip plane (world y = clipY, keep above) in view space
    const C = this._plane || (this._plane = new THREE.Vector4());
    C.set(r.y, u.y, b.y, p.y - Math.max(this.clipY, 0.5 * p.y));
    // largest height gain per unit view depth inside the frustum -> depth scale
    let mmax = 0.02;
    for (const X of [-1, 1]) for (const Y of [-1, 1]) {
      const x = (X + te[8]) / te[0], y = (Y + te[9]) / te[5];
      mmax = Math.max(mmax, C.x * x + C.y * y - C.z);
    }
    const s = 0.95 / mmax;
    if (this.engine.reversed) {
      // z_clip = w - s * (C . p)   (1 on the water plane, decreasing upward/outward; reversed [0,1] depth)
      te[2] = -s * C.x; te[6] = -s * C.y; te[10] = -1 - s * C.z; te[14] = -s * C.w;
    } else {
      // z_clip = -w + 2 s (C . p)
      te[2] = 2 * s * C.x; te[6] = 2 * s * C.y; te[10] = 1 + 2 * s * C.z; te[14] = 2 * s * C.w;
    }
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    this.vp.multiplyMatrices(this.projPlain, cam.matrixWorldInverse);
    this.uniforms.uReflCam.value.copy(p);
    const ru = this.resolve.material.uniforms;
    ru.uRay.value.set(te[0], te[5], te[8], te[9]); ru.uPlane.value.copy(C); ru.uS.value = s; ru.uCamW.value.copy(cam.matrixWorld);
    this.uniforms.uReflInfo.value.set(0.5 * this.h * te[5], this.w, this.h, Math.floor(Math.log2(Math.max(this.w, this.h))));
    // where the key light sits in the mirror image (to test whether distant terrain hides it)
    const ld = G.lightDir.value, l = this._l.set(ld.x, ld.y, ld.z, 0).applyMatrix4(this.vp);
    const su = this.uniforms.uSunUV.value;
    if (l.w > 1e-6) {
      const ux = l.x / l.w * 0.5 + 0.5, uy = l.y / l.w * 0.5 + 0.5;
      su.set(ux, uy, ux > 0.01 && ux < 0.99 && uy > 0.01 && uy < 0.99 ? 1 : 0);
    } else su.set(0.5, 0.5, 0);
    return true;
  }

  /** Render the mirrored scene + resolve. `hidden`: objects to hide (the water itself). */
  render(scene, camera, hidden = []) {
    const eng = this.engine, atm = eng.atmosphere;
    if (!this.rtRaw || !this.setup(camera)) { this.uniforms.uReflOn.value = 0; return false; }
    const vis = hidden.map(o => o.visible); hidden.forEach(o => { o.visible = false; });
    // the sun disc is reflected analytically (glitter) -> remove it from the mirrored sky
    const disk = atm.skyUniforms.uSunDisk.value; const sd = disk.clone(); disk.set(0, 0, 0);
    const prevHook = scene.onBeforeRender;
    scene.onBeforeRender = (...args) => {
      // shaders that unproject with uProjInv (sky dome, glows) must not see the oblique matrix
      G.proj.value.copy(this.projPlain); G.projInv.value.copy(this.projPlainInv);
      if (prevHook) prevHook.apply(scene, args);
    };
    try {
      eng.renderAux(scene, this.cam, this.rtRaw, {});
    } finally {
      scene.onBeforeRender = prevHook;
      disk.copy(sd);
      hidden.forEach((o, i) => { o.visible = vis[i]; });
    }
    const ru = this.resolve.material.uniforms;
    ru.tColor.value = this.rtRaw.texture; ru.tDepth.value = this.rtRaw.depthTexture;
    this.resolve.render(eng.renderer, this.rtRes);
    let src = this.rtRes;
    for (const rt of this.rips) {
      const pu = this.ripPass.material.uniforms; pu.tSrc.value = src.texture; pu.uTexelY.value = 1 / src.height;
      this.ripPass.render(eng.renderer, rt); src = rt;
    }
    eng.renderer.setRenderTarget(null);
    this.uniforms.uReflOn.value = 1;
    return true;
  }
}
