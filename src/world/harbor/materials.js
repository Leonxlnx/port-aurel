// Harbor materials: stone masonry, iron, timber, matte (rope/rubber/canvas/plastic), boats, lamp glass, signs.
// All are world-space procedural (boats: object-space) and react to height above the water (wet zone, algae, barnacles).
// Vertex attributes: color (tint), uv, aK = (kind, param).
import * as THREE from 'three';
import { WET, WET_GLSL, wetSync } from '../streets/wet.js';

const VPARS = /* glsl */`
attribute vec2 aK;
varying vec2 vHUv; varying vec2 vHK;
`;
const VERT = /* glsl */`vHUv = uv; vHK = aK;`;

const FCOMMON = WET_GLSL + /* glsl */`
varying vec2 vHUv; varying vec2 vHK;
float hbrH = 0.0; float hbrRough = 0.8; float hbrMetal = 0.0; vec3 hbrEm = vec3(0.0);
// bump from a procedural height (metres) using screen derivatives; N is the view-space normal
vec3 hbrBump(vec3 N, float h) {
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec3 R1 = cross(sy, N), R2 = cross(N, sx);
  float det = dot(sx, R1);
  vec3 g = sign(det) * (dFdx(h) * R1 + dFdy(h) * R2);
  vec3 r = abs(det) * N - g;
  return dot(r, r) > 1e-20 ? normalize(r) : N;
}
// running-bond block pattern: returns distance (m) to the nearest joint, id = block id
float hbrBond(vec2 p, vec2 size, float jitter, out vec2 id) {
  float row = floor(p.y / size.y);
  float fy = p.y - row * size.y;
  float xx = p.x / size.x + hash11(row * 1.37 + 0.11) * 7.0;
  float c = floor(xx);
  float L = c + (hash12(vec2(c, row)) - 0.5) * jitter, R = c + 1.0 + (hash12(vec2(c + 1.0, row)) - 0.5) * jitter;
  if (xx < L) { R = L; c -= 1.0; L = c + (hash12(vec2(c, row)) - 0.5) * jitter; }
  else if (xx >= R) { L = R; c += 1.0; R = c + 1.0 + (hash12(vec2(c + 1.0, row)) - 0.5) * jitter; }
  id = vec2(c, row);
  return min(min(xx - L, R - xx) * size.x, min(fy, size.y - fy));
}
// intertidal weathering: damp darkening, algae / weed band, barnacles, glossy wet near the waterline
void hbrTide(inout vec3 c, inout float rough, float y, float u, float px, float amt) {
  if (y > 2.3) return;
  float n1 = fbm2(vec2(u * 0.35, y * 0.6) + 3.1);
  float n2 = vnoise(vec2(u * 3.1, y * 2.3));
  float tide = 0.58 + 0.34 * (n1 - 0.5) + 0.07 * (n2 - 0.5);
  float damp = 1.0 - smoothstep(tide + 0.02, tide + 0.5, y);
  c *= mix(1.0, 0.58, damp * amt);
  float alg = 1.0 - smoothstep(tide - 0.16, tide + 0.03, y);
  vec3 algC = mix(vec3(0.045, 0.065, 0.022), vec3(0.085, 0.11, 0.035), vnoise(vec2(u * 5.0, y * 7.0)));
  algC = mix(algC, vec3(0.022, 0.03, 0.022), smoothstep(0.28, -0.12, y));
  c = mix(c, algC, alg * 0.9 * amt);
  vec2 bp = vec2(u, y) * 36.0; vec2 bi = floor(bp); vec2 bf = fract(bp) - 0.5;
  float bz = smoothstep(tide + 0.22, tide - 0.1, y) * smoothstep(-0.2, 0.08, y);
  float dens = smoothstep(0.4, 0.72, vnoise(vec2(u * 1.3, y * 2.0) + 9.0));
  float bd = length(bf + (hash22(bi) - 0.5) * 0.5);
  float barn = step(hash12(bi), 0.6 * dens) * (1.0 - smoothstep(0.12, 0.3, bd)) * bz * (1.0 - smoothstep(0.012, 0.05, px));
  c = mix(c, vec3(0.40, 0.38, 0.32), barn * 0.8 * amt);
  hbrH += barn * 0.006;
  float wet = (1.0 - smoothstep(0.02, 0.55, y)) * amt;
  rough = mix(rough, 0.22, wet * 0.85 * (1.0 - barn));
}
`;

function base(ctx, params, hooks) {
  return ctx.makeMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0, ...params }, {
    uniforms: { ...WET },
    vertexPars: VPARS + (hooks.vertexPars || ''), vertex: VERT + (hooks.vertex || ''),
    fragPars: FCOMMON + (hooks.fragPars || ''),
    color: hooks.color,
    surface: 'roughnessFactor = clamp(hbrRough, 0.04, 1.0); metalnessFactor = hbrMetal;',
    normal: 'normal = hbrBump(normal, hbrH);',
    emissive: 'totalEmissiveRadiance += hbrEm;',
    key: hooks.key,
  });
}

