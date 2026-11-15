// WATER — bay, canal and basin of Port Aurel: one camera-centred surface at y = 0.
//   waves      : src/world/water/waves.js   (trochoidal components + baked dispersive band textures)
//   mesh       : src/world/water/mesh.js    (world-snapped geometry clipmap + skirt to the horizon)
//   reflection : src/world/water/reflection.js (planar mirror pass, oblique clip, fogged + mip-mapped HDR resolve)
//   shading    : src/world/water/shader.js
import * as THREE from 'three';
import { G, globalUniforms } from '../engine/globals.js';
import { WaterClipmap } from './water/mesh.js';
import { PlanarReflection } from './water/reflection.js';
import { WATER_VERT, WATER_FRAG, NG, NLAY } from './water/shader.js';
import { gerstnerSet, layerSet, bakeBand, WIND, BAND_N } from './water/waves.js';

const TAU = Math.PI * 2;

function bandTexture(bake) {
  const mipmaps = bake.levels.map((data, i) => {
    const s = BAND_N >> i; const hf = new Uint16Array(data.length);
    for (let k = 0; k < data.length; k++) hf[k] = THREE.DataUtils.toHalfFloat(data[k]);
    return { data: hf, width: s, height: s };
  });
  const tex = new THREE.DataTexture(mipmaps[0].data, BAND_N, BAND_N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mipmaps = mipmaps; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}

export async function build(ctx) {
  const { engine, layout } = ctx;
  const qs = ctx.params;
  const num = (k, d) => (qs && qs.has && qs.has(k) ? Number(qs.get(k)) : d);
  const rng = ctx.rng('water');

  // ---- tunables (live: change and the next sample picks them up) -------------------------------------------------
  const params = {
    enabled: true,                          // false hides the water (timing / debugging)
    reflection: num('wrefl', 1) !== 0,      // planar reflection on/off (off: sky only)
    reflScale: num('wreflscale', 0.5),      // reflection resolution relative to the frame
    reflEvery: num('wreflevery', 1),        // render the mirror pass every n-th accumulated sample
    waveScale: num('wwave', 1),             // amplitude of the geometric waves
    ripple: num('wripple', 1),              // slope variance of the fine waves
    sparkle: num('wsparkle', 0.28),         // 0 = smooth highlights, 1 = every glint resolved per sample
    quayAmp: 0.42,                          // wave amplitude left at the quay (open bay = 1)
    wallReflection: 0.6,                    // reflected wave trains near walls
    gustSpeed: 2.4,                         // m/s drift of the cat's paws
    groups: 0.45,                           // wave groups: how much the wave energy shifts between crossing trains (0 = uniform)
    glint: 0.65,                            // share of the unresolved slope variance shown as discrete twinkling sun glints (0 = smooth lobe)
    fleck: 0.35,                            // same for the mirror image (skyline / lamps break into flecks instead of blur)
    glintSize: 1.6,                         // glint cell size in filter widths of a 720-line frame (same look at any resolution)
    twinkle: 9,                             // rad/s: how fast the glints turn over
    slick: 0.7,                             // ripple damping inside surface-film streaks (0 = none)
    filter: 0.75,                           // filter width of the wave normals in pixels (1 = alias-free per sample, lower = crisper wavelets)
    bayColor: [0.010, 0.034, 0.035],        // irradiance reflectance of the water body
    canalColor: [0.028, 0.040, 0.022],
    shallowColor: [0.10, 0.115, 0.08],
    extinction: [0.5, 1.0],                 // per metre: bay, canal
    foamWidth: 0.42, foam: 0.7, wakeFoam: 0.6,
    edgeDark: 0.5,                          // dark contact line where the water meets walls / piles (0 = off)
    autoWakes: true,                        // take the ferry / coaster from the seascape module (modules.seascape.vessels)
    sss: 0.045, sunGain: 1, reflGain: 1, cityLightGain: 1.5,
    tapRoughness: num('wtaprough', 0.85), mipK: num('wmipk', 0.25), alphaMin2: 4e-5,
  };

  engine.settings.water = params;      // lets capture specs / the film tweak water per shot: set: { "water.sparkle": 0.2 }

  // ---- waves ----------------------------------------------------------------------------------------------------------
  const gw = gerstnerSet(rng);
  const layers = layerSet();
  if (gw.length !== NG || layers.length !== NLAY) throw new Error('water: wave table size mismatch');
  const bakeA = bakeBand(rng, { spread: 0.5 });     // wind sea: narrow directional spread
  const bakeB = bakeBand(rng, { spread: 1.05 });    // ripples: broad spread
  const pad10 = a => { const o = new Array(10).fill(0); for (let i = 0; i < Math.min(10, a.length); i++) o[i] = a[i]; return o; };

  const refl = new PlanarReflection(engine, {});

  const uniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    ...globalUniforms(),
    ...refl.uniforms,
    uGA: { value: gw.map(g => new THREE.Vector4(g.dx, g.dz, g.k, g.amp)) },
    uGP: { value: gw.map(() => 0) },
    uGS: { value: gw.map(g => g.grp) },
    uGroup: { value: new THREE.Vector4(0.45, 1.6, 0.5, 0.75) }, uFine: { value: new THREE.Vector4(0.75, 0.3, 0.85, 9) },
    uGrid: { value: new THREE.Vector4() },
    uWaveScale: { value: 1 }, uRipple: { value: 1 }, uAniso: { value: 0.4 },
    uLyA: { value: layers.map(l => new THREE.Vector4(l.cos, l.sin, 1 / l.tile, 0)) },
    uLyB: { value: layers.map(l => new THREE.Vector4(0, l.tex, l.varBay, l.varCanal)) },
    uLyC: { value: layers.map(l => new THREE.Vector4(l.gustBay, l.gustCanal, l.wall, l.offset)) },
    uLyD: { value: layers.map(() => new THREE.Vector4(1, 0, 0, 0)) },
    uRetA: { value: pad10(bakeA.retained) }, uRetB: { value: pad10(bakeB.retained) },
    uBandA: { value: bandTexture(bakeA) }, uBandB: { value: bandTexture(bakeB) },
    uCanal: { value: new THREE.Vector4(layout.canal.z0, layout.canal.z1, layout.QUAY_X, layout.canal.x1) },
    uBasin: { value: new THREE.Vector4(layout.basin.x0, layout.basin.x1, layout.basin.z0, layout.basin.z1) },
    uBW: { value: new THREE.Vector4(layout.harbor.breakwater.x0, layout.harbor.breakwater.z0, layout.harbor.breakwater.x1, layout.harbor.breakwater.z1) },
    uWind: { value: new THREE.Vector2(WIND[0], WIND[1]) },
    uQuayAmp: { value: 0.42 }, uWallRefl: { value: 0.6 },
    uBayColor: { value: new THREE.Vector3() }, uCanalColor: { value: new THREE.Vector3() }, uShallowColor: { value: new THREE.Vector3() },
    uExt: { value: new THREE.Vector2() }, uFoam: { value: new THREE.Vector3() },
    uOptics: { value: new THREE.Vector4() }, uLobe: { value: new THREE.Vector4() },
    uWake: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uWakeB: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uWakeC: { value: [new THREE.Vector4(), new THREE.Vector4()] },
  };
  const defines = { ...engine.defines, NTAP: Math.max(1, Math.min(8, Math.round(num('wtaps', 4)))) };
  const mkMat = extra => new THREE.ShaderMaterial({
    uniforms, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, defines: { ...defines, ...extra },
    lights: true, toneMapped: false, side: THREE.FrontSide, depthWrite: true, depthTest: true, transparent: false,
  });
  const material = mkMat({}); const skirtMaterial = mkMat({ SKIRT: 1 });
  material.name = 'water'; skirtMaterial.name = 'waterSkirt';

  const clip = new WaterClipmap({ M: 160, levels: 7, cell0: 0.125, material, skirtMaterial });
  const group = clip.group; group.name = 'water';
  group.traverse(o => { if (o.isMesh) o.renderOrder = 800; });       // after the other opaque geometry, before the sky dome
  uniforms.uGrid.value.set(clip.morph[0], clip.morph[1], clip.q, clip.cell0);

  const stats = { reflMs: 0, reflRendered: false, triangles: clip.triangles };

  function syncParams() {
    uniforms.uWaveScale.value = params.waveScale; uniforms.uRipple.value = params.ripple; uniforms.uAniso.value = params.sparkle;
    uniforms.uQuayAmp.value = params.quayAmp; uniforms.uWallRefl.value = params.wallReflection;
    uniforms.uBayColor.value.fromArray(params.bayColor); uniforms.uCanalColor.value.fromArray(params.canalColor); uniforms.uShallowColor.value.fromArray(params.shallowColor);
    uniforms.uExt.value.fromArray(params.extinction);
    uniforms.uFoam.value.set(params.foamWidth, params.foam, params.wakeFoam);
    uniforms.uOptics.value.set(params.sss, params.sunGain, params.reflGain, params.cityLightGain);
    uniforms.uLobe.value.set(params.tapRoughness, params.mipK, params.alphaMin2, params.gustSpeed);
    uniforms.uGroup.value.set(params.groups, params.glintSize, params.edgeDark, params.filter);
    uniforms.uFine.value.set(Math.min(Math.max(params.glint, 0), 0.97), Math.min(Math.max(params.fleck, 0), 0.97), params.slick, params.twinkle);
  }
  function syncTime(t) {
    const gp = uniforms.uGP.value;
    for (let i = 0; i < NG; i++) gp[i] = (gw[i].omega * t + gw[i].phase) % TAU;
    const ld = uniforms.uLyD.value;
    for (let i = 0; i < NLAY; i++) {
      const l = layers[i]; const ph = (l.omegaHalf * t) % TAU; const drift = (l.vg * t / l.tile) % 1;
      ld[i].set(Math.cos(ph), Math.sin(ph), drift, 0);
    }
  }
  syncParams(); syncTime(0);

  // ---- per accumulated sample: place the grid around the final camera and render the mirror pass ---------------------
  const camPos = new THREE.Vector3();
  engine.hooks.beforeSample.push((eng, scene, camera, i) => {
    group.visible = params.enabled !== false;
    if (!group.parent || !group.visible) { uniforms.uReflOn.value = 0; return; }
    syncParams(); syncTime(G.time.value);
    if (params.autoWakes) {
      const sea = ctx.modules && ctx.modules.seascape;
      if (sea && sea.vessels) {
        const list = sea.vessels(G.time.value); let slot = 0;
        for (const v of list) {
          if (slot > 1) break;
          if (v.kind !== 'ferry' && v.kind !== 'cargo') continue;
          const hl = Math.hypot(v.heading[0], v.heading[1]) || 1, hx = v.heading[0] / hl, hz = v.heading[1] / hl;
          const k = Math.min(1, v.speed / 4.5);
          // origin at the bow: the churned strip is hidden under the hull and emerges at the stern
          if (k > 0.02) api.setWake(slot, { x: v.x + hx * v.length * 0.5, z: v.z + hz * v.length * 0.5, hx, hz, speed: Math.max(v.speed, 1), beam: v.beam * 0.8, length: 70 + 32 * v.speed, strength: k, hull: v.length });
          else api.clearWake(slot);
          slot++;
        }
      }
    }
    camPos.setFromMatrixPosition(camera.matrixWorld);
    clip.place(camPos.x, camPos.y, camPos.z);
    group.updateMatrixWorld(true);
    if (!params.reflection || camPos.y <= 0.02) { uniforms.uReflOn.value = 0; stats.reflRendered = false; return; }
    const every = Math.max(1, Math.round(params.reflEvery));
    if (i % every !== 0 && refl.rtRes && uniforms.uReflOn.value > 0.5) return;       // reuse the previous mirror image
    refl.setSize(eng.width * params.reflScale, eng.height * params.reflScale);
    const t0 = performance.now();
    stats.reflRendered = refl.render(scene, camera, [group]);
    stats.reflMs = performance.now() - t0;
  });

  const api = {
    group, params, uniforms, stats, reflection: refl, clipmap: clip,
    update() {},
    /**
     * Foam wake + Kelvin arms behind a moving hull (slot 0 or 1). Call every update with the hull's current state:
     * x, z: position of the BOW (m), hx, hz: heading (direction of travel), speed (m/s), beam (m), length of the wake (m),
     * strength 0..1, hull: hull length (m; the foam lane starts at the stern).
     */
    setWake(slot, { x, z, hx, hz, speed = 5, beam = 7, length = 160, strength = 1, hull = 30 }) {
      const l = Math.hypot(hx, hz) || 1;
      uniforms.uWake.value[slot].set(x, z, hx / l, hz / l); uniforms.uWakeB.value[slot].set(speed, beam, length, strength);
      uniforms.uWakeC.value[slot].set(hull, 0, 0, 0);
    },
    clearWake(slot) { uniforms.uWakeB.value[slot].set(0, 0, 0, 0); },
  };
  return api;
}
