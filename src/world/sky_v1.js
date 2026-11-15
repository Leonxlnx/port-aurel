// FROZEN REFERENCE COPY of the v1 cloud module (before the "photographic" pass). It is NOT part of the world
// (world.js never loads it); tools/sky2_ab.mjs builds it next to the live module to compare the shader cost
// in one page. Delete src/world/sky_v1.js + src/world/sky_v1/ when that comparison is no longer needed.
// SKY / CLOUDS module: installs the cloud code into the engine's sky dome shader.
//  - cirrus sheet (~9 km) + ray-marched cumulus / stratocumulus shell (1.5-4.2 km), see sky/cloudShader.js
//  - params are plain numbers (sky/presets.js); with params.auto = 1 the time-of-day dependent ones follow the
//    sun elevation (blend of presets golden / sunset / afterglow / night).
// API (returned from build):
//   params                      live values, copied to the shader uniforms in update(t)
//   presets, defaults           named partial parameter sets / the full default set
//   applyParams(overrides)      what main.js calls per still / film frame with the shot's `sky` object:
//                               resets to DEFAULTS + auto-by-elevation, then applies the overrides.
//                               { preset: 'sunset' } pins a preset instead of following the elevation,
//                               { auto: 0 } keeps DEFAULTS (= golden) + overrides at any elevation.
//                               In the interactive demo you can also mutate `params` directly; set params.auto = 0
//                               first, otherwise the preset keys are re-derived whenever the sun elevation changes.
//   update(t), onEnvironment(atm)
//   debugging: index.html?sky=coverage:0.5,cirrus:0   (URL overrides, applied on top of everything)
import * as THREE from 'three';
import { CLOUD_PARS, CLOUD_MAIN } from './sky_v1/cloudShader.js';
import { makeVolumeNoise, makeWeatherNoise, makeSunLUT, fillSunLUT, sunLutKey } from './sky/noise.js';
import { DEFAULTS, PRESETS, autoParams } from './sky_v1/presets.js';

