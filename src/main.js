// App entry: boots the engine + world. Two modes:
//   interactive demo (default)       : fly camera, time-of-day, progressive accumulation when idle
//   capture (?capture=1)             : no loop; tools drive window.__app.still()/frame()
import * as THREE from 'three';
import { Engine } from './engine/Engine.js';
import { G } from './engine/globals.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
if (CAPTURE) document.body.classList.add('capture');
const canvas = document.getElementById('c');
const log = (...a) => console.log('[app]', ...a);

const W0 = CAPTURE ? parseInt(params.get('w') || '1280') : Math.round(innerWidth * Math.min(devicePixelRatio, 1.5));
const H0 = CAPTURE ? parseInt(params.get('h') || '720') : Math.round(innerHeight * Math.min(devicePixelRatio, 1.5));

const engine = new Engine({ canvas, width: W0, height: H0 });
const worldName = params.get('world') || 'city';
const defaultSettings = JSON.parse(JSON.stringify(engine.settings));

async function loadWorld() {
  if (worldName === 'test') return (await import('./world/testworld.js')).createTestWorld(engine);
  return (await import('./world/world.js')).createWorld(engine, { params });
}

function setDeep(obj, path, value) {
  const ks = path.split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = value;
}

const state = {
  elev: 12, az: 180, ev: 0, t: 0,
  cam: { pos: [60, 14, 620], target: [0, 40, 0], fov: 38, roll: 0, focus: 100, aperture: 0 },
};

