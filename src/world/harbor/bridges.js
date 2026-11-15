// Canal bridges: stone arch bridges (voussoirs, cutwaters, parapets / balustrade, lamp standards) and riveted iron arch bridges.
// All bridges span the canal along Z (z0..z1) and are x0..x1 wide.
import * as THREE from 'three';
import { box, cyl, sphere, torus, lathe, M, beam, polyGeo, quadGeo, stripGeo, HEX_FACES } from './geo.js';
import { COL, lantern, lampPost, candelabra } from './quay.js';

const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** sweep a 2D profile [[x,y]...] (CCW seen from +z) along z samples; y offset by yFn(z). Flat shading per profile edge. */
function sweep(H, mat, profile, zs, yFn, color, kind = 0, param = 0, closed = true) {
  const n = profile.length, lim = closed ? n : n - 1;
  for (let e = 0; e < lim; e++) {
    const a = profile[e], b = profile[(e + 1) % n];
    const A = zs.map(z => [a[0], a[1] + yFn(z), z]), Bp = zs.map(z => [b[0], b[1] + yFn(z), z]);
    H.B.add(mat, stripGeo(A, Bp, true, p => [p[2], 0]), null, color, kind, param);
  }
}
const range = (a, b, step) => { const n = Math.max(1, Math.round((b - a) / step)); return Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n); };

const BALUSTER = [[0.075, 0], [0.075, 0.05], [0.045, 0.08], [0.085, 0.24], [0.06, 0.40], [0.04, 0.50], [0.06, 0.56], [0.07, 0.60]];

