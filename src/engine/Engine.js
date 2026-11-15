// Render pipeline: depth prepass -> SSAO -> lit HDR pass -> aerial perspective -> float accumulation
// (sub-pixel jitter, shutter time, lens and sun-disc sampling) -> bloom/halation -> film emulation.
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { G } from './globals.js';
import { Atmosphere } from './atmosphere.js';
import { FSQ, passMaterial } from './fsq.js';
import * as S from './shaders.js';

const BLOOM_LEVELS = 7;

function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
function hash01(n) { let x = Math.sin(n * 127.1 + 311.7) * 43758.5453123; return x - Math.floor(x); }
// concentric disc mapping
function disc(u, v) {
  const a = 2 * u - 1, b = 2 * v - 1; if (a === 0 && b === 0) return [0, 0];
  let r, phi; if (Math.abs(a) > Math.abs(b)) { r = a; phi = (Math.PI / 4) * (b / a); } else { r = b; phi = Math.PI / 2 - (Math.PI / 4) * (a / b); }
  return [r * Math.cos(phi), r * Math.sin(phi)];
}

export class Engine {
  constructor({ canvas, width = 1280, height = 720 }) {
    const renderer = this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: false, stencil: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: true, reversedDepthBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.autoClear = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.info.autoReset = false;
    this.reversed = !!renderer.capabilities.reversedDepthBuffer;
    this.defines = this.reversed ? { REVERSED_DEPTH: 1 } : {};
    const gl = renderer.getContext();
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float');

    this.camera = new THREE.PerspectiveCamera(40, width / height, 0.3, 60000);
    this.atmosphere = new Atmosphere(renderer, { reversed: this.reversed });

    // key light with cascaded shadows
    this.sun = new SunLight(0xffffff, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 900;
    this.sun.shadow.bias = this.reversed ? 0.0 : 0.0;
    this.sun.shadow.normalBias = 0.06;
    this.sun.shadow.radius = 1.5;
    this.sun.shadow.intensity = 1;

    this.settings = {
      ao: true, aoRadius: 0.9, aoRadiusDist: 0.03, aoIntensity: 1.35, aoBlur: false,
      prepass: true,
      shadowDistance: 900, sunSoftness: 1.6,
      exposure: 0.25,
      bloom: 0.09, soft: 0.035, halation: 0.9, halationTint: [1.0, 0.24, 0.07], halationThresh: 1.35,
      grain: 0.055, grainSize: 1.4, vignette: 0.36, ca: 0.0016, distort: 0.012,
      wb: [1, 1, 1], contrast: 1.38, saturation: 1.12, fade: 0.0, look: 1,
      shadowTint: [0.93, 1.0, 1.06], highTint: [1.045, 1.0, 0.94], lift: [0.0010, 0.0012, 0.0018],
      clampHDR: 4000,
      dofFill: true,
      fogDensity: 0.00012, fogFalloff: 140, fogUniform: 0.000012, fogBrightness: 1.0,
      shafts: 1.0, shaftDistance: 520, dust: 0.003, dustHeight: 28, nightGlow: [0.010, 0.0075, 0.0055], cityLightGain: 1, stableNoise: false,
    };

    this._makePasses();
    this.setSize(width, height);
    this.sampleCount = 0;
    this.frameSeed = 0;
    this.stats = {};
    // hooks.beforeSample: fn(engine, scene, camera, sampleIndex) called once per accumulated sample, after the camera
    // is final and before the depth prepass (render planar reflections etc. here with renderAux)
    this.hooks = { beforeSample: [] };
  }

  _makePasses() {
    const D = this.defines;
    this.prepassMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.prepassMat.polygonOffset = true;
    this.prepassMat.polygonOffsetFactor = 1;   // three flips the sign itself for reversed depth
    this.prepassMat.polygonOffsetUnits = 4;

    this.aoPass = new FSQ(passMaterial({
      fragmentShader: S.AO_FRAG, defines: { ...D, AO_SAMPLES: 8 },
      uniforms: {
        tDepth: { value: null }, uProj: G.proj, uProjInv: G.projInv, uFullRes: G.resolution,
        uSeed: G.frame, uRadius: { value: 1 }, uRadiusDist: { value: 0.02 }, uIntensity: { value: 1 }, uFar: { value: 60000 },
      },
    }));
    this.aoBlurPass = new FSQ(passMaterial({
      fragmentShader: S.AO_BLUR_FRAG, uniforms: { tAO: { value: null }, uDir: { value: new THREE.Vector2() } },
    }));
    this.atmoPass = new FSQ(passMaterial({
      fragmentShader: S.ATMO_FRAG, defines: { ...D },
      blending: THREE.CustomBlending,
      extra: { blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor },
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, uSkyLUT: G.skyLUT,
        uProjInv: G.projInv, uCamWorld: G.camWorld, uCamPos: G.camPos,
        uFogA: G.fogA, uFogB: G.fogB, uFogTint: G.fogTint,
        uSunDir: G.sunDir, uSunColor: G.sunColor, uNight: G.night,
        uWeight: { value: 1 }, uClamp: { value: 4000 }, uDof: { value: new THREE.Vector3(100, 0, 0) }, uSeed: G.frame,
        tShadow: { value: null }, uShadowMat0: { value: new THREE.Matrix4() }, uShadowMat1: { value: new THREE.Matrix4() },
        uCascade0: { value: new THREE.Vector4() }, uCascade1: { value: new THREE.Vector4() },
        uShaft: { value: new THREE.Vector4(0, 500, 0, 30) }, uNightGlow: { value: new THREE.Vector3() },
      },
    }));
    this.resolvePass = new FSQ(passMaterial({
      fragmentShader: S.RESOLVE_FRAG, defines: { DOF_FILL: 1 },
      uniforms: { tAccum: { value: null }, uInvWeight: { value: 1 }, uExposure: { value: 1 }, uTexel: { value: new THREE.Vector2() }, uDofFill: { value: 0 } },
    }));
    this.downPass = new FSQ(passMaterial({
      fragmentShader: S.DOWN_FRAG, uniforms: { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uKaris: { value: 0 } },
    }));
    this.upPass = new FSQ(passMaterial({
      fragmentShader: S.UP_FRAG,
      uniforms: { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 }, uWeightLow: { value: 1 }, uWeightHigh: { value: 1 } },
    }));
    this.filmPass = new FSQ(passMaterial({
      fragmentShader: S.FILM_FRAG,
      uniforms: {
        tHDR: { value: null }, tBloom: { value: null }, tH1: { value: null }, tH2: { value: null }, tH3: { value: null },
        uRes: { value: new THREE.Vector2() }, uSeed: { value: 0 },
        uBloom: { value: 0 }, uHalation: { value: 0 }, uHalationTint: { value: new THREE.Vector3() }, uHalationThresh: { value: 1 },
        uGrain: { value: 0 }, uGrainSize: { value: 2 }, uVignette: { value: 0 }, uCA: { value: 0 }, uDistort: { value: 0 },
        uWB: { value: new THREE.Vector3(1, 1, 1) }, uContrast: { value: 1 }, uSaturation: { value: 1 }, uToe: { value: 0 }, uFade: { value: 0 },
        uShadowTint: { value: new THREE.Vector3(1, 1, 1) }, uHighTint: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3() },
        uLook: { value: 1 }, uSoft: { value: 0 },
      },
    }));
    this.copyPass = new FSQ(passMaterial({
      fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; uniform sampler2D tSrc; void main(){ gl_FragColor = texture2D(tSrc, vUv); }`,
      uniforms: { tSrc: { value: null } },
    }));
  }

  setSize(w, h) {
    w = Math.max(2, Math.round(w)); h = Math.max(2, Math.round(h));
    if (this.width === w && this.height === h) return;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false);
    G.resolution.value.set(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    const dispose = t => t && t.dispose();
    [this.rtScene, this.rtAO, this.rtAO2, this.rtAccum, this.rtHDR, ...(this.rtDown || []), ...(this.rtUp || [])].forEach(dispose);

    const depthTex = new THREE.DepthTexture(w, h, THREE.FloatType);
    depthTex.minFilter = depthTex.magFilter = THREE.NearestFilter;
    this.rtScene = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: true, depthTexture: depthTex, stencilBuffer: false, generateMipmaps: false,
    });
    const hw = Math.ceil(w / 2), hh = Math.ceil(h / 2);
    const half = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    this.rtAO = new THREE.WebGLRenderTarget(hw, hh, half);
    this.rtAO2 = new THREE.WebGLRenderTarget(hw, hh, half);
    this.rtAccum = new THREE.WebGLRenderTarget(w, h, { ...half, type: this.floatOK ? THREE.FloatType : THREE.HalfFloatType });
    this.rtHDR = new THREE.WebGLRenderTarget(w, h, half);
    this.rtDown = []; this.rtUp = [];
    let bw = hw, bh = hh;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      this.rtDown.push(new THREE.WebGLRenderTarget(bw, bh, half));
      if (i < BLOOM_LEVELS - 1) this.rtUp.push(new THREE.WebGLRenderTarget(bw, bh, half));
      bw = Math.max(2, Math.ceil(bw / 2)); bh = Math.max(2, Math.ceil(bh / 2));
    }
    G.aoTex.value = this.rtAO.texture;
    this.sampleCount = 0;
  }

  /** Apply time-of-day. Returns true if the sky was rebuilt. */
  setEnvironment({ sunElevation, sunAzimuth }) {
    const changed = this.atmosphere.setSun(sunElevation, sunAzimuth);
    return changed;
  }

  /** Attach engine-owned objects (sun, sky dome) to a scene and set its environment. */
  attach(scene) {
    if (this.sun.parent !== scene) scene.add(this.sun);
    if (this.atmosphere.dome.parent !== scene) scene.add(this.atmosphere.dome);
    scene.environment = this.atmosphere.envMap;
    scene.background = null;
  }

  // ------------------------------------------------------------------------------------------
  accumBegin(frameSeed = 0) {
    this.sampleCount = 0;
    this.frameSeed = frameSeed;
    const r = this.renderer;
    r.setRenderTarget(this.rtAccum);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
  }

  /**
   * Render one sample into the accumulation buffer.
   * lens: { aperture (m, lens radius), focus (m) } — true multi-sample depth of field.
   */
  accumSample(scene, camera, { lens = null, jitter = true, sampleIndex = null, totalSamples = 1 } = {}) {
    const r = this.renderer, st = this.settings, atm = this.atmosphere;
    const i = sampleIndex ?? this.sampleCount;
    const seq = i + 1;
    const rot = [hash01(this.frameSeed * 3.1 + 1.7), hash01(this.frameSeed * 5.3 + 9.2), hash01(this.frameSeed * 7.7 + 4.1), hash01(this.frameSeed * 1.9 + 6.6)];
    const fr = x => x - Math.floor(x);
    // stableNoise: the same stochastic patterns every frame (no temporal flicker in haze / shafts; grain still moves)
    G.frame.value = st.stableNoise ? (i * 17 + 5) % 4096 : (this.frameSeed * 131 + i * 17) % 4096;
    G.cityGain.value = st.cityLightGain ?? 1;

    this.attach(scene);
    // --- key light (jittered across the sun disc for physically soft shadows)
    const ld = atm.lightDir;
    // the same set of directions across the sun disc every frame: grazing-lit surfaces must not flicker
    const [sx, sy] = disc(fr(halton(seq, 11) + 0.37), fr(halton(seq, 13) + 0.61));
    const soft = Math.tan(atm.p.sunAngularRadius) * st.sunSoftness * (jitter ? 1 : 0);
    const t1 = new THREE.Vector3(0, 1, 0).cross(ld).normalize(); const t2 = new THREE.Vector3().crossVectors(ld, t1);
    this.sun.position.copy(ld).addScaledVector(t1, sx * soft).addScaledVector(t2, sy * soft).normalize();
    this.sun.color.copy(atm.lightColor); this.sun.intensity = 1;
    this.sun.shadow.camera.far = st.shadowDistance;
    this.sun.castShadow = st.shadows !== false;
    this.sun.updateMatrixWorld();

    // --- camera: sub-pixel jitter (gaussian pixel filter) + thin-lens offset
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    const pm = camera.projectionMatrix.elements;
    let jx = 0, jy = 0;
    if (jitter) {
      const u1 = Math.max(1e-4, fr(halton(seq, 2) + rot[0])), u2 = fr(halton(seq, 3) + rot[1]);
      const g = Math.sqrt(-2 * Math.log(u1)) * 0.42;
      jx = Math.max(-1.25, Math.min(1.25, g * Math.cos(2 * Math.PI * u2)));
      jy = Math.max(-1.25, Math.min(1.25, g * Math.sin(2 * Math.PI * u2)));
    }
    pm[8] -= (jx * 2) / this.width; pm[9] -= (jy * 2) / this.height;
    let restorePos = null;
    if (lens && lens.aperture > 0) {
      const [lx, ly] = disc(fr(halton(seq, 5) + rot[1]), fr(halton(seq, 7) + rot[0]));
      const dx = lx * lens.aperture, dy = ly * lens.aperture;
      restorePos = camera.position.clone();
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      camera.position.addScaledVector(right, dx).addScaledVector(up, dy);
      // keep the focal plane fixed while the eye moves on the lens: P02' = -P00 * dx / f
      pm[8] += -pm[0] * dx / lens.focus;
      pm[9] += -pm[5] * dy / lens.focus;
      camera.updateMatrixWorld();
    }
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    G.proj.value.copy(camera.projectionMatrix); G.projInv.value.copy(camera.projectionMatrixInverse);
    G.camWorld.value.copy(camera.matrixWorld); G.camPos.value.setFromMatrixPosition(camera.matrixWorld);

    for (const h of this.hooks.beforeSample) h(this, scene, camera, i);

    // --- depth prepass (layer 0 only) + SSAO
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    const savedMask = camera.layers.mask;
    if (st.prepass) {
      camera.layers.set(0);
      scene.overrideMaterial = this.prepassMat;
      r.shadowMap.needsUpdate = false;
      r.render(scene, camera);
      scene.overrideMaterial = null;
      if (st.ao) {
        const au = this.aoPass.material.uniforms;
        au.tDepth.value = this.rtScene.depthTexture;
        au.uRadius.value = st.aoRadius; au.uRadiusDist.value = st.aoRadiusDist; au.uIntensity.value = st.aoIntensity; au.uFar.value = camera.far;
        this.aoPass.render(r, this.rtAO);
        if (st.aoBlur) {
          const bu = this.aoBlurPass.material.uniforms;
          bu.tAO.value = this.rtAO.texture; bu.uDir.value.set(1 / this.rtAO.width, 0); this.aoBlurPass.render(r, this.rtAO2);
          bu.tAO.value = this.rtAO2.texture; bu.uDir.value.set(0, 1 / this.rtAO.height); this.aoBlurPass.render(r, this.rtAO);
        }
      }
    }
    G.aoOn.value = st.prepass && st.ao ? 1 : 0;

    // --- lit pass
    camera.layers.enableAll();
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);
    camera.layers.mask = savedMask;

    // --- aerial perspective + accumulate
    const tu = this.atmoPass.material.uniforms;
    tu.tColor.value = this.rtScene.texture; tu.tDepth.value = this.rtScene.depthTexture;
    tu.uWeight.value = 1; tu.uClamp.value = st.clampHDR;
    G.fogA.value.x = st.fogDensity; G.fogA.value.y = 1 / st.fogFalloff; G.fogB.value.x = st.fogUniform; G.fogB.value.y = st.fogBrightness;
    const sh = this.sun.shadow;
    const shOK = st.shadows !== false && sh.map && sh.map.depthTexture && sh.map.depthTexture.compareFunction !== null;
    if (shOK) {
      tu.tShadow.value = sh.map.depthTexture;
      tu.uShadowMat0.value.copy(sh.getMatrix(0)); tu.uShadowMat1.value.copy(sh.getMatrix(1));
      tu.uCascade0.value.copy(sh._cascadeData[0]); tu.uCascade1.value.copy(sh._cascadeData[1]);
    }
    tu.uShaft.value.set(shOK ? st.shafts : 0, st.shaftDistance, shOK ? st.dust : 0, st.dustHeight);
    tu.uNightGlow.value.fromArray(st.nightGlow);
    if (lens && lens.aperture > 0) {
      // circle of confusion in pixels: aperture * |1/z - 1/f| * focalLengthPx * focus ... (px)
      const fpx = 0.5 * this.height / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
      tu.uDof.value.set(lens.focus, lens.aperture * fpx, 64 * this.height / 2160);
    } else tu.uDof.value.set(100, 0, 0);
    this.atmoPass.render(r, this.rtAccum);

    // restore camera
    if (restorePos) camera.position.copy(restorePos);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    this.sampleCount++;
  }

  /**
   * Render the scene from another camera into a target (no prepass/AO, shadows reused from the last main render).
   * Shared camera uniforms are switched to the aux camera for the call and restored afterwards.
   * layersMask: optional camera layer mask (default: all layers).
   */
  renderAux(scene, camera, target, { layersMask = null, clear = true } = {}) {
    const r = this.renderer;
    const save = { proj: G.proj.value.clone(), projInv: G.projInv.value.clone(), camWorld: G.camWorld.value.clone(), camPos: G.camPos.value.clone(), ao: G.aoOn.value, res: G.resolution.value.clone(), mask: camera.layers.mask };
    camera.updateMatrixWorld();
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    G.proj.value.copy(camera.projectionMatrix); G.projInv.value.copy(camera.projectionMatrixInverse);
    G.camWorld.value.copy(camera.matrixWorld); G.camPos.value.setFromMatrixPosition(camera.matrixWorld);
    G.aoOn.value = 0; G.aux.value = 1; G.resolution.value.set(target.width, target.height);
    if (layersMask != null) camera.layers.mask = layersMask; else camera.layers.enableAll();
    r.shadowMap.needsUpdate = false;
    r.setRenderTarget(target);
    if (clear) { r.setClearColor(0x000000, 0); r.clear(true, true, false); }
    r.render(scene, camera);
    camera.layers.mask = save.mask;
    G.proj.value.copy(save.proj); G.projInv.value.copy(save.projInv); G.camWorld.value.copy(save.camWorld); G.camPos.value.copy(save.camPos);
    G.aoOn.value = save.ao; G.aux.value = 0; G.resolution.value.copy(save.res);
    r.setRenderTarget(null);
  }

  /** Bloom + film -> canvas. */
  present({ exposure = null } = {}) {
    const r = this.renderer, st = this.settings;
    const n = Math.max(1, this.sampleCount);
    const ru = this.resolvePass.material.uniforms;
    ru.tAccum.value = this.rtAccum.texture; ru.uInvWeight.value = 1 / n; ru.uExposure.value = exposure ?? st.exposure;
    ru.uTexel.value.set(1 / this.width, 1 / this.height);
    // lens samples are spread ~ coc / sqrt(n) apart -> fill blur radius
    ru.uDofFill.value = st.dofFill ? 1.15 / Math.sqrt(n) : 0;
    this.resolvePass.render(r, this.rtHDR);

    // bloom pyramid
    let src = this.rtHDR;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const du = this.downPass.material.uniforms;
      du.tSrc.value = src.texture; du.uTexel.value.set(1 / src.width, 1 / src.height); du.uKaris.value = i === 0 ? 1 : 0;
      this.downPass.render(r, this.rtDown[i]);
      src = this.rtDown[i];
    }
    let low = this.rtDown[BLOOM_LEVELS - 1];
    for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
      const uu = this.upPass.material.uniforms;
      uu.tLow.value = low.texture; uu.tHigh.value = this.rtDown[i].texture; uu.uTexel.value.set(1 / low.width, 1 / low.height);
      uu.uRadius.value = 1.0; uu.uWeightLow.value = 0.62; uu.uWeightHigh.value = 0.38;
      this.upPass.render(r, this.rtUp[i]);
      low = this.rtUp[i];
    }

    const fu = this.filmPass.material.uniforms;
    fu.tHDR.value = this.rtHDR.texture; fu.tBloom.value = this.rtUp[0].texture;
    fu.tH1.value = this.rtDown[1].texture; fu.tH2.value = this.rtDown[2].texture; fu.tH3.value = this.rtDown[3].texture;
    fu.uRes.value.set(this.width, this.height); fu.uSeed.value = (this.frameSeed % 1000) + 1;
    fu.uBloom.value = st.bloom; fu.uSoft.value = st.soft; fu.uHalation.value = st.halation; fu.uHalationTint.value.fromArray(st.halationTint); fu.uHalationThresh.value = st.halationThresh;
    fu.uGrain.value = st.grain; fu.uGrainSize.value = st.grainSize; fu.uVignette.value = st.vignette; fu.uCA.value = st.ca; fu.uDistort.value = st.distort;
    fu.uWB.value.fromArray(st.wb); fu.uContrast.value = st.contrast; fu.uSaturation.value = st.saturation; fu.uFade.value = st.fade; fu.uLook.value = st.look;
    fu.uShadowTint.value.fromArray(st.shadowTint); fu.uHighTint.value.fromArray(st.highTint); fu.uLift.value.fromArray(st.lift);
    r.setRenderTarget(null);
    r.setViewport(0, 0, this.width, this.height);
    this.filmPass.render(r, null);
  }

  /** Average scene luminance of the last presented frame (before film curve, exposure applied). */
  meter() {
    if (!this.rtMeter) this.rtMeter = new THREE.WebGLRenderTarget(32, 18, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
    const rt = this.rtMeter;
    this.copyPass.material.uniforms.tSrc.value = this.rtDown[BLOOM_LEVELS - 2].texture;
    this.copyPass.render(this.renderer, rt);
    const n = rt.width * rt.height;
    if (!this._meterBuf || this._meterBuf.length !== n * 4) this._meterBuf = new Float32Array(n * 4);
    let buf = this._meterBuf;
    try { this.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf); } catch (e) { return null; }
    this.renderer.setRenderTarget(null);
    let sum = 0, logSum = 0; const L = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const l = 0.2126 * buf[i * 4] + 0.7152 * buf[i * 4 + 1] + 0.0722 * buf[i * 4 + 2];
      L[i] = l; sum += l; logSum += Math.log(Math.max(l, 1e-6));
    }
    const avg = sum / n;
    // highlight-clamped average (a visible sun must not drag the exposure down), centre weighted
    let cs = 0, cw = 0; const W = rt.width, H = rt.height;
    for (let i = 0; i < n; i++) {
      const x = (i % W + 0.5) / W - 0.5, y = (Math.floor(i / W) + 0.5) / H - 0.5;
      const w = 1.0 - 1.2 * (x * x + y * y);
      cs += Math.min(L[i], avg * 5) * w; cw += w;
    }
    return { avg, logAvg: Math.exp(logSum / n), clampedAvg: cs / cw };
  }
}
