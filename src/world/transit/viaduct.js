// Elevated railway structure: instanced deck modules + column bents, the bowstring span over the canal,
// terminus sheds and signals. "Deck frame": x relative to tram.x, y relative to tram.deckY.
import * as THREE from 'three';
import { Geo, V3, plate } from './geo.js';
import { globeLamp } from './stations.js';

const GX = [-2.67, -1.23, 1.23, 2.67];           // longitudinal plate girders (one under each rail)
const Y_CAP_T = -1.10, Y_CAP_B = -2.0;           // cross girder (bent cap)
export const VIA = { GX, Y_CAP_T, Y_CAP_B, COL_X: 2.3 };

/** laced (lattice) member: two flange plates + zig-zag lacing in the two planes perpendicular to n */
export function lacedMember(g, p0, p1, n, depth, width, { lace = 0.05, pitch = 1.0, batten = 0.45 } = {}) {
  const dir = V3().subVectors(p1, p0); const len = dir.length(); dir.normalize();
  const side = V3().crossVectors(n, dir).normalize();
  for (const s of [-1, 1]) {
    const o = side.clone().multiplyScalar(s * width / 2);
    g.beam(p0.clone().add(o), p1.clone().add(o), 0.016, depth, n);                      // flange plate (edge-on in the lacing plane)
  }
  const nb = Math.max(2, Math.round((len - 2 * batten) / (width * pitch)));
  for (const f of [-1, 1]) {
    const off = n.clone().multiplyScalar(f * depth / 2);
    // batten plates at both ends
    for (const e of [0, 1]) {
      const a = p0.clone().addScaledVector(dir, e ? len - batten : 0).add(off), b = a.clone().addScaledVector(dir, batten);
      g.beam(a, b, width, 0.012, n);
    }
    for (let i = 0; i < nb; i++) {
      const t0 = batten + (len - 2 * batten) * (i / nb), t1 = batten + (len - 2 * batten) * ((i + 1) / nb);
      const sgn = (i % 2 ? 1 : -1) * f;
      const a = p0.clone().addScaledVector(dir, t0).addScaledVector(side, sgn * (width / 2 - 0.02)).add(off);
      const b = p0.clone().addScaledVector(dir, t1).addScaledVector(side, -sgn * (width / 2 - 0.02)).add(off);
      g.beam(a, b, lace, 0.008, n, false);
    }
  }
}

function latticeColumn(g, cx, cz, y0, y1, w) {
  const h = w / 2, a = 0.09, t = 0.014, ym = (y0 + y1) / 2, H = y1 - y0;
  g.box(cx, y0 + 0.02, cz, w + 0.28, 0.04, w + 0.28);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.box(cx + sx * (h - t / 2), ym, cz + sz * (h - a / 2), t, H, a);
    g.box(cx + sx * (h - a / 2), ym, cz + sz * (h - t / 2), a, H, t);
  }
  for (const yy of [y0 + 0.27, y1 - 0.25]) {
    g.box(cx, yy, cz + h + 0.006, w, 0.46, 0.012, 'n'); g.box(cx, yy, cz - h - 0.006, w, 0.46, 0.012, 's');
    g.box(cx + h + 0.006, yy, cz, 0.012, 0.46, w, 'w'); g.box(cx - h - 0.006, yy, cz, 0.012, 0.46, w, 'e');
  }
  const n = Math.round((H - 1.0) / 0.44), dy = (H - 1.0) / n;
  for (let i = 0; i < n; i++) {
    const ya = y0 + 0.5 + i * dy, yb = ya + dy, d = i % 2 ? 1 : -1, r = h - 0.035;
    g.beam(V3(cx - d * r, ya, cz + h), V3(cx + d * r, yb, cz + h), 0.055, 0.009, V3(0, 0, 1), false);
    g.beam(V3(cx + d * r, ya, cz - h), V3(cx - d * r, yb, cz - h), 0.055, 0.009, V3(0, 0, 1), false);
    g.beam(V3(cx + h, ya, cz - d * r), V3(cx + h, yb, cz + d * r), 0.055, 0.009, V3(1, 0, 0), false);
    g.beam(V3(cx - h, ya, cz + d * r), V3(cx - h, yb, cz - d * r), 0.055, 0.009, V3(1, 0, 0), false);
  }
}

