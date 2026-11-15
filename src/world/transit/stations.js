// Elevated stations: side platforms on cantilever arms, cast-iron columns, gabled canopies with valances,
// windscreens, benches, enamel name boards, clocks, lamps, footbridges + stairways down to both sidewalks.
// Built in "station frame": origin (tram.x, tram.deckY, station.z); the west side is s = -1, the east side s = +1.
import * as THREE from 'three';
import { V3, plate } from './geo.js';

const CREAM = [0.70, 0.63, 0.47], GREEN = [0.045, 0.085, 0.065], WOOD = [0.30, 0.16, 0.075], IRON = [0.035, 0.04, 0.04];
export const PL = 1.30, XI = 3.32, XO = 6.72;

/** print quad facing n (horizontal unit vector), centred at c */
export function signQuad(g, c, n, w, h, rect, fo = [0, 0, 0, 0]) {
  const f = n.clone().negate(), up = V3(0, 1, 0), right = V3().crossVectors(f, up).normalize();
  const P = (a, b) => c.clone().addScaledVector(right, a * w / 2).addScaledVector(up, b * h / 2);
  g.uvRect = rect; g.fo = fo; g.color(1, 1, 1);
  g.quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), n.clone());
  g.uvRect = null; g.fo = null;
}

/** pipe railing from p0 to p1 (same y = floor level) */
function railing(g, p0, p1, { h = 1.08, spacing = 1.3, mids = [0.38, 0.72] } = {}) {
  const len = p0.distanceTo(p1); if (len < 0.05) return; const n = Math.max(1, Math.round(len / spacing));
  for (let i = 0; i <= n; i++) { const p = V3().lerpVectors(p0, p1, i / n); g.box(p.x, p.y + h / 2, p.z, 0.045, h, 0.045, 'b'); }
  const up = y => [p0.clone().setY(p0.y + y), p1.clone().setY(p1.y + y)];
  g.cyl(...up(h), 0.024, 0.024, 6);
  for (const m of mids) g.cyl(...up(m), 0.017, 0.017, 5);
}

/** dagged valance boards hanging below the line pa -> pb (two-sided) */
function valance(g, pa, pb, drop = 0.3, bw = 0.15) {
  const len = pa.distanceTo(pb), n = Math.max(1, Math.round(len / bw));
  for (let i = 0; i < n; i++) {
    const a = V3().lerpVectors(pa, pb, i / n + 0.004), b = V3().lerpVectors(pa, pb, (i + 1) / n - 0.004), m = V3().lerpVectors(a, b, 0.5);
    const a1 = a.clone(), b1 = b.clone(); a1.y -= drop * 0.7; b1.y -= drop * 0.7; m.y -= drop;
    g.tri(a, a1, m); g.tri(a, m, b); g.tri(b, m, b1);
    g.tri(a, m, a1); g.tri(a, b, m); g.tri(b, b1, m);
  }
}

function arcBrace(g, cx, cy, z, R, sx, sy, alongZ = false, w = 0.05) {
  // quarter arc from (cx + sx*R, cy) to (cx, cy + sy*R) in the XY plane (or ZY plane if alongZ: x <- z)
  const P = a => alongZ ? V3(z, cy + sy * Math.sin(a) * R, cx + sx * Math.cos(a) * R) : V3(cx + sx * Math.cos(a) * R, cy + sy * Math.sin(a) * R, z);
  const nrm = alongZ ? V3(1, 0, 0) : V3(0, 0, 1);
  for (let i = 0; i < 6; i++) g.beam(P(i / 6 * Math.PI / 2), P((i + 1) / 6 * Math.PI / 2), 0.014, w, nrm, false);
}
function ring(g, c, r, nrm, w = 0.04) {
  const u = Math.abs(nrm.z) > 0.5 ? V3(1, 0, 0) : V3(0, 0, 1), v = V3(0, 1, 0);
  const P = a => c.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(v, Math.sin(a) * r);
  for (let i = 0; i < 10; i++) g.beam(P(i / 10 * Math.PI * 2), P((i + 1) / 10 * Math.PI * 2), 0.012, w, nrm, false);
}

function bench(S, s, z) {
  const p = S.paint; p.color(...WOOD);
  for (let k = 0; k < 4; k++) p.box(s * (6.08 + k * 0.115), PL + 0.45, z, 0.1, 0.03, 2.0);
  for (let k = 0; k < 3; k++) p.box(s * (6.55 + k * 0.012), PL + 0.6 + k * 0.13, z, 0.03, 0.105, 2.0);
  p.color(...IRON);
  for (const e of [-0.92, 0.92]) {
    p.box(s * 6.3, PL + 0.21, z + e, 0.5, 0.42, 0.035); p.box(s * 6.3, PL + 0.68, z + e, 0.5, 0.035, 0.05);
    p.box(s * 6.585, PL + 0.5, z + e, 0.04, 1.0, 0.05); p.box(s * 6.06, PL + 0.56, z + e, 0.035, 0.26, 0.04);
  }
}

