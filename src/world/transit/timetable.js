// Tram timetable: a closed-form, looping schedule. Everything here is a pure function of time (no state).
// A tram shuttles: north shed -> North Market -> Canal -> South Docks -> south shed on the WEST track (southbound),
// changes track inside the shed (out of sight) and runs back north on the EAST track.
import { LAYOUT } from '../layout.js';

export const DIM = {
  TRACK_OFF: 1.95,        // track centre offset from the viaduct axis (west track = -, east track = +)
  RAIL_TOP: 0.35,         // rail top above layout.tram.deckY
  FLOOR: 0.95,            // car floor above rail top
  CAR_L: 14.7,            // car body length
  GAP: 0.5,               // articulation (bellows) gap
  PITCH: 15.2,            // car centre spacing
  HALF_LEN: 22.55,        // half length of a 3-car set
  PLATFORM: 1.30,         // platform top above deckY (= RAIL_TOP + FLOOR)
};
const ACC = 0.85, DEC = 0.95, VMAX = 11, DWELL = 8, TERM = 18;

function build() {
  const tr = LAYOUT.tram;
  const stations = [...tr.stations].sort((a, b) => a.z - b.z);
  const zN = tr.z0 + 24.5, zS = tr.z1 - 24.5;
  const stops = [zN, ...stations.map(s => s.z), zS];
  const segs = []; let t = 0;
  const push = (dur, z0, v0, a, dir, track, dwell = false) => { segs.push({ t0: t, t1: t + dur, z0, v0, a, dir, track, dwell }); t += dur; };
  const run = (za, zb, track) => {
    const dir = Math.sign(zb - za), d = Math.abs(zb - za);
    let vm = VMAX; if (vm * vm / (2 * ACC) + vm * vm / (2 * DEC) > d) vm = Math.sqrt(2 * d * ACC * DEC / (ACC + DEC));
    const dA = vm * vm / (2 * ACC), dD = vm * vm / (2 * DEC);
    push(vm / ACC, za, 0, dir * ACC, dir, track);
    if (d - dA - dD > 1e-6) push((d - dA - dD) / vm, za + dir * dA, dir * vm, 0, dir, track);
    push(vm / DEC, zb - dir * dD, dir * vm, -dir * DEC, dir, track);
  };
  push(TERM / 2, zN, 0, 0, 1, -1, true);
  for (let i = 0; i < stops.length - 1; i++) { run(stops[i], stops[i + 1], -1); if (i < stops.length - 2) push(DWELL, stops[i + 1], 0, 0, 1, -1, true); }
  push(TERM / 2, zS, 0, 0, 1, -1, true);
  push(TERM / 2, zS, 0, 0, -1, 1, true);
  for (let i = stops.length - 1; i > 0; i--) { run(stops[i], stops[i - 1], 1); if (i > 1) push(DWELL, stops[i - 1], 0, 0, -1, 1, true); }
  push(TERM / 2, zN, 0, 0, -1, 1, true);
  const T = t;
  // acceleration steps (for the hand-strap pendulum response)
  const events = [];
  for (let i = 0; i < segs.length; i++) { const p = segs[(i + segs.length - 1) % segs.length]; const da = segs[i].a - p.a; if (Math.abs(da) > 1e-6) events.push({ t: segs[i].t0, da }); }
  // phase: at t = 0 tram A stands at Canal station (southbound) and leaves 2 s later
  const canal = tr.stations.find(s => s.name === 'Canal') || stations[1];
  const dw = segs.find(s => s.dwell && s.dir === 1 && Math.abs(s.z0 - canal.z) < 0.01);
  const phaseA = dw.t1 - 2;
  // tram B: northbound, its nose reaches the canal span at t = 36 s (so both trams cross the canal within the first minute)
  const zEnter = tr.canalSpan.z1 + DIM.HALF_LEN; let tauB = 0;
  for (const sg of segs) {
    if (sg.dir !== -1 || sg.dwell) continue;
    const zEnd = sg.z0 + sg.v0 * (sg.t1 - sg.t0) + 0.5 * sg.a * (sg.t1 - sg.t0) ** 2;
    if (sg.z0 >= zEnter && zEnd < zEnter) { let lo = sg.t0, hi = sg.t1; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2, dt = m - sg.t0; if (sg.z0 + sg.v0 * dt + 0.5 * sg.a * dt * dt > zEnter) lo = m; else hi = m; } tauB = lo; break; }
  }
  return { segs, T, events, stops, zN, zS, phase: [phaseA, tauB - 36] };
}
export const TT = build();