/** one column bent (two lattice columns, tapered cross girder, arched knee braces), origin on the viaduct axis at deck level */
function bentGeo(groundRel) {
  const g = new Geo(); const yPl = groundRel + 0.55;
  for (const s of [-1, 1]) latticeColumn(g, s * VIA.COL_X, 0, yPl, Y_CAP_B, 0.46);
  // cross girder: centre web box + tapered cantilever ends
  const xe = 4.45, xt = 2.78, yT = Y_CAP_T, yB = Y_CAP_B, yTip = yT - 0.46;
  g.box(0, (yT + yB) / 2, 0, 2 * xt, yT - yB - 0.08, 0.026);
  for (const s of [-1, 1]) {
    plate([[s * xt, yB + 0.04], [s * xe, yTip], [s * xe, yT - 0.04], [s * xt, yT - 0.04]], [], (u, v, d) => V3(u, v, d), -0.013, 0.013, g, g, null);
    g.beam(V3(s * xt, yB + 0.02, 0), V3(s * xe, yTip - 0.02, 0), 0.42, 0.04);
    g.box(s * xe, (yT + yTip) / 2, 0, 0.03, yT - yTip, 0.42);
    for (const x of [1.23, 2.3, 2.67, 3.55]) { const yb = x > xt ? yB + (yTip - yB) * (x - xt) / (xe - xt) + 0.04 : yB + 0.04; g.box(s * x, (yT + yb) / 2, 0, 0.022, yT - yb - 0.06, 0.38); }
    // arched knee brace inside the portal
    const R = 1.2, xc = s * (VIA.COL_X - 0.23), cxA = xc - s * R, cyA = yB - R; const arc = [];
    for (let i = 0; i <= 7; i++) { const a = i / 7 * Math.PI / 2; arc.push([cxA + s * Math.cos(a) * R, cyA + Math.sin(a) * R]); }
    plate([[xc, yB], ...arc], [], (u, v, d) => V3(u, v, d), -0.008, 0.008, g, g, null);
    for (let i = 0; i < 7; i++) g.beam(V3(arc[i][0], arc[i][1], 0), V3(arc[i + 1][0], arc[i + 1][1], 0), 0.014, 0.18, V3(0, 0, 1), false);
  }
  g.box(0, yT - 0.02, 0, 2 * xe, 0.04, 0.42);
  g.box(0, yB + 0.02, 0, 2 * xt, 0.04, 0.42);
  // rainwater downpipe on the east column
  g.cyl(V3(VIA.COL_X + 0.3, yT - 0.5, 0.14), V3(VIA.COL_X + 0.3, yPl + 0.05, 0.14), 0.045, 0.045, 7);
  g.cyl(V3(VIA.COL_X + 0.3, yT - 0.5, 0.14), V3(VIA.COL_X + 0.75, yT - 0.2, 0.14), 0.045, 0.045, 7);
  for (const yy of [yPl + 0.9, (yPl + yB) / 2, yB - 0.5]) g.box(VIA.COL_X + 0.27, yy, 0.14, 0.12, 0.04, 0.12);
  return g;
}

