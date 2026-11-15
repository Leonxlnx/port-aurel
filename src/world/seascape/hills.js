// East side: terrain rising behind the city with terraced houses, woods, road, mast, chapel, observatory;
// city outskirts north and south of the grid; rock revetment continuing the quay line.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Geo, C, fbm, hash2, vnoise, smooth, lerp, clamp, gridGeometry, gableRoof } from './util.js';

export function buildHills(ctx, S) {
  const group = new THREE.Group(); group.name = 'hills';
  const { layout, GROUND_Y: GY } = ctx; const b = layout.bounds, hl = layout.hills, quay = layout.harbor.quay, QX = layout.QUAY_X;
  const ZC = (b.z0 + b.z1) / 2, zN = quay.z0, zS = quay.z1, REV = 1500, G0 = GY - 0.06;
  const STEP = 30, GX0 = QX - 53 * STEP, GZ0 = -840 - 113 * STEP;       // grid lines hit x = QUAY_X and z = -840 / 960
  const NX = 155, NZ = 285;

  const inRev = z => z > zN - REV && z < zS + REV;
  function coastX(z) {
    const over = z < zN - REV ? zN - REV - z : z > zS + REV ? z - zS - REV : 0;
    return QX - over * over / 2300 + (fbm(z * 0.003, 0.5, 3, 77) - 0.5) * Math.min(over, 420) * 1.1;
  }
  const hillX0 = z => {
    const dzc = Math.abs(z - ZC);
    return Math.max(coastX(z) + 330, hl.x0 - 0.5 * Math.max(0, dzc - 1250) + (fbm(z * 0.0017, 3.1, 3, 91) - 0.5) * 520 * smooth(1000, 1800, dzc));
  };
  function landH(x, z) {
    const d = x - coastX(z);
    if (inRev(z)) { if (d < -0.01) return -8; } else if (d < 20) return clamp(d * 0.12, -8, G0);
    let h = G0; const x0 = hillX0(z), k = x - x0;
    if (k > 0) {
      const dzc = Math.abs(z - ZC);
      const ridge = hl.maxH * (0.86 + 0.5 * fbm(z * 0.0013, 7.7, 3, 93)) + 150 * smooth(1500, 3600, dzc);
      const v = k * hl.rise / ridge;
      h += ridge * (v < 0.7 ? v : 0.7 + 0.3 * (1 - Math.exp(-(v - 0.7) / 0.3)));
      h += (fbm(x * 0.005, z * 0.005, 4, 95) - 0.5) * 28 * smooth(150, 520, k);
      h += 75 * fbm(x * 0.0012, z * 0.0012, 3, 97) * smooth(900, 1700, k);
    }
    return h;
  }
  const woods = (x, z) => smooth(0.5, 0.62, fbm(x * 0.0034 + 3, z * 0.0034 + 9, 3, 57));
  const cityDist = z => Math.max(b.z0 - z, z - b.z1, 0);
  const landCol = (x, z, y) => {
    const k = x - hillX0(z), du = cityDist(z);
    const n = fbm(x * 0.004, z * 0.004, 3, 55);
    let c = [lerp(0.17, 0.075, n), lerp(0.155, 0.1, n), lerp(0.075, 0.04, n)];
    const w = woods(x, z) * (k > 40 || du > 900 ? 1 : 0.2);
    c = c.map((v, i) => lerp(v, [0.036, 0.05, 0.026][i], w * 0.85));
    const urban = (1 - smooth(450, 1500, du)) * (1 - smooth(-60, 120, k)) * (0.55 + 0.45 * vnoise(x * 0.02, z * 0.02, 5));
    return c.map((v, i) => lerp(v, [0.15, 0.14, 0.13][i], urban));
  };
  // ---- terrain mesh ----------------------------------------------------------------------------------------------------------------
  const terr = gridGeometry(GX0, NX, GZ0, NZ, STEP, (x, z) => {
    if (inRev(z) && Math.abs(x - (QX - STEP)) < 1) return [QX - 8.5, -2.8, z];        // revetment slope
    return [x, landH(x, z), z];
  }, landCol, (x, z, ys) => Math.max(...ys) < -3 || (x + STEP <= 1081 && z >= -841 && z + STEP <= 961));
  const tm = new THREE.Mesh(terr, S.terrainMat); tm.receiveShadow = true; tm.name = 'eastTerrain'; group.add(tm);

  // ---- revetment rocks along the quay line north and south of the harbour wall ---------------------------------------------------------
  const R = ctx.rng('seascape.hills');
  for (const [za, zb] of [[zN - REV - 40, zN], [zS, zS + REV + 40]]) for (let z = za; z < zb; z += 1.75) {
    for (let k = 0; k < 3; k++) {
      const t = R(), s = 0.7 + R() * R() * 1.2; const x = coastX(z) - 0.3 - t * 8.6;
      S.boulders.push({ x, y: G0 - t * 5.2 + 0.1 * s, z: z + R() * 1.7, s, ry: R() * 6.28 });
    }
  }

  // ---- houses ----------------------------------------------------------------------------------------------------------------------
  const houses = [], blocks = [], trees = [], lamps = [];
  const wallPal = [[0.56, 0.48, 0.34], [0.52, 0.36, 0.18], [0.48, 0.27, 0.19], [0.6, 0.57, 0.52], [0.58, 0.5, 0.29], [0.54, 0.42, 0.3], [0.38, 0.42, 0.45], [0.6, 0.54, 0.43]];
  const pick = a => a[Math.floor(R() * a.length)];
  // terraces on the slope: rows along contour lines every ~5.5 m of height
  for (let Lv = 5; Lv < 128; Lv += 5.5) {
    for (let z = ZC - 2700; z < ZC + 2700; z += 13 + R() * 9) {
      const r1 = R(), r2 = R(), r3 = R(), r4 = R(), r5 = R(), r6 = R();
      const x0 = hillX0(z), x = x0 + Lv / hl.rise + (r1 - 0.5) * 16; const dzc = Math.abs(z - ZC);
      const village = fbm(x * 0.0026, z * 0.0026, 3, 61) + 0.1 * vnoise(x * 0.012, z * 0.012, 62);
      if (village < 0.4 + 0.2 * (Lv / 128) + 0.32 * smooth(1100, 2700, dzc) + (r2 - 0.5) * 0.1) continue;
      if (woods(x, z) > 0.75) continue;
      const y = landH(x, z); const turn = r3 < 0.3;
      const w = 6 + r4 * 3.5, d = 8 + r5 * 5.5, h = 4.6 + r6 * r6 * 5;
      houses.push({ x, y, z, w, d, h, ry: (turn ? Math.PI / 2 : 0) + (R() - 0.5) * 0.4, col: pick(wallPal) });
      if (R() < 0.3) lamps.push([x - 7, y + 5.5, z + 5]);
      if (R() < 0.4) trees.push({ x: x + 6 + R() * 16, z: z + (R() - 0.5) * 14, s: 3 + R() * 3 });
    }
  }
  // outskirts north and south of the street grid: the city grid thins out into warehouses, apartment blocks and house rows
  const cellX = 86, cellZ = 92;
  for (const side of [-1, 1]) for (let j = 0; j < 17; j++) {
    const zc = side < 0 ? b.z0 - 112 - j * cellZ : b.z1 + 112 + j * cellZ; const du = cityDist(zc);
    for (let x0c = QX + 60; x0c < 2200; x0c += cellX) {
      const lim = hillX0(zc);
      if (x0c + 40 > lim - 10) break;
      const r1 = R(), r2 = R(), r3 = R();
      if (r1 > 0.97 - 0.55 * du / 1500) { if (r2 < 0.6) for (let k = 0; k < 5; k++) trees.push({ x: x0c + (R() - 0.5) * 60, z: zc + (R() - 0.5) * 60, s: 4 + R() * 4 }); continue; }
      const coastal = x0c < QX + 330 || fbm(x0c * 0.003, zc * 0.003, 2, 71) > 0.62;
      if (coastal) {                 // sheds / warehouses
        const n = r2 < 0.5 ? 1 : 2;
        for (let k = 0; k < n; k++) {
          const w = 20 + R() * 9, d = n === 1 ? 52 + R() * 16 : 28 + R() * 6, h = 7.5 + R() * 5;
          houses.push({ x: x0c + (k - (n - 1) / 2) * 34, y: G0, z: zc + (R() - 0.5) * 8, w, d, h, ry: r3 < 0.5 ? 0 : Math.PI / 2, col: pick([[0.42, 0.2, 0.14], [0.4, 0.4, 0.4], [0.5, 0.47, 0.4], [0.33, 0.4, 0.36], [0.5, 0.26, 0.16]]), shed: true });
        }
      } else if (r2 < 0.5 - 0.3 * du / 1500) {     // apartment blocks
        const n = 1 + Math.floor(R() * 2);
        for (let k = 0; k < n; k++) blocks.push({ x: x0c + (R() - 0.5) * 10, y: G0, z: zc + (k - (n - 1) / 2) * 36, w: 34 + R() * 20, d: 12 + R() * 4, h: (11 + R() * 14) * (1 - 0.4 * du / 1500), ry: r3 < 0.25 ? Math.PI / 2 : 0, col: pick(wallPal) });
      } else {                       // rows of houses
        for (let k = 0; k < 5; k++) for (const s of [-1, 1]) {
          if (R() < 0.18) { if (R() < 0.6) trees.push({ x: x0c - 28 + k * 14, z: zc + s * 20, s: 3.5 + R() * 3 }); continue; }
          houses.push({ x: x0c - 28 + k * 14 + (R() - 0.5) * 2, y: G0, z: zc + s * (17 + R() * 5), w: 7 + R() * 3, d: 8 + R() * 4, h: 5 + R() * 3.5, ry: Math.PI / 2 + (R() - 0.5) * 0.1, col: pick(wallPal) });
        }
        if (R() < 0.7) trees.push({ x: x0c + (R() - 0.5) * 50, z: zc + (R() - 0.5) * 8, s: 4 + R() * 3 });
      }
      if (R() < 0.75) lamps.push([x0c - cellX / 2 + 4, G0 + 8, zc - cellZ / 2 + 4]);
      if (R() < 0.4) lamps.push([x0c, G0 + 8, zc - cellZ / 2 + 4]);
    }
    // coast road lamps
    for (let z = zc - cellZ / 2; z < zc + cellZ / 2; z += 46) lamps.push([QX + 14, G0 + 9, z]);
  }
  // unit house: walls x,z in ±0.5, y in [-0.5, 1]; pitched roof (aE = 1) with the ridge along z; gables are wall
  const houseGeo = (() => {
    const g = new Geo(); const wh = [1, 1, 1];
    const bx = new THREE.BoxGeometry(1, 1.5, 1); bx.translate(0, 0.25, 0); g.add(bx, wh);
    const rg = new Geo(); gableRoof(rg, 1, 1, 0.42, 0, 1, 0, 0, wh, wh, 0.045);
    // gableRoof adds [roof, gables]: tag the roof slabs
    rg.parts[0].attributes.aE.array.fill(1);
    g.parts.push(...rg.parts); return g.build();
  })();
  const blockGeo = (() => {
    const g = new Geo(); const wh = [1, 1, 1];
    const bx = new THREE.BoxGeometry(1, 1.5, 1); bx.translate(0, 0.25, 0); g.add(bx, wh);
    const top = new THREE.BoxGeometry(1.01, 0.03, 1.01); top.translate(0, 1.0, 0); g.add(top, wh, null, 2);
    return g.build();
  })();
  const houseMat = ctx.makeMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 }, {
    defines: { NO_CITY_LIGHTS: 1 },
    vertexPars: 'attribute float aE; varying float vE; varying vec3 vLoc; varying vec3 vScl; varying float vSeed;',
    vertex: /* glsl */`vE = aE;
      #ifdef USE_INSTANCING
        vScl = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
      #else
        vScl = vec3(1.0); vSeed = 0.5;
      #endif
      vLoc = position * vScl;`,
    fragPars: 'varying float vE; varying vec3 vLoc; varying vec3 vScl; varying float vSeed;',
    color: /* glsl */`
      vec3 wallC_ = diffuseColor.rgb; float lit_ = 0.0; vec3 litC_ = vec3(1.0, 0.62, 0.28);
      float wn_ = vnoise(vWPos.xz * 0.45 + vWPos.y * 0.7);
      if (vE > 1.5) diffuseColor.rgb = vec3(0.1, 0.1, 0.105) * (0.7 + 0.6 * wn_);
      else if (vE > 0.5) {
        float rs_ = hash11(vSeed * 91.7);
        vec3 rc_ = mix(vec3(0.3, 0.11, 0.065), vec3(0.42, 0.2, 0.11), rs_);
        if (hash11(vSeed * 17.3) > 0.82) rc_ = vec3(0.1, 0.105, 0.12);
        if (vScl.x > 15.0) rc_ = mix(vec3(0.16, 0.16, 0.17), vec3(0.3, 0.18, 0.13), step(0.6, rs_));
        diffuseColor.rgb = rc_ * (0.75 + 0.5 * wn_);
      } else {
        float fxd_ = 0.5 * vScl.x - abs(vLoc.x), fzd_ = 0.5 * vScl.z - abs(vLoc.z);
        float u_ = fxd_ < fzd_ ? vLoc.z + (vLoc.x > 0.0 ? 13.0 : 41.0) : vLoc.x + (vLoc.z > 0.0 ? 29.0 : 57.0);
        vec2 g_ = vec2(u_ / 2.7, (vLoc.y - 0.25) / 2.9); vec2 id_ = floor(g_); vec2 f_ = fract(g_);
        float body_ = step(0.3, vLoc.y) * step(vLoc.y, vScl.y - 0.45) * (vScl.x > 15.0 ? 0.25 : 1.0);
        float inwin_ = step(0.3, f_.x) * step(f_.x, 0.7) * step(0.32, f_.y) * step(f_.y, 0.75) * body_;
        float lod_ = smoothstep(0.3, 0.8, fwidth(g_.x) + fwidth(g_.y));
        float hl_ = 0.12 + 0.42 * hash11(vSeed * 53.1);                       // share of lit windows differs per house
        float on_ = step(hash12(id_ + vSeed * 311.0), hl_);
        float win_ = mix(inwin_, 0.17 * body_, lod_);
        float wallId_ = fxd_ < fzd_ ? (vLoc.x > 0.0 ? 1.0 : 2.0) : (vLoc.z > 0.0 ? 3.0 : 4.0);
        float farOn_ = step(hash11(vSeed * 77.0 + wallId_ * 13.7), 0.3);                 // far away: a few walls carry the light of the whole house -> sparkle, not a glowing box
        lit_ = mix(inwin_ * on_, 0.17 * hl_ * body_ * farOn_ / 0.3, lod_);
        litC_ = mix(vec3(1.0, 0.58, 0.25), vec3(1.0, 0.82, 0.58), hash12(id_ + 7.0 + vSeed * 40.0));
        diffuseColor.rgb = mix(wallC_ * (0.82 + 0.36 * wn_), vec3(0.03, 0.035, 0.04), win_);
      }`,
    surface: 'roughnessFactor = mix(roughnessFactor, 0.25, step(vE, 0.5) * lit_ * 0.0);',
    emissive: 'totalEmissiveRadiance += litC_ * lit_ * 4.5 * smoothstep(0.04, 0.55, uNight);',
  });
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const instance = (geo, mat, list, name, fn) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((o, i) => { fn(o); M.compose(p, q, s); im.setMatrixAt(i, M); im.setColorAt(i, col); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.name = name; im.receiveShadow = true; group.add(im); return im;
  };
  const hfn = o => { p.set(o.x, o.y, o.z); q.setFromAxisAngle(up, o.ry); s.set(o.w, o.h, o.d); col.setRGB(o.col[0], o.col[1], o.col[2]); };
  instance(houseGeo, houseMat, houses, 'houses', hfn);
  instance(blockGeo, houseMat, blocks, 'outskirtBlocks', hfn);

  // ---- props: road, mast, chapel, observatory, chimneys, tank farms -------------------------------------------------------------------
  const P = S.farProps;
  // summit for the radio mast
  let top = { x: 2300, z: 0, y: -1 };
  for (let x = 1900; x <= 2650; x += 50) for (let z = -700; z <= 900; z += 50) { const y = landH(x, z); if (y > top.y) top = { x, z, y }; }
  {
    const red = C(0xb02a1c), wht = C(0xdcd8cc), H = 92, N = 14;
    const leg = (i, y) => { const a = i * 2.0944 + 0.4, r = lerp(4.6, 0.9, y / H); return [top.x + Math.cos(a) * r, top.y + y, top.z + Math.sin(a) * r]; };
    for (let k = 0; k < N; k++) {
      const y0 = k * H / N, y1 = (k + 1) * H / N, c = k % 2 ? wht : red;
      for (let i = 0; i < 3; i++) { P.beam(leg(i, y0), leg(i, y1), 0.42, c); P.beam(leg(i, y0), leg((i + 1) % 3, y1), 0.24, c); P.beam(leg(i, y1), leg((i + 1) % 3, y1), 0.24, c); }
    }
    P.beam([top.x, top.y + H, top.z], [top.x, top.y + H + 12, top.z], 0.3, wht);
    for (const [y, a] of [[58, 0.5], [64, 2.4], [70, 4.2], [52, 3.3]]) P.cyl(1.5, 1.5, 0.7, top.x + Math.cos(a) * 2.6, top.y + y, top.z + Math.sin(a) * 2.6, wht, { seg: 10, rz: Math.PI / 2, ry: -a });
    P.box(7, 3.2, 5, top.x + 8, top.y + 1.4, top.z + 3, C(0xa9a59a));
    S.sprites.add(top.x, top.y + H + 12.5, top.z, [1.0, 0.06, 0.03], 900, 0.5, [2.6, 0.5, 0, 1]);
    S.sprites.add(top.x, top.y + H * 0.66, top.z, [1.0, 0.06, 0.03], 450, 0.45); S.sprites.add(top.x, top.y + H * 0.33, top.z, [1.0, 0.06, 0.03], 450, 0.45);
  }
  // chapel on a spur north of the centre, observatory on a knoll to the south
  const chap = { x: hillX0(-420) + 640, z: -420 }; chap.y = landH(chap.x, chap.z);
  {
    const wh = C(0xd9d3c4), rf = C(0x6a3324); const { x, y, z } = chap;
    P.box(7.5, 7, 15, x, y + 3, z, wh); gableRoof(P, 7.5, 15, 3.6, x, y + 6.5, z, 0, rf, wh, 0.4);
    P.box(3.6, 16, 3.6, x, y + 7.5, z + 8.6, wh); P.add(new THREE.ConeGeometry(2.9, 6.5, 4), rf, Geo.mat(x, y + 18.7, z + 8.6, 0, Math.PI / 4, 0));
    P.box(0.16, 2.2, 0.16, x, y + 23, z + 8.6, C(0x222222)); P.box(0.16, 0.16, 1.2, x, y + 23.3, z + 8.6, C(0x222222));
    P.box(0.1, 2.2, 1.0, x - 3.78, y + 3.6, z - 2, [1.0, 0.7, 0.36], { e: 6 }); P.box(0.1, 2.2, 1.0, x - 3.78, y + 3.6, z + 2, [1.0, 0.7, 0.36], { e: 6 });
    P.box(1.2, 1.6, 0.1, x - 0, y + 12.6, z + 10.42, C(0x15120f));
    S.sprites.add(x - 6, y + 5, z + 9, [1.0, 0.7, 0.36], 60, 0.5);
  }
  const obs = { x: hillX0(830) + 900, z: 830 }; obs.y = landH(obs.x, obs.z);
  {
    const wh = C(0xdedad0); const { x, y, z } = obs;
    P.cyl(5.2, 5.4, 6.5, x, y - 1, z, wh, { seg: 20 }); P.sphere(5.5, x, y + 5.5, z, C(0xc9cdd0), { ws: 20, hs: 10 });
    P.box(1.5, 5.2, 5.6, x - 2.2, y + 8.2, z, C(0x1a1c20), { rz: 0.5 });
    P.box(12, 4.2, 7, x + 9, y + 1.2, z + 2, wh); P.box(12.6, 0.3, 7.6, x + 9, y + 3.45, z + 2, C(0x5c5f63));
  }
  // industrial outskirts: chimneys and tank farms near the coast
  const brick = C(0x7a4030), conc = C(0x9a968c), wht = C(0xd8d4c8), rst = C(0x86492f);
  const chimneys = [[QX + 210, b.z0 - 420, 62, brick], [QX + 260, b.z0 - 470, 48, brick], [QX + 330, b.z1 + 610, 74, conc], [QX + 620, b.z0 - 980, 55, conc], [QX + 180, b.z1 + 1120, 50, brick]];
  for (const [x, z, h, c] of chimneys) {
    P.cyl(h * 0.03, h * 0.058, h * 0.86, x, G0, z, c, { seg: 12 });
    for (let k = 0; k < 3; k++) P.cyl(h * (0.03 - 0.0012 * (k + 1)), h * (0.03 - 0.0012 * k), h * 0.047, x, G0 + h * (0.86 + 0.047 * k), z, k % 2 ? wht : C(0xa8281c), { seg: 12 });
    S.sprites.add(x, G0 + h + 1, z, [1.0, 0.06, 0.03], 300, 0.4, [3.2, 0.5, hash2(x, z, 1), 1]);
  }
  for (const [tx, tz, n] of [[QX + 130, b.z1 + 380, 7], [QX + 150, b.z0 - 700, 6], [QX + 420, b.z1 + 900, 5]]) for (let i = 0; i < n; i++) {
    const r = 9 + R() * 8, h = 9 + R() * 7; const x = tx + (i % 3) * 42 + R() * 6, z = tz + Math.floor(i / 3) * 44 + R() * 6; const c = pick([wht, wht, rst, conc]);
    P.cyl(r, r, h, x, G0, z, c, { seg: 18 }); P.cyl(0.4, r, r * 0.13, x, G0 + h, z, c, { seg: 18 });
    lamps.push([x + r + 3, G0 + 10, z]);
  }

  // winding road from the east edge of the grid up to the summit, with lamp dots
  {
    const ax = hl.x0 - 30, az = ZC + 190; const pts = [];
    const n = 300; let acc = 0, prev = null; const pos = [], colr = [], ae = [];
    const P2 = t => { const x = lerp(ax, top.x - 30, Math.pow(t, 0.9)); const zc = lerp(az, top.z, t); const amp = 300 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 40; return [x, zc + amp * Math.sin(t * 6.2832 * 3.2) * (1 - 0.35 * t)]; };
    for (let i = 0; i <= n; i++) {
      const t = i / n, [x, z] = P2(t), [x2, z2] = P2(Math.min(1, t + 0.002)), [x1, z1] = P2(Math.max(0, t - 0.002));
      let tx = x2 - x1, tz = z2 - z1; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const y = landH(x, z) + 0.35; if (prev) acc += Math.hypot(x - prev[0], z - prev[1]); prev = [x, z];
      pts.push({ x, y, z, nx: -tz, nz: tx, s: acc });
    }
    for (let i = 0; i < n; i++) {
      const a = pts[i], c = pts[i + 1], w = 3.6;
      const A = [a.x - a.nx * w, a.y, a.z - a.nz * w], B = [a.x + a.nx * w, a.y, a.z + a.nz * w], Cc = [c.x - c.nx * w, c.y, c.z - c.nz * w], D = [c.x + c.nx * w, c.y, c.z + c.nz * w];
      pos.push(...A, ...B, ...D, ...A, ...D, ...Cc, ...A, ...D, ...B, ...A, ...Cc, ...D); ae.push(a.s, a.s, c.s, a.s, c.s, c.s, a.s, c.s, a.s, a.s, c.s, c.s);
      for (let k = 0; k < 12; k++) colr.push(0.1, 0.098, 0.095);
    }
    let lastLamp = -100;
    for (const a of pts) if (a.s - lastLamp >= 42) { lastLamp = a.s; S.sprites.add(a.x + a.nx * 4.5, a.y + 7.5, a.z + a.nz * 4.5, [1.0, 0.62, 0.27], 55, 0.34); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colr), 3)); g.setAttribute('aE', new THREE.BufferAttribute(new Float32Array(ae), 1));
    g.computeVertexNormals(); g.computeBoundingSphere();
    const roadMat = ctx.makeMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9 }, {
      defines: { NO_CITY_LIGHTS: 1 }, vertexPars: 'attribute float aE; varying float vE;', vertex: 'vE = aE;', fragPars: 'varying float vE;',
      color: 'diffuseColor.rgb *= 0.8 + 0.4 * vnoise(vWPos.xz * 0.6);',
      emissive: '{ float lp_ = abs(fract(vE / 42.0 + 0.5) - 0.5) * 42.0; totalEmissiveRadiance += vec3(1.0, 0.6, 0.27) * diffuseColor.rgb * 5.0 * exp(-lp_ * lp_ / 60.0) * smoothstep(0.04, 0.5, uNight); }',
    });
    const rm = new THREE.Mesh(g, roadMat); rm.name = 'hillRoad'; rm.receiveShadow = true; group.add(rm);
  }

  // ---- trees: woods on the slopes and capes, plus the garden / street trees collected above ------------------------------------------
  for (let z = GZ0 + 60; z < GZ0 + NZ * STEP - 60; z += 42) for (let x = QX; x < GX0 + NX * STEP - 40; x += 42) {
    const px = x + (R() - 0.5) * 38, pz = z + (R() - 0.5) * 38; const r1 = R(), r2 = R();
    if (px < coastX(pz) + 40) continue;
    const k = px - hillX0(pz), du = cityDist(pz);
    if (k < 30 && du < 900) continue;
    const w = woods(px, pz); if (w < 0.25 + r1 * 0.6) continue;
    if (k > 1500 && r2 < 0.5) continue;
    trees.push({ x: px, z: pz, s: 10 + r2 * 9 });
  }
  const treeGeo = (() => {
    let g = new THREE.IcosahedronGeometry(1, 1); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-3);
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) { const x = a.getX(i), y = a.getY(i), z = a.getZ(i); const kk = 0.8 + 0.45 * vnoise(x * 2.1 + 5, z * 2.1 + y * 3, 8); a.setXYZ(i, x * kk, (y * 0.5 + 0.5) * (0.9 + 0.3 * kk), z * kk); }
    g.computeVertexNormals(); g.computeBoundingSphere(); return g;
  })();
  const treeMat = ctx.makeMaterial({ color: 0xffffff, roughness: 0.9 }, {
    defines: { NO_CITY_LIGHTS: 1 },
    color: 'diffuseColor.rgb *= (0.6 + 0.8 * fbm3(vWPos * 0.21)) * (0.5 + 0.5 * smoothstep(-0.5, 0.7, vWNormal.y));',
  });
  const tim = instance(treeGeo, treeMat, trees, 'trees', o => {
    const y = o.y ?? landH(o.x, o.z); const r1 = hash2(Math.round(o.x * 3), Math.round(o.z * 3), 9), r2 = hash2(Math.round(o.x * 3), Math.round(o.z * 3), 10);
    p.set(o.x, y - 0.4, o.z); q.setFromAxisAngle(up, r1 * 6.28); s.set(o.s * (0.85 + 0.4 * r2), o.s * (1.0 + 0.7 * r1), o.s * (0.85 + 0.4 * (1 - r2)));
    const dry = r2 * r2; col.setRGB(lerp(0.035, 0.085, dry), lerp(0.055, 0.085, dry * 0.8 + r1 * 0.2), lerp(0.022, 0.03, dry));
  });
  tim.receiveShadow = false;
  for (const l of lamps) S.sprites.add(l[0], l[1], l[2], [1.0, 0.63, 0.29], 40, 0.34);

  S.stats.houses = houses.length; S.stats.blocks = blocks.length; S.stats.trees = trees.length;
  return { group, landH, coastX, hillX0, summit: top, chapel: chap, observatory: obs };
}
