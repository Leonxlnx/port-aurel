// GLSL injected into the engine's sky dome shader (see atmosphere.js: __CLOUD_PARS__ / __CLOUD_MAIN__).
// Two layers: a 2D cirrus sheet at ~9 km and a ray-marched stratocumulus / altocumulus / cumulus shell at 1.5-4.2 km
// (spherical shell: clouds recede to the horizon and stack into bands there).
// Everything is a pure function of (direction, camera, wind offsets derived from the time, sun elevation).
//
// Look (v2, "photographic" pass):
//  - density has a soft quadratic toe (translucent veils and fringes instead of a hard iso-surface); the detail
//    noise is sampled through a curl-like distortion taken from the shape noise, so edges tear into wisps
//  - stratiform types get a cellular / roll texture (closed cells, streets across the sun azimuth) from the 2D
//    noise texture: broken textured sheets instead of isolated puffs
//  - light: one short march toward the sun gives the self shadow for BOTH the direct light and the light of the
//    twilight arch (a soft directional source at the sunset horizon whose colour follows the sky LUT), so at
//    dusk only faces / undersides that see the sunset glow; bodies stay lavender-grey (cool sky ambient)
//  - low sun: shadows of far cloud banks (weather map) + a "beam" term (constant along the light rays) give
//    large tonal variation across the deck
// March: coarse steps look for cloud columns in the weather map, a ray below a column jumps to its base, inside a
// cloud the steps start small (75 m) and double; every start is jittered (uFrame) so the accumulation converges.
// Cost notes (Radeon 780M, ANGLE / D3D11) - all measured, see tools/sky2_ab.mjs:
//  - the large scale weather field is rendered once per time step into a log-polar map (CLOUD_WMAP_FRAG): one fetch
//    per march step instead of 3 fetches + maths
//  - the D3D compiler flattens small `if` branches around texture fetches and is very slow with nested loops:
//    keep the light march in its own density function (clDensL) and written out, no bisection loops
//  - the volume is never sampled at its 8 MB top mip (cache misses), lighting is reused between faint samples
// uAux = 1 (planar reflection pass of the water): half the coarse steps, big in-cloud steps, 2 light samples.

// the large scale weather / composition field (evaluated only in the weather map pass)
const WEATHER_FIELD = /* glsl */`
// large scale weather. pk: world xz in km. F: filter footprint in metres.
// returns coverage (0..1), type (0 stratus .. 1 cumulus), base offset (0..1 of the free height), variety (0..1)
vec4 clWeatherField(vec2 pk, float F) {
  vec2 pa = pk + uClWind.xy;
  vec2 sa = clSa;
  vec2 ps = vec2(dot(pa, sa), dot(pa, vec2(-sa.y, sa.x)) / uClLit2.w);     // cloud streets across the sun azimuth
  vec4 w1 = textureLod(uClWeather, ps * (1.0 / 71.0), log2(max(F / 139.0, 1.0)));
  vec4 w2 = textureLod(uClWeather, ps * (1.0 / 23.0) + vec2(0.31, 0.67), log2(max(F / 45.0, 1.0)));
  float cov = (w1.r * 0.55 + w2.g * 0.30 + w2.b * 0.15 - 0.5) * 3.1 + uClShape.x;   // (mostly fbm: ragged, fractal field outlines)
  // composition (fixed in the world: the camera never leaves the city, so this is a painting of the sky)
  float a = dot(pk, sa), b = dot(pk, vec2(-sa.y, sa.x));
  float r = length(pk);
  float wedge = exp(-pow(b / (uClComp.y * max(a, 1.0) + 4.0), 2.0)) * smoothstep(5.0, 15.0, a);
  cov -= uClComp.x * wedge;
  float bank = smoothstep(2.5, 7.5, -a) * (1.0 - smoothstep(20.0, 46.0, -a));
  cov += uClComp.w * bank;
  cov -= uClComp2.x * exp(-r * r / 40.0);
  cov -= uClComp2.w * smoothstep(24.0, 70.0, r);
  float ty = clamp(uClShape.y + (w1.g - 0.5) * 1.3 + 0.8 * uClComp.w * bank, 0.0, 1.0);
  float bo = clamp((1.0 - ty) * (w1.a * 0.9 + (w2.a - 0.5) * 0.35), 0.0, 1.0);
  // long thin stratus bars, elongated across the sun azimuth: they stack into lines near the horizon
  vec2 pb = vec2(dot(pa, sa) / 39.0, dot(pa, vec2(-sa.y, sa.x)) / 190.0);
  vec4 wb = textureLod(uClWeather, pb + vec2(0.53, 0.19), log2(max(F / 76.0, 1.0)));
  float bar = smoothstep(0.52, 0.66, wb.g * 0.8 + w2.b * 0.2 + (w1.r - 0.5) * 0.12) * smoothstep(6.0, 20.0, r) * uClComp.z;
  cov *= smoothstep(0.12, 0.46, cov);                                      // no isolated crumbs
  float s = smoothstep(-0.08, 0.08, bar - cov);
  return vec4(clamp(mix(cov, bar, s), 0.0, 0.80), mix(ty, 0.03 + 0.12 * wb.r, s), mix(bo, wb.a * uClComp2.y, s), w1.b);
}

`;

