// World assembly: loads the content modules (each owns one file), bakes shared city textures.
// A module is `src/world/<name>.js` exporting `async function build(ctx)` -> { group?, update?(t, engine), ... }.
// Missing or failing modules are skipped so every module can be developed in isolation:
//   index.html?only=buildings,streets     load just these modules
//   index.html?skip=water                 load everything except these
import * as THREE from 'three';
import { G } from '../engine/globals.js';
import { makeMaterial, makeShaderMaterial } from '../engine/materials.js';
import { LAYOUT, mulberry32, hashStr, GROUND_Y } from './layout.js';

export const MODULES = ['sky', 'streets', 'buildings', 'rooftops', 'harbor', 'seascape', 'water', 'transit', 'life'];

/** Collects small local light sources (street lamps, shop fronts...) and bakes them into a top-down light map. */
class CityLights {
  constructor() { this.list = []; }
  /** color: [r,g,b] linear; intensity: radiance scale on a white ground right below (try 0.6..2); radius: pool radius in m; y: lamp height */
  add({ x, z, y = GROUND_Y + 7, color = [1.0, 0.62, 0.30], intensity = 1, radius = 11 }) { this.list.push({ x, z, y, color, intensity, radius }); }
  bake() {
    const m = 60, b = LAYOUT.bounds;
    const rect = { x: b.x0 - 260, z: b.z0 - m, w: (b.x1 - b.x0) + 260 + m, h: (b.z1 - b.z0) + 2 * m };
    const N = 1024; const data = new Float32Array(N * N * 4);
    for (const L of this.list) {
      const cx = (L.x - rect.x) / rect.w * N, cz = (L.z - rect.z) / rect.h * N;
      const rx = L.radius / rect.w * N, rz = L.radius / rect.h * N;
      const x0 = Math.max(0, Math.floor(cx - rx * 2.6)), x1 = Math.min(N - 1, Math.ceil(cx + rx * 2.6));
      const z0 = Math.max(0, Math.floor(cz - rz * 2.6)), z1 = Math.min(N - 1, Math.ceil(cz + rz * 2.6));
      for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) {
        const dx = (i + 0.5 - cx) / rx, dz = (j + 0.5 - cz) / rz; const d2 = dx * dx + dz * dz;
        const w = L.intensity / (1 + 3.2 * d2) * Math.exp(-0.22 * d2);        // bright core, long soft tail
        const k = (j * N + i) * 4;
        data[k] += L.color[0] * w; data[k + 1] += L.color[1] * w; data[k + 2] += L.color[2] * w; data[k + 3] += w;
      }
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
    G.cityLights.value = tex; G.cityLightRect.value.set(rect.x, rect.z, rect.w, rect.h);
    return tex;
  }
}

/** Top-down roof-height map of the city (metres), used for canyon sky visibility in every lit material. */
function bakeCityHeight() {
  const m = 60, b = LAYOUT.bounds;
  const rect = { x: b.x0 - 260, z: b.z0 - m, w: (b.x1 - b.x0) + 260 + m, h: (b.z1 - b.z0) + 2 * m };
  const N = 1024; const data = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = rect.x + (i + 0.5) / N * rect.w, z = rect.z + (j + 0.5) / N * rect.h; data[j * N + i] = LAYOUT.isWater(x, z) ? 0 : GROUND_Y; }
  for (const bd of LAYOUT.buildings) for (const t of bd.tiers) {
    const x0 = bd.x0 + t.inset, x1 = bd.x1 - t.inset, z0 = bd.z0 + t.inset, z1 = bd.z1 - t.inset, y = t.y1 + GROUND_Y;
    const i0 = Math.max(0, Math.round((x0 - rect.x) / rect.w * N)), i1 = Math.min(N, Math.round((x1 - rect.x) / rect.w * N));
    const j0 = Math.max(0, Math.round((z0 - rect.z) / rect.h * N)), j1 = Math.min(N, Math.round((z1 - rect.z) / rect.h * N));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { const k = j * N + i; if (data[k] < y) data[k] = y; }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  G.cityHeight.value = tex; G.cityRect.value.set(rect.x, rect.z, rect.w, rect.h);
}

async function exists(url) {
  try { const r = await fetch('/__exists?p=' + encodeURIComponent(new URL(url).pathname)); if (r.ok) return (await r.json()).ok; } catch {}
  try { const r = await fetch(url, { method: 'HEAD' }); return r.ok; } catch { return false; }
}

export async function createWorld(engine, { params }) {
  const scene = new THREE.Scene();
  const only = params.get('only') ? params.get('only').split(',') : null;
  const skip = params.get('skip') ? params.get('skip').split(',') : [];
  const ctx = {
    engine, scene, layout: LAYOUT, G, THREE, GROUND_Y,
    makeMaterial, makeShaderMaterial,
    rng: name => mulberry32(hashStr(String(name))),
    lights: new CityLights(),
    params,
    modules: {},
  };
  const updates = [];
  for (const name of MODULES) {
    if (only && !only.includes(name)) continue;
    if (skip.includes(name)) continue;
    const url = new URL(`./${name}.js`, import.meta.url).href;
    if (!(await exists(url))) continue;
    const t0 = performance.now();
    try {
      const mod = await import(url);
      const res = (await mod.build(ctx)) || {};
      if (res.group) { res.group.name = res.group.name || name; scene.add(res.group); }
      if (res.update) updates.push(res.update);
      ctx.modules[name] = res;
      console.log(`[app] module ${name}: ${Math.round(performance.now() - t0)} ms`);
    } catch (e) { console.error(`[world] module '${name}' failed: ${e && e.stack || e}`); }
  }
  // fallback ground so isolated modules have something to stand on
  if (!ctx.modules.streets) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(1500, 2100), makeMaterial({ color: 0x4a4c50, roughness: 0.92 }));
    g.rotation.x = -Math.PI / 2; g.position.set(LAYOUT.QUAY_X + 750, GROUND_Y, 60); g.receiveShadow = true; scene.add(g);
  }
  if (!ctx.modules.water) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(30000, 30000), makeMaterial({ color: 0x0b1a22, roughness: 0.12, metalness: 0.0 }));
    w.rotation.x = -Math.PI / 2; w.position.y = 0; scene.add(w);
  }
  ctx.lights.bake();
  if (ctx.modules.buildings) bakeCityHeight();

  let film = null;
  try { if (await exists(new URL('../film/film.js', import.meta.url).href)) film = (await import('../film/film.js')).createFilm({ engine, scene, layout: LAYOUT, modules: ctx.modules }); }
  catch (e) { console.error('[world] film failed: ' + (e && e.stack || e)); }

  return {
    scene, ctx, film, layout: LAYOUT, modules: ctx.modules,
    update(t, eng) { for (const u of updates) u(t, eng); },
    onEnvironment(atm) { for (const k in ctx.modules) if (ctx.modules[k].onEnvironment) ctx.modules[k].onEnvironment(atm); },
    defaultView: { pos: [-330, 9, 330], target: [300, 60, 100], fov: 40 },
    defaultEnv: { elev: 9, az: LAYOUT.SUNSET_AZIMUTH },
  };
}