function deckSteelGeo(L) {
  const g = new Geo();
  for (const x of GX) {
    g.box(x, -0.55, L / 2, 0.02, 1.03, L, 'ns');
    g.box(x, -0.0175, L / 2, 0.32, 0.035, L, 'ns');
    g.box(x, -1.0825, L / 2, 0.32, 0.035, L, 'ns');
    for (let i = 0; i < 8; i++) g.box(x, -0.55, (i + 0.5) * L / 8, 0.26, 1.03, 0.022, 'tb');
  }
  for (let i = 0; i < 4; i++) {
    const z = (i + 0.5) * L / 4 + 0.05;
    for (const [xa, xb] of [[-2.67, -1.23], [1.23, 2.67]]) {
      g.beam(V3(xa + 0.02, -0.14, z), V3(xb - 0.02, -0.96, z), 0.07, 0.07, null, false);
      g.beam(V3(xa + 0.02, -0.96, z), V3(xb - 0.02, -0.14, z), 0.07, 0.07, null, false);
    }
    g.beam(V3(-1.21, -0.2, z), V3(1.21, -0.2, z), 0.08, 0.08, null, false);
    g.beam(V3(-1.21, -0.95, z), V3(1.21, -0.95, z), 0.08, 0.08, null, false);
    const z2 = (i + 1.5) * L / 4 + 0.05; const d = i % 2 ? 1 : -1;
    if (i < 3) g.beam(V3(-1.21 * d, -1.0, z), V3(1.21 * d, -1.0, z2), 0.07, 0.07, null, false);
    else g.beam(V3(-1.21 * d, -1.0, z), V3(0, -1.0, L), 0.07, 0.07, null, false);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 8; i++) {
      const z = (i + 0.5) * L / 8;
      g.beam(V3(s * 2.69, -0.10, z), V3(s * 4.2, -0.10, z), 0.07, 0.07, null, false);
      g.beam(V3(s * 2.70, -1.0, z), V3(s * 4.1, -0.13, z), 0.06, 0.06, null, false);
      g.box(s * 4.17, 0.5, z, 0.05, 1.14, 0.05, 'b');
    }
    g.cyl(V3(s * 4.17, 1.06, 0), V3(s * 4.17, 1.06, L), 0.024, 0.024, 6);
    g.cyl(V3(s * 4.17, 0.55, 0), V3(s * 4.17, 0.55, L), 0.02, 0.02, 5);
    g.box(s * 4.2, 0.06, L / 2, 0.016, 0.16, L, 'ns');
    g.cyl(V3(s * 3.02, -0.42, 0), V3(s * 3.02, -0.42, L), 0.055, 0.055, 7);
    g.cyl(V3(s * 3.02, -0.58, 0), V3(s * 3.02, -0.58, L), 0.03, 0.03, 5);
  }
  return g;
}

function deckTimberGeo(L, R) {
  const g = new Geo(); const n = 23;
  for (const s of [-1, 1]) {
    for (let i = 0; i < n; i++) {
      const z = (i + 0.5) * L / n + (R() - 0.5) * 0.03, k = 0.62 + R() * 0.5;
      g.color(0.21 * k, 0.155 * k, 0.11 * k);
      g.box(s * 1.95 + (R() - 0.5) * 0.04, 0.095, z, 2.6, 0.19, 0.22);
    }
    g.color(0.20, 0.15, 0.105).box(s * 3.07, 0.26, L / 2, 0.14, 0.14, L, 'ns');
    for (let k = 1; k < 4; k++) { const t = 0.75 + R() * 0.4; g.color(0.30 * t, 0.25 * t, 0.19 * t); g.box(s * (3.47 + k * 0.2), -0.04, L / 2, 0.185, 0.045, L, 'ns'); }
    g.color(0.36, 0.35, 0.33).box(s * 3.44, 0.02, L / 2, 0.26, 0.17, L, 'ns');           // cable trough
    g.color(0.26, 0.2, 0.14).box(s * 0.81, 0.485, L / 2, 0.17, 0.03, L, 'ns');            // third-rail cover board
    for (let i = 0; i < 6; i++) g.box(s * 0.72, 0.36, (i + 0.5) * L / 6, 0.03, 0.24, 0.1);
  }
  return g;
}

function deckRailGeo(L) {
  const g = new Geo();
  for (const s of [-1, 1]) {
    for (const o of [-0.7175, 0.7175]) {
      const x = s * 1.95 + o;
      g.color(0.0, 0, 0).box(x, 0.20, L / 2, 0.14, 0.02, L, 'ns').box(x, 0.265, L / 2, 0.025, 0.11, L, 'nstb');
      g.color(1, 1, 1).box(x, 0.33, L / 2, 0.068, 0.04, L, 'ns');
      g.color(0, 0, 0).box(x + 0.024, 0.27, 0.0, 0.016, 0.07, 0.5).box(x - 0.024, 0.27, 0.0, 0.016, 0.07, 0.5);
    }
    g.color(0.6, 1, 1).box(s * 0.81, 0.375, L / 2, 0.07, 0.09, L, 'ns');
    g.color(0, 0, 0); for (let i = 0; i < 6; i++) g.box(s * 0.81, 0.26, (i + 0.5) * L / 6, 0.11, 0.14, 0.13);
  }
  return g;
}