function applyCam(cam, c) {
  cam.position.fromArray(c.pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(c.target[0], c.target[1], c.target[2]);
  if (c.roll) cam.rotateZ(c.roll * Math.PI / 180);
  cam.fov = c.fov ?? 40;
  if (c.near) cam.near = c.near; else cam.near = 0.3;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}

/** target key (average scene luminance after exposure) as the light falls: nights should stay dark */
function exposureKey(elev) {
  const keys = [[-14, 0.050], [-9, 0.062], [-6, 0.085], [-3, 0.105], [0, 0.135], [3, 0.165], [6, 0.25], [10, 0.28], [90, 0.30]];
  if (elev <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (elev <= keys[i][0]) { const t = (elev - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]); return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * t; }
  return keys[keys.length - 1][1];
}

let world = null;
const shotExposure = new Map();
let atmSaved = {};

/**
 * Render one image into the canvas.
 * spec: { w,h, spp, cam:{pos,target,fov,roll,focus,aperture}, elev, az, ev, t, shutter (s), seed,
 *         set:{engine.settings overrides}, atm:{atmosphere params}, sky:{cloud params},
 *         shot, time (film shot id + seconds into the shot), exposure (absolute, skips metering) }
 */
async function still(spec = {}) {
  const t0 = performance.now();
  if (spec.w && spec.h) engine.setSize(spec.w, spec.h);
  const film = world.film;
  const sampleFilm = (dt) => (spec.shot != null && film) ? film.sample(spec.shot, (spec.time ?? 0) + dt) : null;
  const frame = sampleFilm(0);

  // settings: defaults <- shot overrides <- explicit overrides
  Object.assign(engine.settings, JSON.parse(JSON.stringify(defaultSettings)));
  if (frame?.set) for (const k in frame.set) setDeep(engine.settings, k, frame.set[k]);
  if (spec.set) for (const k in spec.set) setDeep(engine.settings, k, spec.set[k]);
  let atmDirty = false;
  const atmOver = { ...(frame?.atm || {}), ...(spec.atm || {}) };
  for (const k in atmSaved) { engine.atmosphere.p[k] = atmSaved[k]; atmDirty = true; }      // undo the previous frame's overrides
  atmSaved = {};
  for (const k in atmOver) { atmSaved[k] = JSON.parse(JSON.stringify(engine.atmosphere.p[k])); setDeep(engine.atmosphere.p, k, atmOver[k]); atmDirty = true; }
  const sky = world.modules?.sky;
  if (sky?.params) { const so = { ...(frame?.sky || {}), ...(spec.sky || {}) }; if (sky.defaults) Object.assign(sky.params, sky.defaults); if (sky.applyParams) sky.applyParams(so); else Object.assign(sky.params, so); }
  if (film?.applyFx) film.applyFx(frame?.fx || spec.fx || null);

  const elev = spec.elev ?? frame?.elev ?? state.elev, az = spec.az ?? frame?.az ?? state.az;
  if (atmDirty) engine.atmosphere.setSun(elev, az, { force: true }); else engine.setEnvironment({ sunElevation: elev, sunAzimuth: az });
  const nightOver = spec.night ?? frame?.night;
  if (nightOver != null) G.night.value = nightOver;
  if (world.onEnvironment) world.onEnvironment(engine.atmosphere);

  const cam = engine.camera;
  const c = { ...state.cam, ...(frame?.cam || {}), ...(spec.cam || {}) };
  const spp = spec.spp ?? 8;
  const shutter = spec.shutter ?? 0;
  const t = spec.t ?? frame?.t ?? state.t;
  const tScale = frame?.tScale ?? 1;
  engine.accumBegin(spec.seed ?? Math.round(t * 30));
  for (let i = 0; i < spp; i++) {
    const dt = shutter * ((i + 0.5) / spp);
    let ci = c, ts = t + dt * tScale;
    if (frame && shutter > 0) { const f = sampleFilm(dt); ci = { ...c, ...f.cam, ...(spec.cam || {}) }; ts = spec.t ?? f.t; }
    G.time.value = ts;
    if (world.update) world.update(ts, engine);
    applyCam(cam, ci);
    engine.accumSample(world.scene, cam, { lens: ci.aperture > 0 ? { aperture: ci.aperture, focus: ci.focus } : null, totalSamples: spp });
  }
  const ev = spec.ev ?? frame?.ev ?? state.ev;
  let exposure = spec.exposure ?? frame?.exposure ?? null;
  let meter = null;
  if (exposure == null) {
    // camera-style metering: render once at unit exposure, read the (highlight-clamped) average
    engine.present({ exposure: 1 });
    meter = engine.meter();
    exposure = exposureKey(elev) / Math.max(meter.clampedAvg, 1e-6);
  }
  const exposureBase = exposure;
  exposure *= Math.pow(2, ev) * (frame?.fade ?? 1);
  engine.present({ exposure });
  engine.renderer.getContext().finish();
  return { ms: Math.round(performance.now() - t0), exposure, exposureBase, meter };
}

/** Meter a shot once (at its `meterAt` time) and keep that exposure for all of its frames — like a locked film camera. */
async function lockExposure(id) {
  const film = world.film; const shot = film.shot(id);
  if (shot.exposure != null) { shotExposure.set(shot.id, shot.exposure); return shot.exposure; }
  const w = engine.width, h = engine.height;
  const r = await still({ shot: id, time: shot.meterAt ?? (shot.end - shot.start) * 0.5, spp: 3, w: 640, h: Math.round(640 * h / w), ev: 0 });
  engine.setSize(w, h);
  shotExposure.set(shot.id, r.exposureBase);
  return r.exposureBase;
}

/** Film frame with the shot's locked exposure. */
async function frame(spec) {
  const shot = world.film.shot(spec.shot);
  if (!shotExposure.has(shot.id)) await lockExposure(spec.shot);
  return still({ ...spec, exposure: shotExposure.get(shot.id) });
}

async function save(file, type = 'image/jpeg', quality = 0.93) {
  const blob = await new Promise(r => canvas.toBlob(r, type, quality));
  const res = await fetch('/__save?file=' + encodeURIComponent(file), { method: 'POST', body: blob });
  return res.json();
}

let frameBuf = null;
/** Send the raw RGBA pixels of the canvas to the render tool (rows bottom-up; the encoder flips). */
async function sendFrame() {
  const gl = engine.renderer.getContext(); const w = engine.width, h = engine.height;
  if (!frameBuf || frameBuf.length !== w * h * 4) frameBuf = new Uint8Array(w * h * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, frameBuf);
  const res = await fetch('/__frame', { method: 'POST', body: frameBuf });
  if (!res.ok) throw new Error('frame upload failed: ' + await res.text());
}

const ready = (async () => {
  const t0 = performance.now();
  world = await loadWorld();
  if (world.defaultView) Object.assign(state.cam, world.defaultView);
  if (world.defaultEnv) Object.assign(state, world.defaultEnv);
  engine.setEnvironment({ sunElevation: state.elev, sunAzimuth: state.az });
  log(`world '${worldName}' ready in ${Math.round(performance.now() - t0)} ms`);
  const gl = engine.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  log('gpu: ' + (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a') + ' reversedZ=' + engine.reversed + ' float=' + engine.floatOK);
  return true;
})();

window.__app = { engine, get world() { return world; }, state, still, frame, lockExposure, sendFrame, save, ready, G, THREE, exposureKey, applyCam, defaultSettings, shotExposure };

if (!CAPTURE) {
  ready.then(async () => {
    const { startInteractive } = await import('./interactive.js');
    startInteractive({ engine, world, state, exposureKey, applyCam, still, defaultSettings });
    const l = document.getElementById('load'); l.style.opacity = 0; setTimeout(() => l.remove(), 700);
  }).catch(e => { console.error(e); document.getElementById('load').textContent = 'error: ' + e.message; });
}
