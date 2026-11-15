// "Last Light" — the 60 s film. Cuts sit on the bar grid of the music (123 BPM, bar = 1.951 s).
// A shot: { name, bars:[from,to], elev: n | [a,b] | fn(u), t0 (world clock at shot start), cam(u, s, ctx) -> {pos,target,fov,roll,focus,aperture},
//           ev, fade(u), night(u), set:{engine settings}, sky:{cloud params}, atm:{...}, fx(u) -> {lantern}, meterAt (s), exposure }
import { lerp, smooth, smoother, glide, spline, keys, drift, add3, lerp3, easeOut, easeIn, clamp01 } from './camlib.js';

export const FPS = 30;
// downbeats of the chosen music window (seconds from film start); last entry = end of film
export const BARS = [0, 1.95, 3.9, 5.85, 7.8, 9.75, 11.7, 13.66, 15.61, 17.56, 19.51, 21.46, 23.41, 25.36, 27.31, 29.27, 31.22, 33.17, 35.12, 37.07, 39.02, 40.97, 42.92, 44.88, 46.83, 48.78, 50.73, 52.68, 54.63, 56.58, 58.54, 60.0];
const barTime = b => { const i = Math.floor(b), f = b - i; const t = BARS[i] + (BARS[Math.min(i + 1, BARS.length - 1)] - BARS[i]) * f; return Math.floor(t * FPS + 1e-6) / FPS; };