/** bowstring arch truss over the canal (world coordinates) */
function buildTruss(S, tram) {
  const g = S.steel; const X = tram.x, z0 = tram.canalSpan.z0, z1 = tram.canalSpan.z1, L = z1 - z0, N = 8;
  const yB = tram.deckY - 1.55, Hc = 9.3, XT = 4.75;
  const hAt = u => Hc * (1 - (2 * u - 1) ** 2);
  const nx = V3(1, 0, 0);
  for (const s of [-1, 1]) {
    const x = X + s * XT;
    g.box(x, yB, (z0 + z1) / 2, 0.5, 0.6, L);
    const M = 24;
    for (let i = 0; i < M; i++) {
      const u0 = i / M, u1 = (i + 1) / M;
      g.beam(V3(x, yB + hAt(u0), z0 + u0 * L), V3(x, yB + hAt(u1), z0 + u1 * L), 0.5, 0.56, null, i === 0 || i === M - 1);
    }
    for (let i = 1; i < N; i++) {
      const u = i / N, zt = z0 + u * L;
      const endNode = i === 1 || i === N - 1;                                         // low nodes at the passengers' eye level: keep them slender
      lacedMember(g, V3(x, yB + 0.3, zt), V3(x, yB + hAt(u) - 0.24, zt), nx, endNode ? 0.22 : 0.36, endNode ? 0.34 : 0.44, { pitch: 1.05, batten: endNode ? 0.2 : 0.45 });
      g.box(x, yB, zt, 0.56, 0.95, 1.2);                                              // bottom gusset
      // top gusset: a pair of thin riveted plates hugging the arch rib (a solid block here sat exactly at the
      // passengers' eye level near the span ends and read as a big dark box sliding past the tram windows)
      if (!endNode) {
        const yc = dz => yB + hAt((zt + dz - z0) / L);
        const gl = 0.62, gw = 0.27, gd = 0.66;
        const poly = [[zt - gl, yc(-gl) - 0.29], [zt - gw, yc(0) - gd], [zt + gw, yc(0) - gd], [zt + gl, yc(gl) - 0.29], [zt + gl, yc(gl) + 0.29], [zt, yc(0) + 0.3], [zt - gl, yc(-gl) + 0.29]];
        for (const e of [-1, 1]) plate(poly, [], (pu, pv, d) => V3(x + e * 0.258 + d, pv, pu), -0.008, 0.008, g, g, g);
      }
    }
    for (let i = 2; i < N - 2; i++) {                                                  // no diagonals in the low end panels (the rib itself braces them)
      const a = i < N / 2 ? i : i + 1, b = i < N / 2 ? i + 1 : i;                    // top node a -> bottom node b (Pratt, mirrored)
      const ua = a / N, ub = b / N;
      const pt = V3(x, yB + hAt(ua) - 0.3, z0 + ua * L), pb = V3(x, yB + 0.3, z0 + ub * L);
      lacedMember(g, pb, pt, nx, 0.3, 0.3, { pitch: 1.3, lace: 0.04 });
    }
    for (const zt of [z0, z1]) { g.box(x, yB - 0.42, zt, 0.75, 0.24, 1.0); g.box(x, yB, zt, 0.58, 0.7, 1.5); }
  }
  // floor beams + bottom laterals
  for (let i = 0; i <= N; i++) {
    const z = z0 + i / N * L;
    g.box(X, tram.deckY - 1.55, z, 2 * XT - 0.5, 0.82, 0.022); g.box(X, tram.deckY - 1.12, z, 2 * XT - 0.5, 0.035, 0.36); g.box(X, tram.deckY - 1.98, z, 2 * XT - 0.5, 0.035, 0.36);
    if (i < N) {
      const zn = z0 + (i + 1) / N * L, y = tram.deckY - 2.05;
      g.beam(V3(X - XT + 0.3, y, z), V3(X + XT - 0.3, y, zn), 0.09, 0.09, null, false);
      g.beam(V3(X + XT - 0.3, y, z), V3(X - XT + 0.3, y, zn), 0.09, 0.09, null, false);
    }
  }
  // top lateral system (only where the arch is high enough to clear the trams) + portal frames
  for (let i = 2; i <= N - 2; i++) {
    const u = i / N, z = z0 + u * L, y = yB + hAt(u) - 0.05;
    const portal = i === 2 || i === N - 2;
    lacedMember(g, V3(X - XT + 0.25, y - (portal ? 0.25 : 0), z), V3(X + XT - 0.25, y - (portal ? 0.25 : 0), z), V3(0, 0, 1), 0.3, portal ? 0.95 : 0.5, { pitch: portal ? 0.8 : 1.2 });
    if (portal) for (const s of [-1, 1]) g.beam(V3(X + s * (XT - 0.2), y - 2.3, z), V3(X + s * (XT - 2.1), y - 0.7, z), 0.12, 0.12, null, false);
    if (i < N - 2) {
      const u2 = (i + 1) / N, zn = z0 + u2 * L, yn = yB + hAt(u2) + 0.05;
      g.beam(V3(X - XT + 0.3, y + 0.1, z), V3(X + XT - 0.3, yn, zn), 0.1, 0.1, null, false);
      g.beam(V3(X + XT - 0.3, y + 0.1, z), V3(X - XT + 0.3, yn, zn), 0.1, 0.1, null, false);
    }
  }
  // masonry piers with corbelled caps
  const st = S.stone; const yTop = yB - 0.54, G = tram.deckY - 7.2;
  for (const zc of [z0, z1]) {
    st.color(1, 1, 1);
    st.box(X, (G + yTop - 0.95) / 2, zc, 6.6, yTop - 0.95 - G, 2.3, 'b');
    st.box(X, G + 0.35, zc, 7.1, 0.7, 2.8, 'b');
    st.color(1.08, 1.06, 1.02).box(X, yTop - 0.72, zc, 8.4, 0.46, 2.6);
    st.box(X, yTop - 0.25, zc, 10.6, 0.5, 2.9);
  }
}

