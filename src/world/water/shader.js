// GLSL for the water surface (custom lighting; receives the engine's cascaded sun shadows through three's chunks).
import { G_GLSL, COMMON_GLSL } from '../../engine/globals.js';

export const NG = 8;      // geometric (Gerstner) components
export const NLAY = 9;    // normal-detail layers

// ---- shared between vertex and fragment: where is the water sheltered, where are walls -----------------------------
const REGION_GLSL = /* glsl */`
uniform vec4 uCanal;      // z0, z1, quay x, x1
uniform vec4 uBasin;      // x0, x1, z0, z1
uniform vec4 uBW;         // breakwater segment x0, z0, x1, z1
uniform vec2 uWind;       // unit travel direction of the wind sea
uniform float uQuayAmp;
uniform float uWallRefl;
float canalMouth(float z) { return smoothstep(uCanal.x - 2.0, uCanal.x + 2.0, z) * (1.0 - smoothstep(uCanal.y - 2.0, uCanal.y + 2.0, z)); }
// 1 = open bay, -> 0 in the sheltered canal / basin
float exposure(vec2 p) {
  float d = uCanal.z - p.x;
  float e = mix(uQuayAmp, 1.0, smoothstep(0.0, 380.0, d));
  vec2 AB = uBW.zw - uBW.xy; vec2 AP = p - uBW.xy;
  float det = AB.x * uWind.y - AB.y * uWind.x;
  float u = (AP.x * uWind.y - AP.y * uWind.x) / det;
  float t = (AB.x * AP.y - AB.y * AP.x) / det;
  float lee = smoothstep(-0.15, 0.1, u) * (1.0 - smoothstep(0.9, 1.15, u)) * smoothstep(0.0, 60.0, t) * exp(-max(t, 0.0) / 1100.0);
  e *= 1.0 - 0.65 * lee;
  if (d < 0.0) e *= exp(d / 28.0);
  return e;
}
// weight of the wave train reflected by the quay wall (bay side)
float quayRefl(vec2 p) { float d = uCanal.z - p.x; return d > 0.0 ? uWallRefl * exp(-d / 45.0) * (1.0 - canalMouth(p.y)) : 0.0; }
// wave groups: the energy shifts slowly between the two families of wave trains (uGS = +1 / -1), so the pattern
// changes character from place to place instead of repeating the same stripes. Returns -depth .. +depth.
uniform vec4 uGroup;      // group modulation depth, glint cell size (filter widths), edge darkening, normal filter scale
float wHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float groupField(vec2 p) {
  vec2 q = p - uWind * (uTime * 1.7);
  return (wNoise(q * 0.0155) * 0.65 + wNoise(q * 0.041 + 7.7) * 0.35 - 0.5) * 2.0 * uGroup.x;
}
`;