function stoneBridge(H, br, o) {
  const { GY, B } = H; const { x0, x1, z0, z1 } = br; const zc = (z0 + z1) / 2, half = (z1 - z0) / 2;
  const hump = o.hump, tint = o.tint || COL.lime, light = mul(tint, 1.2);
  const deckY = z => GY + hump * 0.5 * (1 + Math.cos(Math.PI * Math.min(1, Math.abs(z - zc) / half)));
  br.deckY = deckY;
  const ys = 0.22, ringT = 0.42;
  const R = H.rng('bridge-' + br.id);
  // spans / piers
  const arches = []; const piers = []; let z = z0;
  o.spans.forEach((sp, i) => { arches.push({ za: z, zb: z + sp }); z += sp; if (i < o.spans.length - 1) { piers.push({ za: z, zb: z + o.pier }); z += o.pier; } });
  for (const a of arches) {
    a.c = (a.za + a.zb) / 2; a.a = (a.zb - a.za) / 2;
    a.rise = Math.min(deckY(a.c) - 0.6 - ys, a.a * 0.98);
    a.R = (a.a * a.a + a.rise * a.rise) / (2 * a.rise); a.yc = ys + a.rise - a.R;
    a.y = zz => a.yc + Math.sqrt(Math.max(0, a.R * a.R - (zz - a.c) * (zz - a.c)));
  }
  // --- faces (both sides), intrados
  for (const [xf, sgn] of [[x0, -1], [x1, 1]]) {
    for (const a of arches) {
      const zs = range(a.za, a.zb, 0.45);
      const lo = zs.map(zz => [xf, a.y(zz), zz]), hi = zs.map(zz => [xf, deckY(zz) + 0.02, zz]);
      B.add('stone', stripGeo(lo, hi, sgn > 0), null, tint, 0, 0.72);          // spandrel
      // voussoirs
      const th0 = Math.asin(Math.min(1, a.a / a.R));
      let nv = Math.max(5, Math.round(2 * th0 * a.R / 0.4)); if (nv % 2 === 0) nv++;
      for (let j = 0; j < nv; j++) {
        const key = j === (nv - 1) / 2;
        const ta = -th0 + 2 * th0 * j / nv + 0.004, tb = -th0 + 2 * th0 * (j + 1) / nv - 0.004;
        const r0 = a.R - 0.015, r1 = a.R + ringT + (key ? 0.2 : (R() - 0.5) * 0.03), out = key ? 0.11 : 0.05 + R() * 0.012;
        const xa = xf + sgn * out, xb = xf - sgn * 0.3;
        const P = (th, r, x) => [x, a.yc + Math.cos(th) * r, a.c + Math.sin(th) * r];
        let v = [P(ta, r0, xa), P(tb, r0, xa), P(tb, r0, xb), P(ta, r0, xb), P(ta, r1, xa), P(tb, r1, xa), P(tb, r1, xb), P(ta, r1, xb)];
        if (key) { const w = 0.05; v[4] = P(ta - w / r1, r1, xa); v[5] = P(tb + w / r1, r1, xa); v[6] = P(tb + w / r1, r1, xb); v[7] = P(ta - w / r1, r1, xb); }
        const g = polyGeo(v, sgn > 0 ? HEX_FACES.map(f => [...f].reverse()) : HEX_FACES);
        B.add('stone', g, null, mul(light, 0.88 + R() * 0.22), 1, 0);
      }
    }
    for (const p of piers) {
      B.add('stone', sgn > 0 ? quadGeo([xf, -4, p.zb], [xf, -4, p.za], [xf, deckY(p.za), p.za], [xf, deckY(p.zb), p.zb]) : quadGeo([xf, -4, p.za], [xf, -4, p.zb], [xf, deckY(p.zb), p.zb], [xf, deckY(p.za), p.za]), null, tint, 0, 0.72);
      // cutwater (pointed), sloped cap, pilaster above
      const zm = (p.za + p.zb) / 2, ex = xf + sgn * 1.25, yt = ys + 0.55, hw = (p.zb - p.za) / 2 + 0.12;
      const v = [[xf, -4, zm - hw], [ex, -4, zm], [xf, -4, zm + hw], [xf, yt, zm - hw], [ex, yt, zm], [xf, yt, zm + hw], [xf, yt + 0.75, zm]];
      const f = sgn < 0 ? [[0, 1, 4, 3], [1, 2, 5, 4], [3, 4, 6], [4, 5, 6]] : [[1, 0, 3, 4], [2, 1, 4, 5], [4, 3, 6], [5, 4, 6]];
      B.add('stone', polyGeo(v, f.slice(0, 2)), null, tint, 0);
      B.add('stone', polyGeo(v, f.slice(2)), null, light, 1, 0);
      B.add('stone', box(), M(xf + sgn * 0.09, (yt + 0.2 + deckY(zm)) / 2, zm, 0.2, deckY(zm) - yt - 0.2, hw * 2 - 0.5), mul(light, 0.95), 0, 0.5);
    }
    // string course at deck level + parapet / balustrade
    const zs = range(z0, z1, 0.9);
    const xo = xf + sgn * 0.1, xi = xf - sgn * 0.42;
    const prof = (pts) => sgn < 0 ? pts : pts.map(p => [x0 + x1 - p[0], p[1]]).reverse();
    sweep(H, 'stone', prof([[x0 - 0.1, -0.12], [x0 + 0.02, -0.12], [x0 + 0.02, 0.06], [x0 - 0.1, 0.06]]), zs, deckY, light, 1, 0.9);
    if (o.balustrade) {
      sweep(H, 'stone', prof([[x0 - 0.04, 0.0], [x0 + 0.44, 0.0], [x0 + 0.44, 0.2], [x0 - 0.04, 0.2]]), zs, deckY, light, 1, 0);
      sweep(H, 'stone', prof([[x0 - 0.06, 0.82], [x0 + 0.46, 0.82], [x0 + 0.46, 0.94], [x0 + 0.4, 0.99], [x0, 0.99], [x0 - 0.06, 0.94]]), zs, deckY, light, 1, 1.3);
      // dies (solid blocks) over piers and at regular intervals; balusters in between
      const dies = [z0 + 0.5, z1 - 0.5]; for (const p of piers) dies.push((p.za + p.zb) / 2);
      for (const a of arches) dies.push(a.c);
      dies.sort((a, b) => a - b);
      const xm = xf - sgn * 0.2;
      for (const d of dies) B.add('stone', box(), M(xm, deckY(d) + 0.51, d, 0.44, 0.62, 0.62), light, 1, 0);
      for (let i = 0; i < dies.length - 1; i++) {
        const a = dies[i] + 0.31, b = dies[i + 1] - 0.31; const n = Math.round((b - a) / 0.27);
        for (let k = 0; k < n; k++) { const zz = a + (b - a) * (k + 0.5) / n; B.add('stone', lathe('baluster', BALUSTER, 6), M(xm, deckY(zz) + 0.2, zz, 1.25, 1.04, 1.25), mul(light, 0.95 + R() * 0.1), 1, 0); }
      }
    } else {
      sweep(H, 'stone', prof([[x0, 0.0], [x0 + 0.4, 0.0], [x0 + 0.4, 0.9], [x0, 0.9]]), zs, deckY, tint, 0, 0.6);
      sweep(H, 'stone', prof([[x0 - 0.06, 0.9], [x0 + 0.46, 0.9], [x0 + 0.46, 1.0], [x0 + 0.33, 1.07], [x0 + 0.07, 1.07], [x0 - 0.06, 1.0]]), zs, deckY, light, 1, 1.1);
    }
    // pedestals with lamp standards: both ends + over each pier
    const peds = [[z0 - 0.1, 0.95], [z1 + 0.1, 0.95]]; for (const p of piers) peds.push([(p.za + p.zb) / 2, 0.8]);
    for (const [pz, w] of peds) {
      const px = xf - sgn * 0.14, y = deckY(pz);
      B.add('stone', box(), M(px, y + 0.6 - 0.2, pz, w, 1.6, w), tint, 0, 0.5);
      B.add('stone', box(), M(px, y + 1.26, pz, w + 0.14, 0.12, w + 0.14), light, 1, 0);
      B.add('stone', cyl(4, 0.45), M(px, y + 1.4, pz, (w + 0.02) * 0.7, 0.16, (w + 0.02) * 0.7, 0, Math.PI / 4, 0), light, 1, 0);
      (o.balustrade ? candelabra : lampPost)(H, px, y + 1.44, pz, o.lampScale || 0.66, { intensity: o.balustrade ? 0.8 : 0.6, radius: 9 });
    }
  }
  // --- intrados barrels and pier flanks under the arches
  for (const a of arches) {
    const zs = range(a.za, a.zb, 0.45);
    B.add('stone', stripGeo(zs.map(zz => [x0, a.y(zz), zz]), zs.map(zz => [x1, a.y(zz), zz]), true), null, mul(tint, 0.9), 0, 0.72);
  }
  for (const p of piers) {
    B.add('stone', quadGeo([x1, -4, p.za], [x0, -4, p.za], [x0, ys + 0.05, p.za], [x1, ys + 0.05, p.za]), null, tint, 0);
    B.add('stone', quadGeo([x0, -4, p.zb], [x1, -4, p.zb], [x1, ys + 0.05, p.zb], [x0, ys + 0.05, p.zb]), null, tint, 0);
  }
  // --- deck
  const zs = range(z0, z1, 0.9);
  const xa = x0 + 0.4, xb = x1 - 0.4, sw = o.sidewalk || 0;
  const strip = (xl, xr, dy, color, kind) => B.add('stone', stripGeo(zs.map(zz => [xl, deckY(zz) + dy, zz]), zs.map(zz => [xr, deckY(zz) + dy, zz]), false), null, color, kind);
  if (sw > 0) {
    strip(xa, xa + sw, 0.14, COL.tread, 3); strip(xb - sw, xb, 0.14, COL.tread, 3);
    strip(xa + sw, xb - sw, 0.0, [0.16, 0.155, 0.15], 2);
    for (const [xk, s] of [[xa + sw, 1], [xb - sw, -1]]) B.add('stone', stripGeo(zs.map(zz => [xk, deckY(zz), zz]), zs.map(zz => [xk, deckY(zz) + 0.14, zz]), s > 0), null, COL.coping, 1, 0);
  } else strip(xa, xb, 0.0, mul(COL.tread, 1.05), 3);
}

