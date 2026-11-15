// Timber structures: the long pier, the jetties, mooring piles and dolphins.
import * as THREE from 'three';
import { box, cyl, sphere, torus, M, beam, tubeGeo, catenary, quadGeo } from './geo.js';
import { COL, lampPost, lantern, cleat, lifeRing, bollard } from './quay.js';

const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export function paleTop(yTop, base = COL.tar, band = 0.45) {
  return (x, y, z) => { const k = Math.min(1, Math.max(0, (y - (yTop - band)) / (band * 0.9))); return [base[0] + (COL.pale[0] - base[0]) * k, base[1] + (COL.pale[1] - base[1]) * k, base[2] + (COL.pale[2] - base[2]) * k]; };
}
/** round pile pivoting at the waterline; returns the top position */
export function pile(H, x, z, yTop, r = 0.17, leanX = 0, leanZ = 0, yBot = -4.2, pale = true, moor = false) {
  const T0 = M(x, 0, z, 1, 1, 1, leanX, 0, leanZ), band = pale ? 0.5 : 0;
  const seg = (y0, y1, col) => (H.stats.nPileSeg = (H.stats.nPileSeg || 0) + 1, H.B.add('timber', cyl(16, 1), T0.clone().multiply(M(0, (y0 + y1) / 2, 0, r, y1 - y0, r)), col, 1, 1));
  seg(yBot, yTop - band, COL.tar);
  if (pale) seg(yTop - band, yTop, paleTop(yTop, COL.tar, band));
  const top = new THREE.Vector3(0, yTop, 0).applyMatrix4(M(x, 0, z, 1, 1, 1, leanX, 0, leanZ));
  if (moor) H.moor.push([top.x, top.y - 0.35, top.z]);
  return top;
}
function ropeWrap(H, p, r, n = 3, col = COL.hemp) {
  for (let i = 0; i < n; i++) H.B.add('matte', torus(1, 0.16, 5, 10), M(p.x, p.y - 0.3 - i * 0.055, p.z, r + 0.02, r + 0.02, 0.17, Math.PI / 2, 0, 0), col, 0, 0, [7, 1]);
}
export function bench(H, x, y, z, ry) {
  const R = M(x, y, z, 1, 1, 1, 0, ry, 0), at = (...a) => R.clone().multiply(M(...a)), B = H.B;
  for (const sx of [-0.8, 0.8]) {
    B.add('iron', box(), at(sx, 0.22, 0.02, 0.05, 0.44, 0.46), COL.ironGreen, 0);
    B.add('iron', box(), at(sx, 0.66, -0.2, 0.05, 0.5, 0.05, -0.2, 0, 0), COL.ironGreen, 0);
    B.add('iron', box(), at(sx, 0.6, 0.05, 0.045, 0.04, 0.5), COL.ironGreen, 0);
  }
  const wood = [0.33, 0.24, 0.16];
  for (let i = 0; i < 4; i++) B.add('timber', box(), at(0, 0.46, -0.15 + i * 0.115, 1.8, 0.035, 0.095), mul(wood, 0.9 + 0.2 * ((i * 7) % 3) / 3), 0, 0);
  for (let i = 0; i < 3; i++) B.add('timber', box(), at(0, 0.6 + i * 0.125, -0.215 - i * 0.026, 1.8, 0.1, 0.03, -0.2, 0, 0), mul(wood, 0.95 + 0.15 * (i % 2)), 0, 0);
}

function deckPlanks(H, x0, x1, z0, z1, yFn, R, split = true, base = COL.deck) {
  let x = x0;
  while (x < x1 - 0.05) {
    const w = Math.min(0.17 + R() * 0.06, x1 - x);
    const fresh = R() < 0.05, tone = fresh ? 1.45 : 0.75 + R() * 0.5;
    const col = mul(fresh ? [0.5, 0.42, 0.3] : base, tone);
    const xm = x + w / 2, y = yFn(xm) + (R() - 0.5) * 0.008;
    const slope = Math.atan2(yFn(xm + 0.1) - yFn(xm - 0.1), 0.2);
    const cuts = split ? [z0 - 0.06 - R() * 0.05, z0 + (z1 - z0) * (0.3 + 0.4 * R()), z1 + 0.06 + R() * 0.05] : [z0 - 0.06 - R() * 0.05, z1 + 0.06 + R() * 0.05];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i] + (i ? 0.004 : 0), b = cuts[i + 1];
      H.B.add('timber', box(), M(xm, y - 0.03, (a + b) / 2, w - 0.012, 0.06, b - a, 0, 0, slope + (R() - 0.5) * 0.006), i ? mul(col, 0.92 + R() * 0.16) : col, 0, 2);
    }
    x += w;
  }
}

