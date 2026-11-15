// Street furniture models (merged vertex-coloured geometry, see kit.js) and the shared prop material.
// Conventions: origin on the ground, +Y up, furniture "front" = +Z.
// Emissive codes (aSurf.z): 1 sodium road lamp, 2 opal globe, 3/4/5 traffic red/amber/green, 6 tungsten lantern,
// 9/10 pedestrian signal (same / opposite phase), 11 tail light, 12 head light, 13 festoon bulb (instance tint),
// 14 taxi sign, 15 light panel.
import * as THREE from 'three';
import { Geo, S, xf, box, cyl, sph, hemi, cone, torus, tube, lathe, lin } from './kit.js';

export function makePropMaterial(ctx, extra = {}) {
  return ctx.makeMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.7, metalness: 0.0, ...extra }, {
    key: 'streets-prop' + (extra.side ? '-ds' : ''),
    vertexPars: /* glsl */`attribute vec4 aSurf; attribute vec4 aInst; varying vec4 vSurf; varying vec4 vInst;`,
    vertex: /* glsl */`vSurf = aSurf; vInst = aInst;`,
    fragPars: /* glsl */`varying vec4 vSurf; varying vec4 vInst; float glassK_ = 0.0;`,
    color: /* glsl */`diffuseColor.rgb *= mix(vec3(1.0), vInst.rgb, step(0.5, vSurf.w));
    {
      // lamp glass (opal globe 2, lantern 6, festoon bulb 13): milky grey-white when off, never a self-lit cream disc
      float gc_ = floor(vSurf.z + 0.5);
      glassK_ = (abs(gc_ - 2.0) < 0.5 || abs(gc_ - 6.0) < 0.5 || abs(gc_ - 13.0) < 0.5) ? 1.0 : 0.0;
      if (glassK_ > 0.5) diffuseColor.rgb = vec3(0.47, 0.47, 0.455) * (abs(gc_ - 13.0) < 0.5 ? mix(vec3(1.0), vInst.rgb, 0.3) : vec3(1.0));
    }`,
    ao: /* glsl */`
    if (glassK_ > 0.5) {
      vec3 gv_ = normalize(vViewPosition); float gn_ = clamp(dot(normal, gv_), 0.0, 1.0);
      vec3 gr_ = viewToWorldDir(reflect(-gv_, normal));
      // translucent body: light scattered inside fills the shaded side, the silhouette (long path, grazing) goes darker
      float rim_ = mix(0.42, 1.0, pow(gn_, 0.75));
      reflectedLight.directDiffuse = (reflectedLight.directDiffuse * 0.8 + reflectedLight.indirectDiffuse * 0.2) * rim_;
      reflectedLight.indirectDiffuse *= 1.15 * rim_ * (0.8 + 0.2 * clamp(vWNormal.y + 0.6, 0.0, 1.0));
      // broad soft sky / sunset highlight on the glossy skin
      vec3 gs_ = skyLUT(uSkyLUT, normalize(vec3(gr_.x, abs(gr_.y) * 0.8 + 0.12, gr_.z)));
      reflectedLight.indirectSpecular += gs_ * (0.035 + 0.11 * smoothstep(-0.15, 0.75, gr_.y)) * (0.35 + 0.65 * gn_);
    }`,
    surface: /* glsl */`roughnessFactor = vSurf.x; metalnessFactor = vSurf.y;`,
    emissive: /* glsl */`
    {
      float code = floor(vSurf.z + 0.5);
      if (code > 0.5) {
        float seed = vInst.w; vec3 e = vec3(0.0);
        // lit glass: hot core, soft falloff to the silhouette (same total as a flat disc, so the bloom is unchanged)
        float gcore_ = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0); gcore_ *= gcore_;
        gcore_ = 0.22 + 2.6 * gcore_ * gcore_;
        if (code < 2.5 || (code > 5.5 && code < 6.5)) {
          float var = 0.8 + 0.4 * fract(seed * 37.73);
          float faulty = step(fract(seed * 91.17), 0.018);
          float fl = mix(1.0, step(0.42, vnoise(vec2(uTime * 11.0, seed * 613.0))) * (0.45 + 0.55 * vnoise(vec2(uTime * 3.0, seed * 131.0))), faulty);
          vec3 tl = code < 1.5 ? vec3(1.0, 0.55, 0.19) * 46.0 : (code < 2.5 ? vec3(1.0, 0.76, 0.47) * 15.0 : vec3(1.0, 0.69, 0.38) * 22.0);
          e = tl * var * fl * uNight * (code > 1.5 ? gcore_ : 1.0);
        } else if (code < 5.5) {
          float ph = fract(uTime / 44.0 + seed);
          float on = code < 3.5 ? step(0.48, ph) : (code < 4.5 ? step(0.42, ph) * step(ph, 0.48) : step(ph, 0.42));
          vec3 c = code < 3.5 ? vec3(1.0, 0.05, 0.03) : (code < 4.5 ? vec3(1.0, 0.48, 0.03) : vec3(0.04, 1.0, 0.42));
          e = c * (on * mix(11.0, 5.0, uNight) + 0.015);
        } else if (code > 8.5 && code < 10.5) {
          float ph = fract(uTime / 44.0 + seed + (code > 9.5 ? 0.5 : 0.0));
          float walk = step(ph, 0.3);
          float stop = step(0.3, ph) * mix(1.0, step(0.5, fract(uTime * 1.25)), step(ph, 0.42));
          e = (walk * vec3(0.75, 0.9, 1.0) + stop * vec3(1.0, 0.26, 0.03)) * mix(2.6, 1.5, uNight);
        } else if (code < 11.5) {
          e = vec3(1.0, 0.04, 0.02) * step(0.25, seed) * (seed > 0.75 ? 7.0 : 1.6) * smoothstep(0.0, 0.3, uNight);
        } else if (code < 12.5) {
          e = (seed > 0.75 ? vec3(1.0, 0.92, 0.78) * 60.0 : vec3(1.0, 0.6, 0.25) * 3.0) * step(0.25, seed) * smoothstep(0.0, 0.3, uNight);
        } else if (code < 13.5) {
          e = mix(vInst.rgb, vec3(1.0, 0.9, 0.72), 0.35 * gcore_ / 2.82) * 26.0 * uNight * (0.8 + 0.4 * fract(seed * 37.73)) * gcore_;
        } else if (code < 14.5) {
          e = vec3(1.0, 0.78, 0.28) * 4.0 * uNight;
        } else {
          e = vec3(1.0, 0.88, 0.7) * 7.0 * uNight;
        }
        totalEmissiveRadiance += e;
      }
    }`,
  });
}

