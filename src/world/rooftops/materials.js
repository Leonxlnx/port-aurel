// Rooftop materials. One "universal" prop material whose look is selected per vertex / per instance by a
// material id (aMat), a roof-finish material, skylight glass, and the unlit helpers (sprites, steam).
import * as THREE from 'three';

/** material ids understood by the universal prop shader */
export const M = {
  CONCRETE: 0, BRICK: 1, PAINT: 2, GALV: 3, STAVES: 4, FELT: 5, LOUVER: 6, FAN: 7, SOLAR: 8, PLANT: 9,
  PLANKS: 10, BRASS: 11, IRON: 12, ASHLAR: 13, SOIL: 14, DARKGLASS: 15, CLOTH: 16,
};

const PROP_FRAG_PARS = /* glsl */`
varying float vMat; varying vec2 vUv2;
float gRough; float gMetal;
const vec3 RUST = vec3(0.21, 0.078, 0.028);
`;

const PROP_COLOR = /* glsl */`
{
  vec3 wp = vWPos; vec3 an = abs(vWNormal);
  vec2 pc = an.y > 0.7 ? wp.xz : (an.x > an.z ? vec2(wp.z, wp.y) : vec2(wp.x, wp.y));
  float px = max(fwidth(pc.x), fwidth(pc.y)) + 1e-5;
  float wall = 1.0 - smoothstep(0.5, 0.8, an.y);
  float nA = fbm2(pc * 0.45 + 13.1);
  float nB = vnoise(pc * 2.7 + 5.0);
  float streak = fbm2(vec2(pc.x * 2.6, pc.y * 0.22) + 31.0);
  float fwU = fwidth(vUv2.x); vec2 dq = vUv2 - 0.5; float rq = length(dq) * 2.0; float fwR = fwidth(rq);
  float fwG = max(fwidth(vUv2.x) * 6.0, fwidth(vUv2.y) * 10.0);
  vec3 base = diffuseColor.rgb; vec3 c = base;
  float rough = 0.85; float metal = 0.0;
  int id = int(vMat + 0.5);
  if (id == 0) {                    // concrete / render
    c *= 0.74 + 0.5 * nA; c *= 0.94 + 0.12 * nB;
    c *= 1.0 - 0.38 * wall * smoothstep(0.48, 0.85, streak);
    rough = 0.9;
  } else if (id == 1) {             // brick
    vec2 bs = vec2(0.24, 0.085);
    vec2 q = pc / bs; q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 bid = floor(q); vec2 f = fract(q);
    float fade = 1.0 - smoothstep(0.015, 0.06, px);
    float dj = min(min(f.x, 1.0 - f.x) * bs.x, min(f.y, 1.0 - f.y) * bs.y);
    float mortar = 1.0 - smoothstep(0.004, 0.012, dj);
    c *= mix(1.0, 0.72 + 0.56 * hash12(bid), fade);
    c = mix(c, vec3(0.36, 0.34, 0.31) * (0.8 + 0.3 * nA), mortar * fade * 0.85);
    c *= 0.7 + 0.5 * nA;
    c *= 1.0 - 0.4 * wall * smoothstep(0.45, 0.8, streak);
    rough = 0.9;
  } else if (id == 2 || id == 6) {  // painted metal (6: louvred)
    float ch = smoothstep(0.6, 0.68, fbm2(pc * 3.1 + 7.0));
    c *= 0.82 + 0.34 * nA;
    c = mix(c, vec3(0.22, 0.2, 0.17), 0.3 * (1.0 - wall) * nA);
    c = mix(c, RUST * (0.6 + nB), ch * 0.75);
    c = mix(c, RUST, 0.4 * wall * smoothstep(0.55, 0.85, streak));
    rough = 0.5 + 0.3 * ch + 0.15 * nB;
    if (id == 6 && wall > 0.5) {
      float s = fract(wp.y * 11.0);
      float fadeL = 1.0 - smoothstep(0.02, 0.07, px);
      c *= mix(0.5, mix(0.1, 1.0, smoothstep(0.12, 0.55, s)), fadeL);
    }
  } else if (id == 3) {             // galvanised steel
    float sp = mix(0.5, vnoise(pc * 38.0), 1.0 - smoothstep(0.01, 0.04, px));
    c *= (0.8 + 0.35 * sp) * (0.8 + 0.3 * nA);
    c = mix(c, vec3(0.55), 0.25 * smoothstep(0.5, 0.8, nA));
    float r = clamp(wall * smoothstep(0.6, 0.9, streak) * 0.6 + smoothstep(0.68, 0.8, fbm2(pc * 1.7 + 3.0)) * 0.5, 0.0, 1.0);
    c = mix(c, RUST, r);
    metal = 0.9 * (1.0 - r); rough = 0.42 + 0.22 * nB + 0.3 * r;
  } else if (id == 4) {             // wooden tank staves with iron hoops (uses uv: u around, v up)
    float sx = vUv2.x * 30.0; float sid = floor(sx); float sf = fract(sx);
    float upx = fwU * 30.0;
    float fadeS = 1.0 - smoothstep(0.25, 0.9, upx);
    float gap = smoothstep(0.0, 0.07, sf) * smoothstep(1.0, 0.93, sf);
    float tone = 0.72 + 0.56 * hash11(sid + 3.7);
    float grain = vnoise(vec2(sx * 7.0, wp.y * 1.3));
    c = base * mix(1.0, tone, fadeS) * (0.82 + 0.3 * grain);
    c *= mix(1.0, mix(0.4, 1.0, gap), fadeS);
    c = mix(c, vec3(0.3, 0.285, 0.26) * tone, clamp(0.3 * vUv2.y + 0.3 * nA, 0.0, 1.0));
    c *= mix(0.5, 1.0, smoothstep(0.0, 0.3, vUv2.y + 0.15 * nA));
    c = mix(c, vec3(0.05, 0.075, 0.03), 0.35 * (1.0 - smoothstep(0.0, 0.22, vUv2.y)) * nB);
    float wet = smoothstep(0.5, 0.78, fbm2(vec2(vUv2.x * 19.0 + wp.x * 0.3, vUv2.y * 1.1 + wp.z * 0.2)));
    c *= 1.0 - 0.42 * wet * smoothstep(0.1, 0.9, vUv2.y);
    c = mix(c, c * 1.35 + 0.012, 0.5 * smoothstep(0.6, 0.85, fbm2(pc * 0.8 + 41.0)) * (1.0 - wet));
    float hy = pow(vUv2.y, 0.72) * 9.0; float hf = fract(hy);
    float band = 1.0 - smoothstep(0.045, 0.075, abs(hf - 0.5));
    float drip = 0.3 * smoothstep(0.5, 0.25, hf) * step(hf, 0.5) * smoothstep(0.35, 0.7, streak);
    c = mix(c, RUST * 1.1, drip);
    c = mix(c, vec3(0.03, 0.027, 0.025) + RUST * 0.35 * nB, band);
    metal = 0.5 * band; rough = mix(0.88, 0.6, band);
  } else if (id == 5) {             // roofing felt
    c *= 0.7 + 0.55 * nA; rough = 0.95;
  } else if (id == 7) {             // fan grille (uv disc)
    float r = rq; float a = atan(dq.y, dq.x);
    float fadeF = 1.0 - smoothstep(0.01, 0.05, fwR);
    float inside = step(r, 0.9);
    float blades = smoothstep(0.2, 0.6, sin(a * 5.0 + r * 2.4));
    vec3 col = mix(vec3(0.008), vec3(0.05, 0.052, 0.055), blades);
    col = mix(col, base * 0.6, step(r, 0.2));
    float rings = 1.0 - smoothstep(0.08, 0.2, abs(fract(r * 6.0) - 0.5));
    float spokes = 1.0 - smoothstep(0.03, 0.09, abs(sin(a * 3.0)) * r);
    col = mix(col, vec3(0.3, 0.31, 0.32), max(rings, spokes) * 0.75);
    col = mix(vec3(0.045), col, fadeF);
    c = mix(base * (0.8 + 0.3 * nA), col, inside);
    metal = 0.4; rough = 0.5;
  } else if (id == 8) {             // solar panel
    vec2 g = vUv2 * vec2(6.0, 10.0); vec2 f = fract(g);
    float fadeP = 1.0 - smoothstep(0.03, 0.12, fwG);
    float line = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y));
    float cell = mix(0.9, smoothstep(0.03, 0.08, line), fadeP);
    float e = min(min(vUv2.x, 1.0 - vUv2.x), min(vUv2.y, 1.0 - vUv2.y));
    float frame = 1.0 - smoothstep(0.012, 0.03, e);
    c = mix(vec3(0.2, 0.22, 0.25), vec3(0.008, 0.014, 0.04), cell);
    c = mix(c, vec3(0.5), frame);
    c *= 0.85 + 0.3 * nA;
    rough = mix(0.4, 0.1, cell * (1.0 - frame)); metal = 0.0;
  } else if (id == 9) {             // foliage
    float v3 = vnoise3(wp * 4.5); float v4 = vnoise3(wp * 15.0);
    c = mix(vec3(0.014, 0.036, 0.011), vec3(0.08, 0.125, 0.032), v3) * (0.6 + 0.8 * v4) * (base * 1.6);
    c = mix(c, vec3(0.1, 0.085, 0.03) * base, 0.35 * smoothstep(0.62, 0.9, vnoise3(wp * 1.7 + 4.0)));   // a few yellowing sprays
    rough = 0.72;
  } else if (id == 10) {            // weathered planks
    float co = (wall > 0.5 ? pc.y : pc.x) / 0.14;
    float bl = fract(co); float bid = floor(co);
    float fadeB = 1.0 - smoothstep(0.02, 0.07, px);
    c *= mix(1.0, 0.7 + 0.6 * hash11(bid + 1.3), fadeB) * (0.82 + 0.3 * vnoise(wall > 0.5 ? vec2(pc.x * 1.5, pc.y * 30.0) : vec2(pc.x * 30.0, pc.y * 1.5)));
    c *= mix(1.0, mix(0.45, 1.0, smoothstep(0.0, 0.07, bl) * smoothstep(1.0, 0.93, bl)), fadeB);
    c = mix(c, vec3(0.3, 0.29, 0.27), 0.45 * nA);
    rough = 0.87;
  } else if (id == 11) {            // brass / gilded copper with patina
    float pt = smoothstep(0.45, 0.85, nA * 0.6 + streak * 0.5);
    c = mix(base, base * vec3(0.45, 0.36, 0.26), pt * 0.55);
    c = mix(c, vec3(0.1, 0.27, 0.21), 0.18 * smoothstep(0.58, 0.9, fbm2(pc * 0.9 + 77.0)));
    metal = 1.0; rough = 0.24 + 0.3 * pt + 0.1 * nB;
  } else if (id == 12) {            // structural iron
    c *= 0.7 + 0.5 * nA;
    float r = smoothstep(0.4, 0.75, fbm2(pc * 1.9 + 9.0));
    c = mix(c, RUST * (0.7 + 0.6 * nB), r * 0.7);
    metal = 0.6 * (1.0 - r); rough = 0.6 + 0.3 * r;
  } else if (id == 13) {            // ashlar stone
    vec2 bs = vec2(1.1, 0.55);
    vec2 q = pc / bs; q.x += 0.5 * mod(floor(q.y), 2.0);
    vec2 bid = floor(q); vec2 f = fract(q);
    float fade = (1.0 - smoothstep(0.03, 0.14, px)) * wall;
    float dj = min(min(f.x, 1.0 - f.x) * bs.x, min(f.y, 1.0 - f.y) * bs.y);
    float joint = 1.0 - smoothstep(0.006, 0.022, dj);
    c *= mix(1.0, 0.86 + 0.28 * hash12(bid), fade) * (0.8 + 0.36 * nA) * (0.95 + 0.1 * nB);
    c = mix(c, c * 0.42, joint * fade);
    c *= 1.0 - 0.36 * wall * smoothstep(0.45, 0.85, streak);
    rough = 0.88;
  } else if (id == 14) {            // soil
    c = vec3(0.035, 0.025, 0.018) * (0.6 + 0.8 * nB); rough = 1.0;
  } else if (id == 16) {            // washing: sun-bleached cotton
    c *= 0.86 + 0.2 * nA; c *= 0.93 + 0.1 * vnoise(vec2(vUv2.x * 40.0, vUv2.y * 3.0));
    rough = 0.95;
  } else {                          // dark glass
    rough = 0.08; metal = 0.0;
  }
  diffuseColor.rgb = c; gRough = rough; gMetal = metal;
}
`;