function buildPier(H) {
  const { B, GY } = H; const P = H.L.harbor.pier; const R = H.rng('harbor-pier');
  const { x0, x1, z0, z1 } = P; const Y = P.deckY; const zc = (z0 + z1) / 2;
  deckPlanks(H, x0, x1 - 0.1, z0, z1, () => Y, R, true);
  // threshold at the quay edge
  B.add('stone', box(), M(x1 - 0.05, Y - 0.1, zc, 0.5, 0.5, z1 - z0), COL.coping, 1, 0);
  // stringers
  for (const z of [z0 + 0.5, z0 + 2.75, zc, z1 - 2.75, z1 - 0.5]) B.add('timber', box(), M((x0 + x1) / 2, Y - 0.06 - 0.15, z, x1 - x0, 0.3, 0.2), COL.tar, 1, 0);
  // bents
  const nb = Math.round((x1 - x0) / 5.6);
  const pz = [z0 + 0.75, zc, z1 - 0.75];
  for (let i = 0; i <= nb; i++) {
    const x = x0 + 0.5 + (x1 - x0 - 1.4) * i / nb;
    B.add('timber', box(), M(x, Y - 0.36 - 0.15, zc, 0.3, 0.3, z1 - z0 + 0.5), COL.tar, 1, 2);
    const tops = pz.map((z, k) => {
      const tall = k === 2 && i % 2 === 0 && i > 0;
      const top = pile(H, x, z + (k === 2 && tall ? 0.42 : 0), tall ? Y + 1.0 + R() * 0.25 : Y - 0.62, 0.17 + R() * 0.02, (R() - 0.5) * 0.03, (R() - 0.5) * 0.03, -4.2, tall, tall);
      if (tall && R() < 0.6) ropeWrap(H, top, 0.17);
      return top;
    });
    // cross bracing (X) across the bent, alternating sides
    const s = i % 2 ? 0.2 : -0.2;
    B.add('timber', box(), beam([x + s, 0.45, pz[0]], [x + s, 1.55, pz[2]], 0.2, 0.07, [1, 0, 0]), COL.tar, 1, 2);
    B.add('timber', box(), beam([x - s, 1.55, pz[0]], [x - s, 0.45, pz[2]], 0.2, 0.07, [1, 0, 0]), COL.tar, 1, 2);
    // longitudinal bracing on some bays
    if (i < nb && i % 3 === 1) {
      const xn = x0 + 0.5 + (x1 - x0 - 1.4) * (i + 1) / nb;
      for (const z of [pz[0] - 0.2, pz[2] + 0.2]) B.add('timber', box(), beam([x, 0.5, z], [xn, 1.5, z], 0.2, 0.07, [0, 0, 1]), COL.tar, 1, 0);
    }
  }
  // north side: painted timber railing
  const white = [0.60, 0.58, 0.52], zr = z0 + 0.14;
  for (let x = x0 + 0.15; x <= x1 - 0.3; x += 2.0) B.add('timber', box(), M(x, Y + 0.55, zr, 0.1, 1.1, 0.1), white, 2, 1);
  B.add('timber', box(), M((x0 + x1) / 2, Y + 1.1, zr, x1 - x0 - 0.2, 0.06, 0.15), white, 2, 0);
  B.add('timber', box(), M((x0 + x1) / 2, Y + 0.72, zr, x1 - x0 - 0.3, 0.09, 0.04), white, 2, 0);
  B.add('timber', box(), M((x0 + x1) / 2, Y + 0.36, zr, x1 - x0 - 0.3, 0.09, 0.04), white, 2, 0);
  // south side: bull rail on blocks, cleats
  const zs = z1 - 0.14;
  for (let x = x0 + 4; x < x1 - 2; x += 11.2) {
    B.add('timber', box(), M(x, Y + 0.19, zs, 8.6, 0.16, 0.16), mul(COL.deck, 0.8), 0, 0);
    for (const dx of [-3.9, 0, 3.9]) B.add('timber', box(), M(x + dx, Y + 0.055, zs, 0.3, 0.11, 0.16), mul(COL.deck, 0.7), 0, 0);
    cleat(H, x + 5.6, Y, zs - 0.1, 0, 1.3);
  }
  // lamp posts along the north side + benches
  for (let x = x1 - 18; x > x0 + 6; x -= 30) {
    lampPost(H, x, Y, z0 + 0.42, 0.95, { intensity: 1.1, radius: 10 });
    bench(H, x - 9, Y, z0 + 0.7, 0);
  }
  bench(H, x0 + 1.2, Y, zc + 2.6, Math.PI / 2);
  // ladder to the water at the head + life ring
  lifeRing(H, x0 + 0.5, Y, z1 - 2.2, Math.PI / 2);
  // --- hut at the pier head
  const hx0 = x0 + 0.5, hx1 = x0 + 4.3, hz0 = z0 + 0.45, hz1 = z0 + 4.45, hh = 2.35, wallC = [0.20, 0.045, 0.035], trim = [0.62, 0.6, 0.54];
  const hxc = (hx0 + hx1) / 2, hzc = (hz0 + hz1) / 2;
  B.add('timber', box(), M(hxc, Y + hh / 2, hzc, hx1 - hx0, hh, hz1 - hz0), wallC, 2, 1);
  // gable ends (ridge along x) + roof
  const ridge = Y + hh + 1.05, ov = 0.4;
  for (const [x, s] of [[hx0, -1], [hx1, 1]]) {
    const a = [x, Y + hh, hz0], b = [x, Y + hh, hz1], c = [x, ridge, hzc];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(s > 0 ? [...b, ...a, ...c] : [...a, ...b, ...c], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2)); g.computeVertexNormals();
    B.add('timber', g, null, wallC, 2, 1);
  }
  const roofC = [0.07, 0.075, 0.08];
  for (const s of [-1, 1]) {
    const ze = s < 0 ? hz0 - ov : hz1 + ov, ye = Y + hh - ov * 1.05 / ((hz1 - hz0) / 2);
    const a = [hx0 - ov, ye, ze], b = [hx1 + ov, ye, ze], c = [hx1 + ov, ridge + 0.03, hzc], d = [hx0 - ov, ridge + 0.03, hzc];
    B.add('iron', s > 0 ? quadGeo(a, b, c, d) : quadGeo(b, a, d, c), null, roofC, 0);
    const dn = 0.07; const off = p => [p[0], p[1] - dn, p[2]];
    B.add('iron', s > 0 ? quadGeo(off(b), off(a), off(d), off(c)) : quadGeo(off(a), off(b), off(c), off(d)), null, mul(roofC, 0.6), 0);
    B.add('timber', box(), M(hxc, ye - 0.02, ze, hx1 - hx0 + 2 * ov, 0.12, 0.04), trim, 2, 0);
  }
  B.add('iron', box(), M(hxc, ridge + 0.04, hzc, hx1 - hx0 + 2 * ov + 0.04, 0.07, 0.16), mul(roofC, 0.8), 0);
  // door (east face), windows (east + south), trim, sign over the door, lamp
  const xe = hx1 + 0.012;
  B.add('timber', box(), M(xe, Y + 1.0, hz0 + 1.0, 0.03, 2.0, 0.9), [0.09, 0.13, 0.12], 2, 1);
  B.add('glass', box(), M(xe, Y + 1.45, hz1 - 1.1, 0.03, 0.8, 1.1), [1.0, 0.62, 0.3], 9, 1);
  for (const [dy, dz, sy, sz] of [[1.45, -1.1 - 0.59, 0.92, 0.07], [1.45, -1.1 + 0.59, 0.92, 0.07], [1.89, -1.1, 0.07, 1.25], [1.01, -1.1, 0.07, 1.25], [1.45, -1.1, 0.8, 0.035]]) B.add('timber', box(), M(xe + 0.015, Y + dy, hz1 + dz, 0.035, sy, sz), trim, 2, 1);
  const zsF = hz1 + 0.012;
  B.add('glass', box(), M(hxc, Y + 1.45, zsF, 1.5, 0.8, 0.03), [1.0, 0.62, 0.3], 9, 1);
  for (const [dx, dy, sx, sy] of [[-0.79, 1.45, 0.07, 0.92], [0.79, 1.45, 0.07, 0.92], [0, 1.89, 1.65, 0.07], [0, 1.01, 1.65, 0.07], [0, 1.45, 0.035, 0.8], [-0.4, 1.45, 0.03, 0.8], [0.4, 1.45, 0.03, 0.8]]) B.add('timber', box(), M(hxc + dx, Y + dy, zsF + 0.015, sx, sy, 0.035), trim, 2, 1);
  for (const [x, z] of [[hx0, hz0], [hx1, hz0], [hx0, hz1], [hx1, hz1]]) B.add('timber', box(), M(x, Y + hh / 2, z, 0.1, hh, 0.1), trim, 2, 1);
  H.signs.push({ name: 'longpier', p: [xe + 0.03, Y + hh + 0.38, hzc], w: 2.4, h: 0.75, ry: Math.PI / 2 });
  B.add('iron', tubeGeo([[xe, Y + 2.2, hz0 + 1.0], [xe + 0.35, Y + 2.3, hz0 + 1.0], [xe + 0.45, Y + 2.2, hz0 + 1.0]], 0.015, 4), null, COL.ironBlack, 0);
  B.add('glass', sphere(28, 18), M(xe + 0.45, Y + 2.12, hz0 + 1.0, 0.09, 0.1, 0.09), COL.lamp, 26, 0);
  H.lamps.push({ x: xe + 0.6, y: Y + 2.1, z: hz0 + 1.0, intensity: 1.0, radius: 7 });
  H.lamps.push({ x: hxc, y: Y + 1.4, z: hz1 + 1.2, intensity: 0.55, radius: 5, color: [1.0, 0.55, 0.25] });
  H.pierHut = { x: hxc, z: hzc, y: Y };
  // sign at the pier root
  H.signPost('ferry', x1 + 1.6, GY, z0 - 1.2, -Math.PI / 2, 2.2, 0.7, 2.6);
}

