// Lighthouse islet: rock, tower, keeper's cottage, landing stage, rotating beams.
import * as THREE from 'three';
import { Geo, C, fbm, smooth, lerp, paintMaterial, gableRoof } from './util.js';

export const BEAM_PERIOD = 12;      // seconds per revolution (two beams -> a flash every 6 s)

export function buildLighthouse(ctx, S) {
  const L = ctx.layout.harbor.lighthouse; const cx = L.x, cz = L.z;
  const group = new THREE.Group(); group.name = 'lighthouse';
  const Y0 = 7.6;                                     // tower pad level
  const cot = { x: cx + 15, z: cz + 14, y: 6.0 };     // cottage pad

  // ---- islet height field --------------------------------------------------------------------
  function isletH(x, z) {
    const dx = x - cx, dz = z - cz; const r = Math.hypot(dx, dz); const th = Math.atan2(dz, dx);
    const ct = Math.cos(th), st = Math.sin(th);
    // lobed outline; a spur reaches south-east toward the breakwater root
    const spur = Math.max(0, ct * 0.72 + st * 0.69);
    const R = 34 + 12 * fbm(ct * 1.5 + 3, st * 1.5 + 3, 3, 5) + 7 * fbm(ct * 4 + 1, st * 4 + 8, 2, 9) + 16 * Math.pow(spur, 6);
    const q = r / R;
    let h = q < 1 ? 0.3 + 8.4 * (1 - smooth(0.18, 1, q)) : 0.3 - (q - 1) * R * 0.45;
    h += (fbm(x * 0.07, z * 0.07, 4, 3) - 0.5) * 6.5 * smooth(0.2, 0.7, q) * (1 - 0.6 * smooth(1, 1.3, q));
    h += Math.max(0, fbm(x * 0.19, z * 0.19, 3, 11) - 0.52) * 9 * smooth(0.5, 0.95, q) * (1 - smooth(1.05, 1.4, q));
    if (h > 0.4) {                                    // bedding ledges (tilted strata)
      const tilt = dx * 0.05 - dz * 0.02; const t = (h + tilt) / 1.15; const f = t - Math.floor(t);
      h = lerp(h, (Math.floor(t) + smooth(0.62, 1, f)) * 1.15 - tilt, 0.72);
    }
    h = lerp(h, Y0, 1 - smooth(6.6, 12, r));
    h = lerp(h, cot.y, 1 - smooth(6.5, 10.5, Math.hypot(x - cot.x, z - cot.z)));
    return Math.max(h, -4.5);
  }
  {
    const N = 112, ext = 70, cell = 2 * ext / N; const pos = [];
    const H = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) H[j * (N + 1) + i] = isletH(cx - ext + i * cell, cz - ext + j * cell);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const h00 = H[j * (N + 1) + i], h10 = H[j * (N + 1) + i + 1], h01 = H[(j + 1) * (N + 1) + i], h11 = H[(j + 1) * (N + 1) + i + 1];
      if (Math.max(h00, h10, h01, h11) < -3.5) continue;
      const x0 = cx - ext + i * cell, z0 = cz - ext + j * cell, x1 = x0 + cell, z1 = z0 + cell;
      if ((i + j) & 1) pos.push(x0, h00, z0, x0, h01, z1, x1, h10, z0, x1, h10, z0, x0, h01, z1, x1, h11, z1);
      else pos.push(x0, h00, z0, x0, h01, z1, x1, h11, z1, x0, h00, z0, x1, h11, z1, x1, h10, z0);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, S.isletMat); m.castShadow = m.receiveShadow = true; m.name = 'islet'; group.add(m);
  }
  // loose boulders around the shore
  const R = ctx.rng('seascape.islet');
  for (let i = 0; i < 70; i++) {
    const a = R() * 6.283, rr = 30 + R() * 30; const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr; const h = isletH(x, z);
    if (h < -2.5 || h > 3.5) continue;
    if (Math.hypot(x - (cx + 44), z - (cz + 3)) < 14) continue;      // keep the landing clear
    const s = 1.2 + R() * R() * 3.2; S.boulders.push({ x, y: h + s * 0.15, z, s, big: true });
  }

  // ---- tower -----------------------------------------------------------------------------------
  const stone = new Geo(), P = new Geo();
  const white = C(0xddd8cc), band = C(0x7a2a22), granite = C(0x8f8a82), iron = C(0x1d2a26), copper = C(0x4f8a78), darkGlass = [0.015, 0.017, 0.02];
  const shaftR = y => 3.02 + 2.3 * Math.exp(-(y - 1.6) / 24 * 3.3);           // y above pad
  stone.cyl(5.75, 6.0, 1.0, cx, Y0 - 0.4, cz, granite, { seg: 12 });
  stone.cyl(5.45, 5.65, 1.0, cx, Y0 + 0.6, cz, granite, { seg: 12 });
  const sect = (ya, yb, col) => { const pts = []; for (let k = 0; k <= 8; k++) { const y = lerp(ya, yb, k / 8); pts.push([shaftR(y), y]); } stone.lathe(pts, cx, Y0, cz, col, { seg: 36 }); };
  sect(1.6, 13.6, white); sect(13.6, 17.6, band); sect(17.6, 25.6, white);
  stone.lathe([[3.1, 25.5], [3.22, 25.9], [3.55, 26.35], [4.1, 26.75], [4.5, 26.95], [4.55, 27.3], [0, 27.3]], cx, Y0, cz, granite, { seg: 36 });
  // string course above the band
  stone.lathe([[shaftR(17.6), 17.45], [shaftR(17.6) + 0.14, 17.55], [shaftR(17.6) + 0.14, 17.75], [shaftR(17.9), 17.9]], cx, Y0, cz, granite, { seg: 36 });

  const rail = (r, y, h, n, pr = 0.04) => {
    for (let i = 0; i < n; i++) { const a = i / n * 6.2832, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r; P.tube([x, Y0 + y, z], [x, Y0 + y + h, z], pr, iron, { seg: 4 }); }
    for (const f of [0.5, 1]) { const t = new THREE.TorusGeometry(r, pr * 1.15, 4, 48); t.rotateX(Math.PI / 2); P.add(t, iron, Geo.mat(cx, Y0 + y + h * f, cz)); }
  };
  rail(4.32, 27.3, 1.15, 28);
  // watch room + lantern gallery
  P.cyl(2.55, 2.62, 2.5, cx, Y0 + 27.3, cz, white, { seg: 24 });
  P.cyl(3.05, 2.7, 0.22, cx, Y0 + 29.7, cz, iron, { seg: 24 });
  rail(2.92, 29.92, 1.0, 18, 0.035);
  // lantern: murette, glazing bars (uprights + diamond astragals), cornice
  const lr = 2.2, g0 = 30.75, g1 = 33.95, NB = 12;
  P.cyl(lr, lr, g0 - 29.92, cx, Y0 + 29.92, cz, iron, { seg: 24 });
  for (let i = 0; i < NB; i++) {
    const a0 = i / NB * 6.2832, a1 = (i + 1) / NB * 6.2832;
    const p = (a, y) => [cx + Math.cos(a) * lr, Y0 + y, cz + Math.sin(a) * lr];
    P.tube(p(a0, g0), p(a0, g1), 0.055, iron, { seg: 4 });
    const ym = (g0 + g1) / 2;
    P.tube(p(a0, g0), p(a1, ym), 0.035, iron, { seg: 3 }); P.tube(p(a1, g0), p(a0, ym), 0.035, iron, { seg: 3 });
    P.tube(p(a0, ym), p(a1, g1), 0.035, iron, { seg: 3 }); P.tube(p(a1, ym), p(a0, g1), 0.035, iron, { seg: 3 });
  }
  P.cyl(lr + 0.12, lr + 0.05, 0.32, cx, Y0 + g1, cz, iron, { seg: 24 });
  // domed cap, ventilator ball, lightning rod, weather vane
  P.lathe([[2.5, 34.2], [2.42, 34.36], [2.2, 34.62], [1.85, 35.1], [1.35, 35.62], [0.8, 36.0], [0.36, 36.2], [0.3, 36.75], [0.5, 36.95], [0.56, 37.2], [0.42, 37.46], [0.1, 37.6], [0.06, 38.0]], cx, Y0, cz, copper, { seg: 24 });
  const vy = Y0 + 38.0;
  P.tube([cx, vy, cz], [cx, vy + 2.5, cz], 0.045, iron, { seg: 5 });
  P.tube([cx - 0.75, vy + 0.7, cz], [cx + 0.75, vy + 0.7, cz], 0.03, iron, { seg: 4 }); P.tube([cx, vy + 0.7, cz - 0.75], [cx, vy + 0.7, cz + 0.75], 0.03, iron, { seg: 4 });
  // arrow (points across the view axis so it reads in silhouette from the city): shaft along z
  P.tube([cx, vy + 1.6, cz - 1.15], [cx, vy + 1.6, cz + 1.0], 0.035, iron, { seg: 4 });
  P.add(new THREE.ConeGeometry(0.16, 0.5, 6), iron, Geo.mat(cx, vy + 1.6, cz + 1.2, Math.PI / 2, 0, 0));
  P.box(0.03, 0.5, 0.62, cx, vy + 1.6, cz - 1.05, iron);
  P.sphere(0.09, cx, vy + 2.5, cz, iron, { ws: 6, hs: 4 });
  // optic (fresnel barrel) on a pedestal
  const LY = Y0 + 32.3;
  P.cyl(0.4, 0.55, 1.2, cx, Y0 + 29.92, cz, iron, { seg: 10 });
  P.lathe([[0.3, 31.15], [0.72, 31.4], [0.98, 31.9], [1.04, 32.3], [0.98, 32.7], [0.72, 33.2], [0.3, 33.45]], cx, Y0, cz, [1.0, 0.84, 0.56], { seg: 28, e: 46 });
  // shaft windows (spiral) + door facing the landing (east)
  const winAt = (a, y, lit) => {
    const r = shaftR(y) - 0.08; const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    P.box(0.34, 1.15, 0.62, x, Y0 + y, z, lit ? [1.0, 0.72, 0.38] : darkGlass, { ry: -a, e: lit ? 5 : 0 });
    P.box(0.3, 0.16, 0.9, x + Math.cos(a) * 0.12, Y0 + y - 0.66, z + Math.sin(a) * 0.12, granite, { ry: -a });
  };
  winAt(0.25, 7.5, false); winAt(1.9, 11.8, false); winAt(-1.2, 15.6, false); winAt(0.1, 20.2, true); winAt(2.6, 23.4, false); winAt(-2.3, 22.0, false);
  P.box(0.5, 2.3, 1.25, cx + shaftR(2.8) - 0.05, Y0 + 2.75, cz, C(0x20382f));
  P.box(0.7, 0.3, 1.9, cx + shaftR(2.8) + 0.02, Y0 + 4.05, cz, granite);
  for (let k = 0; k < 3; k++) P.box(1.2, 0.34, 2.4 + k * 0.5, cx + 6.2 + k * 0.5, Y0 + 1.3 - k * 0.42, cz, granite);

  // ---- keeper's cottage ----------------------------------------------------------------------
  const wall = C(0xd6d0c2), slate = C(0x3a3d44), door = C(0x24443a);
  P.box(5.8, 3.4, 9.6, cot.x, cot.y + 1.3, cot.z, wall);                       // walls (sunk 0.4 into the pad)
  gableRoof(P, 5.8, 9.6, 2.3, cot.x, cot.y + 3.0, cot.z, 0, slate, wall, 0.4);
  P.box(0.8, 2.0, 0.8, cot.x, cot.y + 5.0, cot.z - 3.9, C(0x8c5b48)); P.cyl(0.14, 0.17, 0.45, cot.x - 0.18, cot.y + 6.0, cot.z - 3.9, C(0x7a4a3a), { seg: 6 }); P.cyl(0.14, 0.17, 0.45, cot.x + 0.2, cot.y + 6.0, cot.z - 3.9, C(0x7a4a3a), { seg: 6 });
  const ex = cot.x + 2.9;
  P.box(0.12, 2.0, 1.0, ex, cot.y + 1.0, cot.z + 0.3, door);
  P.box(0.1, 1.1, 1.0, ex, cot.y + 1.75, cot.z - 2.7, [1.0, 0.66, 0.32], { e: 7 });           // the lit window
  P.box(0.1, 1.1, 1.0, ex, cot.y + 1.75, cot.z + 3.0, darkGlass);
  P.box(0.1, 1.1, 1.0, cot.x - 2.9, cot.y + 1.75, cot.z + 1.0, darkGlass);
  P.box(1.0, 1.0, 0.1, cot.x, cot.y + 1.75, cot.z + 4.8, darkGlass);
  // lean-to store + rainwater tank
  P.box(3.0, 2.2, 3.4, cot.x - 1.0, cot.y + 1.1, cot.z - 7.2, C(0xbfb8a8)); P.box(3.5, 0.16, 3.9, cot.x - 1.0, cot.y + 2.3, cot.z - 7.2, slate, { rz: 0.12 });
  P.cyl(0.9, 0.9, 1.7, cot.x + 3.9, cot.y, cot.z + 4.2, C(0x5a6a60), { seg: 12 });
  // flagstaff
  const fx = cx + 6, fz = cz - 9.5, fy = Y0 - 0.2;
  P.tube([fx, fy, fz], [fx, fy + 9.5, fz], 0.07, wall, { seg: 5, r1: 0.04 }); P.tube([fx, fy + 6.6, fz - 1.3], [fx, fy + 6.6, fz + 1.3], 0.035, wall, { seg: 4 });
  P.sphere(0.1, fx, fy + 9.55, fz, wall, { ws: 6, hs: 4 });

  // ---- landing stage (east side) ---------------------------------------------------------------
  const conc = C(0x8e8b84), timber = C(0x4a3b2c), jz = cz + 3;
  let jx0 = cx + 30; while (isletH(jx0, jz) > 1.6 && jx0 < cx + 60) jx0 += 1;
  const jx1 = jx0 + 20;
  P.box(jx1 - jx0 + 3, 0.35, 3.2, (jx0 + jx1) / 2 - 1.5, 2.0, jz, conc);
  for (let x = jx0 + 1; x <= jx1; x += 3.8) for (const s of [-1.35, 1.35]) P.cyl(0.2, 0.22, 5.4, x, -3.4, jz + s, timber, { seg: 6 });
  P.box(0.3, 0.3, 3.6, jx1 + 0.05, 1.7, jz, timber);
  for (const s of [-1.1, 1.1]) P.cyl(0.14, 0.17, 0.5, jx1 - 1.2, 2.17, jz + s, iron, { seg: 6 });       // bollards
  for (let y = -0.5; y < 2; y += 0.35) P.box(0.05, 0.05, 0.5, jx1 + 0.25, y, jz - 0.9, iron);           // ladder rungs
  P.box(0.05, 3.0, 0.05, jx1 + 0.25, 0.7, jz - 1.15, iron); P.box(0.05, 3.0, 0.05, jx1 + 0.25, 0.7, jz - 0.65, iron);
  // davit
  P.tube([jx1 - 3, 2.1, jz + 1.3], [jx1 - 3, 4.6, jz + 1.3], 0.08, iron, { seg: 5 }); P.tube([jx1 - 3, 4.6, jz + 1.3], [jx1 - 3, 5.0, jz + 2.9], 0.06, iron, { seg: 5 });
  // steps/ramp from the stage up to the cottage level, with a handrail
  {
    const ax = jx0 + 0.5, ay = 2.0, bx = cot.x + 6.5, by = cot.y, len = Math.hypot(ax - bx, ay - by), ang = Math.atan2(by - ay, ax - bx);
    P.box(len + 0.6, 0.4, 1.7, (ax + bx) / 2, (ay + by) / 2 - 0.15, jz, conc, { rz: -ang });
    const n = Math.ceil(len / 1.6);
    for (let i = 0; i <= n; i++) { const t = i / n, x = lerp(ax, bx, t), y = lerp(ay, by, t); P.tube([x, y, jz - 0.8], [x, y + 1.0, jz - 0.8], 0.03, iron, { seg: 4 }); }
    P.tube([ax, ay + 1.0, jz - 0.8], [bx, by + 1.0, jz - 0.8], 0.035, iron, { seg: 4 });
    P.box(7.5, 0.25, 1.6, cot.x + 3.2, cot.y - 0.1, jz + 0.2, conc);                       // path slab toward the cottage
  }

  // ---- meshes ----------------------------------------------------------------------------------
  const masonry = paintMaterial(ctx, {
    roughness: 0.82, grime: 0.35, wet: 0, uniforms: { uTw: { value: new THREE.Vector3(cx, cz, Y0) } }, extraPars: 'uniform vec3 uTw;',
    extraColor: /* glsl */`
      { vec2 d_ = vWPos.xz - uTw.xy; float ang_ = atan(d_.y, d_.x);
        float crs_ = (vWPos.y - uTw.z) / 0.56; float row_ = floor(crs_);
        float bu_ = ang_ / 6.2831853 * 30.0 + 0.5 * mod(row_, 2.0);
        vec2 bf_ = fract(vec2(bu_, crs_)); vec2 bid_ = floor(vec2(bu_, crs_));
        float lodm_ = 1.0 - smoothstep(0.2, 0.7, fwidth(crs_));
        float jt_ = (1.0 - smoothstep(0.0, 0.05, bf_.x) * smoothstep(1.0, 0.95, bf_.x) * smoothstep(0.0, 0.09, bf_.y) * smoothstep(1.0, 0.91, bf_.y)) * lodm_;
        float streak_ = fbm2(vec2(ang_ * 8.0, vWPos.y * 0.1));
        float damp_ = smoothstep(6.0, 0.0, vWPos.y - uTw.z) * 0.25 + smoothstep(22.0, 26.5, vWPos.y - uTw.z) * 0.18;
        diffuseColor.rgb *= (0.9 + 0.2 * hash12(bid_) * lodm_) * mix(1.0, 0.6, jt_) * (0.7 + 0.5 * streak_) * (1.0 - damp_ * streak_ * 1.4); }`,
  });
  const tm = new THREE.Mesh(stone.build(), masonry); tm.castShadow = tm.receiveShadow = true; tm.name = 'lighthouseShaft'; group.add(tm);
  const pm = new THREE.Mesh(P.build(), S.paintMat); pm.castShadow = pm.receiveShadow = true; pm.name = 'lighthouseParts'; group.add(pm);

  // ---- lamp flash + rotating beams -------------------------------------------------------------
  S.sprites.add(cx, LY, cz, [1.0, 0.86, 0.6], 420, 1.3, [BEAM_PERIOD, 0.02, 0, 2]);
  S.sprites.add(cot.x + 3.0, cot.y + 1.75, cot.z - 2.7, [1.0, 0.62, 0.28], 8, 0.5);
  {
    const LEN = 760, parts = [];
    for (const sgn of [1, -1]) {
      const g = new THREE.CylinderGeometry(0.7 + LEN * 0.013, 0.7, LEN, 24, 16, true); g.translate(0, LEN / 2 + 1.0, 0); g.rotateZ(-sgn * Math.PI / 2);
      parts.push(g);
    }
    const bg = new THREE.BufferGeometry();
    for (const k of ['position', 'normal']) {
      const arr = new Float32Array(parts.reduce((s, p) => s + p.toNonIndexed().attributes[k].array.length, 0)); let o = 0;
      for (const p of parts) { const a = p.toNonIndexed().attributes[k].array; arr.set(a, o); o += a.length; }
      bg.setAttribute(k, new THREE.BufferAttribute(arr, 3));
    }
    const bm = ctx.makeShaderMaterial({
      uniforms: { uPeriod: { value: BEAM_PERIOD }, uLen: { value: LEN } },
      vertexShader: /* glsl */`
        uniform float uPeriod; uniform float uLen; varying float vAlong; varying vec3 vN; varying vec3 vW;
        void main() {
          float th = uTime * 6.2831853 / uPeriod; float c = cos(th), s = sin(th);
          vec3 p = position; vec3 n = normal;
          vec3 pr = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c); vec3 nr = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
          vec4 wp = modelMatrix * vec4(pr, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * nr); vAlong = abs(p.x) / uLen;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */`
        varying float vAlong; varying vec3 vN; varying vec3 vW;
        void main() {
          vec3 V = normalize(uCamPos - vW); float f = abs(dot(normalize(vN), V));
          float edge = f * f * f;
          float fall = (1.0 - smoothstep(0.45, 1.0, vAlong)) / (1.0 + vAlong * 5.0);
          float haze = 0.75 + 0.5 * fbm2(vW.xz * 0.02 + uTime * 0.03);
          vec3 col = vec3(1.0, 0.88, 0.66) * 0.045 * edge * fall * haze * smoothstep(0.25, 0.9, uNight);
          gl_FragColor = vec4(col, 1.0);
        }`,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: true, side: THREE.DoubleSide,
    });
    const beams = new THREE.Mesh(bg, bm); beams.position.set(cx, LY, cz); beams.frustumCulled = false; beams.layers.set(1); beams.renderOrder = 40; beams.name = 'lighthouseBeams';
    group.add(beams);
  }
  return { group, isletH, info: { x: cx, z: cz, baseY: Y0, lampY: LY, topY: Y0 + 40.5, period: BEAM_PERIOD, cottage: cot, landing: { x: jx1, z: jz, y: 2.2 } } };
}
