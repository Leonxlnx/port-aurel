// Post / pipeline fragment shaders. All fullscreen passes use FS_VERT (vUv).
import { COMMON_GLSL } from './globals.js';

// depth -> view position helpers. REVERSED: depth buffer value == ndc z (1 near .. 0 far)
export const DEPTH_GLSL = /* glsl */`
#ifdef REVERSED_DEPTH
  #define NDCZ(d) (d)
  #define IS_SKY(d) ((d) <= 0.0)
#else
  #define NDCZ(d) ((d) * 2.0 - 1.0)
  #define IS_SKY(d) ((d) >= 1.0)
#endif
vec3 viewPosFromDepth(vec2 uv, float d, mat4 projInv) {
  vec4 c = vec4(uv * 2.0 - 1.0, NDCZ(d), 1.0);
  vec4 v = projInv * c;
  return v.xyz / v.w;
}
`;

// ---------------------------------------------------------------------------------------------
// Screen-space ambient occlusion (half res). Output: r = AO, g = linear view depth (m).
export const AO_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tDepth;
uniform mat4 uProj; uniform mat4 uProjInv;
uniform vec2 uFullRes;
uniform float uSeed;
uniform float uRadius; uniform float uRadiusDist; uniform float uIntensity; uniform float uFar;
${COMMON_GLSL}
${DEPTH_GLSL}
#ifndef AO_SAMPLES
#define AO_SAMPLES 8
#endif
vec3 vp(vec2 uv) { float d = texture2D(tDepth, uv).x; if (IS_SKY(d)) return vec3(0.0, 0.0, -uFar); return viewPosFromDepth(uv, d, uProjInv); }
void main() {
  vec2 tx = 1.0 / uFullRes;
  vec2 uv = vUv + 0.5 * tx;
  float d = texture2D(tDepth, uv).x;
  if (IS_SKY(d)) { gl_FragColor = vec4(1.0, uFar, 0.0, 1.0); return; }
  vec3 P = viewPosFromDepth(uv, d, uProjInv);
  vec3 Pr = vp(uv + vec2(tx.x, 0.0)), Pl = vp(uv - vec2(tx.x, 0.0));
  vec3 Pu = vp(uv + vec2(0.0, tx.y)), Pd = vp(uv - vec2(0.0, tx.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  float dist = -P.z;
  float radius = uRadius + uRadiusDist * dist;
  vec3 up = abs(N.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N)); vec3 B = cross(N, T);
  float rot = ign(gl_FragCoord.xy + uSeed * 5.588238) * 6.2831853;
  float rnd = hash12(gl_FragCoord.xy * 1.37 + uSeed * 17.31);
  float occ = 0.0; float wsum = 0.0;
  for (int i = 0; i < AO_SAMPLES; i++) {
    float fi = (float(i) + rnd) / float(AO_SAMPLES);
    float r = sqrt(fi); float th = float(i) * 2.39996323 + rot;
    vec3 h = vec3(r * cos(th), r * sin(th), sqrt(max(1.0 - fi, 0.0)));
    float sc = mix(0.12, 1.0, fract(fi * 7.31 + rnd) * fract(fi * 7.31 + rnd));
    vec3 S = P + (T * h.x + B * h.y + N * h.z) * (radius * sc) + N * (0.002 * dist + 0.01);
    vec4 c = uProj * vec4(S, 1.0);
    vec2 suv = c.xy / c.w * 0.5 + 0.5;
    vec3 SP = vp(suv);
    float diff = SP.z - S.z;                      // > 0: geometry in front of the sample point
    float range = smoothstep(0.0, 1.0, (radius * 1.5) / (abs(P.z - SP.z) + 1e-4));
    occ += step(0.0, diff) * range; wsum += 1.0;
  }
  float ao = 1.0 - occ / max(wsum, 1.0);
  ao = pow(clamp(ao, 0.0, 1.0), uIntensity);
  gl_FragColor = vec4(ao, dist, 0.0, 1.0);
}
`;

// depth-aware blur of the AO buffer (used for realtime preview where few samples are accumulated)
export const AO_BLUR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tAO; uniform vec2 uDir;
void main() {
  vec4 c = texture2D(tAO, vUv);
  float sum = c.r * 0.30; float w = 0.30;
  for (int i = 1; i <= 3; i++) {
    float wi = i == 1 ? 0.22 : (i == 2 ? 0.10 : 0.03);
    for (int s = -1; s <= 1; s += 2) {
      vec4 t = texture2D(tAO, vUv + uDir * float(i * s));
      float dw = wi / (1.0 + 60.0 * abs(t.g - c.g) / max(c.g, 0.01));
      sum += t.r * dw; w += dw;
    }
  }
  gl_FragColor = vec4(sum / w, c.g, 0.0, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Aerial perspective + accumulation. Additively blended into the float accumulation buffer.
export const ATMO_FRAG = /* glsl */`
precision highp float;
precision highp sampler2DShadow;
varying vec2 vUv;
uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D uSkyLUT;
uniform mat4 uProjInv; uniform mat4 uCamWorld; uniform vec3 uCamPos;
uniform vec4 uFogA; uniform vec4 uFogB; uniform vec3 uFogTint;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uNight;
uniform float uWeight; uniform float uClamp; uniform float uSeed;
uniform vec3 uDof;   // focus distance (m), aperture scale (px per unit of |1/z - 1/f|), max coc px
uniform sampler2DShadow tShadow; uniform mat4 uShadowMat0; uniform mat4 uShadowMat1; uniform vec4 uCascade0; uniform vec4 uCascade1;
uniform vec4 uShaft;      // x: strength (0 = off), y: max march distance, z: ground dust density, w: dust falloff height
uniform vec3 uNightGlow;  // haze glow from city lights at night
${COMMON_GLSL}
${DEPTH_GLSL}
#ifndef SHAFT_STEPS
#define SHAFT_STEPS 8
#endif
float sunVis(vec3 wp, float viewDepth) {
  vec4 sc;
  if (viewDepth < uCascade0.y) sc = uShadowMat0 * vec4(wp, 1.0);
  else if (viewDepth < uCascade1.y) sc = uShadowMat1 * vec4(wp, 1.0);
  else return 1.0;
  sc.xyz /= sc.w;
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0) return 1.0;
  return texture(tShadow, sc.xyz);
}
void main() {
  vec4 col = texture2D(tColor, vUv);
  float d = texture2D(tDepth, vUv).x;
  float coc = 0.0;
  bool sky = IS_SKY(d);
  vec3 P = sky ? viewPosFromDepth(vUv, 0.5, uProjInv) : viewPosFromDepth(vUv, d, uProjInv);
  float dist = length(P);
  vec3 vdir = P / dist;
  vec3 wdir = normalize((uCamWorld * vec4(vdir, 0.0)).xyz);
  if (sky) dist = 40000.0;
  // --- sun visibility along the view ray (light shafts between buildings, under the viaduct, through trees)
  float vis = 1.0; float dustOD = 0.0; float dustLit = 0.0;
  float sunUp = clamp(dot(uSunColor, vec3(0.3333)) * 4.0, 0.0, 1.0);
  if (uShaft.x > 0.0 && sunUp > 0.0) {
    float maxT = min(dist, uShaft.y);
    float jit = fract(ign(gl_FragCoord.xy) + uSeed * 0.61803399);
    float acc = 0.0; float wsum = 0.0; float prev = 0.0;
    for (int i = 0; i < SHAFT_STEPS; i++) {
      float f = (float(i) + jit) / float(SHAFT_STEPS);
      float t = maxT * f * f;                               // denser near the camera
      float seg = t - prev; prev = t;
      vec3 wp = uCamPos + wdir * t;
      float v = sunVis(wp, -vdir.z * t);
      float dens = exp(-max(wp.y, 0.0) / uShaft.w);
      float w = seg * (0.25 + dens);
      acc += v * w; wsum += w;
      dustLit += v * dens * seg; dustOD += dens * seg;
    }
    vis = mix(1.0, acc / max(wsum, 1e-4), min(1.0, maxT / 60.0));
  }
  float mu = dot(wdir, uSunDir);
  if (!sky) {
    float a = uFogA.y; float camH = uCamPos.y - uFogA.z; float dy = wdir.y;
    float k = abs(dy) > 1e-5 ? (1.0 - exp(-a * dy * dist)) / (a * dy) : dist;
    float od = uFogA.x * exp(-a * max(camH, -40.0)) * k + uFogB.x * dist;
    float T = max(exp(-od), 1.0 - uFogA.w);
    vec3 fdir = normalize(vec3(wdir.x, 0.035 + 0.5 * max(wdir.y, 0.0), wdir.z));
    vec3 fogCol = skyLUT(uSkyLUT, fdir) * uFogTint * uFogB.y + uNightGlow * uNight;
    float direct = (0.30 + 0.55 * pow(max(mu, 0.0), 2.0)) * uShaft.x * sunUp;
    fogCol *= mix(1.0, vis, clamp(direct, 0.0, 0.95));
    col.rgb = col.rgb * T + fogCol * (1.0 - T);
    coc = min(abs(1.0 / max(-P.z, 0.05) - 1.0 / uDof.x) * uDof.y, uDof.z);
  } else {
    coc = min(abs(1.0 / uDof.x) * uDof.y, uDof.z);
  }
  // --- low sunlit dust layer: forward-scattering glow that only exists where the sun reaches
  if (uShaft.z > 0.0 && sunUp > 0.0) {
    float g = 0.72; float ph = (1.0 - g * g) / (4.0 * PI * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    float lit = dustLit * uShaft.z;
    col.rgb = col.rgb * exp(-dustOD * uShaft.z) + uSunColor * (ph + 0.02) * (1.0 - exp(-lit));
  }
  gl_FragColor = vec4(min(col.rgb, vec3(uClamp)) * uWeight, coc * uWeight);
}
`;

// ---------------------------------------------------------------------------------------------
// Resolve accumulated buffer -> HDR working buffer (exposure applied), optional DOF fill blur.
export const RESOLVE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tAccum; uniform float uInvWeight; uniform float uExposure; uniform vec2 uTexel;
uniform float uDofFill;
${COMMON_GLSL}
void main() {
  vec4 c = texture2D(tAccum, vUv) * uInvWeight;
#ifdef DOF_FILL
  float coc = c.a * uDofFill;
  if (coc > 0.6) {
    // small disc gather to hide the discrete lens samples of the accumulation
    vec3 s = c.rgb; float w = 1.0;
    float rot = ign(gl_FragCoord.xy) * 6.2831853;
    for (int i = 0; i < 16; i++) {
      float fi = (float(i) + 0.5) / 16.0; float r = sqrt(fi) * coc; float th = float(i) * 2.39996323 + rot;
      vec2 o = vec2(cos(th), sin(th)) * r * uTexel;
      vec4 t = texture2D(tAccum, vUv + o) * uInvWeight;
      float tw = smoothstep(0.0, 1.0, (t.a * uDofFill) / max(r, 0.5));   // only blurry samples spread
      s += t.rgb * tw; w += tw;
    }
    c.rgb = s / w;
  }
#endif
  gl_FragColor = vec4(c.rgb * uExposure, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Bloom pyramid
export const DOWN_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uKaris;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 kar(vec3 c) { return c / (1.0 + lum(c) * uKaris); }
void main() {
  vec2 t = uTexel;
  vec3 a = texture2D(tSrc, vUv + t * vec2(-2.0, 2.0)).rgb;
  vec3 b = texture2D(tSrc, vUv + t * vec2(0.0, 2.0)).rgb;
  vec3 c = texture2D(tSrc, vUv + t * vec2(2.0, 2.0)).rgb;
  vec3 d = texture2D(tSrc, vUv + t * vec2(-2.0, 0.0)).rgb;
  vec3 e = texture2D(tSrc, vUv).rgb;
  vec3 f = texture2D(tSrc, vUv + t * vec2(2.0, 0.0)).rgb;
  vec3 g = texture2D(tSrc, vUv + t * vec2(-2.0, -2.0)).rgb;
  vec3 h = texture2D(tSrc, vUv + t * vec2(0.0, -2.0)).rgb;
  vec3 i = texture2D(tSrc, vUv + t * vec2(2.0, -2.0)).rgb;
  vec3 j = texture2D(tSrc, vUv + t * vec2(-1.0, 1.0)).rgb;
  vec3 k = texture2D(tSrc, vUv + t * vec2(1.0, 1.0)).rgb;
  vec3 l = texture2D(tSrc, vUv + t * vec2(-1.0, -1.0)).rgb;
  vec3 m = texture2D(tSrc, vUv + t * vec2(1.0, -1.0)).rgb;
  vec3 o;
  if (uKaris > 0.0) {
    vec3 g0 = kar((j + k + l + m) * 0.25); vec3 g1 = kar((a + b + d + e) * 0.25); vec3 g2 = kar((b + c + e + f) * 0.25);
    vec3 g3 = kar((d + e + g + h) * 0.25); vec3 g4 = kar((e + f + h + i) * 0.25);
    o = g0 * 0.5 + (g1 + g2 + g3 + g4) * 0.125;
    o = o / max(1.0 - lum(o) * uKaris, 0.05);
  } else {
    o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(o, 0.0), 1.0);
}
`;

export const UP_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tLow;   // lower-res accumulated bloom
uniform sampler2D tHigh;  // this level's downsample
uniform vec2 uTexel;      // texel of tLow
uniform float uRadius; uniform float uWeightLow; uniform float uWeightHigh;
void main() {
  vec2 t = uTexel * uRadius;
  vec3 s = texture2D(tLow, vUv).rgb * 4.0;
  s += texture2D(tLow, vUv + vec2(t.x, 0.0)).rgb * 2.0 + texture2D(tLow, vUv - vec2(t.x, 0.0)).rgb * 2.0;
  s += texture2D(tLow, vUv + vec2(0.0, t.y)).rgb * 2.0 + texture2D(tLow, vUv - vec2(0.0, t.y)).rgb * 2.0;
  s += texture2D(tLow, vUv + t).rgb + texture2D(tLow, vUv - t).rgb + texture2D(tLow, vUv + vec2(t.x, -t.y)).rgb + texture2D(tLow, vUv + vec2(-t.x, t.y)).rgb;
  s *= 1.0 / 16.0;
  gl_FragColor = vec4(s * uWeightLow + texture2D(tHigh, vUv).rgb * uWeightHigh, 1.0);
}
`;

// ---------------------------------------------------------------------------------------------
// Film: lens (CA, vignette), bloom + halation, film curve & colour look, grain, sRGB encode.
export const FILM_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tHDR;     // exposure already applied
uniform sampler2D tBloom;   // wide bloom (half res, tent-upsampled pyramid)
uniform sampler2D tH1; uniform sampler2D tH2; uniform sampler2D tH3;   // pyramid levels for halation
uniform vec2 uRes; uniform float uSeed;
uniform float uBloom; uniform float uHalation; uniform vec3 uHalationTint; uniform float uHalationThresh;
uniform float uGrain; uniform float uGrainSize; uniform float uVignette; uniform float uCA; uniform float uDistort;
uniform vec3 uWB;
uniform float uContrast; uniform float uSaturation; uniform float uToe; uniform float uFade;
uniform vec3 uShadowTint; uniform vec3 uHighTint; uniform vec3 uLift;
uniform float uLook;       // 0 = neutral base, 1 = full film look
uniform float uSoft;       // diffusion mix
${COMMON_GLSL}

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

// AgX-style base: log encoding with channel crosstalk -> graceful highlight desaturation
const mat3 INSET = mat3(0.856627153315983, 0.137318972929847, 0.11189821299995,
                        0.0951212405381588, 0.761241990602591, 0.0767994186031903,
                        0.0482516061458583, 0.101439036467562, 0.811302368396859);
const mat3 OUTSET = mat3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
                         -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
                         -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
vec3 sigmoid(vec3 x) {
  vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 filmBase(vec3 c) {
  c = INSET * max(c, 0.0);
  c = max(c, 1e-10);
  c = (log2(c) + 12.47393) / 16.5;
  c = clamp(c, 0.0, 1.0);
  c = sigmoid(c);
  return c;      // display-referred, gamma ~2.2 encoded, still in inset space
}

vec3 grainField(vec2 px, float seed) {
  // organic grain: two rotated value-noise lattices (no axis-aligned weave) + per-pixel crystals
  vec2 q1 = mat2(0.846, -0.533, 0.533, 0.846) * px / uGrainSize;
  vec2 q2 = mat2(0.523, 0.852, -0.852, 0.523) * px / (uGrainSize * 1.9);
  vec3 n1 = vec3(vnoise(q1 + seed * 13.1), vnoise(q1 + 71.3 + seed * 7.7), vnoise(q1 + 151.7 + seed * 3.9)) - 0.5;
  vec3 n2 = vec3(vnoise(q2 + seed * 5.3 + 19.0), vnoise(q2 + 37.3 + seed * 9.1), vnoise(q2 + 211.7 + seed * 1.7)) - 0.5;
  vec3 n0 = hash32(px + seed * 37.0) - 0.5;
  vec3 n = n1 * 1.0 + n2 * 0.55 + n0 * 0.75;
  float mono = (n.r + n.g + n.b) / 3.0;
  return mix(vec3(mono), n, 0.3);
}

void main() {
  vec2 uv = vUv;
  vec2 cc = uv - 0.5; float aspect = uRes.x / uRes.y;
  vec2 ccA = vec2(cc.x * aspect, cc.y);
  float r2 = dot(ccA, ccA);
  // subtle lens distortion + lateral chromatic aberration
  vec2 duv = cc * (1.0 + uDistort * r2);
  vec2 uvR = 0.5 + duv * (1.0 + uCA * r2); vec2 uvG = 0.5 + duv; vec2 uvB = 0.5 + duv * (1.0 - uCA * r2);
  vec3 hdr = vec3(texture2D(tHDR, uvR).r, texture2D(tHDR, uvG).g, texture2D(tHDR, uvB).b);

  vec3 bloom = texture2D(tBloom, uvG).rgb;
  vec3 h1 = texture2D(tH1, uvG).rgb; vec3 h2 = texture2D(tH2, uvG).rgb; vec3 h3 = texture2D(tH3, uvG).rgb;
  // halation: bright sources bleed red/orange into the emulsion around them
  vec3 hsrc = max(h1 - uHalationThresh, 0.0) * 0.40 + max(h2 - uHalationThresh * 0.6, 0.0) * 0.38 + max(h3 - uHalationThresh * 0.3, 0.0) * 0.30;
  float hl = lum(hsrc);
  vec3 hal = uHalationTint * hl / (1.0 + hl * 0.08);

  vec3 c = mix(hdr, bloom, uBloom);
  c = mix(c, h1, uSoft);
  c += hal * uHalation;

  // vignette (natural falloff)
  float vig = 1.0 / pow(1.0 + r2 * uVignette, 2.0);
  c *= vig;
  c *= uWB;

  // ---- film curve
  vec3 f = filmBase(c);
  // look in the encoded domain (ASC-CDL style): contrast around mid grey, toe, saturation
  float l0 = lum(f);
  vec3 g = f;
  g = pow(max(g, 0.0), vec3(uContrast));
  g = mix(vec3(lum(g)), g, uSaturation);
  f = mix(f, g, uLook);
  f = OUTSET * f;
  f = pow(max(f, 0.0), vec3(2.2));        // -> display linear
  f = clamp(f, 0.0, 1.0);

  // ---- print: split toning + lifted, tinted blacks + soft shoulder
  float l = lum(f);
  float sh = 1.0 - smoothstep(0.0, 0.42, l); float hi = smoothstep(0.35, 1.0, l);
  vec3 toned = f * mix(vec3(1.0), uShadowTint, sh * uLook) * mix(vec3(1.0), uHighTint, hi * uLook);
  toned = toned * (1.0 - uFade * uLook) + uLift * uLook * (1.0 - l) * (1.0 - l);
  f = toned;

  // ---- encode + grain (applied in the perceptual domain, strongest in the mid-shadows)
  vec3 e = mix(12.92 * f, 1.055 * pow(max(f, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), f));
  float le = lum(e);
  float gamt = uGrain * (0.22 + 0.78 * smoothstep(0.0, 0.24, le)) * mix(1.0, 0.3, smoothstep(0.45, 0.95, le));
  e += grainField(gl_FragCoord.xy * (2160.0 / uRes.y), uSeed) * gamt;
  gl_FragColor = vec4(clamp(e, 0.0, 1.0), 1.0);
}
`;