function buildJetty(H, j, idx) {
  const { B, GY } = H; const R = H.rng('harbor-jetty' + idx);
  const { x0, x1, z0, z1 } = j; const zc = (z0 + z1) / 2, Y = 1.3, ramp = 7.5;
  const yFn = x => x > x1 - ramp ? Y + (GY + 0.06 - Y) * (x - (x1 - ramp)) / ramp : Y;
  deckPlanks(H, x0, x1 - 0.12, z0, z1, yFn, R, false, mul(COL.deck, 0.92));
  for (const z of [z0 + 0.35, zc, z1 - 0.35]) {
    B.add('timber', box(), M((x0 + x1 - ramp) / 2, Y - 0.06 - 0.13, z, x1 - ramp - x0, 0.26, 0.16), COL.tar, 1, 0);
    B.add('timber', box(), beam([x1 - ramp, Y - 0.19, z], [x1, GY - 0.13, z], 0.26, 0.16, [0, 0, 1]), COL.tar, 1, 0);
  }
  const nb = Math.round((x1 - x0) / 4.6);
  for (let i = 0; i <= nb; i++) {
    const x = x0 + 0.4 + (x1 - x0 - 2.2) * i / nb, y = yFn(x);
    B.add('timber', box(), M(x, y - 0.32 - 0.12, zc, 0.24, 0.24, z1 - z0 + 0.5), COL.tar, 1, 2);
    for (const [z, s] of [[z0 + 0.1, -1], [z1 - 0.1, 1]]) {
      const tall = (i + (s > 0 ? 1 : 0)) % 2 === 0 && x < x1 - ramp;
      const top = pile(H, x, z + s * (tall ? 0.28 : 0), tall ? y + 0.95 + R() * 0.3 : y - 0.56, 0.14 + R() * 0.02, (R() - 0.5) * 0.04, (R() - 0.5) * 0.04, -4.2, tall, tall);
      if (tall && R() < 0.5) ropeWrap(H, top, 0.14, 2 + Math.floor(R() * 2));
      if (!tall && x < x1 - ramp) cleat(H, x + 1.1, y, z - s * 0.22, 0, 1.2);
    }
    B.add('timber', box(), beam([x + 0.14, 0.35, z0 + 0.1], [x + 0.14, y - 0.5, z1 - 0.1], 0.16, 0.06, [1, 0, 0]), COL.tar, 1, 2);
  }
  // ramp handrails
  const white = [0.58, 0.56, 0.5];
  for (const z of [z0 + 0.08, z1 - 0.08]) {
    for (let k = 0; k <= 3; k++) { const x = x1 - 0.5 - k * (ramp - 0.6) / 3; B.add('timber', box(), M(x, yFn(x) + 0.5, z, 0.09, 1.0, 0.09), white, 2, 1); }
    B.add('timber', box(), beam([x1 - ramp + 0.05, yFn(x1 - ramp + 0.05) + 1.0, z], [x1 - 0.45, yFn(x1 - 0.45) + 1.0, z], 0.07, 0.12, [0, 0, 1]), white, 2, 0);
  }
  lampPost(H, x0 + 0.5, Y, zc, 0.8, { intensity: 0.9, radius: 9 });
  // edge rubbing strake
  for (const z of [z0 - 0.02, z1 + 0.02]) B.add('timber', box(), M((x0 + x1 - ramp) / 2, Y - 0.14, z, x1 - ramp - x0, 0.16, 0.06), mul(COL.tar, 1.3), 1, 0);
  j.deckY = Y; j.ramp = ramp;
}

