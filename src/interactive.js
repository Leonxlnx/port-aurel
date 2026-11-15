// Interactive demo: free-fly camera, time of day, film shots, progressive refinement when the view is still.
import * as THREE from 'three';
import { G } from './engine/globals.js';

export function startInteractive({ engine, world, state, exposureKey, applyCam, still, defaultSettings }) {
  const canvas = engine.renderer.domElement;
  const ui = document.getElementById('ui'), hint = document.getElementById('hint');
  const film = world.film;
  hint.innerHTML = 'drag: look · WASD/QE: move · shift: fast · wheel: lens · space: play film';

  // ---- camera state (yaw/pitch fly cam)
  const cam = engine.camera;
  const pos = new THREE.Vector3().fromArray(state.cam.pos);
  const d0 = new THREE.Vector3().fromArray(state.cam.target).sub(pos).normalize();
  let yaw = Math.atan2(d0.x, -d0.z), pitch = Math.asin(d0.y), fov = state.cam.fov || 40;
  const keysDown = new Set(); let dragging = false, dirty = true;
  canvas.addEventListener('pointerdown', e => { dragging = true; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointermove', e => { if (!dragging) return; yaw += e.movementX * 0.0022 * (fov / 40); pitch = Math.max(-1.5, Math.min(1.5, pitch - e.movementY * 0.0022 * (fov / 40))); dirty = true; });
  canvas.addEventListener('wheel', e => { fov = Math.max(4, Math.min(90, fov * (e.deltaY > 0 ? 1.08 : 0.926))); dirty = true; e.preventDefault(); }, { passive: false });
  addEventListener('keydown', e => { keysDown.add(e.code); if (e.code === 'Space') { togglePlay(); e.preventDefault(); } });
  addEventListener('keyup', e => keysDown.delete(e.code));
  addEventListener('resize', () => { engine.setSize(Math.round(innerWidth * scale), Math.round(innerHeight * scale)); dirty = true; });

  // ---- UI
  let scale = Math.min(devicePixelRatio, 1) * 0.75;
  const el = (tag, props = {}, parent = ui) => { const n = document.createElement(tag); Object.assign(n, props); parent.appendChild(n); return n; };
  el('label', { textContent: 'sun' });
  const sun = el('input', { type: 'range', min: -10, max: 30, step: 0.1, value: state.elev });
  const sunVal = el('span', { textContent: state.elev.toFixed(1) + '°' });
  sun.oninput = () => { state.elev = parseFloat(sun.value); sunVal.textContent = state.elev.toFixed(1) + '°'; dirty = true; };
  const shotSel = el('select');
  el('option', { value: '', textContent: 'free camera' }, shotSel);
  if (film) for (const s of film.shots) el('option', { value: s.id, textContent: `${s.id} · ${s.name}` }, shotSel);
  const playBtn = el('button', { textContent: '▶ film' });
  const qSel = el('select');
  [['0.5', 'fast'], ['0.75', 'balanced'], ['1', 'sharp']].forEach(([v, n]) => el('option', { value: v, textContent: n, selected: v === '0.75' }, qSel));
  qSel.onchange = () => { scale = Math.min(devicePixelRatio, 1) * parseFloat(qSel.value); engine.setSize(Math.round(innerWidth * scale), Math.round(innerHeight * scale)); dirty = true; };
  const info = el('span', { textContent: '' }); info.style.opacity = 0.6;
  engine.setSize(Math.round(innerWidth * scale), Math.round(innerHeight * scale));

  // ---- film playback
  let playing = false, filmT0 = 0, audio = null, lockedShot = null, lockedExposure = null;
  if (film && film.audio) { audio = new Audio(film.audio); audio.preload = 'auto'; }
  function togglePlay() {
    if (!film) return;
    playing = !playing; playBtn.textContent = playing ? '■ stop' : '▶ film';
    if (playing) { filmT0 = performance.now() / 1000; if (audio) { audio.currentTime = 0; audio.play().catch(() => {}); } }
    else { if (audio) audio.pause(); dirty = true; }
  }
  playBtn.onclick = togglePlay;
  shotSel.onchange = () => { if (shotSel.value && film) { const f = film.sample(Number(shotSel.value), 0); pos.fromArray(f.cam.pos); const d = new THREE.Vector3().fromArray(f.cam.target).sub(pos).normalize(); yaw = Math.atan2(d.x, -d.z); pitch = Math.asin(d.y); fov = f.cam.fov || 40; state.elev = f.elev; sun.value = f.elev; sunVal.textContent = f.elev.toFixed(1) + '°'; } dirty = true; };

  // ---- loop: 1 sample per frame while moving, keep accumulating (up to 48) when still
  let last = performance.now(), samples = 0, exposure = 0.5, busy = false;
  const clock0 = performance.now() / 1000;
  async function tick(now) {
    requestAnimationFrame(tick);
    if (busy) return; busy = true;
    try {
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (playing) {
        const ft = audio && !audio.paused ? audio.currentTime : performance.now() / 1000 - filmT0;
        if (ft >= film.duration) { togglePlay(); busy = false; return; }
        const { shot, local } = film.at(ft);
        if (lockedShot !== shot.id) { lockedShot = shot.id; const r = await still({ shot: shot.id, time: shot.meterAt ?? (shot.end - shot.start) / 2, spp: 1, ev: 0 }); lockedExposure = r.exposureBase; }
        await still({ shot: shot.id, time: local, spp: 1, exposure: lockedExposure, set: { aoBlur: true } });
        info.textContent = `${ft.toFixed(1)} s · shot ${shot.id}`;
        busy = false; return;
      }
      // fly
      const sp = (keysDown.has('ShiftLeft') ? 60 : 12) * dt;
      const fwd = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
      const mv = new THREE.Vector3();
      if (keysDown.has('KeyW')) mv.add(fwd); if (keysDown.has('KeyS')) mv.sub(fwd);
      if (keysDown.has('KeyD')) mv.add(right); if (keysDown.has('KeyA')) mv.sub(right);
      if (keysDown.has('KeyE')) mv.y += 1; if (keysDown.has('KeyQ')) mv.y -= 1;
      if (mv.lengthSq() > 0) { pos.addScaledVector(mv.normalize(), sp); pos.y = Math.max(0.4, pos.y); dirty = true; }
      const t = performance.now() / 1000 - clock0;
      if (dirty) samples = 0;
      const moving = dirty; dirty = false;
      if (samples < 48) {
        Object.assign(engine.settings, JSON.parse(JSON.stringify(defaultSettings)));
        engine.settings.aoBlur = samples < 4;
        engine.setEnvironment({ sunElevation: state.elev, sunAzimuth: state.az });
        if (world.onEnvironment) world.onEnvironment(engine.atmosphere);
        applyCam(cam, { pos: pos.toArray(), target: pos.clone().add(fwd).toArray(), fov });
        // the world keeps animating only while moving; when still we freeze time so the image can converge
        if (moving || samples === 0) { G.time.value = t; world.update(t, engine); }
        if (samples === 0) engine.accumBegin(Math.floor(t * 30));
        engine.accumSample(world.scene, cam, { jitter: samples > 0 || !moving });
        samples++;
        if (samples === 1 || samples % 8 === 0) { engine.present({ exposure: 1 }); const m = engine.meter(); if (m) exposure += (exposureKey(state.elev) / Math.max(m.clampedAvg, 1e-6) - exposure) * (samples === 1 ? 0.35 : 1); }
        engine.present({ exposure });
        info.textContent = `${engine.width}×${engine.height} · ${samples} spp`;
      }
    } catch (e) { console.error(e); }
    busy = false;
  }
  requestAnimationFrame(tick);
}