function buildShed(S, tram, za, zb, openDir) {
  const X = tram.x, y0 = tram.deckY - 0.3, yE = tram.deckY + 5.3, yR = tram.deckY + 7.2, W = 4.6, c = S.corr, zm = (za + zb) / 2, L = zb - za;
  c.color(1, 1, 1);
  for (const s of [-1, 1]) {
    c.box(X + s * W, (y0 + yE) / 2, zm, 0.06, yE - y0, L);
    c.beam(V3(X + s * (W + 0.35), yE - 0.14, zm), V3(X, yR, zm), L + 0.5, 0.06);
  }
  const zClosed = openDir > 0 ? za : zb, zOpen = openDir > 0 ? zb : za;
  const m = z => (u, v, d) => V3(X + u, v, z + d);
  plate([[-W, y0], [W, y0], [W, yE], [0, yR - 0.1], [-W, yE]], [], m(zClosed), -0.03, 0.03, c, c, null);
  plate([[-W, tram.deckY + 4.75], [W, tram.deckY + 4.75], [W, yE], [0, yR - 0.1], [-W, yE]], [], m(zOpen), -0.03, 0.03, c, c, null);
  const g = S.steel;
  for (const s of [-1, 1]) g.box(X + s * (W - 0.12), (y0 + yE) / 2, zOpen, 0.22, yE - y0, 0.22);
  g.box(X, tram.deckY + 4.7, zOpen, 2 * W, 0.3, 0.2);
  // clerestory windows along the sides (frosted, faintly lit at night)
  const l = S.lamp, p = S.paint;
  for (const s of [-1, 1]) for (let z = za + 3.2; z < zb - 3; z += 3.4) {
    l.color(0.36, 0.35, 0.30); l.fo = [0, 1.6, 0, 0]; l.box(X + s * (W + 0.03), tram.deckY + 3.3, z, 0.03, 1.6, 2.2); l.fo = null;
    p.color(0.05, 0.07, 0.06);
    for (const e of [-1.1, -0.37, 0.37, 1.1]) p.box(X + s * (W + 0.05), tram.deckY + 3.3, z + e, 0.04, 1.66, 0.05);
    for (const e of [-0.8, 0, 0.8]) p.box(X + s * (W + 0.05), tram.deckY + 3.3 + e, z, 0.04, 0.05, 2.2);
  }
  // dark floor infill so the inside stays black
  c.color(0.25, 0.25, 0.25).box(X, y0 + 0.02, zm, 2 * W, 0.04, L);
}