export const CLOUD_PARS = /* glsl */`
precision highp sampler3D;
uniform sampler3D uClNoise;
uniform sampler2D uClWeather;
uniform sampler2D uClWMap;
uniform sampler2D uClSunLUT;
uniform vec3 uCamPos;
uniform vec2 uResolution;
uniform float uAux;
uniform float uClOn;
uniform float uClSteps;
uniform vec4 uClQual;     // detail LOD bias (footprint multiplier), max surface refinements per ray, light steps, extra in-cloud steps
uniform vec4 uClShape;    // coverage, cumulus (type), extinction scale (1/m), erosion
uniform vec4 uClShape2;   // edge softness, cell texture amount, 1/cell tile (1/m), cell stretch (rolls)
uniform vec4 uClLayer;    // base (m), top (m), 1/shape tile (1/m), 1/detail tile (1/m)
uniform vec4 uClWind;     // advection offset xz (km), detail evolution offset (m): horizontal, vertical
uniform vec4 uClComp;     // sun gap, gap width (tan half angle), bars, east amount
uniform vec4 uClComp2;    // overhead opening, bar altitude spread, tallness, horizon clearing
uniform vec4 uClCir;      // amount, altitude (m), side bias, brightness
uniform vec4 uClCirWind;  // advection offset xz (km), streak direction (cos, sin)
uniform vec2 uClCirBias;  // unit vector: side of the sky that carries most cirrus
uniform vec4 uClTw;       // twilight stretch, light altitude bias (km), sun elevation (rad), sun weight
uniform vec3 uClLdir;     // key light direction for the light march (true sun, or moon at night)
uniform vec3 uClSunE;     // sun irradiance above the atmosphere * lit tint * gain
uniform vec3 uClMoonE;    // moon irradiance * gain (0 while the sun still lights the deck)
uniform vec3 uClAmbTint;  // ambient tint * gain
uniform vec4 uClLit;      // twilight arch light gain, haze length (m), powder, far shadow
uniform vec4 uClLit2;     // pink (twilight purple light), terminator exaggeration, bottom ambient, banding
uniform vec4 uClLit3;     // contrast (self shadow depth), silver lining, crease shading, beams
uniform vec4 uClMisc;     // curl distortion of the detail noise (m), arch pink share, body darkening, tilt of the light march (rad)
uniform vec4 uClCity;     // city centre x, z (m), radius (m), gain * night
uniform vec3 uClCityCol;

const float CL_RE = 6360000.0;
const float CL_WR0 = 0.4;            // weather map: inner radius (km)
const float CL_WLOG = 6.4770;        // log(outer radius 260 km / inner radius)
vec2 clSa;                // unit vector toward the sun azimuth (set in clClouds)
float clCellF = 1.0;      // footprint multiplier for the cell texture: a pixel's length along the view ray on a flat sheet

float clRemap(float v, float a, float b) { return clamp((v - a) / (b - a), 0.0, 1.0); }
float clHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566371 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float clPhase(float c, float k) { return 0.74 * clHG(c, 0.80 * k) + 0.26 * clHG(c, -0.28 * k); }

// distance along the view ray to altitude H (m); cc = curvature drop coefficient (1 - dy^2) / (2 R)
float clT(float H, float dy, float cc) { float h = max(H - uCamPos.y, 1.0); return 2.0 * h / (dy + sqrt(dy * dy + 4.0 * cc * h)); }

// sun transmittance at altitude (km) for a point 'a' metres toward the sun azimuth (local sun elevation rises with a)
// stretch: > 1 delays the local sunset; bias: km added to the altitude once the sun is below the local horizontal
vec3 clSunT(float altKm, float a, float stretch, float bias) {
  float th = uClTw.z + clamp(a * uClLit2.y / CL_RE, -0.021, 0.021);
  float tw = smoothstep(0.02, -0.02, th);
  th = th < 0.0 ? th / stretch : th;
  float u = sqrt(clamp((th * 57.29578 + 6.0) / 32.0, 0.0, 1.0));
  float v = clamp((altKm + bias * tw) / 12.0, 0.0, 1.0);
  vec3 T = textureLod(uClSunLUT, vec2((u * 63.0 + 0.5) / 64.0, (v * 15.0 + 0.5) / 16.0), 0.0).rgb;
  T.gb += T.r * uClLit2.x * vec2(0.07, 0.30) * smoothstep(0.022, -0.03, th);   // multiply scattered "purple light" of dusk (after local sunset)
  return T;
}

// aerial perspective: fraction of cloud light surviving 't' metres of air on a path that climbs to altitude h
float clHaze(float t, float h) { float x = max(h, 10.0) / 2600.0; return exp(-t / uClLit.y * (1.0 - exp(-x)) / x); }

// large scale weather: one fetch from the weather map (log-polar around the world origin, rendered once per time
// step by sky.js from WEATHER_FIELD below). pk: world xz in km. F: filter footprint in metres.
// returns coverage (0..1), type (0 stratus .. 1 cumulus), base offset (0..1 of the free height), variety (0..1)
vec4 clWeather(vec2 pk, float F) {
  float r = max(length(pk), CL_WR0);
  vec2 uv = vec2(atan(pk.y, pk.x) * 0.15915494 + 0.5, log(r / CL_WR0) / CL_WLOG);
  return textureLod(uClWMap, uv, log2(max(F / (r * 6.14), 1.0)));
}

// thickness (0..1 of the layer) of the cloud column for a weather sample
float clColumn(vec4 w) { return mix(0.14, 1.0, w.y) * mix(0.45, 1.0, clamp(w.x * uClComp2.z, 0.0, 1.0)); }
// soft shadow cast on altitude y by the cloud field around a far point (uses the smooth weather field only)
float clFarShadow(vec3 fp, float F) {
  float hf = (fp.y - uClLayer.x) / (uClLayer.y - uClLayer.x);
  if (hf <= 0.0 || hf >= 1.0) return 0.0;
  vec4 w = clWeather(fp.xz * 0.001, F);
  float th = clColumn(w);
  float hl = (hf - w.z * (1.0 - th)) / th;
  return smoothstep(0.30, 0.85, w.x) * smoothstep(1.0, 0.55, hl) * step(0.0, hl);
}
// ---- density. Split into separate functions on purpose: the D3D (ANGLE / FXC) compiler flattens small branches
// around texture fetches (it runs both sides and selects), so the light march must not even contain the detail
// fetch. (Measured: sharing one function with an 'if (detail)' cost +60 %; so did any nested loop.)
// clShape: column, vertical profile and base shape (1 volume fetch, + the 2D cell texture when cells > 0.5).
// returns false where there is no cloud. sh = (shape, threshold, erosion amount, cumuliform 0..1),
// hv = (normalised height inside the local cloud column, column thickness 0..1, 0.5), s = shape noise, q = advected position
bool clShape(vec3 p, vec4 w, float F, float cells, out vec4 sh, out vec3 hv, out vec4 s, out vec3 q) {
  float hf = (p.y - uClLayer.x) / (uClLayer.y - uClLayer.x);
  float th = clColumn(w);
  float hl = (hf - w.z * (1.0 - th)) / th;
  hv = vec3(hl, th, 0.5); sh = vec4(0.0); s = vec4(0.0); q = p;
  if (hl <= 0.0 || hl >= 1.0 || w.x <= 0.0) return false;
  float cu = smoothstep(0.10, 0.55, w.y);                         // 0 sheets .. 1 cumuliform
  // vertical profile: flat base, soft top; sheets are soft lenses
  float prof = smoothstep(0.0, mix(0.60, 0.09, cu), hl) * smoothstep(1.0, mix(0.45, 0.22, cu), hl);
  float thr = 1.0 - w.x;
  if (prof <= thr) return false;
  float wr = (w.w - 0.5) * 2600.0;                                // slow warp: hides the tiling of the shape noise
  q = vec3(p.x + uClWind.x * 1000.0 + wr, p.y, p.z + uClWind.y * 1000.0 - wr * 0.7);
  s = textureLod(uClNoise, q * uClLayer.z, log2(max(F * 128.0 * uClLayer.z, 2.0)));
  float wf = s.g * 0.5 + s.b * 0.3 + s.a * 0.2;
  float base = clRemap(clRemap(s.r, wf - 1.0, 1.0), 0.58, 1.0);   // billows
  float sheet = 0.52 + 0.22 * base;                               // (far light-march samples: smooth average of the cells)
  if (cells > 0.5 && cu < 0.995) {
    // stratiform: closed cells / rolls (mackerel, streets) from the 2D texture, bent by the 3D noise
    // (rolls run 33 deg off the sunset azimuth: seen from the city they converge like streets instead of lying
    // parallel to the horizon, where a regular pattern reads as scan lines)
    vec2 ca = vec2(clSa.x * 0.8387 - clSa.y * 0.5446, clSa.x * 0.5446 + clSa.y * 0.8387);
    vec2 qc = vec2(dot(q.xz, ca), dot(q.xz, vec2(-ca.y, ca.x)) / uClShape2.w) * uClShape2.z;
    qc += (s.gb - 0.5) * 0.10 + vec2(0.0, q.y * uClShape2.z * 0.15);
    float cell = textureLod(uClWeather, qc, log2(max(F * clCellF * 512.0 * uClShape2.z, 1.0))).b;   // (far rolls fade instead of turning into scan lines)
    float tex = mix(0.40, 1.0, smoothstep(0.24, 0.70, cell)) * (0.72 + 0.28 * base);
    sheet = mix(0.62 + 0.30 * base, tex, uClShape2.y);
  }
  float shape = mix(sheet, base, cu) * prof;
  sh = vec4(shape, thr, uClShape.w * mix(1.7, 1.0, smoothstep(0.15, 0.6, w.x)), cu);
  return shape > thr;
}
// shape -> density 0..~1.3: soft toe (thin translucent fringes / veils), dense cores; sheets softer than cumulus
float clCurve(float shape, float thr, float cu, float cov, float hl) {
  float x = clRemap(shape, thr, 1.0) * mix(0.6, 1.0, cov);
  float d = mix(x * mix(3.0, 10.0, cu), x * x * mix(8.0, 26.0, cu), uClShape2.x * mix(1.0, 0.7, cu));
  return min(d, 1.0) * mix(0.55, 1.3, hl);
}
// light-march density: mean erosion instead of the detail noise
float clDensL(vec3 p, vec4 w, float F, float cells) {
  vec4 sh, s; vec3 hv, q;
  if (!clShape(p, w, F, cells, sh, hv, s, q)) return 0.0;
  return clCurve(sh.x - sh.z * 0.22, sh.y, sh.w, w.x, hv.x);
}
// view-ray density: the detail noise erodes the edges (wisps, ragged bases, billowy tops).
// hv.z returns the detail noise (1 on billows, 0 in the creases between them)
float clDens(vec3 p, vec4 w, float F, out vec3 hv) {
  vec4 sh, s; vec3 q;
  if (!clShape(p, w, F, 1.0, sh, hv, s, q)) return 0.0;
  float shape = sh.x, thr = sh.y, er = sh.z, cu = sh.w, hl = hv.x;
  vec3 qd = q + vec3(uClWind.z, uClWind.w, uClWind.z * 0.6) + (s.gba - 0.5) * uClMisc.x;   // curl-like distortion
  qd.y *= mix(1.7, 1.0, cu);                                      // sheets: sheared, flattened filaments
  qd *= uClLayer.w;
  vec3 hn = textureLod(uClNoise, qd, log2(max(F * 128.0 * uClLayer.w, 2.0))).gba;
  float hb = hn.x * 0.5 + hn.y * 0.3 + hn.z * 0.2;
  hv.z = mix(hb, s.b, 0.35);                                      // billow / crease signal for the lighting (two scales)
  shape -= er * (mix(hb, 1.0 - hb, clamp(hl * 3.5, 0.0, 1.0) * mix(0.4, 1.0, cu)) - 0.28);
  shape -= er * 0.17 * (1.0 - smoothstep(0.10, 0.26, (shape - thr) / (1.0 - thr)));   // thin fringes evaporate (keeps the gaps open)
  return clCurve(shape, thr, cu, w.x, hl);
}

// density at distance t along the view ray (0 outside the local cloud column; hv.x < 0 below it, > 1 above it)
float clAt(vec3 dir, float cc, float t, float F, float detail, out vec3 p, out vec4 w, out vec3 hv) {
  p = vec3(uCamPos.x + dir.x * t, uCamPos.y + t * dir.y + t * t * cc, uCamPos.z + dir.z * t);
  w = clWeather(p.xz * 0.001, F);
  hv = vec3(0.0, 0.0, 0.5);
  if (w.x <= 0.01) return 0.0;
  return clDens(p, w, F, hv);
}

void clClouds(vec3 dir, vec3 sdir, vec2 cpk, vec2 cgx, vec2 cgy, float ct, inout vec3 col) {
  float dy = dir.y;
  if (uClOn < 0.5 || dy <= 0.0008) return;
  vec3 skyBase = skyLUT(uSkyLUT, sdir);
  vec2 sa = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  clSa = sa;
  float sunMode = uClTw.w > 0.0 ? 1.0 : 0.0;
  float horizon = smoothstep(0.0008, 0.016, dy);
  vec3 zen = skyLUT(uSkyLUT, vec3(0.0, 1.0, 0.0));
  vec3 antiHi = skyLUT(uSkyLUT, normalize(vec3(-sa.x, 0.7, -sa.y)));
  vec3 ambCir = (zen * 0.6 + antiHi * 0.4) * uClAmbTint;                      // (cirrus: unchanged from v1)
  vec2 sb = vec2(sa.x * 0.906 - sa.y * 0.423, sa.x * 0.423 + sa.y * 0.906);  // 25 deg off the sun azimuth (keeps the sun's aureole out)
  vec3 hzSun = skyLUT(uSkyLUT, normalize(vec3(sb.x, 0.05, sb.y)));          // orange band of the twilight arch
  vec3 hzSunHi = skyLUT(uSkyLUT, normalize(vec3(sb.x, 0.19, sb.y)));        // magenta band above it
  vec3 hzAnti = skyLUT(uSkyLUT, normalize(vec3(-sa.x, 0.11, -sa.y)));       // belt of Venus
  // bodies: cool sky light only (the warm light of the sunset side comes in through the shadowed arch term)
  vec3 ambTop = (zen * 0.68 + antiHi * 0.32) * uClAmbTint;
  vec3 ambBot = (hzAnti * 0.40 + zen * 0.60) * uClLit2.z * uClAmbTint;
  // light of the twilight arch on the clouds: orange toward the sunset azimuth, pink / magenta away from it
  float toward = pow(clamp(dot(normalize(dir.xz + vec2(1e-5, 0.0)), sa) * 0.5 + 0.5, 0.0, 1.0), 1.5);
  vec3 archPinkC = max(hzSun.r, hzSunHi.r * 2.0) * vec3(1.0, 0.42, 0.50);
  vec3 archCol = mix(hzSun, archPinkC, clamp(uClMisc.y * (1.0 - 0.75 * toward), 0.0, 1.0)) * (uClLit.x * sunMode * smoothstep(0.12, 0.03, uClTw.z));
  float lowSun = smoothstep(0.075, 0.0, uClTw.z);

  // ---------------------------------------------------------------- cirrus (2D sheet)
  if (uClCir.x > 0.001 && ct < 200000.0) {
    vec2 cd = uClCirWind.zw;
    vec2 p = cpk + uClCirWind.xy;
    vec2 q = vec2(dot(p, cd), dot(p, vec2(-cd.y, cd.x)));
    vec2 qx = vec2(dot(cgx, cd), dot(cgx, vec2(-cd.y, cd.x))), qy = vec2(dot(cgy, cd), dot(cgy, vec2(-cd.y, cd.x)));
    vec4 wp = textureGrad(uClWeather, q / 240.0, qx / 240.0, qy / 240.0);
    vec2 qq = q + (wp.rg - 0.5) * vec2(28.0, 20.0);                              // gentle large bends
    vec4 wq = textureGrad(uClWeather, qq / 41.0 + vec2(0.17, 0.59), qx / 41.0, qy / 41.0);
    vec2 qf = qq + (wq.rg - 0.5) * vec2(5.0, 3.2);                               // local meander of the fibres
    vec2 s0 = vec2(1.0 / 230.0, 1.0 / 110.0), s1 = vec2(1.0 / 46.0, 1.0 / 13.0), s1b = vec2(1.0 / 70.0, 1.0 / 13.0);
    vec2 s2 = vec2(1.0 / 30.0, 1.0 / 1.7), s3 = vec2(1.0 / 12.0, 1.0 / 0.7), s4 = vec2(1.0 / 4.6, 1.0 / 0.27);
    float m1 = textureGrad(uClWeather, qq * s0 + vec2(0.21, 0.4), qx * s0, qy * s0).a;                         // fields
    float m2 = textureGrad(uClWeather, qq * s1 + vec2(0.63, 0.17), qx * s1, qy * s1).r;                        // tufts
    float m3 = textureGrad(uClWeather, (qq - vec2(7.0, 0.0)) * s1b + vec2(0.41, 0.17), qx * s1b, qy * s1b).r;  // combed-out tails
    float fa = textureGrad(uClWeather, qf * s2 + vec2(0.37, 0.11), qx * s2 * 2.0, qy * s2 * 2.0).a;            // fibres
    float fb = textureGrad(uClWeather, qf * s3 + vec2(0.71, 0.53), qx * s3 * 2.0, qy * s3 * 2.0).g;
    float fc = textureGrad(uClWeather, qf * s4 + vec2(0.13, 0.83), qx * s4 * 2.0, qy * s4 * 2.0).r;
    float side = dot(cpk / (length(cpk) + 20.0), uClCirBias) * uClCir.z * 0.3;
    float lo = 0.72 - 0.3 * uClCir.x;
    float fm = smoothstep(lo, lo + 0.22, m1 + side) * clamp(uClCir.x * 3.0, 0.0, 1.0);
    float fib = fa * 0.34 + fb * 0.38 + fc * 0.28;
    float head = smoothstep(0.52, 0.80, m2);
    float tail = smoothstep(0.50, 0.78, m3);
    float fs = smoothstep(0.30, 0.74, fib);
    fs *= 0.45 + 0.75 * smoothstep(0.3, 0.7, wq.a);
    float dens = head * (0.35 + 0.65 * fs) * (0.6 + 0.8 * smoothstep(0.62, 0.9, m2))
               + tail * (1.0 - 0.7 * head) * fs * (0.25 + 0.75 * smoothstep(0.36, 0.66, fa)) * 0.6;
    float veil = 0.07 * smoothstep(0.45, 0.8, wp.b) * (0.4 + 0.6 * smoothstep(0.3, 0.7, fa));
    float tau = fm * (dens * 0.55 + veil) * pow(min(1.0 / dy, 3.5), 0.6);
    if (tau > 0.001) {
      float as = dot(cpk, sa) * 1000.0;
      vec3 E = clSunT(uClCir.y * 0.001, as, 1.64, 2.5) * uClSunE * uClTw.w + uClMoonE;
      float cosT = dot(dir, uClLdir);
      float ph = 0.5 * clHG(cosT, 0.70) + 0.085;
      vec3 rad = (E * ph * mix(1.0, 0.7, clamp(tau, 0.0, 1.0)) + ambCir * 0.30) * uClCir.w;
      float al = (1.0 - exp(-tau)) * clHaze(ct, uClCir.y) * horizon * smoothstep(200000.0, 80000.0, ct);
      col = mix(col, rad, al);
    }
  }

  // ---------------------------------------------------------------- stratocumulus / cumulus shell
  float cheap = step(0.5, uAux);
  float detail = 1.0 - cheap;
  float cc = (1.0 - dy * dy) / (2.0 * CL_RE);
  float t0 = clT(uClLayer.x, dy, cc), t1 = min(clT(uClLayer.y, dy, cc), 240000.0);
  if (t1 <= t0) return;
  // coarse steps look for cloud columns; inside a column the step shrinks to resolve its thickness (thin sheets!)
  float n = min(uClSteps * mix(1.7, 1.0, smoothstep(0.03, 0.2, dy)), 48.0);    // (the path is 60..90 km long near the horizon)
  n = floor(n * mix(1.0, 0.5, cheap));
  float nMax = n + mix(uClQual.w, 2.0, cheap), kIn = mix(7.0, 3.0, cheap);
  float nRef = uClQual.y * detail, nL = mix(uClQual.z, 2.0, cheap);
  float H = uClLayer.y - uClLayer.x;
  float dtC = (t1 - t0) / n;
  float pix = 2.0 * uProjInv[1][1] / uResolution.y;
  float jit = fract(ign(gl_FragCoord.xy) + uFrame * 0.03635494);   // (golden-ratio rotation per accumulated sample: stratified in depth)
  float jl = fract(ign(gl_FragCoord.yx * 1.31 + 7.7) + uFrame * 0.02246860);   // second, decorrelated sequence for the light samples
  float t = t0 + dtC * jit;
  float T = 1.0; vec3 L = vec3(0.0);
  bool wasEmpty = true; int refines = 0;
  float farTau = 0.0, beam = 1.0, wAcc = 0.0; vec3 S = vec3(0.0);
  float c1 = mix(0.72, 0.30, uClLit3.x), c2 = mix(0.55, 0.12, uClLit3.x);
  float prevStep = dtC, fstep = dtC, tFine = -1.0, eStep = dtC;
  // noise footprint: near the horizon the bases are seen at a grazing angle; a pixel covers a strip of cloud
  // t * pix / dy long, and neighbouring pixel rows sample the noise that far apart (finer detail would alias into
  // horizontal comb lines there)
  float fGraze = uClQual.x * mix(1.0, 0.6 / max(dy, 0.04), smoothstep(0.30, 0.06, dy));
  clCellF = 2.0 * uClQual.x / (max(dy, 0.03) * fGraze);
  for (int i = 0; i < 62; i++) {
    if (float(i) >= nMax || t >= t1) break;
    float F = max(t * pix, 16.0) * fGraze;
    vec3 p, hv, hv2; vec4 w;
    float d = clAt(dir, cc, t, F, detail, p, w, hv);
    // step: coarse outside the columns, jump to the base from below, medium in the empty parts of a column,
    // fine inside the cloud itself (growing as the ray gets opaque)
    float stp = dtC, dtF = dtC;
    if (w.x > 0.01) {
      float colT = hv.y * H / (dy + 2.0 * t * cc);              // path length through the local cloud column
      float dtIn = clamp(colT / kIn, 30.0, dtC);
      dtF = min(dtIn, max(uClQual.w > 0.0 ? 75.0 : dtC, t * 0.0055) * mix(1.0, 6.0, cheap));
      if (hv.x <= 0.0) { stp = min(-hv.x * colT + dtF * jit, dtC); fstep = dtF; }  // below: jump to the base
      else if (hv.x < 1.0) {
        if (d > 0.0) { if (wasEmpty) fstep = dtF; stp = min(fstep, dtC); fstep *= 2.2; }  // first steps resolve the skin, then grow
        else stp = dtIn;
      }
    }
    // entering a cloud with a big step: go back to the last empty sample and re-march that interval with small,
    // jittered steps (no nested bisection loop: it was very expensive on D3D; a fixed first depth would also draw
    // onion-skin contours into soft clouds)
    if (d > 0.0 && wasEmpty && prevStep > 1.6 * dtF && t > tFine && float(refines) < nRef) {
      tFine = t; eStep = max(prevStep * 0.25, dtF);
      t -= prevStep; d = 0.0; stp = eStep * max(jit, 0.04); refines++;
    } else if (d <= 0.0 && t < tFine) stp = min(stp, eStep);
    prevStep = stp;
    bool entering = wasEmpty;
    wasEmpty = d <= 0.0;
    if (d > 0.0) {
      float hl = hv.x;
      float sig = d * uClShape.z;
      float al = 1.0 - exp(-sig * stp);
      // full lighting for the samples that matter; faint ones reuse the last lit colour of this ray
      wAcc += T * al;
      if (entering || wAcc > 0.11) {
      wAcc = 0.0;
      // --- light march toward the key light. Around sunset it is tilted (uClMisc.w): at 1.5 .. -1.5 deg the light
      // skims the deck from just below (the glowing horizon band lights bars and undersides), later in dusk it
      // comes from the arch above the horizon: flat bases fall into shadow, faces that see the sunset keep glowing
      float as = dot(p.xz, sa);
      vec3 Ld = normalize(vec3(uClLdir.x, uClLdir.y + sunMode * (as / CL_RE + uClMisc.w), uClLdir.z));
      // three jittered samples in segments of 70, 224 and 717 m (written out: nested loops are very slow on D3D)
      float tau = clDensL(p + Ld * (70.0 * jl), w, F * 2.0, 1.0) * 70.0
                + clDensL(p + Ld * (70.0 + 224.0 * fract(jl + 0.618034)), w, F * 2.0, 1.0) * 224.0;
      if (nL > 2.5) {
        vec3 lp = p + Ld * (294.0 + 717.0 * fract(jl + 0.236068));
        tau += clDensL(lp, clWeather(lp.xz * 0.001, F * 3.0), F * 2.0, 0.0) * 717.0;
      }
      tau *= uClShape.z * mix(1.0, 4.0, cheap);
      if (cheap < 0.5 && entering) {
        // distant banks along the light path shade this one (low sun): smooth, from the weather field
        farTau = 0.0; beam = 1.0;
        if (uClLit.w > 0.0) {
          float FF = max(F * 4.0, 400.0);
          farTau = uClLit.w * 1.3 * (clFarShadow(p + Ld * 5000.0, FF) + clFarShadow(p + Ld * 13000.0, FF * 2.0));
        }
        // shadows of banks beyond the horizon: constant along the light rays -> patches of lit and dull cloud
        if (uClLit3.w * lowSun > 0.0) {
          float bl = dot(p.xz, vec2(-sa.y, sa.x));
          float bn = textureLod(uClWeather, vec2(bl / 57000.0 + 0.37, (p.y - as * 0.035) / 9500.0 + as / 330000.0), 2.5).r;
          beam = mix(1.0, 0.22 + 0.78 * smoothstep(0.36, 0.60, bn), uClLit3.w * lowSun);
        }
      }
      float tauS = tau + farTau;
      float cosT = dot(dir, Ld);
      vec3 E = clSunT(p.y * 0.001, as, uClTw.x, uClTw.y) * uClSunE * (uClTw.w * beam) + uClMoonE;
      float ms = exp(-tauS) * min(clPhase(cosT, 1.0) + uClLit3.y * 0.03 * clHG(cosT, 0.93), 1.1 + 0.5 * uClLit3.y)
               + c1 * exp(-tauS * 0.30) * clPhase(cosT, 0.7)
               + c2 * exp(-tauS * 0.07) * clPhase(cosT, 0.45);
      float pw = 1.0 - exp(-2.0 * tauS - sig * 140.0);
      ms *= mix(1.0, pw, uClLit.z * (0.5 - 0.5 * cosT));
      float bil = smoothstep(0.26, 0.64, hv.z);
      ms *= mix(1.0 - uClLit3.z, 1.0, bil);                                    // creases between the billows
      // --- ambient: sky from above, horizon / ground from below; thick columns have dark bellies
      float ao = mix(1.0, 0.42, d) * mix(1.0 - 0.45 * uClLit3.z, 1.0, bil);
      float thick = smoothstep(0.08, 0.55, hv.y * w.x * 1.5) * uClMisc.z;
      S = E * ms + (ambTop * mix(1.0 - thick, 1.0, hl) + ambBot * mix(0.85, 0.25, hl)) * ao;
      // --- twilight arch: soft directional light from the sunset horizon, shadowed by the same march
      float tauA = tau + 0.25 * farTau;
      S += archCol * ((0.75 * exp(-tauA * 0.9) + 0.25 * exp(-tauA * 0.2)) * mix(1.0, beam, 0.55));
      vec2 cx = p.xz - uClCity.xy;
      S += uClCityCol * (uClCity.w * ao * (1.0 - 0.7 * hl) * (exp(-dot(cx, cx) / (uClCity.z * uClCity.z)) + 0.08));
      }
      L += T * al * mix(skyBase, S, clHaze(t, p.y));
      T *= 1.0 - al;
      if (T < 0.04) { T = 0.0; break; }
    }
    t += stp;
  }
  T = mix(1.0, T, horizon); L *= horizon;
  col = col * T + L;
}
`;