const mod = (a, n) => ((a % n) + n) % n;
function segAt(tau) {
  const s = TT.segs; let lo = 0, hi = s.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (tau < s[m].t1) hi = m; else lo = m + 1; }
  return s[lo];
}
/** kinematics at cycle time tau: z, v (signed, +z = south), a, dir, track (-1 west, +1 east) */
export function kin(tau) {
  tau = mod(tau, TT.T); const s = segAt(tau); const dt = tau - s.t0;
  return { z: s.z0 + s.v0 * dt + 0.5 * s.a * dt * dt, v: s.v0 + s.a * dt, a: s.a, dir: s.dir, track: s.track, dwell: s.dwell };
}
/** hand-strap swing angle (rad, about the car's X axis; + = toward +z) for cycle time tau: pendulum step responses */
export function strapSwing(tau, omega = 5.6, zeta = 0.42) {
  tau = mod(tau, TT.T);
  let th = -kin(tau).a / 9.81;
  for (const e of TT.events) {
    let dt = tau - e.t; if (dt < 0) dt += TT.T;
    if (dt < 14) th += (e.da / 9.81) * Math.exp(-zeta * dt) * Math.cos(omega * dt);
  }
  return th;
}

/** full state of one tram (id 0 = 'A', 1 = 'B') at time t */
export function tramState(id, t) {
  const tau = t + TT.phase[id];
  const k = kin(tau);
  const aS = (kin(tau + 0.5).v - kin(tau - 0.5).v);                 // smoothed acceleration (1 s box filter)
  const sp = Math.min(1, Math.abs(k.v) / 6);
  const roll = sp * (0.0042 * Math.sin(k.z * 0.21 + id * 1.7) + 0.002 * Math.sin(k.z * 0.67 + 1.3 + id));
  const jp = Math.pow(0.5 + 0.5 * Math.cos(k.z * (2 * Math.PI / 12)), 24);     // rail joint every 12 m
  const bob = sp * (0.003 * Math.sin(k.z * 0.52 + id) + 0.0035 * jp);
  const pitch = -aS * 0.0016;
  const tr = LAYOUT.tram;
  const x = tr.x + k.track * DIM.TRACK_OFF, y = tr.deckY + DIM.RAIL_TOP + bob;
  return { id: id === 0 ? 'A' : 'B', index: id, tau, x, y, z: k.z, dir: k.dir, speed: Math.abs(k.v), v: k.v, accel: aS, track: k.track, dwell: k.dwell, roll, pitch,
    carCenters: [k.z - DIM.PITCH, k.z, k.z + DIM.PITCH] };
}
/** -> [{ id:'A'|'B', z, y, dir (+1 south / -1 north), speed, carCenters:[zNorthCar, zMid, zSouthCar], x, v, accel, track, dwell, roll, pitch }] */
export function trainState(t) { return [tramState(0, t), tramState(1, t)]; }

/** time windows (within one cycle, starting at t >= tFrom) in which tram `id` overlaps z-range [za, zb] */
export function crossings(id, za, zb, tFrom = 0, tTo = TT.T, step = 0.05) {
  const out = []; let open = null;
  for (let t = tFrom; t <= tTo; t += step) {
    const s = tramState(id, t); const inside = s.z + DIM.HALF_LEN > za && s.z - DIM.HALF_LEN < zb;
    if (inside && open == null) open = t;
    if (!inside && open != null) { out.push({ t0: +open.toFixed(2), t1: +t.toFixed(2), dir: tramState(id, (open + t) / 2).dir }); open = null; }
  }
  return out;
}
