// The Lantern Tower crown: an octagonal glass lamp room ringed by stepped stone buttresses and finials, with a
// lighthouse-like lens inside, a brass ogee cap, a small upper cupola and a tapering spire with a beacon.
// Built in local coordinates: origin = centre of the last tier's roof (y = crown.y0 + GROUND_Y).
import * as THREE from 'three';
import { Geo, lin, mul, TRS } from './kit.js';
import { M, makePropMaterial } from './materials.js';

const TAU = Math.PI * 2, A0 = Math.PI / 8;       // octagon with flat faces toward +-X / +-Z

export function buildLantern(ctx, K, group) {
  const b = ctx.layout.buildings.find(q => q.landmark === 'lantern');
  if (!b || !b.crown) return null;
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, y0 = ctx.GROUND_Y + b.crown.y0;
  const RG = b.crown.radius;                       // glass circumradius (7.5)
  const HT = b.crown.y1 - b.crown.y0;              // 24: top of the brass cap
  const tierHalf = (b.x1 - b.x0) / 2 - b.tiers[b.tiers.length - 1].inset;   // 9.5

  const stone = lin(0xcbbfa6), stoneLt = mul(stone, 1.1), bronze = lin(0x4a3a26), brass = lin(0xd9a441), brassDk = lin(0xa87a2c), gold = lin(0xf0c05a);
  const yGlass0 = 3.3, yGlass1 = 19.0, yLamp = 10.4;
  const lampWorld = new THREE.Vector3(cx, y0 + yLamp, cz);
  const uni = { uLampPos: { value: lampWorld }, uLampPow: { value: new THREE.Vector4(520, 70, 16.4, 2.5 - yLamp) } };
  const crownMat = makePropMaterial(ctx, { crown: true, uniforms: uni });

  const g = new Geo();
  const oct = (r0, r1, ya, h, opt = {}) => g.cyl(0, ya, 0, r0, r1, h, 8, { a0: A0, smooth: false, capT: false, ...opt });

  // ---- stone plinth (three steps) ------------------------------------------------------------------
  g.set(stone, M.ASHLAR);
  g.lathe(0, 0, [[9.6, 0], [9.6, 1.2], [9.05, 1.2], [9.05, 2.2], [8.45, 2.2], [8.45, 2.9], [7.6, 2.9]], 8, { a0: A0, smooth: false });
  // bronze sill under the glass
  g.set(bronze, M.BRASS);
  g.lathe(0, 0, [[7.9, 2.9], [7.9, 3.3], [7.45, 3.3]], 8, { a0: A0, smooth: false });

  // ---- glazing bars ------------------------------------------------------------------------------------
  g.set(bronze, M.BRASS);
  const transoms = [7.2, 11.1, 15.0, 17.7];
  for (const ty of transoms) oct(RG + 0.07, RG + 0.07, ty - 0.11, 0.22);
  for (let k = 0; k < 8; k++) {
    const a = A0 + k * TAU / 8;
    g.push(TRS(0, 0, 0, -a));                                   // local +X = radial direction of this vertex
    g.box(RG + 0.02, (yGlass0 + yGlass1) / 2, 0, 0.46, yGlass1 - yGlass0, 0.46, 'yY');
    g.pop();
    // two slim mullions per face (three lights), face centred at angle am
    const am = (k + 1) * TAU / 8; const ap = RG * Math.cos(Math.PI / 8); const fw = 2 * RG * Math.sin(Math.PI / 8);
    g.push(TRS(0, 0, 0, -am));
    for (const u of [-1 / 6, 1 / 6]) g.box(ap + 0.03, (yGlass0 + yGlass1) / 2, u * fw, 0.16, yGlass1 - yGlass0, 0.13, 'yY');
    // pointed heads in the top register (two rafters per light)
    for (let i = 0; i < 3; i++) {
      const zc = (i - 1) * fw / 3, hw = fw / 6 - 0.08;
      g.beam([ap + 0.03, 17.8, zc - hw], [ap + 0.03, 18.9, zc], 0.1, 0.1, [1, 0, 0], 'zZ');
      g.beam([ap + 0.03, 17.8, zc + hw], [ap + 0.03, 18.9, zc], 0.1, 0.1, [1, 0, 0], 'zZ');
    }
    g.pop();
  }

  // ---- entablature + brass ogee cap ---------------------------------------------------------------------
  g.set(brassDk, M.BRASS);
  g.lathe(0, 0, [[7.5, 19.0], [7.95, 19.0], [7.95, 19.9], [8.4, 19.9], [8.4, 20.3], [7.7, 20.3]], 8, { a0: A0, smooth: false });
  g.set(brass, M.BRASS);
  const capProf = [[7.7, 20.3], [7.0, 21.3], [5.6, 22.5], [4.1, 23.3], [3.2, 24.0]];
  g.lathe(0, 0, capProf, 8, { a0: A0, smooth: false });
  g.set(gold, M.BRASS);
  for (let k = 0; k < 8; k++) {                                  // ribs along the hips
    const a = A0 + k * TAU / 8, c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < capProf.length - 1; i++) g.beam([c * capProf[i][0], capProf[i][1], s * capProf[i][0]], [c * capProf[i + 1][0], capProf[i + 1][1], s * capProf[i + 1][0]], 0.22, 0.2, [c, 0, s], 'zZ');
  }

  // ---- cupola (small upper lantern) ----------------------------------------------------------------------
  const yc0 = 24.7, yc1 = 28.6, RC = 2.35;
  g.set(brassDk, M.BRASS);
  g.lathe(0, 0, [[3.2, 24.0], [3.2, 24.35], [2.75, 24.35], [2.75, 24.7], [RC - 0.05, 24.7]], 8, { a0: A0, smooth: false });
  g.set(bronze, M.BRASS);
  for (let k = 0; k < 8; k++) { const a = A0 + k * TAU / 8; g.push(TRS(0, 0, 0, -a)); g.box(RC, (yc0 + yc1) / 2, 0, 0.2, yc1 - yc0, 0.2, 'yY'); g.pop(); }
  oct(RC + 0.04, RC + 0.04, 26.55, 0.14);
  g.set(brass, M.BRASS);
  g.lathe(0, 0, [[RC - 0.05, yc1], [2.85, yc1], [2.85, 29.0], [2.2, 29.5], [1.25, 30.6], [0.7, 32.0], [0.46, 33.2]], 8, { a0: A0, smooth: false });

  // ---- spire / mast ------------------------------------------------------------------------------------------
  g.set(brassDk, M.BRASS);
  g.lathe(0, 0, [[0.46, 33.2], [0.33, 38.5], [0.22, 46.5], [0.1, 55.4]], 8, {});
  g.cyl(0, 55.4, 0, 0.1, 0.0, 0.25, 6, { capT: false, smooth: false });
  g.set(gold, M.BRASS);
  g.sphere(0, 34.4, 0, 0.82, 12, 8);
  g.sphere(0, 41.2, 0, 0.42, 10, 6);
  g.cyl(0, 47.4, 0, 0.5, 0.5, 0.12, 10, { capT: true, capB: true });
  for (let k = 0; k < 4; k++) { const a = k * TAU / 4; g.beam([0, 47.46, 0], [Math.cos(a) * 1.5, 47.46, Math.sin(a) * 1.5], 0.07, 0.07, null, 'z'); g.sphere(Math.cos(a) * 1.5, 47.46, Math.sin(a) * 1.5, 0.14, 6, 4); }

  // ---- stepped buttress piers at the eight corners --------------------------------------------------------
  for (let k = 0; k < 8; k++) {
    const a = A0 + k * TAU / 8;
    g.push(TRS(0, 0, 0, -a));
    const step = (r0, r1, w, ya, yb) => {
      g.set(stone, M.ASHLAR); g.box((r0 + r1) / 2, (ya + yb) / 2, 0, r1 - r0, yb - ya, w, 'y');
      g.set(stoneLt, M.CONCRETE); g.box((r0 + r1) / 2 + 0.06, yb + 0.11, 0, r1 - r0 + 0.3, 0.22, w + 0.3, '');
    };
    step(7.35, 10.05, 1.5, 0, 9.4);
    step(7.35, 9.2, 1.2, 9.62, 13.5);
    step(7.35, 8.5, 0.95, 13.72, 16.5);
    g.set(stoneLt, M.CONCRETE);
    g.push(TRS(7.92, 16.72, 0, Math.PI / 4)); g.cyl(0, 0, 0, 0.62, 0.0, 2.1, 4, { capT: false, smooth: false }); g.pop();
    g.pop();
  }

  // ---- four corner pylons on the tier corners + flying struts to the lantern ---------------------------
  const pc = tierHalf - 1.4;
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const px = sx * pc, pz = sz * pc;
    const tier = (s, ya, yb) => {
      g.set(stone, M.ASHLAR); g.box(px, (ya + yb) / 2, pz, s, yb - ya, s, 'y');
      g.set(stoneLt, M.CONCRETE); g.box(px, yb + 0.12, pz, s + 0.34, 0.24, s + 0.34, '');
    };
    tier(2.5, 0, 7.0); tier(1.9, 7.24, 11.0); tier(1.3, 11.24, 13.9);
    g.set(stoneLt, M.CONCRETE);
    g.push(TRS(px, 14.14, pz, Math.PI / 4)); g.cyl(0, 0, 0, 0.82, 0.0, 3.7, 4, { capT: false, smooth: false }); g.pop();
    // flying strut landing on the 15.0 transom of the diagonal face
    g.set(stone, M.ASHLAR);
    const qa = RG * Math.cos(Math.PI / 8) / Math.SQRT2 + 0.15;
    g.beam([sx * (pc - 0.7), 10.2, sz * (pc - 0.7)], [sx * qa, 15.4, sz * qa], 0.5, 0.75, [0, 1, 0], '');
  }

  // ---- interior: floor, pedestal, colonnade, gallery, stair ------------------------------------------------
  g.set(lin(0x5b4a3a), M.PLANKS);
  g.cyl(0, 3.3, 0, 7.4, 7.4, 0.06, 8, { a0: A0, capT: true, smooth: false });
  g.set(brassDk, M.BRASS);
  g.cyl(0, 3.36, 0, 2.1, 1.7, 2.3, 16, { capT: true });
  g.cyl(0, 15.1, 0, 2.0, 0.5, 1.3, 16, { capT: true });
  g.cyl(0, 16.4, 0, 0.14, 0.14, 4.0, 6, { capT: false });
  for (const ry of [5.66, 7.6, 10.4, 13.2, 15.1]) { const rr = ry === 10.4 ? 3.08 : (ry === 7.6 || ry === 13.2 ? 2.78 : 1.98); g.cyl(0, ry - 0.09, 0, rr, rr, 0.18, 16, { capT: false }); }
  for (let k = 0; k < 8; k++) { const a = k * TAU / 8; const c = Math.cos(a), s = Math.sin(a); g.beam([c * 1.95, 5.66, s * 1.95], [c * 3.1, 10.4, s * 3.1], 0.1, 0.1, [c, 0, s], 'zZ'); g.beam([c * 3.1, 10.4, s * 3.1], [c * 1.95, 15.1, s * 1.95], 0.1, 0.1, [c, 0, s], 'zZ'); }
  g.set(bronze, M.IRON);
  for (let k = 0; k < 8; k++) {
    const a = A0 + k * TAU / 8, c = Math.cos(a), s = Math.sin(a);
    g.cyl(c * 5.3, 3.36, s * 5.3, 0.13, 0.11, 15.4, 6, { capT: false });
    g.beam([c * 5.3, 18.7, s * 5.3], [c * 7.4, 18.95, s * 7.4], 0.14, 0.2, null, 'zZ');                  // rafters to the corner posts
    const a2 = A0 + (k + 1) * TAU / 8;
    g.beam([c * 5.3, 18.7, s * 5.3], [Math.cos(a2) * 5.3, 18.7, Math.sin(a2) * 5.3], 0.12, 0.18, null, 'zZ');   // ring beam
    g.beam([c * 5.3, 11.0, s * 5.3], [c * 7.4, 11.0, s * 7.4], 0.1, 0.16, null, 'zZ');                    // gallery brackets
  }
  // gallery ring at the middle transom
  g.set(lin(0x3a3632), M.IRON);
  g.ring(0, 11.1, 0, 6.2, 7.42, 8, 1, A0); g.ring(0, 11.02, 0, 6.2, 7.42, 8, -1, A0);
  oct(6.2, 6.2, 12.1, 0.06);
  // spiral stair from the floor to the gallery
  const nSt = 30;
  for (let i = 0; i < nSt; i++) {
    const a = (i / nSt) * TAU * 1.25 + 0.4, yy = 3.5 + (i + 0.5) * (11.0 - 3.5) / nSt;
    g.push(TRS(Math.cos(a) * 4.3, yy, Math.sin(a) * 4.3, -a)); g.box(0, 0, 0, 1.15, 0.06, 0.42, ''); g.pop();
    if (i < nSt - 1) {
      const a2 = ((i + 1) / nSt) * TAU * 1.25 + 0.4, y2 = 3.5 + (i + 1.5) * (11.0 - 3.5) / nSt;
      g.beam([Math.cos(a) * 4.85, yy + 0.95, Math.sin(a) * 4.85], [Math.cos(a2) * 4.85, y2 + 0.95, Math.sin(a2) * 4.85], 0.05, 0.05, null, 'zZ');
    }
  }
  // uplight fixtures on the plinth, one per face
  g.set(lin(0x2a2a2a), M.IRON);
  for (let k = 0; k < 8; k++) { const a = k * TAU / 8; g.push(TRS(Math.cos(a) * 8.6, 2.2, Math.sin(a) * 8.6, -a)); g.box(0, 0.16, 0, 0.42, 0.32, 0.6, 'y'); g.pop(); }

  const solid = new THREE.Mesh(g.build(), crownMat);
  solid.position.set(cx, y0, cz); solid.castShadow = true; solid.receiveShadow = true; solid.name = 'roof_lantern_solid';
  group.add(solid);

  // ---- the lens (lighthouse optic): glass barrel that carries the light --------------------------------
  const lg = new Geo(); lg.set([1, 1, 1], 0);
  lg.lathe(0, 0, [[1.9, 5.66], [2.7, 7.6], [3.0, 10.4], [2.7, 13.2], [1.9, 15.1]], 24, {});
  const lensMat = ctx.makeMaterial({ color: 0xcfd6c4, roughness: 0.12, metalness: 0.0 }, {
    key: 'rooflens',
    fragPars: 'uniform vec3 uLampPos;',
    uniforms: uni,
    color: /* glsl */`
    {
      float rings = smoothstep(0.25, 0.5, abs(fract(vWPos.y * 2.6) - 0.5));
      diffuseColor.rgb *= mix(0.45, 1.0, rings);
    }`,
    emissive: /* glsl */`
    {
      vec2 d = vWPos.xz - uLampPos.xz; float ang = atan(d.y, d.x);
      float rings = 0.55 + 0.45 * smoothstep(0.2, 0.5, abs(fract(vWPos.y * 2.6) - 0.5));
      float facets = 0.78 + 0.22 * cos(ang * 16.0 + uTime * 0.22);
      float bull = exp(-pow((vWPos.y - uLampPos.y) / 2.6, 2.0));
      float lvl = max(uNight, 0.035);
      totalEmissiveRadiance += vec3(1.0, 0.66, 0.3) * (28.0 + 34.0 * bull) * rings * facets * lvl * (1.0 + 0.03 * sin(uTime * 0.9));
    }`,
  });
  const lens = new THREE.Mesh(lg.build(), lensMat);
  lens.position.copy(solid.position); lens.castShadow = false; lens.name = 'roof_lantern_lens';
  group.add(lens);

  // ---- glass: outer skin (front faces) + far side seen through the room (back faces) -----------------
  const gg = new Geo(); gg.set([1, 1, 1], 0);
  const tiersU = (yGlass1 - yGlass0) / 3.9;
  const glassOct = (R, ya, yb, panesU, panesV, kind) => {
    for (let k = 0; k < 8; k++) {
      const aa = A0 + k * TAU / 8, ab = A0 + (k + 1) * TAU / 8;
      const A = [Math.cos(aa) * R, ya, Math.sin(aa) * R], B = [Math.cos(ab) * R, ya, Math.sin(ab) * R];
      const C = [Math.cos(ab) * R, yb, Math.sin(ab) * R], D = [Math.cos(aa) * R, yb, Math.sin(aa) * R];
      const am = (aa + ab) / 2;
      gg.mat = kind + k * 0.01;                                 // aMat carries: lantern (0) / cupola (1) + face index
      gg.quad(A, D, C, B, [0, 0, panesU, panesV], [Math.cos(am), 0, Math.sin(am)]);
    }
  };
  // quad(A, D, C, B) -> uv u runs bottom->top; swap so that u is horizontal
  glassOct(RG, yGlass0, yGlass1, tiersU, 3, 0);
  glassOct(RC, yc0, yc1, 2, 1, 1);
  const ggeo = gg.build();
  const glassUni = { ...uni, uGlass: { value: new THREE.Vector4(y0 + yGlass0, y0 + yGlass1, 16, y0 + yc0) } };
  const mkGlass = (back) => ctx.makeMaterial({
    color: 0x9fc4b4, roughness: 0.07, metalness: 0.9, transparent: true, depthWrite: false,
    side: back ? THREE.BackSide : THREE.FrontSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }, {
    key: 'roofglass' + (back ? 'B' : 'F'),
    uniforms: glassUni,
    defines: back ? { GLASS_BACK: 1 } : {},
    vertexPars: 'attribute float aMat; varying float vMat; varying vec2 vUv2;',
    vertex: 'vMat = aMat; vUv2 = uv;',
    fragPars: 'uniform vec3 uLampPos; uniform vec4 uGlass; varying float vMat; varying vec2 vUv2; float gDirt;',
    color: /* glsl */`
    {
      gDirt = fbm2(vUv2.yx * 1.7 + vMat * 31.0);
      diffuseColor.rgb = mix(vec3(0.2, 0.27, 0.24), vec3(0.3, 0.3, 0.27), smoothstep(0.45, 0.8, gDirt) * 0.5);
    }`,
    surface: 'roughnessFactor = 0.05 + 0.12 * gDirt;',
    normal: /* glsl */`
    {
      vec2 pid = floor(vUv2.yx) + floor(vMat * 100.0 + 0.5) * 7.0;
      vec3 j = hash32(pid) - 0.5;
      normal = normalize(normal + vec3(j.xy, 0.0) * 0.045);
    }`,
    emissive: /* glsl */`
    {
      bool cup = vMat > 0.5;
      float hy = cup ? 0.5 : clamp((vWPos.y - uGlass.x) / (uGlass.y - uGlass.x), 0.0, 1.0);
      float grad = 0.3 + 0.7 * exp(-pow((hy - 0.45) / 0.36, 2.0));
      vec2 d = vWPos.xz - uLampPos.xz;
      float fall = cup ? 1.0 : 48.0 / dot(d, d);
      vec2 pid = floor(vUv2.yx) + floor(vMat * 100.0 + 0.5) * 7.0;
      float pane = 0.82 + 0.18 * hash12(pid + 3.0);
      float frost = 0.72 + 0.28 * fbm2(vUv2.yx * 2.3 + vMat * 17.0);
      vec3 warm = mix(vec3(1.0, 0.4, 0.09), vec3(1.0, 0.6, 0.24), grad);
      float lvl = uNight * (1.0 + 0.03 * sin(uTime * 0.9));
      #ifdef GLASS_BACK
        lvl *= 0.55;
      #endif
      totalEmissiveRadiance += warm * uGlass.z * (cup ? 0.8 : 1.0) * grad * fall * pane * frost * lvl;
    }`,
    final: /* glsl */`
    {
      float ndv = abs(dot(normalize(vViewPosition), normal));
      float fres = pow(1.0 - ndv, 4.0);
      float a = mix(0.42, 0.96, fres) + 0.2 * smoothstep(0.45, 0.8, gDirt);
      #ifdef GLASS_BACK
        a *= 0.45;
      #endif
      a = mix(a, max(a, 0.6), uNight);
      diffuseColor.a = clamp(a, 0.0, 1.0);
    }`,
  });
  const gBack = new THREE.Mesh(ggeo, mkGlass(true)); gBack.position.copy(solid.position); gBack.renderOrder = 5; gBack.layers.set(1); gBack.name = 'roof_lantern_glass_in';
  const gFront = new THREE.Mesh(ggeo, mkGlass(false)); gFront.position.copy(solid.position); gFront.renderOrder = 6; gFront.layers.set(1); gFront.name = 'roof_lantern_glass_out';
  group.add(gBack, gFront);

  // ---- lights (purely emissive): halo of the lamp room, cupola lamp, uplights, beacon ------------------
  const S = K.sprites;
  S.halo(cx, y0 + yLamp, cz, 34, [0.13, 0.075, 0.03]);
  S.halo(cx, y0 + 26.6, cz, 10, [0.12, 0.075, 0.03]);
  S.lamp(cx, y0 + 26.6, cz, 1.3, [30, 20, 9], { minPx: 1.0 });                                  // cupola lamp
  for (let k = 0; k < 8; k++) { const a = k * TAU / 8; S.lamp(cx + Math.cos(a) * 8.6, y0 + 2.62, cz + Math.sin(a) * 8.6, 0.2, [34, 24, 12], { minPx: 0.8 }); }
  S.lamp(cx, y0 + 55.9, cz, 0.55, [70, 3.2, 1.6], { day: 0.07, pulse: 1.75, phase: 0.0, minPx: 1.9 });       // red beacon on the spire tip
  S.lamp(cx, y0 + 47.9, cz, 0.3, [26, 1.4, 0.7], { day: 0.07, pulse: 1.75, phase: 0.0, minPx: 1.3 });
  // warm wash from the lamp room on the roof of the last tier
  S.pool(cx, y0 + 0.12, cz, [tierHalf, 0, 0], [0, 0, tierHalf], [0.5, 0.3, 0.12]);

  return {
    center: [cx, y0 + yLamp, cz], base: y0, top: y0 + 55.9, capTop: y0 + HT, radius: RG,
    meshes: { solid, lens, glass: [gBack, gFront] },
    /** tuning handles: uGlass.value.z = glass HDR level, uLampPow.value.x / .y = lamp / uplight wash on the stonework */
    uniforms: { uGlass: glassUni.uGlass, uLampPow: uni.uLampPow },
  };
}