export const WATER_VERT = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>
${G_GLSL}
#define NG ${NG}
uniform vec4 uGA[NG];       // dir.x, dir.z, k, amplitude
uniform float uGP[NG];      // omega * t + phase0 (wrapped on the CPU)
uniform float uGS[NG];      // wave-group family (+1 / -1, 0 = unmodulated)
uniform vec4 uGrid;         // morph start, morph end (cells), spacing/distance, finest cell (m)
uniform float uWaveScale;
varying vec2 vXZ0;          // undisplaced (parametric) world xz
varying vec3 vWPos;
varying vec2 vMisc;         // exposure, view depth
${REGION_GLSL}
void gerstnerDisp(vec2 p, float amp, float sx, float sp, float grp, inout vec3 disp) {
  for (int i = 0; i < NG; i++) {
    vec4 g = uGA[i];
    float lam = 6.2831853 / g.z;
    float att = 1.0 - smoothstep(lam / 7.0, lam / 3.5, sp);      // only what the local grid can carry
    float ph = g.z * dot(g.xy, p) - uGP[i];
    float a = g.w * amp * att * (1.0 + uGS[i] * grp);
    float c = cos(ph), s = sin(ph);
    disp.x += sx * g.x * a * c; disp.z += g.y * a * c; disp.y += a * s;
  }
}
void main() {
  vec2 wp = (modelMatrix * vec4(position, 1.0)).xz;
  vec3 disp = vec3(0.0);
#ifndef SKIRT
  float cell = modelMatrix[0][0];
  vec2 dc = abs(wp - uCamPos.xz);
  float mf = smoothstep(uGrid.x, uGrid.y, max(dc.x, dc.y) / cell);
  wp -= fract(position.xz * 0.5) * 2.0 * cell * mf;              // odd vertices slide onto the coarser lattice
#endif
  float expo = exposure(wp);
#ifndef SKIRT
  float d3 = length(vec3(wp.x, 0.0, wp.y) - uCamPos);
  float sp = max(uGrid.w, d3 * uGrid.z);
  float amp = expo * uWaveScale;
  float grp = groupField(wp);
  gerstnerDisp(wp, amp, 1.0, sp, grp, disp);
  float qr = quayRefl(wp);
  if (qr > 0.01) gerstnerDisp(vec2(2.0 * uCanal.z - wp.x, wp.y), amp * qr, -1.0, sp, -grp, disp);
#endif
  vec3 wpos = vec3(wp.x + disp.x, disp.y, wp.y + disp.z);
  vec4 mvPosition = viewMatrix * vec4(wpos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  // never let the far plane cut the sea: pin depth just inside the far limit
#ifdef REVERSED_DEPTH
  gl_Position.z = max(gl_Position.z, 2.0e-7 * gl_Position.w);
#else
  gl_Position.z = min(gl_Position.z, 0.999999 * gl_Position.w);
#endif
  vXZ0 = wp; vWPos = wpos; vMisc = vec2(expo, -mvPosition.z);
#if defined( USE_SHADOWMAP ) && NUM_SUN_LIGHT_SHADOWS > 0
  vSunShadowWorldPosition = vec4(wpos, -mvPosition.z);
  vSunShadowWorldNormal = vec3(0.0, 1.0, 0.0);
#endif
}
`;

export const WATER_FRAG = /* glsl */`
#include <common>
#include <packing>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${G_GLSL}
${COMMON_GLSL}
#define NG ${NG}
#define NLAY ${NLAY}
#ifndef NTAP
#define NTAP 4
#endif
uniform vec4 uGA[NG];
uniform float uGP[NG];
uniform float uGS[NG];
uniform vec4 uFine;         // glint (sun), fleck (mirror image), slick damping, twinkle rate (rad/s)
uniform vec4 uLyA[NLAY];    // cos, sin, 1/tile, -
uniform vec4 uLyB[NLAY];    // -, texture select, variance bay, variance canal
uniform vec4 uLyC[NLAY];    // calm fraction bay, calm fraction canal, wall reflection, uv offset
uniform vec4 uLyD[NLAY];    // cos(phase), sin(phase), group drift (tiles), -
uniform float uRetA[10];    // variance kept per mip level of band A / B
uniform float uRetB[10];
uniform sampler2D uBandA;
uniform sampler2D uBandB;
uniform sampler2D uRefl;    // rgb = mirrored scene (fogged), a = view depth in the mirror camera
uniform mat4 uReflVP;
uniform vec3 uReflCam;
uniform float uReflOn;
uniform vec4 uReflInfo;     // px per radian, w, h, max mip
uniform vec3 uSunUV;        // key light position in the mirror image, z = valid
uniform sampler2D uRip1; uniform sampler2D uRip2; uniform sampler2D uRip3; uniform sampler2D uRip4;   // vertically pre-blurred mirror image
uniform float uWaveScale;
uniform float uRipple;
uniform float uAniso;
uniform vec3 uBayColor;     // irradiance reflectance of the water body
uniform vec3 uCanalColor;
uniform vec3 uShallowColor;
uniform vec2 uExt;          // extinction per metre: bay, canal
uniform vec3 uFoam;         // width (m), strength, wake strength
uniform vec4 uOptics;       // sss, sun gain, reflection gain, city light gain
uniform vec4 uLobe;         // tap roughness scale, mip k, alpha^2 floor, gust speed
uniform vec4 uWake[2];      // x, z, heading x, heading z (unit; zero = off)
uniform vec4 uWakeB[2];     // speed (m/s), beam (m), length (m), strength
uniform vec4 uWakeC[2];     // hull length (m)
varying vec2 vXZ0;
varying vec3 vWPos;
varying vec2 vMisc;
${REGION_GLSL}

// sky LUT with explicit lod (usable inside loops / branches)
vec3 skyLUT0(vec3 dir) {
  float az = atan(dir.z, dir.x);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * PI));
  return textureLod(uSkyLUT, vec2(az / (2.0 * PI) + 0.5, v), 0.0).rgb;
}
// unpolarised Fresnel reflectance of water (n = 1.34)
float fresnelW(float c) {
  c = clamp(c, 0.0, 1.0);
  float g = sqrt(0.7956 + c * c);
  float A = (g - c) / (g + c);
  float B = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
  return 0.5 * A * A * (1.0 + B * B);
}
float smithG1(float c, float a2) {
  float a = c / sqrt(max(a2 * (1.0 - c * c), 1e-9));
  return a < 1.6 ? (3.535 * a + 2.181 * a * a) / (1.0 + 2.276 * a + 2.577 * a * a) : 1.0;
}
// Heitz 2018: sample the GGX distribution of visible normals (local frame, z = mean normal)
vec3 sampleVNDF(vec3 Ve, float a, vec2 u) {
  vec3 Vh = normalize(vec3(a * Ve.x, a * Ve.y, Ve.z));
  float lensq = Vh.x * Vh.x + Vh.y * Vh.y;
  vec3 T1 = lensq > 1e-8 ? vec3(-Vh.y, Vh.x, 0.0) * inversesqrt(lensq) : vec3(1.0, 0.0, 0.0);
  vec3 T2 = cross(Vh, T1);
  float r = sqrt(u.x); float phi = 6.2831853 * u.y;
  float p1 = r * cos(phi), p2 = r * sin(phi);
  float s = 0.5 * (1.0 + Vh.z);
  p2 = (1.0 - s) * sqrt(max(1.0 - p1 * p1, 0.0)) + s * p2;
  vec3 Nh = p1 * T1 + p2 * T2 + sqrt(max(0.0, 1.0 - p1 * p1 - p2 * p2)) * Vh;
  return normalize(vec3(a * Nh.x, a * Nh.y, max(1e-4, Nh.z)));
}

