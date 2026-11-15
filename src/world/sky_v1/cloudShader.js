// GLSL injected into the engine's sky dome shader (see atmosphere.js: __CLOUD_PARS__ / __CLOUD_MAIN__).
// Two layers: a 2D cirrus sheet at ~9 km and a ray-marched cumulus / stratocumulus shell at 1.5-4.2 km
// (spherical shell: clouds recede to the horizon and stack into bands there).
// Everything is a pure function of (direction, camera, wind offsets derived from the time, sun elevation).
// Cost notes: the volume is never sampled at its 8 MB top mip (cache misses dominated the frame time), the
// weather field is tested before the volume, and a ray entering a cloud bisects back to the surface so that
// 32 steps give a correctly lit, crisp skin.

export const CLOUD_PARS = /* glsl */`
precision highp sampler3D;
uniform sampler3D uClNoise;
uniform sampler2D uClWeather;
uniform sampler2D uClSunLUT;
uniform vec3 uCamPos;
uniform vec2 uResolution;
uniform float uClOn;
uniform float uClSteps;
uniform vec4 uClQual;     // detail LOD bias (footprint multiplier), max surface refinements per ray, light steps, -
uniform vec4 uClShape;    // coverage, cumulus (type), extinction scale (1/m), erosion
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
uniform vec4 uClLit;      // twilight glow gain, haze length (m), powder, far shadow
uniform vec4 uClLit2;     // pink (twilight purple light), terminator exaggeration, bottom ambient, banding
uniform vec4 uClCity;     // city centre x, z (m), radius (m), gain * night
uniform vec3 uClCityCol;

const float CL_RE = 6360000.0;

float clRemap(float v, float a, float b) { return clamp((v - a) / (b - a), 0.0, 1.0); }
float clHG(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.566371 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
float clPhase(float c, float k) { return 0.74 * clHG(c, 0.80 * k) + 0.26 * clHG(c, -0.28 * k); }

// distance along the view ray to altitude H (m); cc = curvature drop coefficient (1 - dy^2) / (2 R)
float clT(float H, float dy, float cc) { float h = max(H - uCamPos.y, 1.0); return 2.0 * h / (dy + sqrt(dy * dy + 4.0 * cc * h)); }

// sun transmittance at altitude (km) for a point 'a' metres toward the sun azimuth (local sun elevation rises with a)
vec3 clSunT(float altKm, float a, float stretch) {
  float th = uClTw.z + clamp(a * uClLit2.y / CL_RE, -0.021, 0.021);
  float tw = smoothstep(0.02, -0.02, th);
  th = th < 0.0 ? th / stretch : th;
  float u = sqrt(clamp((th * 57.29578 + 6.0) / 32.0, 0.0, 1.0));
  float v = clamp((altKm + uClTw.y * tw) / 12.0, 0.0, 1.0);
  vec3 T = textureLod(uClSunLUT, vec2((u * 63.0 + 0.5) / 64.0, (v * 15.0 + 0.5) / 16.0), 0.0).rgb;
  T.gb += T.r * uClLit2.x * vec2(0.07, 0.30) * smoothstep(0.022, -0.03, th);   // multiply scattered "purple light" of dusk (after local sunset)
  return T;
}

// aerial perspective: fraction of cloud light surviving 't' metres of air on a path that climbs to altitude h
float clHaze(float t, float h) { float x = max(h, 10.0) / 2600.0; return exp(-t / uClLit.y * (1.0 - exp(-x)) / x); }

// large scale weather. pk: world xz in km. F: filter footprint in metres.
// returns coverage (0..1), type (0 stratus .. 1 cumulus), base offset (0..1 of the free height)
vec4 clWeather(vec2 pk, float F) {
  vec2 pa = pk + uClWind.xy;
  vec2 sa = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  vec2 ps = vec2(dot(pa, sa), dot(pa, vec2(-sa.y, sa.x)) / uClLit2.w);     // cloud streets across the sun azimuth
  vec4 w1 = textureLod(uClWeather, ps * (1.0 / 71.0), log2(max(F / 139.0, 1.0)));
  vec4 w2 = textureLod(uClWeather, ps * (1.0 / 23.0) + vec2(0.31, 0.67), log2(max(F / 45.0, 1.0)));
  float cov = (w1.r * 0.6 + w2.b * 0.4 - 0.5) * 2.3 + uClShape.x;
  // composition (fixed in the world: the camera never leaves the city, so this is a painting of the sky)
  float a = dot(pk, sa), b = dot(pk, vec2(-sa.y, sa.x));
  float r = length(pk);
  float wedge = exp(-pow(b / (uClComp.y * max(a, 1.0) + 4.0), 2.0)) * smoothstep(5.0, 15.0, a);
  cov -= uClComp.x * wedge;
  float bank = smoothstep(2.5, 7.5, -a) * (1.0 - smoothstep(20.0, 46.0, -a));
  cov += uClComp.w * bank;
  cov -= uClComp2.x * exp(-r * r / 40.0);
  cov -= uClComp2.w * smoothstep(24.0, 70.0, r);
  float ty = clamp(uClShape.y + (w1.g - 0.5) * 1.3 + 1.3 * uClComp.w * bank, 0.0, 1.0);
  float bo = clamp((1.0 - ty) * (w1.a * 0.9 + (w2.a - 0.5) * 0.35), 0.0, 1.0);
  // long thin stratus bars, elongated across the sun azimuth: they stack into lines near the horizon
  vec2 pb = vec2(dot(pa, sa) / 39.0, dot(pa, vec2(-sa.y, sa.x)) / 190.0);
  vec4 wb = textureLod(uClWeather, pb + vec2(0.53, 0.19), log2(max(F / 76.0, 1.0)));
  float bar = smoothstep(0.52, 0.66, wb.g * 0.8 + w2.b * 0.2 + (w1.r - 0.5) * 0.12) * smoothstep(6.0, 20.0, r) * uClComp.z;
  cov *= smoothstep(0.16, 0.48, cov);                                      // no isolated crumbs
  float s = smoothstep(-0.08, 0.08, bar - cov);
  return vec4(clamp(mix(cov, bar, s), 0.0, 0.88), mix(ty, 0.03 + 0.12 * wb.r, s), mix(bo, wb.a * uClComp2.y, s), w1.b);
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
// density 0..1 at p = (x, altitude, z) in metres. hv: (normalised height inside the local cloud column, column thickness 0..1)
float clDens(vec3 p, vec4 w, float F, float detail, out vec2 hv) {
  float hf = (p.y - uClLayer.x) / (uClLayer.y - uClLayer.x);
  float th = clColumn(w);
  float hl = (hf - w.z * (1.0 - th)) / th;
  hv = vec2(hl, th);
  if (hl <= 0.0 || hl >= 1.0 || w.x <= 0.0) return 0.0;
  float prof = smoothstep(0.0, 0.07, hl) * smoothstep(1.0, 0.25, hl);
  float thr = 1.0 - w.x;
  if (prof <= thr) return 0.0;
  float wr = (w.w - 0.5) * 2600.0;                                // slow warp: hides the tiling of the shape noise
  vec3 q = vec3(p.x + uClWind.x * 1000.0 + wr, p.y, p.z + uClWind.y * 1000.0 - wr * 0.7);
  vec4 s = textureLod(uClNoise, q * uClLayer.z, log2(max(F * 128.0 * uClLayer.z, 2.0)));
  float wf = s.g * 0.5 + s.b * 0.3 + s.a * 0.2;
  float base = clRemap(clRemap(s.r, wf - 1.0, 1.0), 0.58, 1.0);
  base = mix(0.62 + 0.3 * base, base, smoothstep(0.05, 0.45, w.y));  // stratiform types: smooth sheets
  float shape = base * prof;
  if (shape <= thr) return 0.0;
  // the detail noise displaces the surface (cauliflower tops, wispy ragged bases and thin clouds)
  float er = uClShape.w * mix(1.7, 1.0, smoothstep(0.15, 0.6, w.x));
  if (detail > 0.5) {
    vec3 qd = (q + vec3(uClWind.z, uClWind.w, uClWind.z * 0.6)) * uClLayer.w;
    vec3 hn = textureLod(uClNoise, qd, log2(max(F * 128.0 * uClLayer.w, 2.0))).gba;
    float hb = hn.x * 0.5 + hn.y * 0.3 + hn.z * 0.2;
    shape -= er * mix(hb, 1.0 - hb, clamp(hl * 3.5, 0.0, 1.0));
    if (F < 30.0 && shape > thr) {                                  // close clouds: one more octave of crispness
      float h2 = textureLod(uClNoise, qd * 3.7 + 0.31, log2(max(F * 128.0 * uClLayer.w * 3.7, 2.0))).b;
      shape -= er * 0.35 * (1.0 - h2) * smoothstep(30.0, 12.0, F);
    }
  } else shape -= er * 0.5;
  float d = clRemap(shape, thr, 1.0) * mix(0.6, 1.0, w.x);
  float sharp = detail > 0.5 ? mix(3.0, 10.0, smoothstep(0.05, 0.45, w.y)) : 3.0;                 // sheets stay soft, cumulus crisp
  return min(d * sharp, 1.0) * mix(0.7, 1.3, hl);
}

void clClouds(vec3 dir, vec3 sdir, vec2 cpk, vec2 cgx, vec2 cgy, float ct, inout vec3 col) {
  float dy = dir.y;
  if (uClOn < 0.5 || dy <= 0.0008) return;
  vec3 skyBase = skyLUT(uSkyLUT, sdir);
  vec2 sa = normalize(uSunDir.xz + vec2(1e-5, 0.0));
  float sunMode = uClTw.w > 0.0 ? 1.0 : 0.0;
  float horizon = smoothstep(0.0008, 0.016, dy);
  vec3 ambTop = (skyLUT(uSkyLUT, vec3(0.0, 1.0, 0.0)) * 0.6 + skyLUT(uSkyLUT, normalize(vec3(-sa.x, 0.7, -sa.y))) * 0.4) * uClAmbTint;
  vec3 hzSun = skyLUT(uSkyLUT, normalize(vec3(sa.x, 0.06, sa.y)));
  vec3 hzAnti = skyLUT(uSkyLUT, normalize(vec3(-sa.x, 0.10, -sa.y)));
  vec3 ambBot = (hzAnti * 0.5 + ambTop * 0.25 + hzSun * 0.25 * uClLit.x) * uClLit2.z * uClAmbTint;

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
      vec3 E = clSunT(uClCir.y * 0.001, as, 1.0 + (uClTw.x - 1.0) * 0.4) * uClSunE * uClTw.w + uClMoonE;
      float cosT = dot(dir, uClLdir);
      float ph = 0.5 * clHG(cosT, 0.70) + 0.085;
      vec3 rad = (E * ph * mix(1.0, 0.7, clamp(tau, 0.0, 1.0)) + ambTop * 0.30) * uClCir.w;
      float al = (1.0 - exp(-tau)) * clHaze(ct, uClCir.y) * horizon * smoothstep(200000.0, 80000.0, ct);
      col = mix(col, rad, al);
    }
  }

  // ---------------------------------------------------------------- cumulus / stratocumulus shell
  float cc = (1.0 - dy * dy) / (2.0 * CL_RE);
  float t0 = clT(uClLayer.x, dy, cc), t1 = min(clT(uClLayer.y, dy, cc), 240000.0);
  if (t1 <= t0) return;
  float n = min(uClSteps * mix(1.5, 1.0, smoothstep(0.03, 0.2, dy)), 48.0);    // thin far sheets need denser sampling
  float dt = (t1 - t0) / n;
  float pix = 2.0 * uProjInv[1][1] / uResolution.y;
  float t = t0 + dt * fract(ign(gl_FragCoord.xy) + uFrame * 0.03635494);
  float T = 1.0; vec3 L = vec3(0.0);
  bool wasEmpty = true; int refines = 0;
  for (int i = 0; i < 48; i++) {
    if (float(i) >= n) break;
    vec3 p = vec3(uCamPos.x + dir.x * t, uCamPos.y + t * dy + t * t * cc, uCamPos.z + dir.z * t);
    float F = max(t * pix, dt * 0.06) * uClQual.x;
    vec4 w = clWeather(p.xz * 0.001, F);
    float d = 0.0; vec2 hv, hv2;
    if (w.x > 0.01) d = clDens(p, w, F, 1.0, hv);
    // entering a cloud: bisect back to its surface, so the first sample is the lit (or shadowed) skin and
    // not a random depth inside the body -> correct brightness and crisp silhouettes from few steps
    if (d > 0.0 && wasEmpty && float(refines) < uClQual.y) {
      float lo = t - dt, hi = t;
      for (int b = 0; b < 3; b++) {
        float tm = 0.5 * (lo + hi);
        vec3 pm = vec3(uCamPos.x + dir.x * tm, uCamPos.y + tm * dy + tm * tm * cc, uCamPos.z + dir.z * tm);
        vec4 wm = clWeather(pm.xz * 0.001, F);
        vec2 hm; float dm = clDens(pm, wm, F, 1.0, hm);
        if (dm > 0.0) { hi = tm; p = pm; w = wm; d = dm; hv = hm; } else lo = tm;
      }
      t = hi; refines++;
    }
    wasEmpty = d <= 0.0;
    {
      if (d > 0.0) {
        float hl = hv.x;
        float sig = d * uClShape.z;
        // --- light march toward the key light (the sun may be below the deck: bases light up)
        float as = dot(p.xz, sa);
        vec3 Ld = normalize(vec3(uClLdir.x, uClLdir.y + sunMode * as / CL_RE, uClLdir.z));
        float tau = 0.0, s = 0.0, seg = 70.0;
        for (int k = 0; k < 5; k++) {
          if (float(k) >= uClQual.z) break;
          vec3 lp = p + Ld * (s + seg * 0.5);
          vec4 lw = w;
          if (k >= 3) lw = clWeather(lp.xz * 0.001, F * 2.0);
          tau += clDens(lp, lw, F * 2.0, 0.0, hv2) * seg;
          s += seg; seg *= 2.1;
        }
        tau *= uClShape.z;
        // distant banks along the light path shade this one (low sun): smooth, from the weather field
        if (uClLit.w > 0.0) {
          float FF = max(F * 4.0, 400.0);
          tau += uClLit.w * 1.3 * (clFarShadow(p + Ld * 5000.0, FF) + clFarShadow(p + Ld * 13000.0, FF * 2.0));
        }
        float cosT = dot(dir, Ld);
        vec3 E = clSunT(p.y * 0.001, as, uClTw.x) * uClSunE * uClTw.w + uClMoonE;
        float ms = exp(-tau) * (clPhase(cosT, 1.0) + 0.03 * clHG(cosT, 0.93))
                 + 0.60 * exp(-tau * 0.30) * clPhase(cosT, 0.7)
                 + 0.30 * exp(-tau * 0.09) * clPhase(cosT, 0.45);
        float pw = 1.0 - exp(-2.0 * tau - sig * 140.0);
        ms *= mix(1.0, pw, uClLit.z * (0.5 - 0.5 * cosT));
        // --- ambient: sky from above, horizon / twilight glow / city from below (cloud sides see half the sky)
        float ao = mix(1.0, 0.42, d);
        vec3 S = E * ms + (ambTop * mix(0.30, 1.0, hl) + ambBot * mix(0.85, 0.25, hl)) * ao;
        vec2 cx = p.xz - uClCity.xy;
        S += uClCityCol * (uClCity.w * ao * (1.0 - 0.7 * hl) * (exp(-dot(cx, cx) / (uClCity.z * uClCity.z)) + 0.08));
        float al = 1.0 - exp(-sig * dt);
        L += T * al * mix(skyBase, S, clHaze(t, p.y));
        T *= 1.0 - al;
        if (T < 0.012) { T = 0.0; break; }
      }
    }
    t += dt;
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