export function createFilm({ engine, scene, layout, modules }) {
  const L = layout, Y = L.GROUND_Y;
  const transit = modules.transit, roof = modules.rooftops;
  const shake = (c, time, amp, seed) => { const d = drift(time, 1, seed); const k = Math.hypot(c.target[0] - c.pos[0], c.target[1] - c.pos[1], c.target[2] - c.pos[2]) * amp; c.target = [c.target[0] + d[0] * k, c.target[1] + d[1] * k, c.target[2] + d[2] * k]; return c; };
  const CLEAN = { coverage: 0.30, east: 0.08, cumulus: 0.35 };
  const GOLD = { coverage: 0.34, east: 0.14, cumulus: 0.4 };
  const FIRE = { coverage: 0.64, east: 0.3, bars: 1.0, glow: 0.9, cirrus: 0.28 };   // larger warm-bellied forms at sunset
  const DUSK = { coverage: 0.62, east: 0.5, steps: 30, cirrus: 0.45 };

  const SUNSET = { shadowTint: [0.76, 0.93, 1.24], saturation: 1.22, halation: 1.5, halationThresh: 0.9 };   // cool shadows against the warm light
  const NIGHT = { saturation: 1.25, halation: 1.4, halationThresh: 1.0 };
  const DAY = { dust: 0.0015, contrast: 1.46, saturation: 1.2, wb: [0.955, 1.0, 0.99] };                    // clear air, crisp light

  const defs = [
    // ------------------------------------------------------------------ golden hour
    // hook: tight on the tram window (the sun over the canal), then the lens opens to the carriage
    { name: 'tram-inside', bars: [0, 2], elev: 1.8, t0: 13.6, tScale: 0.56, sky: { ...GOLD, cirrus: 0.4 }, ev: 0.25, meterAt: 0.3,
      set: { shadowDistance: 180, dust: 0.0016, fogDensity: 0.00007, bloom: 0.16, ...SUNSET, saturation: 1.45, halation: 1.7, halationThresh: 0.8 }, atm: { sunDiskScale: 1.8 },
      cam: (u, s) => { const wt = 13.6 + s * 0.56; const v = transit ? transit.interiorView(wt, { tram: 'A', car: 1, seatSide: 'east', lookAt: 'west', height: 1.22 }) : { pos: [35.8, 12.15, 152], target: [25.8, 12.37, 152] }; return { pos: v.pos, target: [v.target[0], v.target[1] + 0.25, v.target[2] + lerp(-1.0, 0.5, u)], fov: lerp(34, 44, smooth(clamp01((s - 0.25) / 3.2))), near: 0.08 }; } },
    { name: 'skyline', bars: [2, 3.5], elev: [7.6, 7.3], t0: 60, sky: CLEAN, ev: 0.3, set: { ...DAY },
      cam: (u, s) => shake({ pos: lerp3([-770, 2.2, 530], [-690, 10, 494], glide(u, 0.3)), target: [470, 62, 120], fov: lerp(24.5, 22.8, u) }, s, 0.0005, 2) },
    { name: 'quay', bars: [3.5, 5], elev: 7.0, t0: 20, sky: CLEAN, ev: 0.3, set: { ...DAY },
      cam: (u, s) => { const p = lerp3([-230, 1.9, 316], [-228, 2.2, 290], u); return shake({ pos: p, target: [p[0] + 96, p[1] + 9.5, p[2] - 62], fov: 40 }, s, 0.001, 3); } },
    { name: 'tower-up', bars: [5, 6.5], elev: 6.2, t0: 30, sky: GOLD, ev: 0.2, set: { ...DAY },
      cam: (u, s) => shake({ pos: lerp3([453, 3.3, 130.3], [458, 3.6, 130.8], u), target: lerp3([668, 96, 153], [668, 128, 153], smooth(u)), fov: 47 }, s, 0.0012, 4) },
    { name: 'station', bars: [6.5, 7.5], elev: 4.3, t0: 0.6, sky: GOLD, ev: -0.1, set: { contrast: 1.44, saturation: 1.2 },
      cam: (u, s) => shake({ pos: lerp3([-22, 3.2, 112], [-20.6, 3.25, 111], u), target: [40, 16, 92], fov: 31 }, s, 0.0009, 5) },

    // ------------------------------------------------------------------ sunset
    { name: 'jetty', bars: [7.5, 9], elev: [3.3, 3.1], t0: 6, sky: { coverage: 0.36, east: 0.1, cirrus: 0.28 }, ev: 0.35, set: { ...SUNSET },
      cam: (u, s) => shake({ pos: lerp3([-153.6, 4.3, -141.0], [-156.9, 4.1, -142.1], u), target: [-185, 1.6, -150.5], fov: 45 }, s, 0.0012, 1) },
    { name: 'rooftops', bars: [9, 10], elev: 2.6, t0: 40, sky: { coverage: 0.5, cirrus: 0.28 }, set: { ...SUNSET },
      cam: (u, s) => shake({ pos: lerp3([73.6, 23.6, 71.5], [72.4, 23.8, 73.9], u), target: [30.5, 34.5, 79], fov: 27, focus: 40, aperture: 0.012 }, s, 0.001, 6) },
    { name: 'henge', bars: [10, 12], elev: [1.7, 1.45], t0: 10.6, sky: { coverage: 0.55, cirrus: 0.28 }, set: { ...SUNSET },
      cam: (u, s) => shake({ pos: lerp3([306, 1.35, 153.4], [288, 1.5, 153.2], u), target: [-600, 9, 153], fov: 30 }, s, 0.0007, 8) },
    { name: 'promenade', bars: [12, 13], elev: 1.3, t0: 50, sky: FIRE, set: { ...SUNSET },
      cam: (u, s) => shake({ pos: lerp3([-130.0, Y + 0.34, -27.3], [-131.2, Y + 0.36, -28.3], u), target: [-400, Y + 3.0, 14], fov: 30, focus: 9, aperture: 0.006 }, s, 0.001, 9) },
    { name: 'arch', bars: [13, 14], elev: 1.1, t0: 52, sky: FIRE, set: { ...SUNSET, saturation: 1.25 },
      cam: (u, s) => shake({ pos: lerp3([-93.5, 1.05, 150.6], [-97.5, 1.1, 150.5], u), target: [-200, 4.6, 144.5], fov: 32 }, s, 0.001, 10) },
    { name: 'sun', bars: [14, 16], elev: [0.6, 0.3], t0: 35.3, sky: { coverage: 0.5, cirrus: 0.4 },
      set: { fogDensity: 0.00005, dust: 0.001, ...SUNSET, saturation: 1.2, halation: 3.0, halationThresh: 0.7, bloom: 0.14 }, atm: { sunDiskMax: 90, sunDiskScale: 1.3, mieScale: 1.5 },
      cam: (u, s) => shake({ pos: [-140, 5, 169], target: [-1180, 22.5, 161], fov: lerp(8.5, 7.6, u) }, s, 0.00012, 11) },

    // ------------------------------------------------------------------ afterglow (music breakdown from bar 19): the city waits in the dusk
    { name: 'crown-dusk', bars: [16, 18], elev: [-1.4, -1.9], t0: 70, sky: DUSK, night: [0.06, 0.1], ev: 0.5,
      set: { fogDensity: 0.00006, ...SUNSET },
      cam: (u, s) => shake({ pos: lerp3([792, 243, 196], [786, 246, 176], u), target: [560, 226, 150], fov: 36 }, s, 0.0006, 12) },
    { name: 'pier', bars: [18, 19.5], elev: -2.6, t0: 80, sky: DUSK, night: 0.0, ev: 0.4, set: { ...SUNSET },
      cam: (u, s) => shake({ pos: lerp3([-158, 5.8, 601.3], [-164, 5.9, 601.0], u), target: [-600, 8, 560], fov: 35 }, s, 0.0008, 13) },
    { name: 'lamps-on', bars: [19.5, 22], elev: -3.9, t0: 100, sky: DUSK, meterAt: 4.78, ev: -0.1, set: { ...SUNSET, cityLightGain: 0.38 },
      // dark bridge against the dusk, then the lamps stutter to life on the last four beats before the lift
      night: (u, s) => keys([[0, 0], [0.16, 0], [0.165, 0.5], [0.2, 0.08], [0.33, 0.1], [0.335, 0.62], [0.38, 0.2], [0.5, 0.22], [0.505, 0.7], [0.56, 0.45], [0.66, 0.5], [0.67, 0.82], [1, 0.86]], clamp01((s - 1.933) / 2.933), x => x),
      cam: (u, s) => shake({ pos: lerp3([-66, 2.15, 148.8], [-74, 2.3, 149.3], u), target: [-200, 6, 154], fov: 22 }, s, 0.0005, 15) },

    // ------------------------------------------------------------------ the lift: the city switches on, beat by beat (blue hour)
    { name: 'ignite', bars: [22, 24], elev: -4.4, t0: 110, sky: DUSK, set: { ...NIGHT }, meterAt: 3.3,
      night: (u, s) => keys([[0, 0.42], [0.115, 0.42], [0.19, 0.26], [0.3, 0.3], [0.485, 0.3], [0.5, 0.66], [0.58, 0.5], [0.7, 0.55], [0.975, 0.55], [0.99, 0.88], [1.07, 0.72], [1.2, 0.78], [1.46, 0.78], [1.475, 1.0], [9, 1]], s, x => x),
      fx: (u, s) => ({ lantern: s < 1.95 ? 0.12 : (s < 2.85 ? lerp(3.6, 1.0, easeOut((s - 1.95) / 0.9, 2)) : 1) }),
      cam: (u, s) => shake({ pos: lerp3([-46, 1.55, 153], [-36, 1.7, 153], glide(u, 0.2)), target: [668, 86, 153], fov: 40 }, s, 0.0006, 16) },
    { name: 'windows', bars: [24, 25], elev: -4.6, t0: 120, sky: DUSK, night: [0.45, 1.0], set: { ...NIGHT },
      cam: (u, s) => { const p = lerp3([-235, 1.8, 312], [-234, 1.9, 301], u); return shake({ pos: p, target: [p[0] + 96, p[1] + 10.5, p[2] - 62], fov: 40 }, s, 0.0008, 17); } },
    { name: 'tram-night', bars: [25, 26.5], elev: -5.4, t0: 38.6, sky: DUSK, night: 1, ev: -0.45, set: { ...NIGHT, wb: [0.92, 1.0, 1.12], contrast: 1.48, bloom: 0.06 },
      cam: (u, s) => shake({ pos: lerp3([119, 3.25, 147.2], [114.5, 3.32, 146.9], u), target: [37, 13.5, 153], fov: 29 }, s, 0.0008, 18) },
    { name: 'station-night', bars: [26.5, 28], elev: -3.2, t0: 0.6, sky: DUSK, night: 1, ev: 0.0, set: { ...NIGHT },
      cam: (u, s) => shake({ pos: lerp3([-22, 3.2, 112], [-20.4, 3.3, 111], u), target: [40, 20.5, 92], fov: 24.5, focus: 66, aperture: 0.035 }, s, 0.0008, 19) },
    { name: 'aerial', bars: [28, 29.5], elev: -4.6, t0: 150, sky: DUSK, night: 1, ev: 0.2, set: { nightGlow: [0.04, 0.03, 0.022], cityLightGain: 3.2, ...NIGHT },
      fx: () => ({ lantern: 0.6 }),
      cam: (u, s) => shake({ pos: lerp3([516, 235, 236], [530, 239, 216], glide(u, 0.2)), target: [668, 222, 153], fov: 40 }, s, 0.0004, 21) },
    { name: 'final', bars: [29.5, 31], elev: -4.8, t0: 165, sky: DUSK, night: 1, set: { ...NIGHT },
      fade: (u, s) => 1 - smooth((s - 1.42) / 1.0),
      cam: (u, s) => shake({ pos: lerp3([-572, 9.0, 452], [-576, 9.3, 454], u), target: [500, 62, 100], fov: lerp(27, 25.6, u) }, s, 0.0003, 22) },
  ];

  const shots = defs.map((d, i) => { const start = barTime(d.bars[0]), end = d.bars[1] >= BARS.length - 1 ? BARS[BARS.length - 1] : barTime(d.bars[1]); return { id: i + 1, ...d, start, end, dur: end - start }; });
  const byKey = k => (typeof k === 'number' ? shots.find(s => s.id === k) : shots.find(s => s.name === k || String(s.id) === String(k)));

  // base values of controllable effects (restored when a shot does not drive them)
  const lanternU = roof && roof.lantern && roof.lantern.uniforms ? roof.lantern.uniforms : null;
  const base = lanternU ? { glass: lanternU.uGlass ? lanternU.uGlass.value.z : null, lamp: lanternU.uLampPow ? [lanternU.uLampPow.value.x, lanternU.uLampPow.value.y] : null } : null;
  function applyFx(fx) {
    if (!lanternU || !base) return;
    const k = fx && fx.lantern != null ? fx.lantern : 1;
    if (base.glass != null) lanternU.uGlass.value.z = base.glass * k;
    if (base.lamp) { lanternU.uLampPow.value.x = base.lamp[0] * k; lanternU.uLampPow.value.y = base.lamp[1] * k; }
  }

  function sample(key, local) {
    const s = byKey(key); if (!s) throw new Error('no shot ' + key);
    const u = clamp01(local / s.dur);
    const val = (v, dflt) => v == null ? dflt : (typeof v === 'function' ? v(u, local) : (Array.isArray(v) ? lerp(v[0], v[1], u) : v));
    const out = {
      cam: s.cam(u, local, { modules, layout: L }),
      elev: val(s.elev, 8), az: val(s.az, L.SUNSET_AZIMUTH),
      t: (s.t0 ?? 0) + local * (s.tScale ?? 1), tScale: s.tScale ?? 1,
      ev: val(s.ev, 0), fade: val(s.fade, 1),
      fx: s.fx ? s.fx(u, local) : null,
    };
    if (s.night != null) out.night = val(s.night, 0);
    if (s.set) out.set = s.set;
    if (s.sky) out.sky = typeof s.sky === 'function' ? s.sky(u) : s.sky;
    if (s.atm) out.atm = s.atm;
    if (s.exposure != null) out.exposure = s.exposure;
    return out;
  }
  return {
    fps: FPS, duration: BARS[BARS.length - 1], shots, shot: byKey, sample, applyFx,
    audio: 'out/film/mix.wav',
    /** film time -> { shot, local } */
    at(time) { const s = shots.find(x => time >= x.start && time < x.end) || shots[shots.length - 1]; return { shot: s, local: time - s.start }; },
  };
}