export function globeLamp(ctx, S, world, p, hgt, night = 18, r = 0.17, light = 0.9) {
  const g = S.steel;
  g.lathe(p, [[0.13, 0], [0.13, 0.1], [0.075, 0.2], [0.055, 0.9], [0.045, hgt - 0.3], [0.07, hgt - 0.24], [0.085, hgt - 0.16]], 8);
  const l = S.lamp; l.color(1.0, 0.76, 0.46); l.fo = [0, night, 0, 0];
  l.sphere(V3(p.x, p.y + hgt, p.z), r, 12, 7); l.fo = null;
  const w = V3(p.x, p.y + hgt, p.z).applyMatrix4(world);
  ctx.lights.add({ x: w.x, z: w.z, y: w.y, color: [1.0, 0.68, 0.36], intensity: light, radius: 7.5 });
}

export function buildStation(ctx, S, A, st, idx, bents) {
  const tram = ctx.layout.tram, X = tram.x, Y = tram.deckY, zc = st.z, hz = st.length / 2, yG = ctx.GROUND_Y - Y;
  const M4 = new THREE.Matrix4().makeTranslation(X, Y, zc);
  const all = [S.steel, S.timber, S.paint, S.roof, S.lamp, S.print, S.stone];
  all.forEach(g => { g.matrix(M4); g.color(1, 1, 1); });
  const steel = S.steel, timber = S.timber, paint = S.paint, roof = S.roof, lamp = S.lamp, print = S.print;
  const xm = (XI + XO) / 2, wP = XO - XI, yE = PL + 3.0, yR = yE + 0.86, LEN = 2 * hz;
  const nameRect = A.rect('st' + idx);
  const NC = 9; const colZ = []; for (let i = 0; i < NC; i++) colZ.push(-hz + 1.2 + i * (LEN - 2.4) / (NC - 1));

  for (const s of [-1, 1]) {
    // ---- platform deck + structure ------------------------------------------------------------
    timber.color(0.37, 0.31, 0.24).box(s * xm, PL - 0.03, 0, wP, 0.06, LEN);
    paint.color(0.78, 0.75, 0.64).box(s * (XI + 0.11), PL - 0.027, 0, 0.22, 0.063, LEN + 0.01);
    steel.color(1, 1, 1);
    for (const x of [XI + 0.13, XO - 0.1]) {
      steel.box(s * x, PL - 0.31, 0, 0.02, 0.5, LEN); steel.box(s * x, PL - 0.075, 0, 0.2, 0.03, LEN); steel.box(s * x, PL - 0.545, 0, 0.2, 0.03, LEN);
    }
    for (let z = -hz + 0.6; z < hz; z += 1.15) steel.box(s * xm, PL - 0.15, z, wP - 0.3, 0.16, 0.07, 'ew');
    for (const zb of bents) {
      const rel = zb - zc; if (Math.abs(rel) > hz + 0.3) continue;
      const yT = -1.10;
      plate([[s * 4.42, -1.56], [s * 6.78, -1.40], [s * 6.78, yT - 0.03], [s * 4.42, yT - 0.03]], [], (u, v, d) => V3(u, v, rel + d), -0.012, 0.012, steel, steel, null);
      steel.beam(V3(s * 4.42, -1.58, rel), V3(s * 6.78, -1.42, rel), 0.3, 0.035);
      steel.box(s * 5.6, yT - 0.015, rel, 2.36, 0.03, 0.3);
      steel.box(s * 6.62, (PL - 0.56 + yT) / 2, rel, 0.2, PL - 0.56 - yT, 0.2);
      steel.box(s * 3.46, (PL - 0.56 + yT) / 2, rel, 0.16, PL - 0.56 - yT, 0.16);
      steel.beam(V3(s * 2.56, -3.4, rel), V3(s * 6.2, -1.52, rel), 0.16, 0.2);
    }
    // ---- canopy -------------------------------------------------------------------------------
    for (const z of colZ) {
      steel.color(0.8, 0.86, 0.82);
      steel.lathe(V3(s * 6.3, PL, z), [[0.15, 0], [0.15, 0.07], [0.10, 0.14], [0.088, 0.5], [0.072, 0.57], [0.062, 2.68], [0.078, 2.76], [0.125, 2.85], [0.125, 2.94]], 10);
      steel.color(1, 1, 1);
      steel.box(s * 4.9, yE, z, 4.15, 0.12, 0.07);
      steel.beam(V3(s * 2.85, yE + 0.04, z), V3(s * 4.9, yE + 0.88, z), 0.06, 0.09);
      steel.beam(V3(s * 6.95, yE + 0.04, z), V3(s * 4.9, yE + 0.88, z), 0.06, 0.09);
      steel.box(s * 4.9, yE + 0.45, z, 0.05, 0.8, 0.05);
      const R = 1.3; arcBrace(steel, s * (6.24 - R), yE - 0.06 - R, z, R, s, 1, false, 0.06);
      steel.beam(V3(s * 6.24, yE - 0.06 - R, z), V3(s * (6.24 - R), yE - 0.06, z), 0.05, 0.014, V3(0, 0, 1), false);
      ring(steel, V3(s * (6.24 - 0.36), yE - 0.42, z), 0.2, V3(0, 0, 1), 0.05);
      steel.beam(V3(s * 6.37, yE - 0.55, z), V3(s * 6.93, yE - 0.06, z), 0.05, 0.05, null, false);
      for (const d of [-1, 1]) arcBrace(steel, z + d * 0.75, yE - 0.2 - 0.75, s * 6.3, 0.75, -d, 1, true, 0.05);
    }
    steel.box(s * 6.3, yE - 0.12, 0, 0.08, 0.16, LEN + 0.3);
    steel.box(s * 2.9, yE - 0.02, 0, 0.06, 0.14, LEN + 0.3);
    steel.box(s * 4.9, yE + 0.88, 0, 0.06, 0.12, LEN + 0.3);
    paint.color(...CREAM);
    for (const [xa, ya, xb, yb] of [[2.72, yE + 0.06, 4.9, yE + 0.96], [7.08, yE + 0.06, 4.9, yE + 0.96]]) {
      roof.beam(V3(s * xa, ya, 0), V3(s * xb, yb, 0), LEN + 0.7, 0.045);
      for (const t of [0.33, 0.66]) paint.box(s * (xa + (xb - xa) * t), ya + (yb - ya) * t - 0.06, 0, 0.07, 0.07, LEN + 0.3);
    }
    roof.box(s * 4.9, yE + 0.985, 0, 0.2, 0.05, LEN + 0.72);
    for (const x of [2.74, 7.06]) valance(paint, V3(s * x, yE + 0.04, -hz - 0.34), V3(s * x, yE + 0.04, hz + 0.34));
    for (const zz of [-hz - 0.34, hz + 0.34]) {
      valance(paint, V3(s * 2.74, yE + 0.05, zz), V3(s * 4.9, yE + 0.94, zz), 0.3, 0.15);
      valance(paint, V3(s * 4.9, yE + 0.94, zz), V3(s * 7.06, yE + 0.05, zz), 0.3, 0.15);
    }
    // ---- lamps under the ridge -----------------------------------------------------------------
    for (let i = 0; i < NC - 1; i++) {
      const z = (colZ[i] + colZ[i + 1]) / 2;
      steel.cyl(V3(s * 4.9, yR, z), V3(s * 4.9, yR - 0.5, z), 0.012, 0.012, 5);
      paint.color(...GREEN).lathe(V3(s * 4.9, yR - 0.64, z), [[0.22, 0], [0.12, 0.08], [0.03, 0.15]], 12);
      paint.color(0.8, 0.78, 0.7).cyl(V3(s * 4.9, yR - 0.6, z), V3(s * 4.9, yR - 0.62, z), 0.2, 0.2, 12, true);
      lamp.color(1.0, 0.76, 0.46); lamp.fo = [0, 30, 0, 0]; lamp.sphere(V3(s * 4.9, yR - 0.68, z), 0.085, 10, 6); lamp.fo = null;
      ctx.lights.add({ x: X + s * 4.9, z: zc + z, y: Y + yR - 0.7, color: [1.0, 0.66, 0.34], intensity: 0.95, radius: 8 });
    }
    // ---- back railing / windscreens / benches / boards ------------------------------------------
    const zB = -s * 10, xr = s * 6.67;
    for (let b = 0; b < NC - 1; b++) {
      const za = colZ[b], zb = colZ[b + 1], mid = (za + zb) / 2;
      const hasBridge = zB > za && zB < zb;
      if (hasBridge) {
        railing(steel, V3(xr, PL, za), V3(xr, PL, zB - 0.85)); railing(steel, V3(xr, PL, zB + 0.85), V3(xr, PL, zb));
      } else if (b >= 2 && b <= 5) {
        paint.color(...CREAM).box(xr + s * 0.01, PL + 1.15, mid, 0.05, 2.3, zb - za - 0.16);
        paint.color(...GREEN).box(xr + s * 0.01, PL + 2.33, mid, 0.09, 0.08, zb - za - 0.1).box(xr + s * 0.01, PL + 0.95, mid, 0.075, 0.07, zb - za - 0.1).box(xr + s * 0.01, PL + 0.05, mid, 0.075, 0.1, zb - za - 0.1);
        signQuad(print, V3(xr - s * 0.02, PL + 1.72, mid), V3(-s, 0, 0), 2.8, 0.4, nameRect, [0, 0.5, 0, 0]);
        signQuad(print, V3(xr + s * 0.04, PL + 1.6, mid), V3(s, 0, 0), 3.5, 0.5, nameRect, [0, 0.3, 0, 0]);
        if (b === 2 || b === 5) signQuad(print, V3(xr - s * 0.02, PL + 1.27, mid), V3(-s, 0, 0), 2.8, 0.24, A.rect('line'));
        bench(S, s, mid);
      } else railing(steel, V3(xr, PL, za), V3(xr, PL, zb));
    }
    railing(steel, V3(xr, PL, -hz), V3(xr, PL, colZ[0])); railing(steel, V3(xr, PL, colZ[NC - 1]), V3(xr, PL, hz));
    for (const ze of [-hz, hz]) railing(steel, V3(s * (XI + 0.3), PL, ze), V3(xr, PL, ze));
    // hanging name signs across the platform + clock
    for (const zz of [-13.6, 13.6]) {
      paint.color(...IRON).box(s * 4.75, PL + 2.42, zz, 1.56, 0.27, 0.024);
      for (const d of [-1, 1]) { signQuad(print, V3(s * 4.75, PL + 2.42, zz + d * 0.014), V3(0, 0, d), 1.5, 0.215, nameRect, [0, 0.6, 0, 0]); steel.cyl(V3(s * (4.75 + d * 0.6), PL + 2.55, zz), V3(s * (4.75 + d * 0.6), yE, zz), 0.008, 0.008, 4); }
    }
    const zck = s * 2.9;
    paint.color(...IRON).cyl(V3(s * 4.9, PL + 2.5, zck - 0.09), V3(s * 4.9, PL + 2.5, zck + 0.09), 0.34, 0.34, 18, true);
    steel.cyl(V3(s * 4.9, PL + 2.84, zck), V3(s * 4.9, yR, zck), 0.014, 0.014, 5);
    for (const d of [-1, 1]) signQuad(print, V3(s * 4.9, PL + 2.5, zck + d * 0.095), V3(0, 0, d), 0.47, 0.47, A.rect('clock'), [0, 1.4, 0, 0]);

    // ---- footbridge + stairway down to the sidewalk ---------------------------------------------
    const zd = s, xS = 12.2, wS = 1.6;
    timber.color(0.36, 0.30, 0.23).box(s * 9.0, PL - 0.03, zB, 4.6, 0.06, 1.7);
    timber.box(s * xS, PL - 0.03, zB, 1.8, 0.06, 1.7);
    for (const e of [-0.84, 0.84]) {
      steel.box(s * 9.9, PL - 0.27, zB + e, 6.4, 0.42, 0.02); steel.box(s * 9.9, PL - 0.07, zB + e, 6.4, 0.03, 0.16); steel.box(s * 9.9, PL - 0.48, zB + e, 6.4, 0.03, 0.16);
      railing(steel, V3(s * 6.72, PL, zB + e), V3(s * (e * zd > 0 ? 11.35 : 13.08), PL, zB + e), { spacing: 1.15 });
    }
    railing(steel, V3(s * 13.08, PL, zB - 0.84), V3(s * 13.08, PL, zB + 0.84));
    for (let x = 7.4; x < 13; x += 1.1) steel.box(s * x, PL - 0.2, zB, 0.07, 0.14, 1.66, 'ns');
    for (const x of [11.46, 12.94]) for (const e of [-0.62, 0.62]) steel.box(s * x, (PL - 0.5 + yG) / 2, zB + e, 0.14, PL - 0.5 - yG, 0.14, 'b');
    for (const x of [11.46, 12.94]) { steel.beam(V3(s * x, yG + 0.5, zB - 0.62), V3(s * x, yG + 3.9, zB + 0.62), 0.04, 0.04, null, false); steel.beam(V3(s * x, yG + 3.9, zB - 0.62), V3(s * x, yG + 0.5, zB + 0.62), 0.04, 0.04, null, false); steel.box(s * x, yG + 4.1, zB, 0.08, 0.1, 1.24); }
    const flight = (yTop, zs) => {
      for (let i = 1; i <= 24; i++) { timber.color(0.33, 0.27, 0.2).box(s * xS, yTop - i * 0.17 - 0.02, zs + zd * (i - 0.5) * 0.28, wS - 0.06, 0.04, 0.3); }
      for (const x of [xS - wS / 2, xS + wS / 2]) {
        steel.beam(V3(s * x, yTop - 0.1, zs), V3(s * x, yTop - 4.25 - 0.1, zs + zd * 7.0), 0.02, 0.34);
        steel.cyl(V3(s * x, yTop + 1.0, zs), V3(s * x, yTop - 4.25 + 1.0, zs + zd * 7.0), 0.024, 0.024, 6);
        steel.cyl(V3(s * x, yTop + 0.55, zs), V3(s * x, yTop - 4.25 + 0.55, zs + zd * 7.0), 0.016, 0.016, 5);
        for (let i = 0; i <= 5; i++) { const t = i / 5; steel.box(s * x, yTop - 4.25 * t + 0.45, zs + zd * 7.0 * t, 0.035, 1.1, 0.035, 'b'); }
      }
    };
    const z1 = zB + zd * 0.85; flight(PL, z1);
    const yM = PL - 4.25, zM = z1 + zd * 7.75;
    timber.color(0.36, 0.30, 0.23).box(s * xS, yM - 0.03, zM, 1.8, 0.06, 1.5);
    for (const x of [xS - 0.86, xS + 0.86]) { steel.box(s * x, yM - 0.22, zM, 0.02, 0.34, 1.5); railing(steel, V3(s * x, yM, zM - 0.75), V3(s * x, yM, zM + 0.75), { spacing: 1.5 }); }
    for (const x of [11.46, 12.94]) steel.box(s * x, (yM - 0.4 + yG) / 2, zM, 0.13, yM - 0.4 - yG, 0.13, 'b');
    steel.box(s * xS, yM - 0.34, zM, 1.6, 0.1, 0.1);
    flight(yM, zM + zd * 0.75);
    const zF = zM + zd * 7.75;      // foot of the stairs (street level)
    // entrance canopy + boards + globe lamps
    const yC = yG + 2.75;
    for (const x of [11.25, 13.15]) for (const e of [0.25, 2.75]) steel.box(s * x, yG + 1.375, zF + zd * e, 0.08, 2.75, 0.08, 'b');
    for (const x of [11.25, 13.15]) steel.box(s * x, yC - 0.05, zF + zd * 1.5, 0.07, 0.1, 2.6);
    for (const [xa, xb] of [[10.95, xS], [13.45, xS]]) roof.beam(V3(s * xa, yC + 0.02, zF + zd * 1.5), V3(s * xb, yC + 0.55, zF + zd * 1.5), 3.3, 0.04);
    paint.color(...CREAM);
    for (const x of [10.97, 13.43]) valance(paint, V3(s * x, yC + 0.02, zF + zd * -0.15), V3(s * x, yC + 0.02, zF + zd * 3.15), 0.22, 0.13);
    for (const e of [-0.15, 3.15]) {
      plate([[10.97, yC - 0.02], [13.43, yC - 0.02], [xS, yC + 0.52]].map(p => [s * p[0], p[1]]), [], (u, v, d) => V3(u, v, zF + zd * e + d), -0.015, 0.015, paint, paint, null);
    }
    signQuad(print, V3(s * xS, yC - 0.36, zF + zd * 3.19), V3(0, 0, zd), 1.5, 0.47, A.rect('way'), [0, 0.5, 0, 0]);
    signQuad(print, V3(s * xS, yC - 0.36, zF - zd * 0.19), V3(0, 0, -zd), 1.5, 0.47, A.rect('way'));
    signQuad(print, V3(s * 10.93, yC - 0.3, zF + zd * 1.5), V3(-s, 0, 0), 2.1, 0.3, nameRect, [0, 0.4, 0, 0]);
    paint.color(...IRON).box(s * 10.95, yC - 0.3, zF + zd * 1.5, 0.02, 0.36, 2.2);
    for (const x of [11.0, 13.4]) globeLamp(ctx, S, M4, V3(s * x, yG, zF + zd * 3.3), 2.9, 18, 0.17, 0.9);
    globeLamp(ctx, S, M4, V3(s * 13.02, yM, zM), 2.3, 14, 0.13, 0.5);
    globeLamp(ctx, S, M4, V3(s * 13.02, PL, zB - zd * 0.84), 2.3, 14, 0.13, 0.4);
  }
  all.forEach(g => g.matrix(null));
}