function ironBridge(H, br, o) {
  const { GY, B } = H; const { x0, x1, z0, z1 } = br; const zc = (z0 + z1) / 2;
  const paint = o.paint; br.deckY = () => GY;
  const R = H.rng('bridge-' + br.id);
  const za = z0 + 0.35, zb = z1 - 0.35, a = (zb - za) / 2, ys = 0.38, crown = GY - 0.62, rise = crown - ys;
  const RR = (a * a + rise * rise) / (2 * rise), yc = ys + rise - RR;
  const arcY = z => yc + Math.sqrt(Math.max(0, RR * RR - (z - zc) * (z - zc)));
  const yU = GY - 0.34;       // underside of the deck
  // deck: slab, road + sidewalks
  B.add('iron', box(), M((x0 + x1) / 2, GY - 0.19, zc, x1 - x0, 0.3, z1 - z0), mul(paint, 0.8), 0);
  const sw = o.sidewalk;
  B.add('stone', quadGeo([x0 + sw, GY, z1], [x1 - sw, GY, z1], [x1 - sw, GY, z0], [x0 + sw, GY, z0]), null, [0.085, 0.085, 0.09], 4);
  for (const [xl, xr, xk, s] of [[x0, x0 + sw, x0 + sw, 1], [x1 - sw, x1, x1 - sw, -1]]) {
    B.add('stone', quadGeo([xl, GY + 0.14, z1], [xr, GY + 0.14, z1], [xr, GY + 0.14, z0], [xl, GY + 0.14, z0]), null, COL.tread, 3);
    B.add('stone', s < 0 ? quadGeo([xk, GY, z0], [xk, GY, z1], [xk, GY + 0.14, z1], [xk, GY + 0.14, z0]) : quadGeo([xk, GY, z1], [xk, GY, z0], [xk, GY + 0.14, z0], [xk, GY + 0.14, z1]), null, COL.coping, 1, 0);
  }
  // stone bearing shelves at both abutments
  for (const [zs0, zs1] of [[z0, z0 + 0.6], [z1 - 0.6, z1]]) B.add('stone', box(), M((x0 + x1) / 2, (ys - 4) / 2, (zs0 + zs1) / 2, x1 - x0 + 0.6, ys + 4, 0.6 + 0.001), COL.limeLight, 1, 0);
  // ribs
  const nRib = Math.max(3, Math.round((x1 - x0) / 2.7) + 1);
  const zs = range(za, zb, 0.8);
  for (let i = 0; i < nRib; i++) {
    const fascia = i === 0 || i === nRib - 1;
    const x = x0 + 0.12 + (x1 - x0 - 0.24) * i / (nRib - 1);
    const fw = 0.16;
    // bottom flange following the arc (riveted strip, top + bottom faces + edges)
    const uvA = (p, k, side) => [p[2], side ? fw : -fw];
    const lo = zs.map(zz => [x - fw, arcY(zz) - 0.04, zz]), lo2 = zs.map(zz => [x + fw, arcY(zz) - 0.04, zz]);
    const up = zs.map(zz => [x - fw, arcY(zz), zz]), up2 = zs.map(zz => [x + fw, arcY(zz), zz]);
    B.add('iron', stripGeo(lo, lo2, true, uvA), null, paint, 1, fw);
    B.add('iron', stripGeo(up, up2, false, uvA), null, paint, 1, fw);
    B.add('iron', stripGeo(lo, up, false), null, paint, 0); B.add('iron', stripGeo(lo2, up2, true), null, paint, 0);
    // top chord under the deck
    B.add('iron', box(), M(x, yU - 0.03, zc, fw * 2, 0.06, zb - za), paint, 0);
    if (!fascia) {
      // solid web plate
      const wA = zs.map(zz => [x, arcY(zz), zz]), wB = zs.map(zz => [x, yU, zz]);
      B.add('iron', stripGeo(wA, wB, false), null, mul(paint, 0.9), 0); B.add('iron', stripGeo(wA, wB, true), null, mul(paint, 0.9), 0);
    } else {
      // open spandrel: verticals + rings shrinking toward the crown
      const sgn = i === 0 ? -1 : 1;
      const bay = 1.3, nb = Math.round((zb - za) / bay);
      for (let k = 0; k <= nb; k++) {
        const zz = za + (zb - za) * k / nb, h = yU - arcY(zz);
        if (h > 0.08) B.add('iron', box(), M(x, arcY(zz) + h / 2, zz, 0.09, h, 0.07), paint, 0);
        if (k < nb) {
          const zm = zz + (zb - za) / nb / 2, hm = yU - 0.06 - arcY(zm), r = Math.min((zb - za) / nb, hm) / 2 - 0.045;
          if (r > 0.1) B.add('iron', new THREE.TorusGeometry(r, 0.032, 4, 14), M(x, arcY(zm) + hm / 2 + 0.01, zm, 1, 1, 1, 0, Math.PI / 2, 0), paint, 0);
          else if (hm > 0.12) B.add('iron', box(), M(x, arcY(zm) + hm / 2, zm, 0.03, hm, (zb - za) / nb - 0.1), paint, 0);
        }
      }
      // fascia girder along the deck edge with rivets, cornice
      const xf = i === 0 ? x0 - 0.02 : x1 + 0.02, hw = 0.24;
      const A = [[xf, GY - 0.42, z0], [xf, GY - 0.42, z1]], Bq = [[xf, GY + 0.06, z0], [xf, GY + 0.06, z1]];
      B.add('iron', stripGeo(A, Bq, sgn > 0, (p, k, side) => [p[2], side ? hw : -hw]), null, paint, 1, hw);
      B.add('iron', box(), M(xf + sgn * 0.04, GY + 0.08, zc, 0.16, 0.05, z1 - z0), paint, 0);
      B.add('iron', box(), M(xf + sgn * 0.03, GY - 0.44, zc, 0.12, 0.05, z1 - z0), paint, 0);
      // lattice railing
      const xr = i === 0 ? x0 + 0.1 : x1 - 0.1, yb = GY + 0.14, top = 1.1;
      B.add('iron', box(), M(xr, yb + top, zc, 0.075, 0.05, z1 - z0), paint, 0);
      B.add('iron', box(), M(xr, yb + 0.1, zc, 0.05, 0.04, z1 - z0), paint, 0);
      B.add('iron', box(), M(xr, yb + top - 0.12, zc, 0.03, 0.03, z1 - z0), paint, 0);
      const np = Math.round((z1 - z0) / 2.0);
      for (let k = 0; k <= np; k++) {
        const zz = z0 + 0.05 + (z1 - z0 - 0.1) * k / np;
        B.add('iron', box(), M(xr, yb + 0.6, zz, 0.085, 1.2, 0.085), paint, 0);
        B.add('iron', sphere(6, 4), M(xr, yb + 1.25, zz, 0.06, 0.06, 0.06), paint, 0);
      }
      const lh = top - 0.24, sp = 0.22;
      for (let zz = z0 - lh; zz < z1; zz += sp) for (const dir of [1, -1]) {
        const zs_ = dir > 0 ? zz : zz + lh, ze_ = dir > 0 ? zz + lh : zz;     // bottom end -> top end
        let t0 = 0, t1 = 1;
        { const ta = (z0 + 0.04 - zs_) / (ze_ - zs_), tb = (z1 - 0.04 - zs_) / (ze_ - zs_); t0 = Math.max(0, Math.min(ta, tb)); t1 = Math.min(1, Math.max(ta, tb)); }
        if (t1 - t0 < 0.08) continue;
        const pa = [xr + dir * 0.006, yb + 0.12 + lh * t0, zs_ + (ze_ - zs_) * t0], pb = [xr + dir * 0.006, yb + 0.12 + lh * t1, zs_ + (ze_ - zs_) * t1];
        B.add('iron', box(), beam(pa, pb, 0.028, 0.008, [1, 0, 0]), paint, 0);
      }
    }
  }
  // lamp posts (on the sidewalk by the railing)
  for (const zz of [z0 + 0.9, zc, z1 - 0.9]) for (const xx of [x0 + 0.42, x1 - 0.42]) lampPost(H, xx, GY + 0.14, zz, 1.0, { intensity: 0.6, radius: 9 });
}

