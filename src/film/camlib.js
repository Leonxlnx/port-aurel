// Camera path helpers for the film (all pure functions of u in [0,1]).
export const clamp01 = x => Math.min(1, Math.max(0, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
export const smoother = t => { t = clamp01(t); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeOut = (t, p = 2) => 1 - Math.pow(1 - clamp01(t), p);
export const easeIn = (t, p = 2) => Math.pow(clamp01(t), p);
/** gentle start/stop: mostly linear with eased ends (k = fraction of easing, 0 = linear) */
export const glide = (t, k = 0.25) => { t = clamp01(t); return lerp(t, smooth(t), k); };

/** Catmull-Rom through points (array of [x,y,z]); u in [0,1] */
export function spline(pts, u) {
  const n = pts.length; if (n === 1) return pts[0].slice(); if (n === 2) return lerp3(pts[0], pts[1], u);
  const f = clamp01(u) * (n - 1); const i = Math.min(n - 2, Math.floor(f)); const t = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const a = 2 * p1[k], b = p2[k] - p0[k], c = 2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k], d = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k];
    out[k] = 0.5 * (a + b * t + c * t * t + d * t * t * t);
  }
  return out;
}
/** keyframed scalar: keys [[u, v], ...] ascending, linear or smooth interpolation */
export function keys(k, u, ease = smooth) {
  if (u <= k[0][0]) return k[0][1];
  for (let i = 1; i < k.length; i++) if (u <= k[i][0]) return lerp(k[i - 1][1], k[i][1], ease((u - k[i - 1][0]) / (k[i][0] - k[i - 1][0])));
  return k[k.length - 1][1];
}
/** deterministic organic handheld drift: returns [dx, dy, dz] in metres-ish units scaled by amp */
export function drift(t, amp = 1, seed = 0) {
  const s = seed * 12.9898;
  return [
    amp * (Math.sin(t * 0.83 + s) * 0.6 + Math.sin(t * 1.91 + s * 1.7) * 0.3 + Math.sin(t * 3.7 + s * 0.3) * 0.1),
    amp * (Math.sin(t * 0.71 + s * 2.1) * 0.6 + Math.sin(t * 1.63 + s) * 0.3 + Math.sin(t * 4.1 + s * 1.3) * 0.1),
    amp * (Math.sin(t * 0.57 + s * 0.7) * 0.6 + Math.sin(t * 2.3 + s * 2.9) * 0.4),
  ];
}
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