// cat's paws: large patches of wind-roughened water drifting with the breeze
// x: 0 = lull .. 1 = ruffled; y: 1 inside a slick (thin meandering streak of surface film where capillaries die)
// Every octave fades out on its own when the pixel footprint (fb, along the view) outgrows it, so the big patches
// still read far out in the bay. (The two large octaves are the field the film's shots were tuned with.)
vec2 gustField(vec2 p, float fb) {
  vec2 q = p - uWind * (uTime * uLobe.w);
  vec2 w = vec2(dot(q, uWind), q.y * uWind.x - q.x * uWind.y);
  float n1 = vnoise(q / 85.0) - 0.5;
  float n2 = vnoise(q / 29.0 + 17.3) - 0.5;
  float n3 = vnoise(w * vec2(1.0 / 14.0, 1.0 / 8.5) + 5.7) - 0.5;
  float k1 = 1.0 - smoothstep(60.0, 240.0, fb), k2 = 1.0 - smoothstep(20.0, 80.0, fb), k3 = 1.0 - smoothstep(7.0, 26.0, fb);
  float n = 0.5 + n1 * (0.62 * k1) + n2 * (0.38 * k2) + n3 * (0.12 * k3);
  float sn = vnoise(w * vec2(1.0 / 90.0, 1.0 / 21.0) + vec2(3.1, 40.0) + n2 * 0.7) - 0.5;
  float slick = (1.0 - smoothstep(0.02, 0.10, abs(sn))) * smoothstep(-0.08, 0.16, n3 + 0.6 * n2) * (1.0 - smoothstep(4.0, 16.0, fb));
  return vec2(smoothstep(0.36, 0.70, n), slick);
}