export function buildBridges(H) {
  const L = H.L;
  const cfg = {
    br_promenade: { spans: [7.2, 8.6, 7.2], pier: 1.5, hump: 0.7, balustrade: true, tint: [0.52, 0.47, 0.38], lampScale: 0.78 },
    br_ave1: { spans: [7.7, 7.8, 7.7], pier: 1.4, hump: 0.4, sidewalk: 2.4, tint: [0.44, 0.40, 0.33] },
    br_ave3: { spans: [12.2, 12.2], pier: 1.6, hump: 0.45, sidewalk: 2.8, tint: [0.40, 0.375, 0.33] },
    br_ave5: { spans: [6.4, 10.4, 6.4], pier: 1.4, hump: 0.4, sidewalk: 2.4, tint: [0.47, 0.42, 0.34] },
    br_ave2: { paint: [0.035, 0.07, 0.055], sidewalk: 3.0 },
    br_ave4: { paint: [0.085, 0.028, 0.02], sidewalk: 2.4 },
    br_ave6: { paint: [0.06, 0.085, 0.11], sidewalk: 2.8 },
  };
  for (const br of L.bridges) {
    const o = cfg[br.id] || (br.kind === 'stone' ? cfg.br_ave1 : cfg.br_ave4);
    if (br.kind === 'stone' && o.spans) stoneBridge(H, br, o); else ironBridge(H, br, o.paint ? o : cfg.br_ave4);
  }
  H.deckY = (x, z) => { for (const br of L.bridges) if (x >= br.x0 && x <= br.x1 && z >= br.z0 && z <= br.z1) return br.deckY(z); return H.GY; };
}