// ---- palette -----------------------------------------------------------------------------------------
const IRON = S(0x18201c, 0.5, 0.6);          // dark green-black cast iron
const DARK = S(0x232629, 0.6, 0.5);
const STEEL = S(0x767c82, 0.48, 0.8);
const GALV = S(0x8c9195, 0.55, 0.7);
const WOOD = S(0x5f4128, 0.72, 0);
const CONC = S(0x8a857c, 0.9, 0);
const GLASS = S([0.05, 0.06, 0.07], 0.05, 0.3);
const BLACK = S(0x0b0b0c, 0.7, 0);

// Detail level q of the round props: 2 = near (round at 4K), 1 = mid, 0 = far (the original low-poly model). The three
// levels are chained through Geo.lods and streamed by lod.js (see "chain" at the bottom of this file).
const N = (q, far, mid, hi) => (q >= 2 ? hi : q === 1 ? mid : far);

export function lampCobra(q = 2) {
  const g = new Geo();
  g.add(box(0.36, 0.5, 0.36), DARK, xf(0, 0.25, 0));
  g.add(cyl(0.2, 0.2, 0.05, N(q, 8, 12, 20)), DARK, xf(0, 0.52, 0));
  g.add(cyl(0.062, 0.105, 8.0, N(q, 7, 12, 20), true), STEEL, xf(0, 4.5, 0));
  g.add(cyl(0.085, 0.085, 0.14, N(q, 7, 12, 20)), DARK, xf(0, 3.1, 0));
  g.add(tube([[0, 8.35, 0], [0, 8.95, 0.22], [0, 9.3, 0.95], [0, 9.36, 1.8], [0, 9.28, 2.3]], 0.042, N(q, 8, 8, 12), N(q, 5, 8, 12)), STEEL);
  g.add(box(0.3, 0.13, 0.8), S(0x4c5054, 0.45, 0.7), xf(0, 9.24, 2.64, 0.06, 0, 0));
  g.add(box(0.22, 0.03, 0.52), S([1, 0.92, 0.8], 0.3, 0, 1), xf(0, 9.16, 2.72, 0.06, 0, 0));
  return g;
}
export const COBRA_BULB = [0, 9.14, 2.72];

