// Rubble-mound breakwater with tetrapod armour + entrance light, and the channel buoys.
import * as THREE from 'three';
import { Geo, C, fbm, hash2, smooth, lerp, tetrapodGeometry, rockMaterial } from './util.js';

export function buildBreakwater(ctx, S) {
  const bw = ctx.layout.harbor.breakwater; const group = new THREE.Group(); group.name = 'breakwater';
  const ax = bw.x0, az = bw.z0, bx = bw.x1, bz = bw.z1; const len = Math.hypot(bx - ax, bz - az);
  const dx = (bx - ax) / len, dz = (bz - az) / len;           // along
  const nx = -dz, nz = dx;                                     // seaward normal (south-west)
  const HC = 4.0;
  /** returns {dist, a, side} for a world xz point (capsule metric around the centre line) */
  const metric = (x, z) => {
    const px = x - ax, pz = z - az; const a = px * dx + pz * dz; const ac = Math.min(len, Math.max(-20, a));
    const qx = px - ac * dx, qz = pz - ac * dz; return { dist: Math.hypot(qx, qz), a, side: px * nx + pz * nz };
  };
  const coreH = (dist, x, z) => HC - Math.max(0, dist - 2.7) / 1.45 + (fbm(x * 0.21, z * 0.21, 2, 4) - 0.5) * 0.9;

  // core mound
  {
    const NA = Math.ceil((len + 40) / 3.2), NO = 22; const pos = [];
    const P = (i, j) => { const a = -20 + i * (len + 40) / NA, o = (j / NO - 0.5) * 34; const x = ax + dx * a + nx * o, z = az + dz * a + nz * o; const m = metric(x, z); return [x, Math.max(-5, coreH(m.dist, x, z)), z]; };
    for (let i = 0; i < NA; i++) for (let j = 0; j < NO; j++) {
      const p00 = P(i, j), p10 = P(i + 1, j), p01 = P(i, j + 1), p11 = P(i + 1, j + 1);
      if (Math.max(p00[1], p10[1], p01[1], p11[1]) < -4) continue;
      pos.push(...p00, ...p01, ...p11, ...p00, ...p11, ...p10);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, S.rockMat); m.castShadow = m.receiveShadow = true; m.name = 'breakwaterCore'; group.add(m);
  }

  // armour: tetrapods on the seaward face and around the head, quarry rock on the lee side
  const R = ctx.rng('seascape.breakwater');
  const tet = []; const clear = S.clear;
  const x0 = Math.min(ax, bx) - 24, x1 = Math.max(ax, bx) + 24, z0 = Math.min(az, bz) - 24, z1 = Math.max(az, bz) + 24, step = 2.15;
  for (let z = z0; z < z1; z += step) for (let x = x0; x < x1; x += step) {
    const px = x + (R() - 0.5) * 1.5, pz = z + (R() - 0.5) * 1.5; const m = metric(px, pz);
    const r1 = R(), r2 = R(), r3 = R(), r4 = R();
    if (m.dist < 2.3 || m.dist > 10.4 || m.a < -6) continue;
    const y = coreH(m.dist, px, pz);
    if (y < -2.2) continue;
    if (clear.some(c => Math.hypot(px - c[0], pz - c[2]) < 7.5 && Math.abs(y + 1 - c[1]) < 7)) continue;
    const head = m.a > len - 85;
    if (m.side > 0 || head) {
      const s = 1.5 + r1 * 0.4;
      tet.push({ x: px, y: y + 0.62 * s, z: pz, s, r: [r2, r3, r4], tone: R() });
      if (R() < 0.33 && m.dist > 3.5) tet.push({ x: px + (R() - 0.5), y: y + 1.75 * s, z: pz + (R() - 0.5), s, r: [R(), R(), R()], tone: R() });
    } else {
      const s = 0.75 + r1 * r1 * 1.1; S.boulders.push({ x: px, y: y + 0.25 * s, z: pz, s, ry: r2 * 6.28 });
      if (r3 < 0.5) S.boulders.push({ x: px + r4 - 0.5, y: y + 0.9 * s, z: pz + r2 - 0.5, s: s * 0.8, ry: r3 * 20 });
    }
  }
  {
    const im = new THREE.InstancedMesh(tetrapodGeometry(), rockMaterial(ctx, { kind: 'concrete', color: 0xffffff }), tet.length);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    tet.forEach((t, i) => {
      // uniform random orientation
      const u1 = t.r[0], u2 = t.r[1] * 6.2832, u3 = t.r[2] * 6.2832;
      q.set(Math.sqrt(1 - u1) * Math.sin(u2), Math.sqrt(1 - u1) * Math.cos(u2), Math.sqrt(u1) * Math.sin(u3), Math.sqrt(u1) * Math.cos(u3));
      p.set(t.x, t.y, t.z); s.setScalar(t.s); M.compose(p, q, s); im.setMatrixAt(i, M);
      const v = 0.3 + 0.2 * t.tone; col.setRGB(v * 1.02, v, v * 0.94); im.setColorAt(i, col);
    });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = im.receiveShadow = true; im.name = 'tetrapods';
    group.add(im); S.stats.tetrapods = tet.length;
  }

  // crown wall / walkway and the entrance light on a lattice post
  const P = S.props; const conc = C(0x99958c), green = C(0x1f6b45), iron = C(0x26302c), white = C(0xd8d4c8);
  const ry = -Math.atan2(dz, dx);
  const segs = Math.floor((len - 22) / 12);
  for (let i = 0; i < segs; i++) {                              // cast in bays with joints
    const a = 14 + (i + 0.5) * 12; const x = ax + dx * a, z = az + dz * a;
    P.box(11.9, 1.0, 3.3, x, HC + 0.12 + (hash2(i, 3, 7) - 0.5) * 0.08, z, conc, { ry });
    P.box(11.9, 0.9, 0.45, x + nx * 1.45, HC + 1.0, z + nz * 1.45, conc, { ry });                // wave wall on the seaward edge
  }
  const tx = bx + dx * 1.5, tz = bz + dz * 1.5, ty = HC + 0.4;
  P.cyl(2.3, 2.6, 1.5, tx, ty - 0.9, tz, conc, { seg: 14 });
  const ty0 = ty + 0.6, TH = 7.2;
  const leg = (sx, sz, y) => { const k = lerp(0.75, 0.38, (y - ty0) / TH); return [tx + sx * k, y, tz + sz * k]; };
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (let c = 0; c < 4; c++) {
    const [sx, sz] = corners[c], [ux, uz] = corners[(c + 1) % 4];
    P.tube(leg(sx, sz, ty0), leg(sx, sz, ty0 + TH), 0.06, green, { seg: 4 });
    for (let k = 0; k < 5; k++) {
      const y0 = ty0 + k * TH / 5, y1 = ty0 + (k + 1) * TH / 5;
      P.tube(leg(sx, sz, y0), leg(ux, uz, y1), 0.032, green, { seg: 3 }); P.tube(leg(ux, uz, y0), leg(sx, sz, y1), 0.032, green, { seg: 3 });
      P.tube(leg(sx, sz, y1), leg(ux, uz, y1), 0.032, green, { seg: 3 });
    }
  }
  const py = ty0 + TH;
  P.cyl(0.95, 0.95, 0.08, tx, py, tz, iron, { seg: 10 });
  for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832; P.tube([tx + Math.cos(a) * 0.9, py, tz + Math.sin(a) * 0.9], [tx + Math.cos(a) * 0.9, py + 0.9, tz + Math.sin(a) * 0.9], 0.022, iron, { seg: 3 }); }
  { const t = new THREE.TorusGeometry(0.9, 0.025, 3, 16); t.rotateX(Math.PI / 2); P.add(t, iron, Geo.mat(tx, py + 0.9, tz)); }
  P.cyl(0.3, 0.34, 0.5, tx, py + 0.08, tz, green, { seg: 8 });
  P.cyl(0.22, 0.22, 0.42, tx, py + 0.58, tz, [0.03, 1.0, 0.3], { seg: 8, e: 5 });
  P.cyl(0.02, 0.3, 0.3, tx, py + 1.0, tz, green, { seg: 8 });
  P.box(0.9, 1.1, 0.06, tx - nx * 0.5, ty0 + 3.2, tz - nz * 0.5, white, { ry });               // day mark board
  S.sprites.add(tx, py + 0.8, tz, [0.03, 1.0, 0.3], 14, 0.34, [4, 0.3, 0.1, 1]);
  group.userData.tip = { x: tx, y: py + 0.8, z: tz };
  return { group, tip: { x: tx, y: py + 0.8, z: tz } };
}