// runs in main() of the sky shader, in uniform control flow (derivatives for the cirrus sheet are taken here)
export const CLOUD_MAIN = /* glsl */`
  {
    vec3 cdir = normalize(vec3(dir.x, max(dir.y, 0.03), dir.z));
    float ct = clT(uClCir.y, cdir.y, (1.0 - cdir.y * cdir.y) / (2.0 * CL_RE));
    vec2 cpk = (uCamPos.xz + cdir.xz * ct) * 0.001;
    vec2 cgx = dFdx(cpk), cgy = dFdy(cpk);
    clClouds(dir, sdir, cpk, cgx, cgy, ct, col);
  }
`;

// ---------------------------------------------------------------------------------------------
// Weather map pass (sky.js renders it into a 1024 x 1024 RGBA8 log-polar map whenever the time / params change):
// u = azimuth / 2 pi + 0.5, v = log(r / 0.4 km) / log(650). One texel is ~0.6 % of r (60 m at 10 km, 370 m at 60 km).
export const CLOUD_WMAP_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D uClWeather;
uniform vec3 uSunDir;
uniform vec4 uClShape;
uniform vec4 uClWind;
uniform vec4 uClComp;
uniform vec4 uClComp2;
uniform vec4 uClLit2;
const float CL_WR0 = 0.4;
const float CL_WLOG = 6.4770;
vec2 clSa;
__FIELD__
void main() {
  clSa = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  float ang = (vUv.x - 0.5) * 6.2831853;
  float r = CL_WR0 * exp(vUv.y * CL_WLOG);
  gl_FragColor = clWeatherField(r * vec2(cos(ang), sin(ang)), r * 6.14);
}
`.replace('__FIELD__', WEATHER_FIELD);