export function lampOrnate(q = 2) {
  const g = new Geo();
  g.add(lathe([[0.27, 0], [0.27, 0.1], [0.2, 0.2], [0.165, 0.55], [0.2, 0.63], [0.12, 0.8], [0.085, 1.15], [0.068, 3.4], [0.105, 3.5], [0.06, 3.64], [0.05, 4.3], [0.09, 4.38], [0.03, 4.55], [0.0, 4.8]], N(q, 8, 10, 20)), IRON);
  for (const s of [-1, 1]) {
    g.add(tube([[0, 3.72, 0], [0.3 * s, 3.6, 0], [0.64 * s, 3.74, 0], [0.82 * s, 4.02, 0]], 0.028, N(q, 6, 6, 10), N(q, 4, 5, 8)), IRON);
    g.add(tube([[0, 4.2, 0], [0.26 * s, 4.24, 0], [0.5 * s, 4.05, 0], [0.42 * s, 3.86, 0]], 0.018, N(q, 5, 5, 8), N(q, 3, 4, 6)), IRON);
    g.add(cyl(0.085, 0.04, 0.1, N(q, 6, 8, 16)), IRON, xf(0.82 * s, 4.07, 0));
    g.add(sph(0.2, N(q, 8, 14, 24), N(q, 5, 9, 14)), S([0.95, 0.92, 0.84], 0.25, 0, 2), xf(0.82 * s, 4.3, 0));
    g.add(cone(0.075, 0.13, N(q, 6, 8, 16)), IRON, xf(0.82 * s, 4.55, 0));
  }
  return g;
}
export const ORNATE_BULBS = [[-0.82, 4.3, 0], [0.82, 4.3, 0]];

export function lampPost(q = 2) {
  const g = new Geo();
  const pole = S(0x23282a, 0.55, 0.55);
  g.add(lathe([[0.14, 0], [0.14, 0.45], [0.08, 0.6], [0.058, 3.55], [0.1, 3.66], [0.14, 3.7]], N(q, 7, 12, 22)), pole);
  g.add(cyl(0.22, 0.14, 0.52, N(q, 8, 14, 28), true), S([0.95, 0.9, 0.8], 0.3, 0, 6), xf(0, 3.96, 0));
  g.add(cone(0.33, 0.2, N(q, 8, 14, 28)), pole, xf(0, 4.32, 0));
  g.add(cyl(0.225, 0.225, 0.025, N(q, 8, 14, 28)), pole, xf(0, 4.215, 0));
  g.add(sph(0.045, N(q, 5, 8, 12), N(q, 4, 5, 8)), pole, xf(0, 4.45, 0));
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.add(box(0.018, 0.54, 0.018), pole, xf(Math.cos(a) * 0.185, 3.96, Math.sin(a) * 0.185, 0, 0, 0)); }
  return g;
}
export const POST_BULB = [0, 3.96, 0];

export function lampPendant(q = 2) {
  const g = new Geo();
  g.add(cyl(0.012, 0.012, 0.35, N(q, 4, 5, 8)), DARK, xf(0, -0.175, 0));
  g.add(cone(0.3, 0.2, N(q, 10, 16, 28), true), S(0x2c3331, 0.5, 0.5), xf(0, -0.45, 0));
  g.add(cone(0.29, 0.19, N(q, 10, 16, 28), true), S([0.8, 0.78, 0.7], 0.5, 0), xf(0, -0.455, 0), true);
  g.add(sph(0.09, N(q, 6, 10, 18), N(q, 5, 7, 12)), S([1, 0.92, 0.8], 0.3, 0, 6), xf(0, -0.56, 0));
  return g;
}