// Unresolved facets as discrete glints: one random slope offset per world-anchored cell (2D Gaussian, unit variance
// per axis), turning slowly so the glints twinkle. A pure function of position and time.
vec2 glintCell(vec2 q, float sz) {
  vec2 id = mod(floor(q / sz), 1024.0) + sz * 37.0;
  vec3 h = hash32(id);
  float r = sqrt(-2.0 * log(max(h.x, 1.0e-4)));
  float a = 6.2831853 * h.y + uTime * uFine.w * (h.z - 0.5);
  return r * vec2(cos(a), sin(a));
}
vec2 glintSlope(vec2 p, float f) {
  vec2 q = p - uWind * (uTime * 0.3);
  // cell size is tied to the frame, not to the pixel grid: a 720-line preview and the 4K frame show the same glints
  float l = log2(max(f * uGroup.y * uResolution.y / 720.0, 1.0e-4)); float l0 = floor(l); float w = l - l0;
  float sz = exp2(l0);
  vec2 d = mix(glintCell(q, sz), glintCell(q, 2.0 * sz), w);
  return d * inversesqrt(1.0 - 2.0 * w * (1.0 - w));
}

// trochoidal components: accumulates (sum Dx kA cos, sum kA sin, sum Dz kA cos), lost slope variance and height
void gerstner(vec2 p, float f, float amp, float sx, float grp, inout vec3 acc, inout float varLost, inout float hgt) {
  for (int i = 0; i < NG; i++) {
    vec4 g = uGA[i];
    float ph = g.z * dot(g.xy, p) - uGP[i];
    float c = cos(ph), s = sin(ph);
    float a = g.w * amp * (1.0 + uGS[i] * grp);
    float ka = g.z * a;
    float kf = g.z * f;
    float flt = exp(-0.05 * kf * kf);                 // footprint filter of a sinusoid
    acc.x += sx * g.x * ka * c * flt; acc.z += g.y * ka * c * flt; acc.y += ka * s * flt;
    varLost += 0.5 * ka * ka * (1.0 - flt * flt);
    hgt += a * s;
  }
}

float retained(float lod, float sel) {
  float l = clamp(lod, 0.0, 8.0); int i = int(l); float fr = l - float(i);
  return sel > 0.5 ? mix(uRetB[i], uRetB[i + 1], fr) : mix(uRetA[i], uRetA[i + 1], fr);
}
vec2 bandSlope(vec2 p, vec4 A, float sel, float off, vec4 D, float lod) {
  vec2 q = vec2(A.x * p.x + A.y * p.y, -A.y * p.x + A.x * p.y);
  vec2 uv = q * A.z + vec2(off - D.z, off * 1.7);
  vec4 Gt = sel > 0.5 ? textureLod(uBandB, uv, lod) : textureLod(uBandA, uv, lod);
  vec2 sl = vec2(Gt.x * D.x + Gt.y * D.y, Gt.z * D.x + Gt.w * D.y);   // Re[G exp(-i w t)]
  return vec2(A.x * sl.x - A.y * sl.y, A.y * sl.x + A.x * sl.y);
}
// nearest wall: returns reflection weight, mirror axis and wall coordinate
float wallInfo(vec2 p, out vec2 axis, out float c) {
  axis = vec2(1.0, 0.0); c = uCanal.z;
  float d = uCanal.z - p.x;
  if (d > 0.0) return exp(-d / 40.0) * (1.0 - canalMouth(p.y));
  float d1, d2;
  if (p.x < uBasin.x) {
    float a = p.y - uCanal.x, b = uCanal.y - p.y;
    axis = vec2(0.0, 1.0);
    if (a < b) { d1 = a; d2 = b; c = uCanal.x; } else { d1 = b; d2 = a; c = uCanal.y; }
  } else {
    d1 = uBasin.y - p.x; c = uBasin.y; d2 = 1.0e4;
    float dn = p.y - uBasin.z, ds = uBasin.w - p.y;
    if (dn < d1) { d2 = d1; d1 = dn; axis = vec2(0.0, 1.0); c = uBasin.z; } else d2 = min(d2, dn);
    if (ds < d1) { d2 = d1; d1 = ds; axis = vec2(0.0, 1.0); c = uBasin.w; } else d2 = min(d2, ds);
  }
  return d1 > 0.0 ? exp(-d1 / 8.0) * smoothstep(0.0, 5.0, d2 - d1) : 0.0;
}