const DEG = Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export async function build(ctx) {
  const { engine, G } = ctx;
  const atm = engine.atmosphere, renderer = engine.renderer;
  const t0 = performance.now();

  const noise = makeVolumeNoise(renderer);
  const weather = makeWeatherNoise(renderer);
  const sunLUT = makeSunLUT(atm.p);
  let lutKey = sunLutKey(atm.p);

  const params = { ...DEFAULTS, ...autoParams(atm.elev) };
  let overrides = {}; let pinned = null;
  const urlOver = {};
  const q = ctx.params && ctx.params.get && ctx.params.get('sky');
  if (q) for (const kv of q.split(',')) { const [k, v] = kv.split(':'); if (k) urlOver[k] = isNaN(Number(v)) ? v : Number(v); }

  const U = {
    uClNoise: { value: noise }, uClWeather: { value: weather }, uClSunLUT: { value: sunLUT },
    uCamPos: G.camPos, uResolution: G.resolution,
    uClOn: { value: 1 }, uClSteps: { value: 20 }, uClQual: { value: new THREE.Vector4(1, 2, 5, 0) },
    uClShape: { value: new THREE.Vector4() }, uClLayer: { value: new THREE.Vector4() }, uClWind: { value: new THREE.Vector4() },
    uClComp: { value: new THREE.Vector4() }, uClComp2: { value: new THREE.Vector4() },
    uClCir: { value: new THREE.Vector4() }, uClCirWind: { value: new THREE.Vector4() }, uClCirBias: { value: new THREE.Vector2(1, 0) },
    uClTw: { value: new THREE.Vector4() }, uClLdir: { value: new THREE.Vector3(0, 1, 0) },
    uClSunE: { value: new THREE.Vector3() }, uClMoonE: { value: new THREE.Vector3() }, uClAmbTint: { value: new THREE.Vector3(1, 1, 1) },
    uClLit: { value: new THREE.Vector4() }, uClLit2: { value: new THREE.Vector4() }, uClCity: { value: new THREE.Vector4() }, uClCityCol: { value: new THREE.Vector3() },
  };
  // debug: index.html?skydbg=1|2|3 shows a cost counter instead of the sky: 3D fetches / 64, 2D fetches / 256, march iterations / 64
  const DBG = Number(ctx.params && ctx.params.get && ctx.params.get('skydbg')) || 0;
  const DBG_GLSL = 'float clN = 0.0, clI = 0.0;\n'
    + 'vec4 clTexL(sampler2D s, vec2 p, float l) { clN += ' + (DBG === 2 ? '1.0 / 256.0' : '0.0') + '; return textureLod(s, p, l); }\n'
    + 'vec4 clTexL(sampler3D s, vec3 p, float l) { clN += ' + (DBG === 1 ? '1.0 / 64.0' : '0.0') + '; return textureLod(s, p, l); }\n'
    + '#define textureLod clTexL\n';
  atm.setCloudHook({
    pars: DBG ? CLOUD_PARS.replace('const float CL_RE', DBG_GLSL + 'const float CL_RE').replace('float F = max(t * pix', 'clI += 1.0 / 64.0; float F = max(t * pix') : CLOUD_PARS,
    main: DBG ? CLOUD_MAIN.replace('clClouds(dir, sdir, cpk, cgx, cgy, ct, col);', 'clClouds(dir, sdir, cpk, cgx, cgy, ct, col); col = vec3(' + (DBG === 3 ? 'clI' : 'clN') + ');') : CLOUD_MAIN,
    uniforms: U,
  });

  const L = ctx.layout, b = L && L.bounds;
  const cityX = b ? (b.x0 + b.x1) * 0.5 : 450, cityZ = b ? (b.z0 + b.z1) * 0.5 : 150;

  let lastElev = null, time = 0;

  // reset: start again from DEFAULTS (used by applyParams so stills never inherit each other's state)
  function resolve(reset = false) {
    lastElev = atm.elev;
    if (reset) Object.assign(params, DEFAULTS, { auto: overrides.auto ?? DEFAULTS.auto });
    if (pinned && PRESETS[pinned]) Object.assign(params, PRESETS[pinned]);
    else if (params.auto) Object.assign(params, autoParams(atm.elev));
    Object.assign(params, urlOver, overrides);
  }

  function apply() {
    const p = params, elev = atm.elev;
    U.uClOn.value = p.enabled ? 1 : 0;
    U.uClSteps.value = Math.max(4, Math.min(48, Math.round(p.steps)));
    U.uClQual.value.set(Math.max(0.25, p.lodBias), Math.round(p.refine), Math.round(p.lightSteps), 0);
    U.uClShape.value.set(p.coverage, p.cumulus, 0.03 * p.density, p.erosion);
    U.uClLayer.value.set(p.base, Math.max(p.top, p.base + 200), 1 / (p.shapeScale * 1000), 1 / (p.detailScale * 1000));
    const wd = p.windDir * DEG, ws = p.windSpeed * time / 1000;
    U.uClWind.value.set(-Math.cos(wd) * ws, -Math.sin(wd) * ws, p.evolve * time * 9.0, -p.evolve * time * 13.0);
    U.uClComp.value.set(p.sunGap, p.gapWidth, p.bars, p.east);
    U.uClComp2.value.set(p.overhead, p.barSpread, p.tallness, p.horizonClear);
    U.uClCir.value.set(p.cirrus, p.cirrusHeight, p.cirrusSide, p.cirrusGain);
    const cd = p.cirrusDir * DEG, cs = p.cirrusSpeed * time / 1000;
    U.uClCirWind.value.set(-Math.cos(cd) * cs, -Math.sin(cd) * cs, Math.cos(cd), Math.sin(cd));
    U.uClCirBias.value.set(Math.cos(p.cirrusSideDir * DEG), Math.sin(p.cirrusSideDir * DEG));
    // key light: the true sun (also below the horizon) until its light has left the deck, then the moon
    const dark = -(2.65 * p.twilightStretch + 1.3);
    const sunW = smooth(dark, dark + 0.6, elev), moonW = smooth(dark, dark - 1.2, elev);
    U.uClTw.value.set(Math.max(1, p.twilightStretch), p.lightAlt, elev * DEG, sunW);
    U.uClLdir.value.copy(sunW > 0 ? atm.sunDir : atm.p.moonDir).normalize();
    const E = atm.p.sunE * p.sunGain;
    U.uClSunE.value.set(E * p.litR, E * p.litG, E * p.litB);
    const M = atm.p.moonE * p.moonGain * moonW, mc = atm.p.moonColor;
    U.uClMoonE.value.set(M * mc[0], M * mc[1], M * mc[2]);
    U.uClAmbTint.value.set(p.ambGain * p.ambR, p.ambGain * p.ambG, p.ambGain * p.ambB);
    U.uClLit.value.set(p.glow, p.haze * 1000, p.powder, p.farShadow);
    U.uClLit2.value.set(p.pink, p.terminator, p.ambBottom, Math.max(0.3, p.banding));
    U.uClCity.value.set(cityX, cityZ, 6000, p.cityGlow * G.night.value);
    U.uClCityCol.value.set(0.012, 0.0068, 0.003);
  }

  function onEnvironment() {
    const k = sunLutKey(atm.p);
    if (k !== lutKey) { lutKey = k; fillSunLUT(sunLUT, atm.p); }
    resolve(); apply();
  }

  function applyParams(o = {}) {
    overrides = { ...o };
    pinned = overrides.preset ?? null; delete overrides.preset;
    resolve(true); apply();
  }

  function update(t) {
    time = t;
    if (lastElev !== atm.elev) resolve();
    apply();
  }

  resolve(); apply();
  console.log(`[app] sky: noise + cloud hook ready in ${Math.round(performance.now() - t0)} ms`);
  return { update, params, presets: PRESETS, defaults: DEFAULTS, applyParams, setPreset: name => applyParams({ preset: name }), onEnvironment, uniforms: U };
}