function signalHead(g, x, y, z, ry, q = 2) {
  // 3-lens vehicle head centred at (x, y, z), lenses facing local +Z rotated by ry
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  g.add(box(0.32, 1.0, 0.24), BLACK, xf(...P(0, 0, 0), 0, ry, 0));
  g.add(box(0.5, 1.2, 0.02), S(0x0a0a0a, 0.8, 0), xf(...P(0, 0, -0.13), 0, ry, 0));
  const cols = [[1.0, 0.25, 0.2], [1.0, 0.7, 0.2], [0.3, 0.9, 0.6]];
  for (let i = 0; i < 3; i++) {
    const ly = 0.32 - i * 0.32;
    g.add(new THREE.CircleGeometry(0.105, N(q, 8, 14, 28)), S(cols[i].map(v => v * 0.25), 0.3, 0, 3 + i), xf(...P(0, ly, 0.123), 0, ry, 0));
    g.add(box(0.26, 0.02, 0.16), BLACK, xf(...P(0, ly + 0.125, 0.2), 0, ry, 0));
  }
}
function pedHead(g, x, y, z, ry, code) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  g.add(box(0.34, 0.36, 0.2), BLACK, xf(...P(0, 0, 0), 0, ry, 0));
  g.add(box(0.2, 0.2, 0.02), S([0.12, 0.1, 0.09], 0.3, 0, code), xf(...P(0, 0, 0.105), 0, ry, 0));
  g.add(box(0.36, 0.02, 0.12), BLACK, xf(...P(0, 0.185, 0.16), 0, ry, 0));
}
/** post-mounted signal: vehicle head faces +Z, the road is at -X */
export function signalPost(q = 2) {
  const g = new Geo();
  g.add(cyl(0.16, 0.18, 0.3, N(q, 8, 12, 20)), DARK, xf(0, 0.15, 0));
  g.add(cyl(0.065, 0.075, 3.5, N(q, 7, 10, 18), true), S(0x2b3033, 0.55, 0.6), xf(0, 2.05, 0));
  g.add(sph(0.08, N(q, 6, 10, 14), N(q, 4, 6, 8)), DARK, xf(0, 3.8, 0));
  signalHead(g, -0.24, 3.2, 0.05, 0, q);
  pedHead(g, -0.06, 2.35, -0.2, Math.PI, 9);          // faces -Z : crossing parallel to this approach
  pedHead(g, -0.22, 2.35, 0.0, -Math.PI / 2, 10);     // faces -X : crossing over this approach
  return g;
}
/** mast-arm signal for avenues: head on the pole and one over the lanes at the end of a 5.6 m arm */
export function signalMast(q = 2) {
  const g = new Geo();
  const pc = S(0x2b3033, 0.55, 0.6);
  g.add(cyl(0.2, 0.24, 0.4, N(q, 8, 12, 20)), DARK, xf(0, 0.2, 0));
  g.add(cyl(0.085, 0.12, 6.2, N(q, 8, 12, 20), true), pc, xf(0, 3.5, 0));
  g.add(sph(0.1, N(q, 6, 10, 14), N(q, 4, 6, 8)), DARK, xf(0, 6.62, 0));
  g.add(tube([[0, 5.7, 0], [-0.9, 6.25, 0], [-2.8, 6.45, 0], [-5.7, 6.4, 0]], 0.06, N(q, 8, 8, 12), N(q, 6, 8, 12)), pc);
  g.add(tube([[0, 4.9, 0], [-0.8, 5.5, 0], [-1.7, 6.3, 0]], 0.03, 3, N(q, 4, 5, 8)), pc);
  signalHead(g, -5.3, 5.82, 0.02, 0, q);
  signalHead(g, -0.26, 3.3, 0.06, 0, q);
  pedHead(g, -0.06, 2.4, -0.22, Math.PI, 9);
  pedHead(g, -0.24, 2.4, 0.0, -Math.PI / 2, 10);
  return g;
}

export function bench() {
  const g = new Geo();
  for (const s of [-0.82, 0.82]) {
    g.add(box(0.05, 0.44, 0.05), IRON, xf(s, 0.22, 0.2));
    g.add(box(0.05, 0.86, 0.05), IRON, xf(s, 0.43, -0.22, -0.16, 0, 0));
    g.add(box(0.05, 0.05, 0.5), IRON, xf(s, 0.42, 0));
    g.add(box(0.05, 0.04, 0.46), IRON, xf(s, 0.66, 0.02));
    g.add(box(0.05, 0.24, 0.04), IRON, xf(s, 0.55, 0.23));
  }
  for (let i = 0; i < 4; i++) g.add(box(1.8, 0.03, 0.095), WOOD, xf(0, 0.46, 0.2 - i * 0.115));
  for (let i = 0; i < 3; i++) g.add(box(1.8, 0.095, 0.03), WOOD, xf(0, 0.6 + i * 0.12, -0.235 - i * 0.02, -0.16, 0, 0));
  return g;
}

export function bin(q = 2) {
  const g = new Geo();
  const c = S(0x1d2a23, 0.55, 0.5), nb = N(q, 10, 16, 28);
  g.add(lathe([[0.2, 0.04], [0.245, 0.08], [0.265, 0.8], [0.285, 0.83], [0.285, 0.87], [0.24, 0.87]], nb), c);
  g.add(cyl(0.24, 0.24, 0.02, nb), BLACK, xf(0, 0.8, 0));
  g.add(cyl(0.05, 0.07, 0.08, N(q, 6, 8, 12)), DARK, xf(0, 0.04, 0));
  g.add(cyl(0.3, 0.3, 0.035, nb), c, xf(0, 1.08, 0));
  for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; g.add(box(0.025, 0.22, 0.025), c, xf(Math.cos(a) * 0.255, 0.97, Math.sin(a) * 0.255)); }
  return g;
}