export function createMaterials(ctx) {
  // ------------------------------------------------------------------------------------------------ stone
  // kinds: 0 ashlar wall blocks, 1 dressed monolith (param = joint spacing along the run, 0 = none), 2 setts paving,
  //        3 flagstones, 4 asphalt
  const stone = base(ctx, {}, {
    key: 'hbr_stone',
    color: /* glsl */`{
      float kind = floor(vHK.x + 0.5);
      vec3 an = abs(vWNormal);
      bool top = an.y > 0.6;
      vec2 p = top ? vWPos.xz : (an.x > an.z ? vWPos.zy : vWPos.xy);
      float px = length(fwidth(vWPos));
      float fade = 1.0 - smoothstep(0.015, 0.09, px);
      vec3 c = diffuseColor.rgb; float rough = 0.9; float h = 0.0;
      float mott = fbm2(p * 0.8 + 11.0);
      float grime = fbm2(p * 0.27 + 5.0);
      float jD = 1.0; float sId = 0.5;      // distance to the nearest paving joint, per-stone random (walking surfaces)
      if (kind < 0.5) {
        float bs = vHK.y > 0.01 ? vHK.y : 1.0;
        vec2 pj = p + (vec2(vnoise(p * 9.0), vnoise(p * 9.0 + 31.7)) - 0.5) * 0.014;
        vec2 id; float d = hbrBond(pj, vec2(1.08, 0.42) * bs, 0.5, id);
        float aa = max(px * 0.7, 0.003);
        float joint = 1.0 - smoothstep(0.009 - aa, 0.009 + aa, d);
        float far = smoothstep(0.15, 0.6, px);
        float bl = mix(0.66 + 0.62 * hash12(id), 1.0, far);
        vec3 hue = mix(vec3(1.0), mix(vec3(1.12, 0.97, 0.80), vec3(0.88, 0.96, 1.06), hash12(id + 3.1)), hash12(id + 7.7) * 0.7);
        float face = fbm2(p * 5.0 + id * 3.3);
        float pit = vnoise(p * 37.0 + id * 1.7); float grain = vnoise(p * 150.0);
        float pits = smoothstep(0.72, 0.9, pit * (0.6 + 0.8 * face)) * fade;
        c *= bl * hue * (0.72 + 0.5 * mott) * (0.8 + 0.4 * face) * (0.93 + 0.14 * grain * fade);
        c *= 1.0 - 0.45 * pits;
        c *= mix(1.0, 0.8, (1.0 - smoothstep(0.0, 0.1, d)) * (1.0 - far));      // weathered arrises
        c *= 1.0 - 0.66 * joint;
        c *= 0.62 + 0.7 * grime;
        h = (0.016 * smoothstep(0.0, 0.06, d) + 0.016 * face + 0.003 * pit - 0.004 * pits) * fade;
        rough = 0.93;
      } else if (kind < 1.5) {
        float grain = vnoise(p * 60.0); float fine = vnoise(p * 170.0);
        c *= (0.78 + 0.4 * mott) * (0.9 + 0.14 * grain + 0.08 * fine * fade) * (0.7 + 0.55 * grime);
        if (vHK.y > 0.01) {
          float sp = vHK.y; float f = fract(p.x / sp + 0.37);
          float d = min(f, 1.0 - f) * sp; float aa = max(px * 0.7, 0.003);
          float joint = 1.0 - smoothstep(0.007 - aa, 0.007 + aa, d);
          c *= 1.0 - 0.6 * joint;
          c *= 0.9 + 0.2 * hash11(floor(p.x / sp + 0.37) * 3.1);
          h = 0.012 * smoothstep(0.0, 0.03, d) * fade;
        }
        h += 0.0015 * grain * fade;
        float chips = smoothstep(0.7, 0.8, fbm2(p * 3.0 + 5.0));
        c *= 1.0 - 0.18 * chips;
        rough = 0.86;
      } else if (kind < 3.5) {
        bool setts = kind < 2.5;
        vec2 id; float d = hbrBond(p.yx, setts ? vec2(0.21, 0.125) : vec2(0.95, 0.62), setts ? 0.35 : 0.3, id);
        float aa = max(px * 0.7, 0.002);
        float jw = setts ? 0.007 : 0.005;
        float joint = 1.0 - smoothstep(jw - aa, jw + aa, d);
        float bl = mix(1.0, (setts ? 0.7 : 0.87) + (setts ? 0.55 : 0.24) * hash12(id), 1.0 - smoothstep(setts ? 0.03 : 0.15, setts ? 0.16 : 0.6, px));
        c *= bl * (0.75 + 0.45 * mott) * mix(vec3(1.0), vec3(1.07, 0.99, 0.88), hash12(id + 3.0));
        c = mix(c, mix(c * 0.4, vec3(0.045, 0.06, 0.022), smoothstep(0.5, 0.68, grime)), joint * 0.85);
        c *= 1.0 - 0.18 * (1.0 - smoothstep(0.0, setts ? 0.03 : 0.05, d)) * fade;
        jD = d; sId = hash12(id + 5.0);
        h = (setts ? 0.012 * smoothstep(0.0, 0.04, d) : 0.004 * smoothstep(0.0, 0.015, d)) * fade + 0.001 * vnoise(p * 50.0) * fade;
        rough = setts ? 0.78 - 0.2 * smoothstep(0.02, 0.06, d) * hash12(id + 1.0) : 0.84;
      } else {
        float sp = vnoise(p * 90.0);
        c *= (0.8 + 0.3 * mott) * (0.85 + 0.3 * sp * fade) * (1.0 + 0.5 * step(0.93, hash12(floor(p * 150.0))) * (1.0 - smoothstep(0.003, 0.012, px)));
        float cn = vnoise(p * 0.31 + 5.0) + 0.3 * vnoise(p * 1.9 + 9.0);
        float tar = (1.0 - smoothstep(0.012, 0.02 + px, abs(cn - 0.65) * 1.2)) * smoothstep(0.5, 0.7, vnoise(p * 0.07 + 40.0));
        c = mix(c, vec3(0.02), tar * 0.9);
        h = 0.0012 * sp * fade; rough = mix(0.9, 0.4, tar);
      }
      hbrH = h;
      if (!top) {
        // rain streaks from the coping + drain stains (walls)
        float st = fbm2(vec2(p.x * 2.3, p.y * 0.11));
        float st2 = fbm2(vec2(p.x * 7.0, p.y * 0.3) + 13.0);
        float streak = smoothstep(0.48, 0.72, st) * smoothstep(0.2, 2.0, p.y);
        c *= (1.0 - 0.45 * streak) * (0.86 + 0.28 * st2);
        if (kind < 0.5) {
          float du = abs(mod(p.x, 21.0) - 10.5);
          float dr = (1.0 - smoothstep(0.06, 0.4 + 0.25 * vnoise(vec2(p.x * 4.0, p.y * 1.5)), du)) * (1.0 - smoothstep(1.2, 1.32, p.y));
          c = mix(c, c * vec3(0.36, 0.44, 0.28), dr * 0.85);
          rough = mix(rough, 0.5, dr * 0.5);
        }
      } else {
        float li = smoothstep(0.6, 0.72, fbm2(p * 1.9 + 40.0));
        c = mix(c, c * vec3(1.08, 1.0, 0.62) + 0.02, li * 0.28 * step(kind, 1.5));
        float wear = fbm2(p * 0.35 + 3.0);
        c *= 0.86 + 0.25 * wear;
        // rain water: damp stones, standing water in the joints and the low spots (level surfaces only)
        if (vWPos.y > 1.9) {
          float lowJ = (kind > 1.5 && kind < 3.5) ? (kind < 2.5 ? 0.1 : 0.04) * (1.0 - smoothstep(0.0, 0.03, jD)) * fade + (sId - 0.5) * 0.06 : 0.0;
          vec2 wm = wetMask(p, lowJ - 0.02, lowJ + (sId - 0.5) * 0.2, px);
          wm.x *= smoothstep(0.990, 0.999, vWNormal.y);
          c *= mix(1.0, 0.64, wm.y) * mix(1.0, 0.72, wm.x);
          rough = mix(mix(rough, rough * 0.45, wm.y), 0.04, wm.x);
          hbrH *= 1.0 - wm.x;
        }
      }
      hbrTide(c, rough, vWPos.y, p.x + (top ? p.y : 0.0), px, 1.0);
      diffuseColor.rgb = c; hbrRough = rough;
    }`,
  });

  // ------------------------------------------------------------------------------------------------ iron
  // kinds: 0 painted cast iron, 1 riveted painted strip (uv = metres along / across, param = half width),
  //        2 bare rusty steel, 3 bright / galvanised metal
  const iron = base(ctx, {}, {
    key: 'hbr_iron',
    color: /* glsl */`{
      float kind = floor(vHK.x + 0.5);
      vec3 wp = vWPos; float px = length(fwidth(wp));
      float fade = 1.0 - smoothstep(0.01, 0.06, px);
      vec3 c = diffuseColor.rgb; float rough = 0.45; float metal = 0.0; float h = 0.0;
      float n = fbm3(wp * 4.0); float nf = vnoise3(wp * 38.0);
      float rust = 0.0;
      if (kind < 0.5) {
        rust = smoothstep(0.64, 0.76, n + 0.2 * (1.0 - smoothstep(0.0, 1.8, wp.y)) + 0.1 * nf);
        h = 0.0008 * nf * fade;
      } else if (kind < 1.5) {
        float hw = vHK.y;
        vec2 q = vec2(fract(vHUv.x / 0.1) - 0.5, (abs(vHUv.y) - 0.62 * hw) / 0.1);
        float d = length(q) * 0.1;
        float riv = (1.0 - smoothstep(0.010, 0.017, d)) * fade;
        h = 0.007 * sqrt(max(riv, 0.0)) + 0.0006 * nf * fade;
        c *= 1.0 + 0.25 * riv;
        float edge = smoothstep(0.75 * hw, hw, abs(vHUv.y));
        rust = smoothstep(0.56, 0.7, n + 0.18 * edge + 0.1 * nf);
      } else if (kind < 2.5) {
        rust = 0.72 + 0.28 * n; h = 0.001 * nf * fade;
      } else {
        metal = 0.9; rough = 0.34 + 0.2 * n;
      }
      vec3 rustC = mix(vec3(0.085, 0.036, 0.018), vec3(0.19, 0.085, 0.032), nf) * (0.6 + 0.7 * n);
      c = mix(c, rustC, rust); rough = mix(rough, 0.93, rust);
      c *= 0.85 + 0.3 * n;
      float tr = rough; hbrH = h;
      hbrTide(c, tr, wp.y, wp.x + wp.z, px, 0.8);
      diffuseColor.rgb = c; hbrRough = tr; hbrMetal = metal;
    }`,
  });

  // ------------------------------------------------------------------------------------------------ timber
  // kinds: 0 weathered planks, 1 tarred / marine piles, 2 painted boards (flaking). param = grain axis (0 x, 1 y, 2 z)
  const timber = base(ctx, {}, {
    key: 'hbr_timber',
    color: /* glsl */`{
      float kind = floor(vHK.x + 0.5); float ax = floor(vHK.y + 0.5);
      vec3 wp = vWPos; float px = length(fwidth(wp));
      float fade = 1.0 - smoothstep(0.008, 0.05, px);
      vec3 q = ax < 0.5 ? wp.xyz : (ax < 1.5 ? wp.yzx : wp.zxy);
      vec3 nn = abs(ax < 0.5 ? vWNormal.xyz : (ax < 1.5 ? vWNormal.yzx : vWNormal.zxy));
      float endGrain = smoothstep(0.72, 0.9, nn.x);
      float across = nn.y > nn.z ? q.z : q.y;
      float g1 = fbm2(vec2(across * 60.0, q.x * 1.6));
      float g2 = fbm2(vec2(across * 8.0 + 0.7 * vnoise(vec2(q.x * 0.9, across * 3.0)), q.x * 0.4) + 7.3);
      float crack = smoothstep(0.80, 0.87, vnoise(vec2(across * 55.0, q.x * 0.7 + 3.0))) * fade;
      vec3 c = diffuseColor.rgb; float rough = 0.86; float h = 0.0;
      vec3 wood = c;
      if (kind > 1.5) wood = vec3(0.26, 0.22, 0.17);
      wood *= 0.6 + 0.55 * g2 + 0.3 * (g1 - 0.5) * fade;
      wood *= 1.0 - 0.65 * crack;
      wood = mix(wood, wood * vec3(1.06, 1.0, 0.9), g2);
      h = (-0.004 * crack + 0.002 * g1) * fade;
      if (endGrain > 0.01) {
        float rings = 0.5 + 0.5 * sin(vnoise(q.yz * 4.0) * 70.0);
        wood = mix(wood, diffuseColor.rgb * (0.38 + 0.3 * rings) , endGrain * 0.9);
      }
      if (kind < 0.5 && ax > 1.5 && vWNormal.y > 0.7) {
        // deck planks: salt bleaching, per-plank moisture, damp plank ends at the deck edge, nail heads with rust weeps
        float pid = fract(dot(diffuseColor.rgb, vec3(37.1, 91.7, 53.3)) * 7.0);
        float sb = vnoise(vec2(wp.x * 0.5 + pid * 13.0, wp.z * 0.27));
        wood = mix(wood, vec3(0.40, 0.385, 0.35) * (0.62 + 0.5 * g2 + 0.25 * (g1 - 0.5) * fade) * (1.0 - 0.6 * crack), smoothstep(0.42, 0.78, sb) * 0.6);
        float nz = (fract(wp.z / 0.75 + 0.5) - 0.5) * 0.75;
        float nx = min(abs(vHUv.x - 0.2), abs(vHUv.x - 0.8)) * 0.2;
        float nail = (1.0 - smoothstep(0.0035, 0.0065, length(vec2(nx, nz)))) * fade;
        float weep = exp(-nx * nx / 0.00012) * exp(-abs(nz) / 0.07) * fade * step(0.35, pid);
        wood = mix(wood, wood * vec3(0.78, 0.5, 0.32), weep * 0.6);
        wood = mix(wood, vec3(0.03, 0.022, 0.018), nail);
        h -= 0.002 * nail;
        float endW = smoothstep(0.09, 0.0, min(vHUv.y, 1.0 - vHUv.y));
        float wetP = smoothstep(0.85 - 0.6 * uGroundWet, 1.05 - 0.6 * uGroundWet, pid) * smoothstep(0.75, 0.4, sb);
        float dampT = max(endW * 0.75, wetP) * smoothstep(0.0, 0.25, uGroundWet);
        wood *= mix(1.0, 0.52, dampT);
        rough = mix(rough, 0.45, dampT);
      }
      if (kind > 1.5) {
        float bd = fract(across / 0.14); float groove = (1.0 - smoothstep(0.0, 0.035, min(bd, 1.0 - bd))) * fade;
        float fl = fbm2(vec2(across * 9.0, q.x * 2.2) + 20.0) + 0.25 * (g1 - 0.5) + 0.3 * smoothstep(0.6, 0.0, wp.y - 2.2);
        float flake = smoothstep(0.56, 0.62, fl);
        vec3 paint = c * (0.82 + 0.3 * g2);
        c = mix(paint, wood, flake * (1.0 - endGrain));
        c *= 1.0 - 0.55 * groove;
        h += (-0.004 * groove + 0.0012 * (1.0 - flake)) * fade;
        rough = mix(0.6, 0.9, flake);
      } else c = wood;
      if (kind > 0.5 && kind < 1.5) rough = 0.8;
      hbrH = h;
      hbrTide(c, rough, wp.y, wp.x * 1.3 + wp.z * 1.7, px, 1.0);
      diffuseColor.rgb = c; hbrRough = rough;
    }`,
  });

  // ------------------------------------------------------------------------------------------------ matte
  // kinds: 0 rope (uv: metres along, 0..1 around), 1 rubber, 2 canvas / tarp, 3 smooth paint / plastic, 4 net over dark
  const matte = base(ctx, {}, {
    key: 'hbr_matte',
    color: /* glsl */`{
      float kind = floor(vHK.x + 0.5);
      vec3 wp = vWPos; float px = length(fwidth(wp));
      float fade = 1.0 - smoothstep(0.004, 0.03, px);
      vec3 c = diffuseColor.rgb; float rough = 0.9; float h = 0.0;
      float n = fbm3(wp * 3.0);
      if (kind < 0.5) {
        float tw = sin((vHUv.x * 70.0 + vHUv.y * 6.2831853 * 3.0));
        c *= 0.62 + 0.3 * n + 0.22 * tw * fade;
        h = 0.003 * tw * fade; rough = 0.95;
      } else if (kind < 1.5) {
        c *= 0.7 + 0.6 * n; rough = 0.82 - 0.2 * n;
        c = mix(c, vec3(0.16, 0.15, 0.14), smoothstep(0.62, 0.8, fbm3(wp * 9.0)) * 0.6);
      } else if (kind < 2.5) {
        float w = fbm3(wp * vec3(2.2, 5.0, 2.2) + 4.0);
        float weave = vnoise3(wp * 160.0);
        c *= (0.6 + 0.6 * w) * (0.92 + 0.16 * weave * fade);
        c = mix(c, c * vec3(0.55, 0.6, 0.5), smoothstep(0.55, 0.8, fbm3(wp * 1.3 + 9.0)) * 0.5);
        h = 0.012 * w * fade; rough = 0.88;
      } else if (kind < 3.5) {
        c *= 0.8 + 0.35 * n;
        float dirt = smoothstep(0.5, 0.8, fbm3(wp * 6.0 + 2.0));
        c = mix(c, c * 0.5 + vec3(0.03, 0.025, 0.02), dirt * 0.6);
        rough = 0.5 + 0.3 * dirt;
      } else {
        vec2 g = vHUv * 22.0; vec2 f = abs(fract(vec2(g.x + g.y, g.x - g.y)) - 0.5);
        float line = 1.0 - smoothstep(0.06, 0.12, min(f.x, f.y));
        line = mix(0.35, line, fade);
        c = mix(c * 0.18, c, line) * (0.7 + 0.5 * n);
        rough = 0.95;
      }
      hbrH = h;
      hbrTide(c, rough, wp.y, wp.x + wp.z, px, 0.7);
      diffuseColor.rgb = c; hbrRough = rough;
    }`,
  });

  // ------------------------------------------------------------------------------------------------ boats
  // Object-space detail. aK = (part, surf):
  //   part 0 fixed vertex colour; surf: 0 gloss paint, 1 varnished wood, 2 metal, 3 canvas, 4 rubber, 5 rope, 6 raw worn wood (deck planks), 7 net
  //   part 1 instance colour A (surf 0 = hull paint with antifouling below the waterline), 2 instance colour B (any surf),
  //   part 3 window glass (glows when iMisc.y > 0.75), 4 navigation / anchor light (iMisc.y > 0.25)
  // instance attributes: iColA, iColB (rgb), iMisc = (seed, lights, wear, boot stripe)
  const boat = base(ctx, {}, {
    key: 'hbr_boat',
    vertexPars: /* glsl */`
      attribute vec3 iColA; attribute vec3 iColB; attribute vec4 iMisc;
      varying vec3 vOP; varying vec3 vCA; varying vec3 vCB; varying vec4 vMisc;`,
    vertex: /* glsl */`vOP = position; vCA = iColA; vCB = iColB; vMisc = iMisc;`,
    fragPars: /* glsl */`varying vec3 vOP; varying vec3 vCA; varying vec3 vCB; varying vec4 vMisc;`,
    color: /* glsl */`{
      float part = floor(vHK.x + 0.5); float surf = floor(vHK.y + 0.5);
      vec3 op = vOP; float seed = vMisc.x; float wear = vMisc.z;
      float px = length(fwidth(op));
      float fade = 1.0 - smoothstep(0.006, 0.04, px);
      vec3 c = diffuseColor.rgb; float rough = 0.4; float metal = 0.0; float h = 0.0; vec3 em = vec3(0.0);
      float n = fbm3(op * 2.6 + seed * 17.0); float nf = vnoise3(op * 42.0 + seed);
      if (part > 3.5) {
        c = vec3(0.85, 0.85, 0.8); rough = 0.3;
        em = step(0.25, vMisc.y) * uNight * mix(vec3(1.0, 0.86, 0.62), vec3(1.0, 0.95, 0.85), fract(seed * 3.7)) * 30.0;
      } else if (part > 2.5) {
        float lit = step(0.75, vMisc.y);
        float ws = fract(c.r * 17.3 + seed * 3.1);                // per-pane random (vertex colour r = pane seed)
        c = vec3(0.015, 0.02, 0.025); rough = 0.07;
        float glassM = 1.0; vec3 room;
        if (surf > 0.5) {
          // framed pane (uv 0..1): painted / varnished frame with rounded corners, putty line, glass showing a dim varied interior
          vec2 q = abs(vHUv - 0.5) - vec2(0.5 - 0.09 - 0.1);
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.1;
          float aa = max(fwidth(d), 1e-4);
          glassM = 1.0 - smoothstep(-aa, aa, d);
          float seal = 1.0 - smoothstep(0.015, 0.03 + aa, abs(d - 0.015));
          vec3 frame = mix(vec3(0.30, 0.15, 0.06), vCB * 0.5, step(0.5, fract(seed * 5.3))) * (0.7 + 0.5 * n);
          c = mix(frame * (1.0 - 0.7 * seal), c, glassM); rough = mix(0.45, 0.07, glassM);
          float u = vHUv.x, v = clamp((vHUv.y - 0.09) / 0.82, 0.0, 1.0);
          float wall = mix(0.2, 1.0, smoothstep(0.1, 0.95, v));
          wall *= mix(0.3, 1.0, smoothstep(0.0, 0.06, v - (0.14 + 0.22 * fract(ws * 7.7) * step(0.4, fract(u * 1.5 + ws)))));   // things on the sill against the light
          vec2 lp = vec2(u - (0.25 + 0.5 * fract(ws * 3.3)), (v - 0.8) * 1.6);
          float lamp = (exp(-dot(lp, lp) * 70.0) * 1.1 + exp(-dot(lp, lp) * 6.0) * 0.3) * step(0.45, ws);                        // a bulb / oil lamp in some
          room = mix(vec3(1.0, 0.42, 0.13), vec3(1.0, 0.6, 0.28), fract(ws * 9.1)) * (wall * (0.35 + 0.45 * fract(ws * 5.9)) + lamp);
          room = mix(room, vec3(0.9, 0.33, 0.09) * 0.36 * (0.75 + 0.25 * sin(u * 30.0 + ws * 6.0)) * mix(0.7, 1.0, v), step(ws, 0.3));   // drawn curtain
        } else {
          float curtain = 0.5 + 0.5 * vnoise(vec2((op.x + op.z) * 2.3 + seed * 9.0, op.y * 1.5));
          room = vec3(1.0, 0.48, 0.15) * 0.8 * curtain;
        }
        em = lit * uNight * room * glassM * 1.1;
      } else {
        if (part > 1.5) c = vCB; else if (part > 0.5) c = vCA;
        if (part > 0.5 && surf < 0.5) {
          float streak = fbm2(vec2((op.x + op.z) * 7.0, op.y * 0.5) + seed);
          if (part < 1.5) {
            float wl = op.y + 0.02 * (n - 0.5);
            vec3 bottom = mix(vec3(0.20, 0.045, 0.03), vec3(0.03, 0.06, 0.055), step(0.5, fract(seed * 7.13)));
            c = mix(bottom, c, smoothstep(0.05, 0.062, wl));
            float stripe = smoothstep(0.062, 0.07, wl) * (1.0 - smoothstep(0.115, 0.123, wl));
            c = mix(c, vec3(0.78, 0.76, 0.68), stripe * vMisc.w);
            float scum = 1.0 - smoothstep(0.0, 0.11 + 0.08 * n, op.y);
            c = mix(c, vec3(0.05, 0.07, 0.035), scum * 0.75);
            float seam = abs(fract(op.y / 0.17 + 0.1 * sin(op.x * 0.7)) - 0.5);
            float sl = (1.0 - smoothstep(0.02, 0.06, seam)) * fade * (1.0 - vMisc.w * 0.6);
            c *= 1.0 - 0.2 * sl; h -= 0.002 * sl;
          }
          float fl = n + 0.14 * nf + 0.3 * wear;
          float flake = smoothstep(0.66, 0.72, fl);
          c = mix(c, c * 0.5 + vec3(0.13, 0.11, 0.09), flake * 0.85);
          c *= 0.8 + 0.34 * streak;
          float rustS = smoothstep(0.7, 0.85, fbm2(vec2((op.x + op.z) * 11.0, op.y * 0.8) + seed * 3.0)) * wear;
          c = mix(c, vec3(0.25, 0.11, 0.045), rustS * 0.6);
          rough = mix(0.3, 0.78, clamp(flake + wear * 0.5 + rustS, 0.0, 1.0));
          h += 0.0015 * flake * fade;
        } else if (surf < 0.5) { c *= 0.85 + 0.25 * n; rough = 0.38 + 0.3 * wear; }
        else if (surf < 1.5) {
          float g = fbm2(vec2(op.x * 1.8 + seed, (op.y + op.z) * 55.0));
          float g2 = fbm2(vec2(op.x * 0.5, (op.y + op.z) * 9.0) + seed);
          c *= 0.6 + 0.5 * g2 + 0.25 * (g - 0.5) * fade; rough = 0.32 + 0.4 * wear + 0.2 * g2; h = 0.0012 * g * fade;
        } else if (surf < 2.5) { metal = 0.92; rough = 0.28 + 0.25 * n; }
        else if (surf < 3.5) {
          float w = fbm3(op * vec3(3.0, 6.0, 3.0) + seed);
          c *= (0.62 + 0.6 * w) * (0.93 + 0.14 * nf * fade); h = 0.012 * w * fade; rough = 0.9;
          c = mix(c, c * vec3(0.6, 0.64, 0.52), smoothstep(0.55, 0.8, fbm3(op * 1.7 + 9.0 + seed)) * 0.45);
        } else if (surf < 4.5) { c *= 0.7 + 0.6 * n; rough = 0.8; }
        else if (surf < 5.5) { float tw = sin(vHUv.x * 70.0 + vHUv.y * 18.85); c *= 0.62 + 0.3 * n + 0.2 * tw * fade; rough = 0.95; }
        else if (surf < 6.5) {
          float g = fbm2(vec2(op.x * 1.5 + seed, (op.y + op.z) * 60.0));
          float g2 = fbm2(vec2(op.x * 0.4, (op.y + op.z) * 8.0) + seed);
          float bd = abs(fract(op.z / 0.12) - 0.5);
          float groove = (1.0 - smoothstep(0.42, 0.5, bd)) * fade;
          c *= (0.6 + 0.55 * g2 + 0.3 * (g - 0.5) * fade) * (1.0 - 0.5 * groove); rough = 0.86; h = (0.002 * g - 0.003 * groove) * fade;
        } else {
          vec3 g = op * 26.0; vec2 f = abs(fract(vec2(g.x + g.z + g.y, g.x - g.z + g.y)) - 0.5);
          float line = mix(0.4, 1.0 - smoothstep(0.08, 0.16, min(f.x, f.y)), fade);
          c = mix(c * 0.15, c, line) * (0.6 + 0.7 * n); rough = 0.95; h = 0.004 * line * fade;
        }
      }
      diffuseColor.rgb = c; hbrRough = rough; hbrMetal = metal; hbrH = h; hbrEm = em;
    }`,
  });

  // ------------------------------------------------------------------------------------------------ lamp glass / windows
  // aK = (emissive strength, type): type 0 = lantern glass (milky by day), 1 = window pane (dark by day)
  const glass = base(ctx, { roughness: 0.2 }, {
    key: 'hbr_glass',
    color: /* glsl */`{
      vec3 tint = diffuseColor.rgb;
      float n = vnoise(vWPos.xy * 3.0 + vWPos.z * 2.0);
      if (vHK.y > 0.5) { diffuseColor.rgb = vec3(0.02, 0.025, 0.03); hbrRough = 0.08; hbrEm = tint * vHK.x * uNight * (0.6 + 0.5 * n); }
      else {
        // opal lamp glass: grey-white and not self-luminous by day (darker rim, a little sky showing through); lit: hot core, soft falloff to the limb
        vec3 Vg = normalize(uCamPos - vWPos); float nv = clamp(abs(dot(normalize(vWNormal), Vg)), 0.0, 1.0);
        float lit = uNight * smoothstep(0.1, 0.3, uNight);
        vec3 milk = vec3(0.48, 0.49, 0.49) * mix(0.45, 1.0, pow(nv, 0.8)) * (0.92 + 0.16 * n);
        diffuseColor.rgb = milk; hbrRough = 0.16;
        float vy = exp(-pow((vHUv.y - 0.45) * 2.4, 2.0));
        float core = (mix(0.2, 1.0, pow(nv, 2.2)) + 1.5 * pow(nv, 12.0)) * mix(0.5, 1.0, vy);
        vec3 thru = skyLUT(uSkyLUT, normalize(vec3(-Vg.x, abs(Vg.y) + 0.06, -Vg.z))) * milk * 0.15 * pow(nv, 0.6);
        hbrEm = tint * vHK.x * lit * core + thru * (1.0 - lit);
      }
    }`,
  });

  stone.onBeforeRender = timber.onBeforeRender = wetSync(ctx);
  return { stone, iron, timber, matte, boat, glass };
}