const CROWN_EMISSIVE = /* glsl */`
{
  vec3 nrm_ = normalize(vWNormal);
  vec3 Lv = uLampPos - vWPos; float d2 = dot(Lv, Lv); vec3 L = Lv * inversesqrt(d2);
  float lamp = (max(dot(nrm_, L), 0.0) * 0.85 + 0.15) * uLampPow.x / (d2 + 30.0);
  // cupola lamp (small upper lantern)
  vec3 Lv2 = uLampPos + vec3(0.0, uLampPow.z, 0.0) - vWPos; float d22 = dot(Lv2, Lv2);
  lamp += (max(dot(nrm_, Lv2 * inversesqrt(d22)), 0.0) * 0.85 + 0.15) * uLampPow.x * 0.12 / (d22 + 6.0);
  float up = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.78539816;
    vec3 lp = uLampPos + vec3(cos(a) * 8.6, uLampPow.w, sin(a) * 8.6);
    vec3 dv = vWPos - lp; float dd = dot(dv, dv); vec3 dn = dv * inversesqrt(dd + 1e-4);
    up += smoothstep(0.3, 0.9, dn.y) * (max(dot(nrm_, -dn), 0.0) * 0.8 + 0.2) / (dd + 2.0);
  }
  vec3 alb = diffuseColor.rgb;
  totalEmissiveRadiance += alb * (vec3(1.0, 0.56, 0.22) * lamp + vec3(1.0, 0.7, 0.38) * up * uLampPow.y) * uNight;
}
`;