export function hydrant(q = 2) {
  const g = new Geo();
  const c = S([1, 1, 1], 0.5, 0.1, 0, 1), ns = N(q, 6, 10, 16);
  g.add(lathe([[0.17, 0], [0.17, 0.05], [0.115, 0.09], [0.1, 0.5], [0.125, 0.53], [0.125, 0.58], [0.1, 0.62], [0.07, 0.71], [0.035, 0.76], [0.035, 0.8], [0.0, 0.81]], N(q, 8, 14, 24)), c);
  g.add(cyl(0.055, 0.055, 0.42, ns), S(0x8c8f8f, 0.45, 0.7), xf(0, 0.42, 0, 0, 0, Math.PI / 2));
  g.add(cyl(0.062, 0.062, 0.06, ns, true), c, xf(0.15, 0.42, 0, 0, 0, Math.PI / 2));
  g.add(cyl(0.062, 0.062, 0.06, ns, true), c, xf(-0.15, 0.42, 0, 0, 0, Math.PI / 2));
  g.add(cyl(0.075, 0.075, 0.2, N(q, 7, 10, 16)), c, xf(0, 0.36, 0.1, Math.PI / 2, 0, 0));
  return g;
}

export function bollard(q = 2) {
  const g = new Geo();
  g.add(lathe([[0.115, 0], [0.115, 0.07], [0.078, 0.13], [0.066, 0.7], [0.088, 0.74], [0.088, 0.8], [0.05, 0.84], [0.075, 0.93], [0.045, 1.0], [0.0, 1.02]], N(q, 8, 10, 20)), IRON);
  return g;
}

export function mailbox() {
  const g = new Geo();
  const c = S([1, 1, 1], 0.45, 0.2, 0, 1);
  for (const sx of [-0.2, 0.2]) for (const sz of [-0.18, 0.18]) g.add(box(0.05, 0.4, 0.05), DARK, xf(sx, 0.2, sz));
  g.add(box(0.52, 0.72, 0.48), c, xf(0, 0.74, 0));
  g.add(new THREE.CylinderGeometry(0.24, 0.24, 0.52, 10, 1, false, 0, Math.PI), c, xf(0, 1.1, 0, 0, 0, Math.PI / 2, 1, 1, 1));
  g.add(box(0.36, 0.035, 0.02), BLACK, xf(0, 1.12, 0.235));
  g.add(box(0.3, 0.2, 0.01), S(0xd8d4c8, 0.5, 0), xf(0, 0.8, 0.246));
  return g;
}

export function newsbox() {
  const g = new Geo();
  const c = S([1, 1, 1], 0.45, 0.2, 0, 1);
  g.add(box(0.3, 0.42, 0.3), DARK, xf(0, 0.21, 0));
  g.add(box(0.44, 0.62, 0.4), c, xf(0, 0.73, 0));
  g.add(box(0.36, 0.3, 0.02), GLASS, xf(0, 0.84, 0.2));
  g.add(box(0.36, 0.14, 0.02), S(0xd8d4c8, 0.6, 0), xf(0, 0.56, 0.2));
  g.add(box(0.16, 0.12, 0.14), c, xf(0.1, 1.1, 0));
  return g;
}

export function bikeRack() {
  const g = new Geo();
  g.add(tube([[-0.36, 0, 0], [-0.36, 0.66, 0], [-0.26, 0.8, 0], [0.26, 0.8, 0], [0.36, 0.66, 0], [0.36, 0, 0]], 0.026, 7, 4, 0.2), GALV);
  return g;
}

export function bicycle(q = 2) {
  const g = new Geo();
  const fr = S([1, 1, 1], 0.4, 0.4, 0, 1);
  const tyre = S(0x0e0e0e, 0.85, 0);
  for (const x of [-0.52, 0.52]) {
    g.add(torus(0.325, 0.02, N(q, 3, 4, 6), N(q, 11, 18, 32)), tyre, xf(x, 0.345, 0));
    for (let i = 0; i < 2; i++) g.add(box(0.62, 0.008, 0.008), STEEL, xf(x, 0.345, 0, 0, 0, i * Math.PI / 2 + 0.4));
  }
  const bar = (a, b, r = 0.016) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const len = Math.hypot(...d);
    const m = new THREE.Matrix4(); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(d[0] / len, d[1] / len, d[2] / len));
    m.compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    g.add(cyl(r, r, len, 4, true), fr, m);
  };
  const bb = [-0.08, 0.3, 0], seat = [-0.2, 0.84, 0], head = [0.36, 0.84, 0], rear = [-0.52, 0.345, 0], front = [0.52, 0.345, 0];
  bar(bb, seat); bar(seat, head); bar(bb, [0.34, 0.74, 0]); bar(bb, rear, 0.012); bar(seat, rear, 0.012); bar([0.34, 0.92, 0], front, 0.014);
  g.add(box(0.03, 0.03, 0.46), DARK, xf(0.33, 0.95, 0));
  g.add(box(0.24, 0.045, 0.12), BLACK, xf(-0.22, 0.9, 0));
  g.add(cyl(0.012, 0.012, 0.1, 4), STEEL, xf(-0.205, 0.86, 0));
  return g;
}