/** Sign atlas: a canvas with fictional signs; returns { material, rects: {name: [u0,v0,u1,v1]} }. */
export function createSignAtlas(ctx) {
  const W = 1024, H = 1024;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#222'; g.fillRect(0, 0, W, H);
  const rects = {};
  const sign = (name, x, y, w, h, bg, fg, lines, opts = {}) => {
    g.save();
    g.fillStyle = bg; g.fillRect(x, y, w, h);
    g.strokeStyle = fg; g.lineWidth = opts.border ?? 6; g.strokeRect(x + 10, y + 10, w - 20, h - 20);
    g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    const n = lines.length; const lh = (h - 40) / n;
    lines.forEach((ln, i) => {
      const size = (ln.size ?? 1) * Math.min(lh * 0.78, 200);
      g.font = `${ln.weight ?? 700} ${size}px ${ln.font ?? 'Georgia, "Times New Roman", serif'}`;
      let txt = ln.text; const mw = w - 50;
      const tw = g.measureText(txt).width; const sx = tw > mw ? mw / tw : 1;
      g.save(); g.translate(x + w / 2, y + 20 + lh * (i + 0.5)); g.scale(sx, 1); g.fillText(txt, 0, 0); g.restore();
    });
    // grime
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(30,20,10,${0.03 + 0.05 * ((i * 37) % 7) / 7})`; const rx = x + ((i * 97) % w), ry = y + ((i * 53) % h); g.fillRect(rx, ry, 2 + (i % 5) * 7, 1 + (i % 3)); }
    g.restore();
    rects[name] = [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H];
  };
  const navy = '#1c2f44', cream = '#e9dfc4', red = '#8f2a1f', green = '#234a3a', white = '#ece8dc', black = '#1a1a1a', yellow = '#d9b23a';
  sign('harbourmaster', 0, 0, 640, 200, navy, cream, [{ text: 'PORT AUREL', size: 0.8 }, { text: 'HARBOUR OFFICE · QUAY 3', size: 0.75, weight: 400 }]);
  sign('longpier', 0, 200, 640, 200, cream, navy, [{ text: 'LONG PIER', size: 0.95 }, { text: 'EST. 1887 · LANDING STAGE', size: 0.6, weight: 400 }]);
  sign('nomooring', 640, 0, 384, 200, white, red, [{ text: 'NO MOORING', size: 0.9, font: 'Arial, Helvetica, sans-serif' }, { text: 'FERRY BERTH', size: 0.7, font: 'Arial, Helvetica, sans-serif' }]);
  sign('boathire', 640, 200, 384, 200, green, cream, [{ text: 'BOAT HIRE', size: 0.9 }, { text: 'Marlow & Daughters', size: 0.62, weight: 400, font: 'Georgia, serif' }]);
  sign('fish', 0, 400, 512, 200, red, cream, [{ text: 'AUREL FISH DOCK', size: 0.85 }, { text: 'LANDINGS DAILY · 5 A.M.', size: 0.6, weight: 400 }]);
  sign('deepwater', 512, 400, 256, 256, yellow, black, [{ text: 'DEEP', size: 0.9, font: 'Arial, Helvetica, sans-serif' }, { text: 'WATER', size: 0.9, font: 'Arial, Helvetica, sans-serif' }, { text: 'NO RAILING', size: 0.5, font: 'Arial, Helvetica, sans-serif' }], { border: 10 });
  sign('quay7', 768, 400, 256, 256, navy, cream, [{ text: 'QUAY', size: 0.7 }, { text: '7', size: 1.3 }]);
  sign('canal', 0, 600, 512, 160, navy, cream, [{ text: 'LANTERN CANAL', size: 0.9 }, { text: 'DEAD SLOW · 4 KNOTS', size: 0.65, weight: 400 }]);
  sign('ferry', 0, 760, 512, 160, white, navy, [{ text: 'ISLAND FERRY', size: 0.9, font: 'Arial, Helvetica, sans-serif' }, { text: 'PIER GATE 2  →', size: 0.7, font: 'Arial, Helvetica, sans-serif', weight: 400 }]);
  sign('crane', 512, 656, 256, 128, yellow, black, [{ text: 'S.W.L. 3 TONS', size: 0.9, font: 'Arial, Helvetica, sans-serif' }], { border: 8 });
  sign('cafe', 512, 784, 512, 136, green, cream, [{ text: 'THE TIDE TABLE', size: 0.95 }, { text: 'chandlery & provisions', size: 0.62, weight: 400 }]);
  sign('blank', 768, 656, 256, 128, '#3a3f3c', '#3a3f3c', [{ text: '', size: 1 }]);
  const tex = new ctx.THREE.CanvasTexture(cv);
  tex.colorSpace = ctx.THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
  tex.minFilter = ctx.THREE.LinearMipmapLinearFilter;
  const material = ctx.makeMaterial({ map: tex, roughness: 0.62, metalness: 0.0 }, {
    key: 'hbr_sign',
    color: /* glsl */`{ float n = fbm2(vWPos.xy * 3.0 + vWPos.z * 3.0); diffuseColor.rgb *= 0.55 + 0.4 * n;
      float r = smoothstep(0.62, 0.78, fbm2(vWPos.xy * 7.0 + vWPos.z * 5.0 + 9.0)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.09, 0.04), r * 0.55); }`,
  });
  return { material, rects };
}