// one reflection lookup: mirrored scene where available (parallax corrected with the reflected scene's distance), sky LUT elsewhere
vec3 reflTex(vec2 uv, float m, float r) {
  vec3 c;
  if (r < 0.5) c = textureLod(uRefl, uv, m).rgb;
  else if (r < 1.5) c = textureLod(uRip1, uv, m).rgb;
  else if (r < 2.5) c = textureLod(uRip2, uv, m).rgb;
  else if (r < 3.5) c = textureLod(uRip3, uv, m).rgb;
  else c = textureLod(uRip4, uv, m).rgb;
  return c;
}
vec3 envSample(vec3 R, vec3 P, float L0, vec2 hdir, float mip, float rip) {
  float wTex = 0.0; vec3 tex = vec3(0.0);
  if (uReflOn > 0.5) {
    float rh = dot(R.xz, hdir);
    if (rh > 0.02) {
      float tt = min(L0 / rh, 4.0e4);
      vec4 c = uReflVP * vec4(P + R * tt, 1.0);
      if (c.w > 0.0) {
        vec2 uv = c.xy / c.w * 0.5 + 0.5;
        vec2 e = min(uv, 1.0 - uv);
        wTex = smoothstep(0.0, 0.03, e.x) * smoothstep(0.0, 0.03, e.y);
        if (wTex > 0.0) tex = reflTex(uv, mip, rip);
      }
    }
  }
  vec3 sky = wTex < 0.999 ? skyLUT0(R) : vec3(0.0);
  return mix(sky, tex, wTex);
}