export function planter() {
  const g = new Geo();
  g.add(new THREE.CylinderGeometry(0.62, 0.5, 0.6, 4, 1, true, Math.PI / 4), CONC, xf(0, 0.3, 0, 0, 0, 0, 1.25, 1, 1.25));
  g.add(box(1.02, 0.02, 1.02), S(0x2a2118, 0.95, 0), xf(0, 0.55, 0));
  const leaf = [S(0x2c4a1f, 0.85, 0), S(0x3a5a24, 0.85, 0), S(0x25401c, 0.85, 0)];
  const blobs = [[0, 0.82, 0, 0.5], [0.24, 0.72, 0.2, 0.36], [-0.26, 0.74, -0.16, 0.38], [0.1, 0.7, -0.28, 0.32], [-0.18, 0.7, 0.27, 0.3]];
  blobs.forEach((b, i) => g.add(new THREE.IcosahedronGeometry(b[3], 0), leaf[i % 3], xf(b[0], b[1], b[2], i, i * 2, 0, 1, 0.8, 1)));
  return g;
}

export function shelter() {
  // bus shelter: 4.2 m long (X), opens toward +Z, light box at the +X end
  const g = new Geo();
  const fr = S(0x2d3235, 0.5, 0.6);
  for (const x of [-2.05, 2.05]) for (const z of [-0.7, 0.55]) g.add(box(0.08, 2.5, 0.08), fr, xf(x, 1.25, z));
  g.add(box(4.5, 0.07, 1.9), fr, xf(0, 2.56, 0.02, 0.05, 0, 0));
  g.add(box(4.1, 0.03, 0.14), S([1, 0.95, 0.85], 0.4, 0, 15), xf(0, 2.5, -0.1, 0.05, 0, 0));
  g.add(box(4.1, 1.05, 0.03), S(0x2f3437, 0.5, 0.5), xf(0, 0.7, -0.7));
  g.add(box(4.1, 0.9, 0.02), GLASS, xf(0, 1.68, -0.7));
  g.add(box(4.1, 0.05, 0.05), fr, xf(0, 2.0, -0.7));
  g.add(box(2.6, 0.05, 0.36), WOOD, xf(-0.4, 0.5, -0.45));
  for (const x of [-1.5, 0.7]) g.add(box(0.06, 0.48, 0.3), fr, xf(x, 0.24, -0.45));
  g.add(box(0.16, 2.0, 1.3), fr, xf(2.05, 1.2, -0.08));          // light box body (faces added by the sign mesh)
  return g;
}

export function utilityBox() {
  const g = new Geo();
  const c = S(0x566158, 0.6, 0.3);
  g.add(box(1.04, 0.1, 0.44), CONC, xf(0, 0.05, 0));
  g.add(box(1.0, 1.2, 0.4), c, xf(0, 0.7, 0));
  g.add(box(1.04, 0.04, 0.44), c, xf(0, 1.32, 0));
  g.add(box(0.012, 1.1, 0.012), BLACK, xf(0, 0.7, 0.2));
  for (let i = 0; i < 4; i++) g.add(box(0.3, 0.015, 0.012), BLACK, xf(-0.25, 1.05 - i * 0.05, 0.2));
  g.add(box(0.04, 0.1, 0.03), STEEL, xf(0.08, 0.72, 0.21));
  return g;
}

export function phonePost() {
  const g = new Geo();
  g.add(box(0.14, 1.25, 0.14), S(0x3a3f43, 0.5, 0.5), xf(0, 0.625, 0));
  g.add(box(0.5, 0.66, 0.34), S(0x3a3f43, 0.5, 0.5), xf(0, 1.55, 0));
  g.add(box(0.42, 0.5, 0.02), BLACK, xf(0, 1.5, 0.165));
  g.add(box(0.5, 0.12, 0.36), S([1, 1, 1], 0.45, 0.1, 0, 1), xf(0, 1.94, 0));
  g.add(box(0.12, 0.2, 0.05), S(0x9aa0a4, 0.4, 0.7), xf(0.06, 1.48, 0.17));
  return g;
}

export function treeGrate() {
  const g = new Geo();
  const c = S(0x221f1c, 0.6, 0.6);
  g.add(new THREE.RingGeometry(0.4, 1.06, 4, 1, Math.PI / 4), c, xf(0, 0.012, 0, -Math.PI / 2, 0, 0));
  g.add(new THREE.RingGeometry(0.4, 0.46, 16, 1), S(0x15130f, 0.7, 0.4), xf(0, 0.016, 0, -Math.PI / 2, 0, 0));
  g.add(new THREE.CircleGeometry(0.4, 16), S(0x231a12, 0.95, 0), xf(0, 0.006, 0, -Math.PI / 2, 0, 0));
  return g;
}