/** Universal prop material. opt.crown: adds the analytic lamp / uplight wash of the Lantern Tower crown. */
export function makePropMaterial(ctx, opt = {}) {
  const hooks = {
    key: 'roofprop' + (opt.crown ? '_crown' : '') + (opt.foliage ? '_fol' : ''),
    vertexPars: 'attribute float aMat; varying float vMat; varying vec2 vUv2;',
    vertex: 'vMat = aMat; vUv2 = uv;',
    fragPars: PROP_FRAG_PARS + (opt.crown ? 'uniform vec3 uLampPos; uniform vec4 uLampPow;' : ''),
    color: PROP_COLOR,
    surface: 'roughnessFactor = gRough; metalnessFactor = gMetal;',
  };
  if (opt.crown) { hooks.uniforms = opt.uniforms; hooks.emissive = CROWN_EMISSIVE; }
  if (opt.foliage) {
    // two-sided leaves / cloth that keep their authored (volume) normal on both faces
    hooks.normal = 'normal = normalize(vNormal);';
    return ctx.makeMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true, side: THREE.DoubleSide }, hooks);
  }
  return ctx.makeMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, vertexColors: true }, hooks);
}

// ---------------------------------------------------------------------------------------------------------------
// roof finish: instanced unit quads, per-instance vec4 aRoof = (type, seed, sizeX, sizeZ)
// types: 0 bitumen, 1 gravel ballast, 2 pale membrane, 3 concrete pavers, 4 stone terrace, 5 red-oxide coating
export function makeRoofMaterial(ctx) {
  return ctx.makeMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 }, {
    key: 'roofsurf',
    vertexPars: 'attribute vec4 aRoof; varying vec4 vRoof; varying vec2 vUv2;',
    vertex: 'vRoof = aRoof; vUv2 = uv;',
    fragPars: /* glsl */`varying vec4 vRoof; varying vec2 vUv2; float gRough; float gBump; float gPud;`,
    color: /* glsl */`
    {
      vec2 p = vWPos.xz; float seed = vRoof.y;
      float px = max(fwidth(p.x), fwidth(p.y)) + 1e-5;
      vec2 e2 = min(vUv2, 1.0 - vUv2) * vRoof.zw; float edge = min(e2.x, e2.y);
      float big = fbm2(p * 0.06 + seed * 17.0);
      float mid = fbm2(p * 0.42 + seed * 3.0);
      float fine = vnoise(p * 7.0 + seed);
      float fadeFine = 1.0 - smoothstep(0.03, 0.2, px);
      float speck = mix(0.5, hash12(floor(p * 45.0)), 1.0 - smoothstep(0.008, 0.03, px));
      int ty = int(vRoof.x + 0.5);
      vec3 c; float rough = 0.93; float bump = 0.0; float pudAmt = 0.0; float seamW = 1.05; float seamK = 0.0;
      float sheetK = 0.0; float tarK = 0.0;
      bool dirX = fract(seed * 7.31) > 0.5;
      if (ty == 0) {            // bitumen / tar
        c = mix(vec3(0.032, 0.031, 0.033), vec3(0.075, 0.07, 0.066), big) * (0.75 + 0.5 * mid);
        c = mix(c, vec3(0.11, 0.105, 0.1), 0.35 * smoothstep(0.55, 0.9, fbm2(p * 0.15 + seed)));   // bleached areas
        seamK = 0.7; pudAmt = 0.5; bump = 0.35; rough = 0.88; sheetK = 0.34; tarK = 1.0;
      } else if (ty == 1) {     // gravel ballast
        c = mix(vec3(0.17, 0.155, 0.135), vec3(0.3, 0.28, 0.25), mid) * (0.6 + 0.8 * speck) * (0.85 + 0.3 * fine);
        bump = 1.0; pudAmt = 0.12; rough = 0.95; sheetK = 0.1;
        // gravel scoured away in drifts: the dark felt underneath shows
        c = mix(c, vec3(0.06, 0.057, 0.055) * (0.8 + 0.4 * fine), smoothstep(0.66, 0.8, fbm2(p * 0.27 + seed * 6.0)) * 0.8);
      } else if (ty == 2) {     // pale membrane
        c = mix(vec3(0.34, 0.345, 0.35), vec3(0.5, 0.5, 0.49), big) * (0.85 + 0.25 * mid);
        seamK = 0.42; seamW = 1.8; pudAmt = 0.42; rough = 0.78; sheetK = 0.16; tarK = 0.5;
      } else if (ty == 3) {     // concrete pavers
        vec2 g = p / 0.6; vec2 f = fract(g); vec2 gi = floor(g);
        float fadeP = 1.0 - smoothstep(0.04, 0.2, px);
        float j = 1.0 - smoothstep(0.01, 0.03, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * 0.6);
        c = vec3(0.3, 0.29, 0.275) * mix(1.0, 0.82 + 0.36 * hash12(gi + seed), fadeP) * (0.8 + 0.35 * mid);
        c = mix(c, c * 0.35, j * fadeP);
        pudAmt = 0.25; rough = 0.9;
      } else if (ty == 4) {     // stone terrace flags
        vec2 g = p / vec2(0.9, 0.6); g.x += 0.5 * mod(floor(g.y), 2.0); vec2 f = fract(g); vec2 gi = floor(g);
        float fadeP = 1.0 - smoothstep(0.04, 0.22, px);
        float j = 1.0 - smoothstep(0.012, 0.035, min(min(f.x, 1.0 - f.x) * 0.9, min(f.y, 1.0 - f.y) * 0.6));
        c = vec3(0.36, 0.33, 0.29) * mix(1.0, 0.8 + 0.4 * hash12(gi + seed), fadeP) * (0.78 + 0.4 * mid);
        c = mix(c, c * 0.4, j * fadeP);
        pudAmt = 0.3; rough = 0.86;
      } else {                  // red oxide coating over old tar
        c = mix(vec3(0.2, 0.062, 0.04), vec3(0.3, 0.115, 0.07), big) * (0.7 + 0.55 * mid);
        c = mix(c, vec3(0.05, 0.048, 0.05), smoothstep(0.62, 0.78, fbm2(p * 0.33 + seed * 5.0)) * 0.85);   // worn through to the tar
        seamK = 0.5; pudAmt = 0.4; bump = 0.25; rough = 0.85; sheetK = 0.26; tarK = 0.8;
      }
      // felt laid in separate campaigns: big rectangular fields of different age
      if (sheetK > 0.0) {
        vec2 cs = dirX ? vec2(9.5, 5.3) : vec2(5.3, 9.5);
        vec2 q = p / cs + seed * 5.0; q.x += 0.37 * floor(q.y);
        c *= 1.0 + sheetK * (hash12(floor(q) + seed) - 0.5) * 2.0;
      }
      // hand-mopped tar over cracks and laps: wandering glossy black lines
      float tar = 0.0;
      if (tarK > 0.0) {
        // long wobbly runs (no closed loops): one family across the laps, a sparser one along them
        vec2 dr = dirX ? vec2(0.29, 0.957) : vec2(0.957, 0.29);
        float l1 = abs(fract(dot(p, dr) * 0.13 + (mid - 0.5) * 0.5 + seed) - 0.5) / 0.13;
        float l2 = abs(fract(dot(p, vec2(-dr.y, dr.x)) * 0.07 + (mid - 0.5) * 0.35 + seed * 2.3) - 0.5) / 0.07;
        float gate = smoothstep(0.42, 0.56, big);
        float lw = 0.035 + px * 0.5;
        tar = max((1.0 - smoothstep(lw * 0.5, lw, l1)) * gate, (1.0 - smoothstep(lw * 0.5, lw, l2)) * (1.0 - gate) * step(0.4, fract(seed * 3.7)));
        tar *= tarK * (1.0 - smoothstep(0.12, 0.6, px));
        c = mix(c, vec3(0.014, 0.014, 0.016), tar * 0.85);
      }
      // roll seams
      if (seamK > 0.0) {
        float sc = (dirX ? p.x : p.y) / seamW + seed;
        float sf = abs(fract(sc) - 0.5);
        float fadeS = 1.0 - smoothstep(0.06, 0.35, px);
        float seam = (1.0 - smoothstep(0.0, 0.02 / seamW, sf)) * fadeS;
        float lapTone = 0.9 + 0.2 * hash11(floor(sc) + seed * 3.0);
        c *= mix(1.0, lapTone, fadeS * 0.8);
        c = mix(c, c * 0.5 + 0.012, seam * seamK * 1.4);
      }
      // rectangular repair patches
      {
        vec2 cs = vec2(4.3, 3.1); vec2 q = p / cs + seed * 9.0; vec2 ci = floor(q); vec2 cf = fract(q);
        float h = hash12(ci);
        vec2 lo = vec2(0.12, 0.15) + 0.3 * hash22(ci + 3.0), hi = lo + 0.25 + 0.3 * hash22(ci + 7.0);
        float inside = step(lo.x, cf.x) * step(cf.x, hi.x) * step(lo.y, cf.y) * step(cf.y, hi.y) * step(0.62, h);
        float ptone = 0.55 + 1.5 * fract(h * 17.3);
        if (ty == 0 || ty == 5 || ty == 2) c = mix(c, (ty == 2 ? vec3(0.42, 0.42, 0.41) : vec3(0.05, 0.05, 0.053) * ptone) * (0.8 + 0.4 * fine), inside * 0.85);
      }
      // broad run-off staining toward the outlets (survives at distance)
      c *= 1.0 - 0.3 * smoothstep(0.48, 0.8, fbm2((dirX ? p : p.yx) * vec2(0.045, 0.22) + seed * 11.0));
      // grime gathering against the parapets, soot / water stains
      float eg = 1.0 - smoothstep(0.1, 1.9, edge + (mid - 0.5) * 1.6);
      c = mix(c, c * 0.45 + vec3(0.01, 0.012, 0.006), eg * 0.7);
      c *= 1.0 - 0.3 * smoothstep(0.5, 0.8, fbm2(p * 0.9 + seed * 2.0)) * fadeFine;
      c *= 0.9 + 0.2 * mix(0.5, fine, fadeFine);
      // puddles (smooth, dark, mirror the sky) with a damp halo
      float pn = fbm2(p * 0.19 + seed * 9.0) + 0.1 * (mid - 0.5) + 0.12 * eg;
      float th = 0.73 - 0.22 * pudAmt;
      float pud = smoothstep(th, th + 0.035, pn) * step(0.01, pudAmt);
      float damp = smoothstep(th - 0.09, th, pn) * step(0.01, pudAmt);
      c = mix(c, c * 0.6, damp * 0.7);
      rough = mix(rough, 0.55, damp * 0.6);
      // pale silt / tide ring left where the ponding has shrunk
      float ring = smoothstep(th - 0.135, th - 0.115, pn) * (1.0 - smoothstep(th - 0.1, th - 0.085, pn)) * step(0.01, pudAmt);
      c = mix(c, c * 1.5 + vec3(0.035, 0.032, 0.026), ring * 0.5 * (1.0 - smoothstep(0.1, 0.5, px)));
      rough = mix(rough, 0.4, tar * 0.8);
      c = mix(c, c * 0.3, pud);
      rough = mix(rough, 0.035, pud);
      diffuseColor.rgb = c; gRough = rough; gBump = bump * (1.0 - pud) * (1.0 - smoothstep(0.01, 0.06, px)); gPud = pud;
    }`,
    surface: 'roughnessFactor = gRough;',
    normal: /* glsl */`
    if (gBump > 0.01) {
      vec2 p = vWPos.xz * 26.0; float e = 0.35;
      float h0 = vnoise(p), hx = vnoise(p + vec2(e, 0.0)), hz = vnoise(p + vec2(0.0, e));
      vec3 nw = normalize(vec3(-(hx - h0) * gBump * 1.6, 1.0, -(hz - h0) * gBump * 1.6));
      normal = worldToViewDir(nw);
    }`,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// skylight glass: dark glass by day, warm glow from the room below at night
export function makeSkylightMaterial(ctx) {
  return ctx.makeMaterial({ color: 0x1a2426, roughness: 0.12, metalness: 0.0, vertexColors: true }, {
    key: 'roofskylight',
    vertexPars: 'varying vec2 vUv2; varying vec3 vSeed;',
    vertex: /* glsl */`vUv2 = uv;
      #ifdef USE_INSTANCING
        vSeed = vec3(instanceMatrix[3].x, instanceMatrix[3].z, instanceMatrix[0].x + instanceMatrix[2].x);
      #else
        vSeed = vec3(0.0);
      #endif`,
    fragPars: 'varying vec2 vUv2; varying vec3 vSeed; float gMul;',
    color: /* glsl */`
    {
      vec2 g = vUv2 * vec2(max(1.0, floor(abs(vSeed.z) * 1.1 + 0.5)), 1.0);
      vec2 f = fract(g);
      float fade = 1.0 - smoothstep(0.08, 0.3, max(fwidth(g.x), fwidth(g.y)));
      float e = min(min(f.x, 1.0 - f.x), min(vUv2.y, 1.0 - vUv2.y) * 1.6);
      gMul = mix(0.75, smoothstep(0.035, 0.06, e), fade);
      float dirt = fbm2(vWPos.xz * 1.3 + vWPos.y);
      diffuseColor.rgb = mix(vec3(0.16, 0.165, 0.16), diffuseColor.rgb * (0.6 + 0.8 * dirt), gMul);
    }`,
    surface: 'roughnessFactor = mix(0.5, 0.1 + 0.25 * fbm2(vWPos.xz * 2.1), gMul);',
    emissive: /* glsl */`
    {
      float h1 = hash12(vSeed.xy * 0.37 + 1.7), h2 = hash12(vSeed.xy * 0.73 + 9.1), h3 = hash12(vSeed.xy * 1.31 + 4.4);
      float on = step(0.42, h1) * step(0.8, vColor.r);
      vec3 warm = h2 > 0.82 ? vec3(0.75, 0.86, 1.0) : mix(vec3(1.0, 0.56, 0.22), vec3(1.0, 0.72, 0.4), h3);
      float frost = 0.55 + 0.45 * vnoise(vWPos.xz * 2.3 + vWPos.y * 2.0);
      float hot = 1.0 - 0.6 * abs(vUv2.x - 0.5) * 2.0 * h3;
      totalEmissiveRadiance += warm * on * (2.5 + 7.0 * h3) * frost * hot * gMul * uNight;
    }`,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// light sprites / decals: additive quads. Per instance: aPos (xyz + size m), aCol (rgb HDR + day factor),
// aFx (pulse speed rad/s, phase, min pixel radius, kind), aU / aV (fixed-plane axes for decals; zero = camera facing)
export function makeSpriteMaterial(ctx) {
  return ctx.makeShaderMaterial({
    vertexShader: /* glsl */`
      attribute vec4 aPos; attribute vec4 aCol; attribute vec4 aFx; attribute vec3 aU; attribute vec3 aV;
      varying vec2 vQ; varying vec4 vC; varying float vKind;
      void main() {
        vQ = position.xy * 2.0;
        float size = aPos.w; float gain = 1.0;
        vec4 mv = viewMatrix * vec4(aPos.xyz, 1.0);
        if (dot(aU, aU) > 0.0) {
          mv = viewMatrix * vec4(aPos.xyz + (aU * position.x + aV * position.y) * 2.0, 1.0);
        } else {
          float pxPerM = projectionMatrix[1][1] * uResolution.y * 0.5 / max(-mv.z, 0.1);
          float minS = aFx.z / pxPerM;
          if (size < minS) { gain = (size * size) / (minS * minS); size = minS; }
          mv.xy += position.xy * 2.0 * size;
          mv.z += min(size, 1.0) * 0.5;          // nudge toward the camera so the lamp is not buried in its fixture
        }
        float pulse = aFx.x > 0.0 ? 0.12 + 0.88 * pow(0.5 + 0.5 * sin(uTime * aFx.x + aFx.y), 3.0) : 1.0;
        float lvl = mix(aCol.a, 1.0, uNight);
        vC = vec4(aCol.rgb * gain * pulse * lvl, 1.0);
        vKind = aFx.w;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vQ; varying vec4 vC; varying float vKind;
      void main() {
        float r2 = dot(vQ, vQ);
        if (r2 > 1.0) discard;
        float f;
        float r = sqrt(r2);
        if (vKind < 0.5) f = exp(-r2 * 9.0) + 0.045 * pow(1.0 - r, 3.0);       // lamp: hot core + faint halo
        else if (vKind < 1.5) f = pow(1.0 - r2, 2.0) * (1.0 - 0.5 * r2);        // pool of light on a surface
        else f = pow(1.0 - r, 2.6);                                              // soft atmospheric glow, no edge
        gl_FragColor = vec4(vC.rgb * f, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export class Sprites {
  constructor() { this.pos = []; this.col = []; this.fx = []; this.u = []; this.v = []; this.count = 0; }
  /** camera-facing lamp. color = HDR rgb at night; day = fraction kept in daylight; pulse = rad/s (0 = steady) */
  lamp(x, y, z, size, color, { day = 0, pulse = 0, phase = 0, minPx = 1.2 } = {}) {
    this.pos.push(x, y, z, size); this.col.push(color[0], color[1], color[2], day); this.fx.push(pulse, phase, minPx, 0);
    this.u.push(0, 0, 0); this.v.push(0, 0, 0); this.count++;
  }
  /** soft camera-facing glow (haze around a strong source) */
  halo(x, y, z, size, color, { day = 0 } = {}) {
    this.pos.push(x, y, z, size); this.col.push(color[0], color[1], color[2], day); this.fx.push(0, 0, 0, 2);
    this.u.push(0, 0, 0); this.v.push(0, 0, 0); this.count++;
  }
  /** light pool on a plane spanned by half-axes u, v (metres) */
  pool(x, y, z, u, v, color, { day = 0 } = {}) {
    this.pos.push(x, y, z, 1); this.col.push(color[0], color[1], color[2], day); this.fx.push(0, 0, 0, 1);
    this.u.push(u[0], u[1], u[2]); this.v.push(v[0], v[1], v[2]); this.count++;
  }
  finish(ctx, group) {
    if (!this.count) return null;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aPos', new THREE.InstancedBufferAttribute(new Float32Array(this.pos), 4));
    g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(this.col), 4));
    g.setAttribute('aFx', new THREE.InstancedBufferAttribute(new Float32Array(this.fx), 4));
    g.setAttribute('aU', new THREE.InstancedBufferAttribute(new Float32Array(this.u), 3));
    g.setAttribute('aV', new THREE.InstancedBufferAttribute(new Float32Array(this.v), 3));
    g.instanceCount = this.count;
    const mesh = new THREE.Mesh(g, makeSpriteMaterial(ctx));
    mesh.frustumCulled = false; mesh.layers.set(1); mesh.renderOrder = 20; mesh.name = 'roof_sprites';
    group.add(mesh);
    return mesh;
  }
}