function dolphin(H, x, z, R, top = 2.6) {
  const lean = 0.07 + R() * 0.03, r = 0.17, a0 = R() * 6.28;
  let c = null;
  for (let i = 0; i < 3; i++) {
    const a = a0 + i * 2.094, d = 0.19 + (top) * lean;
    const t = pile(H, x + Math.cos(a) * d, z + Math.sin(a) * d, top + (R() - 0.5) * 0.35, r, -Math.sin(a) * lean, Math.cos(a) * lean, -4.4, true, i === 0);
    c = c || t;
  }
  H.B.add('iron', cyl(10, 1, true), M(x, top - 0.55, z, 0.4, 0.09, 0.4), COL.rustSteel, 2);
  H.B.add('matte', torus(1, 0.16, 5, 12), M(x, top - 0.8, z, 0.4, 0.4, 0.2, Math.PI / 2, 0, 0), COL.hemp, 0, 0, [8, 1]);
  H.B.add('matte', torus(1, 0.16, 5, 12), M(x, top - 0.86, z, 0.41, 0.41, 0.2, Math.PI / 2, 0, 0), mul(COL.hemp, 0.8), 0, 0, [8, 1]);
}

export function buildTimber(H) {
  const R = H.rng('harbor-timber');
  buildPier(H);
  H.L.harbor.jetties.forEach((j, i) => buildJetty(H, j, i));
  // free-standing mooring piles beside the jetties (bow lines) and dolphins in the bay
  H.piles = [];
  for (const j of H.L.harbor.jetties) {
    for (const s of [-1, 1]) for (let x = j.x0 + 3; x < j.x1 - 12; x += 11.5) {
      const z = s < 0 ? j.z0 - 6.8 : j.z1 + 6.8, big = R() < 0.25;
      const t = pile(H, x + (R() - 0.5) * 1.5, z + (R() - 0.5) * 0.6, 1.9 + R() * 1.1, 0.15 + R() * 0.03, (R() - 0.5) * (big ? 0.3 : 0.1), (R() - 0.5) * (big ? 0.3 : 0.1), -4.4, true, true);
      H.piles.push([t.x, t.y, t.z]);
      if (R() < 0.4) ropeWrap(H, t, 0.16, 2);
    }
  }
  const dol = [[-207, -180], [-208, -236], [-209, -122], [-203, 322], [-200, 281], [-336, 590.5], [-336, 611.5], [-176, 40], [-178, -20], [-172, 452], [-173, 520], [-171, -338], [-172, -300], [-180, 690], [-176, 720]];
  for (const [x, z] of dol) dolphin(H, x, z, R, 2.2 + R() * 0.9);
  H.dolphins = dol;
  // a few lone leaning piles (remains of an old jetty) south of the pier and north of the yacht jetties
  for (let i = 0; i < 9; i++) pile(H, -163 - i * 4.2 - R() * 1.5, 632 + (i % 2) * 3.2 + R() * 0.6, 0.9 + R() * 1.6, 0.13 + R() * 0.04, (R() - 0.5) * 0.35, (R() - 0.5) * 0.35, -4.3, true, false);
  for (let i = 0; i < 7; i++) pile(H, -160 - i * 3.8 - R() * 1.5, -262 - (i % 2) * 2.8 - R() * 0.6, 0.8 + R() * 1.5, 0.13 + R() * 0.04, (R() - 0.5) * 0.35, (R() - 0.5) * 0.35, -4.3, true, false);
}