export function cafeTable(q = 2) {
  const g = new Geo();
  g.add(cyl(0.36, 0.36, 0.028, N(q, 12, 18, 32)), S(0xcfc9bb, 0.35, 0.1), xf(0, 0.735, 0));
  g.add(cyl(0.028, 0.028, 0.7, N(q, 6, 8, 12), true), STEEL, xf(0, 0.37, 0));
  g.add(cyl(0.2, 0.23, 0.03, N(q, 10, 14, 24)), DARK, xf(0, 0.015, 0));
  return g;
}
export function cafeChair() {
  const g = new Geo();
  const c = S([1, 1, 1], 0.5, 0.3, 0, 1);
  g.add(box(0.4, 0.025, 0.4), c, xf(0, 0.45, 0));
  for (const x of [-0.18, 0.18]) { g.add(box(0.025, 0.45, 0.025), c, xf(x, 0.225, 0.18)); g.add(box(0.025, 0.86, 0.025), c, xf(x, 0.43, -0.19, -0.07, 0, 0)); }
  g.add(box(0.4, 0.11, 0.02), c, xf(0, 0.8, -0.215, -0.07, 0, 0));
  g.add(box(0.4, 0.04, 0.02), c, xf(0, 0.63, -0.203, -0.07, 0, 0));
  return g;
}
export function parasolOpen() {
  const g = new Geo();
  const c = S([1, 1, 1], 0.8, 0, 0, 1);
  g.add(cyl(0.25, 0.28, 0.09, 8), CONC, xf(0, 0.045, 0));
  g.add(cyl(0.024, 0.024, 2.6, 6, true), S(0x8a6d4b, 0.6, 0), xf(0, 1.3, 0));
  g.add(cone(1.45, 0.55, 8, true), c, xf(0, 2.42, 0));
  g.add(cone(1.45, 0.55, 8, true), S([0.85, 0.85, 0.85], 0.85, 0, 0, 1), xf(0, 2.415, 0), true);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.add(box(0.012, 0.012, 1.45), DARK, xf(Math.sin(a) * 0.7, 2.4, Math.cos(a) * 0.7, 0.36, a, 0)); }
  g.add(sph(0.04, 5, 4), DARK, xf(0, 2.72, 0));
  return g;
}
export function parasolClosed() {
  const g = new Geo();
  const c = S([1, 1, 1], 0.8, 0, 0, 1);
  g.add(cyl(0.25, 0.28, 0.09, 8), CONC, xf(0, 0.045, 0));
  g.add(cyl(0.024, 0.024, 2.6, 6, true), S(0x8a6d4b, 0.6, 0), xf(0, 1.3, 0));
  g.add(cone(0.17, 1.5, 7), c, xf(0, 1.92, 0, Math.PI, 0, 0));
  g.add(box(0.36, 0.05, 0.36), c, xf(0, 1.7, 0, 0, 0.5, 0, 0.6));
  return g;
}

export function festoonPole(q = 2) {
  const g = new Geo();
  g.add(cyl(0.11, 0.13, 0.25, N(q, 7, 12, 18)), IRON, xf(0, 0.125, 0));
  g.add(cyl(0.035, 0.05, 5.3, N(q, 6, 10, 16), true), IRON, xf(0, 2.75, 0));
  g.add(sph(0.07, N(q, 6, 10, 14), N(q, 4, 6, 8)), IRON, xf(0, 5.42, 0));
  return g;
}

export function bulb(q = 2) {
  const g = new Geo();
  const glass = S([1, 1, 1], 0.3, 0, 13, 1), M = xf(0, -0.03, 0, 0, 0, 0, 1, 1.3, 1);
  if (q === 0) {
    // far: 20 triangles, but shaded as a sphere (smooth normals)
    const ico = new THREE.IcosahedronGeometry(0.055, 0), P = ico.attributes.position, Nn = ico.attributes.normal, v = new THREE.Vector3();
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).normalize(); Nn.setXYZ(i, v.x, v.y, v.z); }
    g.add(ico, glass, M);
  } else {
    g.add(sph(0.055, q === 2 ? 12 : 8, q === 2 ? 7 : 4), glass, M);
    if (q === 2) g.add(cyl(0.021, 0.027, 0.034, 6, true), S(0x0d0d0d, 0.6, 0.2), xf(0, 0.048, 0));     // lamp holder on the cable
  }
  return g;
}