void main() {
  vec2 p = vXZ0;
  vec3 toCam = uCamPos - vWPos; float dist = length(toCam); vec3 V = toCam / dist;
  float expo = vMisc.x;
  float dQuay = uCanal.z - p.x;

  // ---- pixel footprint on the water plane: fa across, fb along the view direction
  float pixAng = 2.0 / (uProj[1][1] * uResolution.y);
  float fa = dist * pixAng;
  float cosv = max(V.y, 0.003);
  float fb = fa / cosv;
  float f = fa * pow(1.0 / cosv, uAniso) * uGroup.w; // filter width for the normals (rest becomes sparkle / roughness)

  float bayness = smoothstep(0.0, 0.3, expo);
  vec2 gs = gustField(p, fb);
  float gust = gs.x;

  // ---- surface slopes
  vec3 acc = vec3(0.0); float varLost = 0.0; float hgt = 0.0;
  float amp = expo * uWaveScale;
  float grp = groupField(p);
  gerstner(p, f, amp, 1.0, grp, acc, varLost, hgt);
  float qr = quayRefl(p);
  if (qr > 0.01) gerstner(vec2(2.0 * uCanal.z - p.x, p.y), f, amp * qr, -1.0, -grp, acc, varLost, hgt);
  vec2 slope = acc.xz / max(1.0 - acc.y, 0.3);

  // ---- wakes (optional): turbulent lane + foam behind the stern, Kelvin pattern (cusp + transverse waves)
  float wakeFoam = 0.0; float lane = 0.0; vec2 wakeSlope = vec2(0.0); float wakeH = 0.0;
  for (int i = 0; i < 2; i++) {
    vec4 w = uWake[i]; vec4 wb = uWakeB[i];
    if (wb.w > 0.0) {
      vec2 perp = vec2(-w.w, w.z);
      vec2 rel = p - w.xy; float along = -dot(rel, w.zw); float side = dot(rel, perp); float as = abs(side);
      if (along > 0.0 && along < wb.z && as < 0.5 * along + wb.y) {
        float hull = uWakeC[i].x;
        float fade = (1.0 - smoothstep(wb.z * 0.3, wb.z, along)) * wb.w;
        // foam anchored to the water: dense at the stern, breaking up into soft streaks along the track
        vec2 wq = vec2(dot(p, w.zw), dot(p, perp));
        float halfW = (0.42 * wb.y + 0.012 * along) * (0.75 + 0.5 * vnoise(vec2(wq.x * 0.08, 3.1)));
        float strip = (1.0 - smoothstep(halfW * 0.35, halfW, as)) * smoothstep(hull * 0.7, hull, along);
        lane = max(lane, strip * fade);
        float nz = vnoise(vec2(wq.x * 0.10, wq.y * 0.8)) * 0.5 + vnoise(vec2(wq.x * 0.37, wq.y * 2.1) + 7.3) * 0.3 + vnoise(vec2(wq.x * 1.3, wq.y * 5.0) + 3.7) * 0.2;
        float near = 1.0 - smoothstep(hull, hull + 0.35 * wb.z, along);
        float dens = mix(smoothstep(0.35, 0.85, nz) * 0.5, 0.5 + 0.5 * smoothstep(0.2, 0.7, nz), near * near);
        wakeFoam = max(wakeFoam, strip * fade * dens * exp(-fb * 0.015));
        // Kelvin pattern, stationary in the ship's frame
        float a3 = pow(max(along, 4.0), -0.33);
        float arm = 0.3536 * along;
        float da = as - arm - 0.3 * wb.y;
        float armW = 1.5 + 0.07 * along;
        float crest = exp(-da * da / (armW * armW));
        float kd = 9.81 / max(wb.x * wb.x * 0.667, 0.5);                      // cusp waves: k = g / (U cos 35.3)^2
        float sD = 0.9 * a3 * crest * fade * exp(-0.05 * kd * kd * f * f);
        float phd = kd * (-along * 0.816 + as * 0.577);
        wakeSlope += (w.zw * 0.816 + perp * (0.577 * sign(side))) * (sD * cos(phd));
        float kt = 9.81 / max(wb.x * wb.x, 0.5);                              // transverse waves inside the wedge
        float sT = 0.22 * a3 * (1.0 - smoothstep(0.55 * arm, arm + 1.0, as)) * fade * smoothstep(hull * 0.8, hull * 1.4, along) * exp(-0.05 * kt * kt * f * f);
        wakeSlope += w.zw * (sT * cos(kt * along));
        wakeH += (sD / kd) * sin(phd) * 0.5;
      }
    }
  }

  vec2 wAxis; float wC; float wW = wallInfo(p, wAxis, wC) * uWallRefl * 1.6;
  vec2 pm = p + wAxis * (2.0 * (wC - dot(p, wAxis)));
  float damp = (1.0 - 0.8 * lane) * (1.0 - uFine.z * gs.y);   // churned wake lane and slicks: fine ripples are damped
  for (int i = 0; i < NLAY; i++) {
    vec4 A = uLyA[i]; vec4 B = uLyB[i]; vec4 C = uLyC[i]; vec4 D = uLyD[i];
    float var = mix(B.w * mix(C.y, 1.0, gust), B.z * mix(C.x, 1.0, gust), bayness) * uRipple;
    if (i >= 4) var *= damp;
    float lod = log2(max(f * A.z * 256.0, 1.0));
    float r = retained(lod, B.y);
    if (r > 0.004) {
      vec2 sl = bandSlope(p, A, B.y, C.w, D, lod);
      float wr = C.z * wW;
      if (wr > 0.02) {
        vec2 s2 = bandSlope(pm, A, B.y, C.w, D, lod);
        sl += (s2 - 2.0 * wAxis * dot(s2, wAxis)) * wr;
        var *= 1.0 + wr * wr;
      }
      slope += sqrt(var) * sl;
    }
    varLost += var * (1.0 - r);
  }

  slope += wakeSlope; hgt += wakeH;

  // part of the slope variance below the filter width is put back as discrete facets (glints / flecks): the sun lobe
  // and the mirror image see a perturbed normal and a correspondingly narrower lobe (same mean, sparkling edges)
  // (the sun lobe is never made narrower than a2 = 0.003: sharper glints would only be clipped by the renderer)
  vec2 gl = glintSlope(p, f);
  float vS = max(varLost * (1.0 - uFine.x), min(varLost, 0.003));
  vec2 slR = slope + gl * sqrt(0.5 * varLost * uFine.y);
  vec2 slS = slope + gl * sqrt(0.5 * (varLost - vS));
  vec3 n = normalize(vec3(-slR.x, 1.0, -slR.y));
  float nv0 = dot(n, V);
  if (nv0 < 0.03) n = normalize(n + V * ((0.03 - nv0) * 1.2));     // a facet turned away is hidden: show the next front face
  vec3 nS = normalize(vec3(-slS.x, 1.0, -slS.y));

  float a2 = varLost * (1.0 - uFine.y) + uLobe.z;    // Beckmann alpha^2 of everything below the filter width
  float a2S = vS + uLobe.z;
  float alpha = sqrt(a2);

#ifdef USE_SHADOWMAP
  float shadow = getShadowMask();
#else
  float shadow = 1.0;
#endif
  // beyond the shadow cascades: is the key light hidden by distant terrain / skyline in the mirror image?
  if (uReflOn > 0.5 && uSunUV.z > 0.5) {
    vec2 px = (0.6 * 0.0047 * uReflInfo.x) / uReflInfo.yz;
    float occ = 0.0;
    for (int i = 0; i < 5; i++) {
      vec2 o = i == 0 ? vec2(0.0) : (i == 1 ? vec2(px.x, 0.0) : (i == 2 ? vec2(-px.x, 0.0) : (i == 3 ? vec2(0.0, px.y) : vec2(0.0, -px.y))));
      float dd = textureLod(uRefl, uSunUV.xy + o, 0.0).a;
      occ += (dd > 900.0 && dd < 5.0e4) ? 0.2 : 0.0;
    }
    shadow *= 1.0 - occ;
  }

  // ---- reflection: stratified samples of the visible unresolved facets (converges over the accumulated samples)
  vec3 t1 = normalize(cross(n, vec3(0.0, 0.0, 1.0))); vec3 t2 = cross(n, t1);
  vec3 Ve = vec3(dot(V, t1), dot(V, t2), dot(V, n));
  float aT = alpha * uLobe.x;
  float L0 = 4.0e4; vec2 hdir = normalize(-V.xz + vec2(1e-6));
  if (uReflOn > 0.5) {
    vec4 c0 = uReflVP * vec4(vWPos, 1.0);
    vec2 uv0 = c0.xy / c0.w * 0.5 + 0.5;
    float dQ = textureLod(uRefl, uv0, 0.0).a;
    vec3 gdir = (vWPos - uReflCam) / max(c0.w, 1e-3);
    L0 = max(dQ - c0.w, 0.0) * length(gdir.xz);
    hdir = normalize(gdir.xz + vec2(1e-6));
  }
  // filter footprint of one tap in the mirror image: across (mip) and along the streak direction (rip level)
  float kLat = max(1.0, 2.0 * aT * max(Ve.z, 0.04) * uReflInfo.x * uLobe.y);
  float kVer = max(kLat, 2.0 * aT * uReflInfo.x * uLobe.y);
  float mip = clamp(log2(kLat), 0.0, 4.0);
  float ripF = clamp(log2(kVer / kLat), 0.0, 4.0);
  float sidx = uFrame * (1.0 / 17.0);
  vec2 xi0 = vec2(ign(gl_FragCoord.xy), hash12(gl_FragCoord.xy + 17.3));
  int nt = aT > 0.012 ? NTAP : 1;
  vec3 reflSum = vec3(0.0); float Fsum = 0.0;
  for (int j = 0; j < NTAP; j++) {
    if (j >= nt) break;
    vec3 m = n;
    if (nt > 1) {
      vec2 u = fract(xi0 + (sidx * float(NTAP) + float(j)) * vec2(0.7548776662, 0.5698402910));
      vec3 mh = sampleVNDF(Ve, aT, u);
      m = t1 * mh.x + t2 * mh.y + n * mh.z;
    }
    float vm = max(dot(V, m), 1e-3);
    vec3 R = 2.0 * vm * m - V;
    if (R.y < 0.004) { R.y = abs(R.y) + 0.004; R = normalize(R); }     // would hit the next wave: bounce up
    float F = fresnelW(vm);
    float rip = floor(ripF + fract(xi0.y + float(j) * 0.618 + sidx * 0.4142));          // dithered between rip levels
    reflSum += F * envSample(R, vWPos, L0, hdir, mip, rip);
    Fsum += F;
  }
  reflSum /= float(nt); float Fm = Fsum / float(nt);

  // ---- key light (sun / moon) through the slope distribution: the glitter path
  vec3 Ld = uLightDir;
  vec3 sunL = vec3(0.0);
  float nl = dot(nS, Ld);
  if (nl > 0.0) {
    vec3 H = normalize(V + Ld);
    float nh = max(dot(nS, H), 0.0), nv = max(dot(nS, V), 0.02);
    float c2 = max(nh * nh, 1e-4); float tn2 = (1.0 - c2) / c2;      // (c2 = 0 would give 0 / 0)
    float Dm = exp(-tn2 / a2S) / (PI * a2S * c2 * c2);
    float Fh = fresnelW(max(dot(V, H), 0.0));
    float aG = varLost + uLobe.z;                    // masking / shadowing by the full roughness
    sunL = min(uLightColor * (Dm * Fh * smithG1(nv, aG) * smithG1(nl, aG) / (4.0 * nv)), vec3(3.0e4)) * (shadow * uOptics.y);
  }

  // ---- water body: light scattered back out of the volume
  float bayMix = smoothstep(-10.0, 260.0, dQuay);
  vec3 Rw = mix(uCanalColor, uBayColor, bayMix);
  float sunDown = max(Ld.y, 0.0) * (1.0 - fresnelW(max(Ld.y, 0.0))) * shadow;
  vec3 Ed = uAmbient * PI + uLightColor * sunDown;
  vec3 body = (0.54 / PI) * Rw * Ed * mix(1.0, 1.45, pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0));
  if (uNight > 0.001) {
    vec2 cuv = (p - uCityLightRect.xy) / uCityLightRect.zw;
    body += 0.54 * Rw * textureLod(uCityLights, cuv, 0.0).rgb * (uNight * uOptics.w);
  }
  body *= 1.0 + 2.0 * lane;                           // aerated water in a wake scatters more light
  // subsurface glow in crests when looking toward the light
  vec2 lh = normalize(Ld.xz + vec2(1e-5));
  float toward = pow(max(dot(-V.xz, lh), 0.0), 3.0);
  body += uOptics.x * uLightColor * shadow * (Rw * 9.0) * toward * smoothstep(0.0, 0.11, hgt) * (0.35 + 0.65 * bayness);

  // ---- shallow water / foam where the surface meets solid geometry (scene depth from the prepass, layer 0)
  float foam = wakeFoam * uFoam.z; float edge = 0.0;
  if (uAOOn > 0.5) {
    float sd = textureLod(uAOTex, gl_FragCoord.xy / uResolution, 0.0).g;
    float thick = (sd - vMisc.y) * dist / max(vMisc.y, 0.01);       // metres of water along the view ray
    if (thick > 0.0) {
      float ext = mix(uExt.y, uExt.x, bayMix);
      body = mix(body, (0.54 / PI) * uShallowColor * Ed, exp(-thick * ext) * 0.9);
      // soft, patchy wetting / foam line that breathes with the waves
      float brk = vnoise(p * 1.7 + vec2(uTime * 0.25, 0.0)) * 0.6 + vnoise(p * 5.3 - vec2(0.0, uTime * 0.4)) * 0.4;
      float wdt = uFoam.x * (0.3 + 1.2 * brk) + 1.5 * max(hgt, 0.0);
      foam = max(foam, (1.0 - smoothstep(0.0, wdt, thick)) * uFoam.y * smoothstep(0.2, 0.6, brk + 0.25) * (0.4 + 0.6 * bayness));
      // thin dark contact line (meniscus / wet shadow) along walls, piles and hulls; at least about a pixel wide
      edge = (1.0 - smoothstep(0.0, max(0.09 + 0.5 * max(hgt, 0.0), 1.2 * fb), thick)) * (1.0 - smoothstep(5.0, 22.0, fb));
    }
  }

  vec3 col = reflSum * uOptics.z + sunL + (1.0 - Fm) * body;
  // foam is a rough scatterer: it also catches the low sun from the side
  vec3 Ef = uAmbient * PI + uLightColor * (shadow * (0.3 + 0.7 * max(Ld.y, 0.0)));
  col = mix(col, 0.5 * Ef / PI + 0.05 * reflSum, clamp(foam, 0.0, 1.0));
  col *= 1.0 - uGroup.z * edge;
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}
`;