function buildSignal(S, tram, side, z, facing, aspect) {
  const g = S.steel, X = tram.x + side * 4.42, y = tram.deckY;
  g.box(X - side * 0.1, y - 0.06, z, 0.5, 0.05, 0.5);
  g.cyl(V3(X, y - 0.05, z), V3(X, y + 4.3, z), 0.06, 0.05, 8);
  for (let i = 0; i < 7; i++) g.box(X + side * 0.12, y + 0.5 + i * 0.45, z, 0.18, 0.02, 0.02);
  g.cyl(V3(X + side * 0.21, y + 0.3, z), V3(X + side * 0.21, y + 3.4, z), 0.012, 0.012, 4);
  const p = S.paint; p.color(0.03, 0.03, 0.03);
  const yh = y + 3.75; p.box(X, yh, z + facing * 0.02, 0.62, 1.34, 0.03); p.box(X, yh, z - facing * 0.1, 0.34, 1.05, 0.22);
  const cols = [[1, 0.06, 0.03], [1, 0.55, 0.05], [0.1, 1, 0.35]];
  for (let i = 0; i < 3; i++) {
    const on = i === aspect, yy = yh + (1 - i) * 0.33, c = cols[i];
    const l = S.lamp; l.color(c[0] * (on ? 1 : 0.12), c[1] * (on ? 1 : 0.12), c[2] * (on ? 1 : 0.12)); l.fo = on ? [9, 16, 0, 0] : [0, 0, 0, 0];
    l.cyl(V3(X, yy, z + facing * 0.035), V3(X, yy, z + facing * 0.06), 0.085, 0.07, 10, true); l.fo = null;
    p.box(X, yy + 0.11, z + facing * 0.12, 0.24, 0.02, 0.2);
  }
}

/**
 * Builds the whole fixed structure. S = static geometry collectors (world coords).
 * Returns { instanced: [{geo, mat, matrices}], bents: [z...] }
 */