export function stall() {
  // market stall: 3 x 2 m, counter + striped awning (tinted stripes)
  const g = new Geo();
  for (const x of [-1.45, 1.45]) for (const z of [-0.95, 0.95]) g.add(box(0.05, z > 0 ? 2.1 : 2.5, 0.05), GALV, xf(x, (z > 0 ? 2.1 : 2.5) / 2, z));
  g.add(box(2.9, 0.9, 0.9), S(0x6a4c31, 0.75, 0), xf(0, 0.45, 0.2));
  g.add(box(3.0, 0.04, 1.0), S(0x8a6a48, 0.7, 0), xf(0, 0.92, 0.2));
  for (let i = 0; i < 8; i++) {
    const s = i % 2 ? S([0.92, 0.9, 0.84], 0.85, 0) : S([1, 1, 1], 0.85, 0, 0, 1);
    g.add(box(0.4, 0.025, 2.5), s, xf(-1.4 + i * 0.4, 2.33, 0.05, 0.2, 0, 0));
    g.add(box(0.4, 0.22, 0.02), s, xf(-1.4 + i * 0.4, 1.99, 1.27));
  }
  for (let i = 0; i < 3; i++) g.add(box(0.5, 0.3, 0.38), S([0.55, 0.42, 0.28], 0.8, 0), xf(-0.9 + i * 0.9, 1.09, 0.25, 0, i * 0.3, 0));
  return g;
}

export function kiosk() {
  const g = new Geo();
  const c = S(0x1f3a30, 0.5, 0.3);
  g.add(cyl(1.55, 1.6, 0.9, 8), c, xf(0, 0.45, 0));
  g.add(cyl(1.5, 1.5, 1.2, 8, true), S([0.9, 0.82, 0.62], 0.4, 0, 15), xf(0, 1.5, 0));
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; g.add(box(0.12, 1.2, 0.12), c, xf(Math.cos(a) * 1.55, 1.5, Math.sin(a) * 1.55, 0, -a, 0)); }
  g.add(cyl(1.6, 1.6, 0.25, 8), c, xf(0, 2.22, 0));
  g.add(cone(2.3, 0.9, 8), S(0x2c4a3e, 0.45, 0.4), xf(0, 2.8, 0));
  g.add(cyl(2.3, 2.3, 0.05, 8), S(0x1a2b25, 0.5, 0.4), xf(0, 2.36, 0));
  g.add(sph(0.14, 6, 5), S(0x8a7a3a, 0.4, 0.8), xf(0, 3.32, 0));
  return g;
}

export function fountain() {
  const g = new Geo();
  const stone = S(0x8f897c, 0.8, 0);
  g.add(lathe([[4.3, 0], [4.3, 0.18], [4.1, 0.22], [4.1, 0.62], [4.2, 0.66], [4.2, 0.72], [3.75, 0.72], [3.75, 0.3]], 64), stone);
  g.add(cyl(3.76, 3.76, 0.02, 64), S([0.03, 0.06, 0.065], 0.04, 0.6), xf(0, 0.56, 0));
  g.add(lathe([[0.75, 0.3], [0.7, 0.75], [0.45, 0.9], [0.3, 1.5], [0.4, 1.75], [1.45, 2.0], [1.5, 2.08], [1.3, 2.08], [0.3, 1.95]], 36), stone);
  g.add(cyl(1.3, 1.3, 0.02, 36), S([0.03, 0.06, 0.065], 0.04, 0.6), xf(0, 2.04, 0));
  g.add(lathe([[0.22, 1.95], [0.16, 2.5], [0.3, 2.62], [0.52, 2.72], [0.5, 2.78], [0.1, 2.76], [0.06, 3.0], [0.0, 3.1]], 24), stone);
  return g;
}

/** near model with its mid / far stand-ins attached (apparent distances in metres at a 40 degree lens, see lod.js) */
const chain = (fn, mid = 30, far = 110) => () => { const g = fn(2); g.lods = [{ geo: fn(1), from: mid }, { geo: fn(0), from: far }]; return g; };

export const MODELS = {
  lampCobra: chain(lampCobra), lampOrnate: chain(lampOrnate, 26, 90), lampPost: chain(lampPost), lampPendant: chain(lampPendant),
  signalPost: chain(signalPost), signalMast: chain(signalMast), bench, bin: chain(bin, 22, 70), hydrant: chain(hydrant, 22, 70),
  bollard: chain(bollard, 22, 70), mailbox, newsbox,
  bikeRack, bicycle: chain(bicycle, 22, 70), planter, shelter, utilityBox, phonePost, treeGrate, cafeTable: chain(cafeTable, 22, 70), cafeChair, parasolOpen, parasolClosed,
  festoonPole: chain(festoonPole), bulb: chain(bulb, 14, 44), stall, kiosk, fountain,
};
export { lin };