// ---------------------------------------------------------------------------------------------
export function buildBuoys(ctx, S) {
  const group = new THREE.Group(); group.name = 'buoys';
  const red = C(0xa8261c), green = C(0x1c6a3c), iron = C(0x2a2a28);
  const make = kind => {
    const g = new Geo(); const col = kind === 'can' ? red : green;
    g.cyl(1.15, 1.05, 1.5, 0, -0.9, 0, col, { seg: 14 }); g.cyl(0.62, 1.15, 0.4, 0, 0.6, 0, col, { seg: 14 });
    g.cyl(1.19, 1.19, 0.16, 0, 0.3, 0, iron, { seg: 14 });                                       // fender band
    for (let i = 0; i < 4; i++) { const a = i * 1.5708 + 0.785; g.tube([Math.cos(a) * 0.6, 0.95, Math.sin(a) * 0.6], [Math.cos(a) * 0.24, 3.5, Math.sin(a) * 0.24], 0.045, col, { seg: 4 }); }
    for (const y of [1.8, 2.7]) { const k = lerp(0.6, 0.24, (y - 0.95) / 2.55); const t = new THREE.TorusGeometry(k, 0.03, 3, 10); t.rotateX(Math.PI / 2); g.add(t, col, Geo.mat(0, y, 0)); }
    g.cyl(0.3, 0.3, 0.07, 0, 3.5, 0, col, { seg: 8 });
    if (kind === 'can') g.cyl(0.42, 0.42, 0.75, 0, 3.75, 0, col, { seg: 10 });
    else g.cyl(0.02, 0.5, 0.9, 0, 3.72, 0, col, { seg: 10 });
    g.cyl(0.03, 0.03, 0.5, 0, 4.5, 0, iron, { seg: 4 });
    g.cyl(0.11, 0.11, 0.24, 0, 4.95, 0, kind === 'can' ? [1.0, 0.04, 0.015] : [0.03, 1.0, 0.3], { seg: 6, e: 4 });
    return g.build();
  };
  // channel centre line from the open bay (passing north of the islet) to the canal mouth
  const centre = [[-1620, -230], [-1190, -95], [-800, 25], [-430, 118]];
  const dir = (() => { const a = centre[0], b = centre[centre.length - 1]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; })();
  const list = [];
  centre.forEach((c, i) => {
    const w = 34 - i * 2;
    // inbound = heading east: port hand (red can) is to the north, starboard (green cone) to the south
    list.push({ kind: 'can', x: c[0] + dir[1] * w, z: c[1] - dir[0] * w, period: [3, 4, 5, 2.5][i], duty: 0.16, ph: i * 0.37 });
    list.push({ kind: 'cone', x: c[0] - dir[1] * w, z: c[1] + dir[0] * w, period: [3, 4, 5, 1.2][i], duty: i === 3 ? 0.35 : 0.16, ph: 0.5 + i * 0.21 });
  });
  const mat = S.paintMat;
  const meshes = { can: new THREE.InstancedMesh(make('can'), mat, 4), cone: new THREE.InstancedMesh(make('cone'), mat, 4) };
  const counts = { can: 0, cone: 0 };
  for (const b of list) {
    b.idx = counts[b.kind]++; b.seed = hash2(Math.round(b.x), Math.round(b.z), 3) * 6.28;
    b.light = S.dyn.add(b.x, 5.1, b.z, b.kind === 'can' ? [1.0, 0.04, 0.015] : [0.03, 1.0, 0.3], 12, 0.24, [b.period, b.duty, b.ph, 1]);
  }
  for (const k in meshes) { const m = meshes[k]; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; m.name = 'buoys_' + k; group.add(m); }
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  function update(t) {
    for (const b of list) {
      const y = 0.12 * Math.sin(t * 1.1 + b.seed) + 0.06 * Math.sin(t * 1.9 + b.seed * 2.3);
      e.set(0.075 * Math.sin(t * 0.93 + b.seed) + 0.03 * Math.sin(t * 2.1 + b.seed), b.seed, 0.065 * Math.sin(t * 0.77 + b.seed * 1.7) + 0.025 * Math.sin(t * 1.7 + b.seed));
      q.setFromEuler(e); p.set(b.x, y, b.z); M.compose(p, q, s); meshes[b.kind].setMatrixAt(b.idx, M);
      v.set(0, 5.1, 0).applyMatrix4(M); S.dyn.setPos(b.light, v.x, v.y, v.z);
    }
    meshes.can.instanceMatrix.needsUpdate = true; meshes.cone.instanceMatrix.needsUpdate = true;
  }
  update(0);
  return { group, update, list: list.map(b => ({ kind: b.kind, x: b.x, z: b.z })) };
}