export function buildViaduct(ctx, S, R) {
  const L = ctx.layout, tram = L.tram, G = ctx.GROUND_Y;
  const span = tram.canalSpan;
  // ---- bent positions -------------------------------------------------------------------------
  let zs = [];
  const nN = Math.round((span.z0 - tram.z0 - 0.6) / 14), nS = Math.round((tram.z1 - 0.6 - span.z1) / 14);
  for (let i = 0; i < nN; i++) zs.push(tram.z0 + 0.6 + (span.z0 - tram.z0 - 0.6) * i / nN);
  for (let i = 1; i <= nS; i++) zs.push(span.z1 + (tram.z1 - 0.6 - span.z1) * i / nS);
  const roads = L.streets.filter(s => s.dir === 'EW' && s.kind === 'street').map(s => [s.z0 + 1.6, s.z1 - 1.6]);
  zs = zs.map(z => { for (const r of roads) if (z > r[0] && z < r[1]) return (z - r[0] < r[1] - z) ? r[0] - 0.3 : r[1] + 0.3; return z; });
  zs = zs.filter(z => z < span.z0 - 6.5 || z > span.z1 + 6.5).sort((a, b) => a - b);
  const bents = []; for (const z of zs) { if (!bents.length || z - bents[bents.length - 1] > 5.5) bents.push(z); }

  // ---- instanced modules (chunked along z so they can be frustum-culled) -------------------------
  const nMod = Math.round((tram.z1 - tram.z0) / 14), Lm = (tram.z1 - tram.z0) / nMod;
  const gBent = bentGeo(G - tram.deckY).build();
  const gDS = deckSteelGeo(Lm).build(), gDT = deckTimberGeo(Lm, R).build(), gDR = deckRailGeo(Lm).build();
  const CH = 6, clen = (tram.z1 - tram.z0) / CH;
  const instanced = [];
  for (let c = 0; c < CH; c++) {
    const za = tram.z0 + c * clen, zb = za + clen;
    const mb = bents.filter(z => z >= za && z < zb).map(z => new THREE.Matrix4().makeTranslation(tram.x, tram.deckY, z));
    const mods = []; for (let i = 0; i < nMod; i++) { const z = tram.z0 + i * Lm; if (z + Lm / 2 >= za && z + Lm / 2 < zb) mods.push(new THREE.Matrix4().makeTranslation(tram.x, tram.deckY, z)); }
    instanced.push({ geo: gBent, mat: 'steel', matrices: mb }, { geo: gDS, mat: 'steel', matrices: mods }, { geo: gDT, mat: 'timber', matrices: mods }, { geo: gDR, mat: 'rail', matrices: mods, noShadow: true });
  }
  // plinths
  S.stone.color(0.95, 0.95, 0.97);
  for (const z of bents) for (const s of [-1, 1]) { S.stone.box(tram.x + s * VIA.COL_X, G + 0.275, z, 0.98, 0.55, 0.98, 'b'); }

  // enamel-shade lamps hanging under every third cross girder (pools of light on the median at night)
  bents.forEach((z, i) => {
    if (i % 3 !== 1) return;
    const y = tram.deckY + Y_CAP_B, X = tram.x;
    S.steel.cyl(V3(X, y, z), V3(X, y - 0.45, z), 0.014, 0.014, 5);
    S.paint.color(0.045, 0.085, 0.065).lathe(V3(X, y - 0.62, z), [[0.3, 0], [0.16, 0.1], [0.04, 0.18]], 12);
    S.paint.color(0.8, 0.78, 0.7).cyl(V3(X, y - 0.585, z), V3(X, y - 0.6, z), 0.27, 0.27, 12, true);
    S.lamp.color(1.0, 0.76, 0.46); S.lamp.fo = [0, 26, 0, 0]; S.lamp.sphere(V3(X, y - 0.66, z), 0.08, 10, 6); S.lamp.fo = null;
    ctx.lights.add({ x: X, z, y: y - 0.7, color: [1.0, 0.66, 0.34], intensity: 1.0, radius: 8.5 });
  });
  buildTruss(S, tram);
  const I4 = new THREE.Matrix4();
  for (const zz of [span.z0 + 0.9, span.z1 - 0.9]) for (const s of [-1, 1]) globeLamp(ctx, S, I4, V3(tram.x + s * 4.75, tram.deckY - 1.25, zz), 4.6, 16, 0.16, 0.5);
  buildShed(S, tram, tram.z0 - 1, tram.z0 + 50, 1);
  buildShed(S, tram, tram.z1 - 50, tram.z1 + 1, -1);

  // signals: southbound (west track) signals stand on the west walkway and face north; northbound on the east facing south
  const sig = [];
  for (const st of tram.stations) { sig.push([-1, st.z - st.length / 2 - 34, -1, 2], [1, st.z + st.length / 2 + 34, 1, 2], [-1, st.z + st.length / 2 + 3, -1, 0], [1, st.z - st.length / 2 - 3, 1, 0]); }
  sig.push([-1, span.z0 - 9, -1, 2], [1, span.z1 + 9, 1, 2]);
  for (const s of sig) buildSignal(S, tram, s[0], s[1], s[2], s[3]);
  return { instanced, bents, Lm };
}
