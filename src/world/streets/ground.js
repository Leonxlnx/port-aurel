// Ground of the city: three merged meshes (asphalt / paved / soft) with fully procedural world-space shading.
// Rain water (puddles in depressions, damp patches that follow the paving) comes from ./wet.js: one wetness parameter,
// `engine.settings.groundWet` / setGroundWetness() / ?wet= (0 dry .. 0.5 default .. 1 soaked), see the header of wet.js.
import * as THREE from 'three';
import { PARK_PATH_GLSL } from './plan.js';
import { WET, WET_GLSL, initWet, wetSync, setGroundWetness } from './wet.js';

const VERT_PARS = /* glsl */`attribute vec4 aA; attribute vec4 aB; attribute vec4 aC; varying vec4 vA; varying vec4 vB; varying vec4 vC;`;
const VERT = /* glsl */`vA = aA; vB = aB; vC = aC;`;

const COMMON = WET_GLSL + /* glsl */`
varying vec4 vA; varying vec4 vB; varying vec4 vC;
vec3 g_alb; float g_rough; float g_metal; vec2 g_grad; float g_hgt; float g_fw; vec2 g_fw2; float g_damp; float g_pud; float g_w;
// anti-aliased, energy conserving coverage of a line of half width hw at distance dist (metres); fw = pixel footprint
float lineCov(float dist, float hw, float fw) {
  float f = max(fw, 1e-4);
  return clamp((hw - dist) / f + 0.5, 0.0, 1.0) * min(1.0, 2.0 * hw / f);
}
// two families of joints (dj.x = distance to the joints of constant x, dj.y = of constant y), each filtered with the
// pixel footprint along its own axis so that joints running towards the camera stay crisp at grazing angles
float jointCov(vec2 dj, float hw, vec2 f2) { return max(lineCov(dj.x, hw, f2.x), lineCov(dj.y, hw, f2.y)); }
float areaCov(float sd, float fw) { return clamp(0.5 - sd / max(fw, 1e-4), 0.0, 1.0); }
vec2 gradFromScreen(vec2 p, float h) {
  vec2 dpx = dFdx(p), dpy = dFdy(p); float dhx = dFdx(h), dhy = dFdy(h);
  float det = dpx.x * dpy.y - dpx.y * dpy.x;
  if (abs(det) < 1e-12) return vec2(0.0);
  return clamp(vec2(dhx * dpy.y - dhy * dpx.y, dhy * dpx.x - dhx * dpy.x) / det, -1.2, 1.2);
}
// (the shoreline is filtered with the geometric mean footprint: crisp across the view even at grazing angles)
void g_wet(vec2 p, float low, float lowDamp) { g_w = wetLevel(p); vec2 m = wetMaskW(g_w, low, lowDamp, sqrt(g_fw2.x * g_fw2.y)); g_pud = m.x; g_damp = m.y; }
// water standing in the joints around a puddle: jm = resolved joint mask (0 when the joints are smaller than a pixel)
void g_jointWater(float lowJ, float jm) { g_pud = max(g_pud, smoothstep(0.0, 0.025, g_w + lowJ) * jm); g_damp = max(g_damp, g_pud); }
void g_applyWet(float porous) {
  g_alb *= mix(1.0, 0.64, g_damp * porous);
  g_rough = mix(g_rough, g_rough * 0.45, g_damp);
  g_alb *= mix(1.0, 0.72, g_pud);
  g_rough = mix(g_rough, 0.03, g_pud);
  g_metal *= 1.0 - g_pud;
}
// id.xy = stone id, z = distance to the nearest joint (m); lf = local 0..1 coords inside the stone, dj = joint distances per axis
vec3 stoneGrid(vec2 p, vec2 size, float bond, out vec2 lf, out vec2 dj) {
  vec2 q = p / size; float row = floor(q.y);
  q.x += bond * (0.5 * mod(row, 2.0) + 0.31 * hash11(row * 1.37 + 3.0));
  vec2 id = floor(q); lf = fract(q);
  dj = min(lf, 1.0 - lf) * size;
  return vec3(id.x, row, min(dj.x, dj.y));
}
// fallen leaves and litter: dens = local density 0..1; returns the coverage, lc = leaf colour
float g_leaf(vec2 p, float dens, out vec3 lc) {
  vec2 q = p / 0.105; vec3 h = hash32(floor(q) + 3.7);
  vec2 f = fract(q) - 0.5 - (h.xy - 0.5) * 0.55;
  float a = h.z * 6.2832; vec2 d = vec2(cos(a), sin(a));
  float r = length(vec2(dot(f, d), dot(f, vec2(-d.y, d.x)) * 1.9)) * 0.105 / (0.65 + 0.6 * fract(h.y * 3.1));
  float pick = fract(h.z * 7.31);
  lc = mix(vec3(0.17, 0.11, 0.05), vec3(0.30, 0.23, 0.09), fract(h.x * 5.3));
  lc = mix(lc, vec3(0.115, 0.08, 0.045), step(0.8, fract(h.y * 9.7)));
  float nearK = 1.0 - smoothstep(0.02, 0.09, g_fw);
  return mix(dens * 0.13, step(pick, dens) * areaCov(r - 0.031, g_fw), nearK);
}
// chewing gum spots
void g_gum(vec2 p, inout vec3 col) {
  vec2 gp = p / 0.3; vec3 gh = hash32(floor(gp) + 5.0);
  float gr = length(fract(gp) - 0.2 - 0.6 * gh.xy) * 0.3;
  float gum = step(0.86, gh.z) * areaCov(gr - (0.015 + 0.013 * gh.x), g_fw) * (1.0 - smoothstep(0.02, 0.07, g_fw));
  col = mix(col, gh.y > 0.7 ? vec3(0.40, 0.38, 0.36) : vec3(0.085, 0.08, 0.08), gum * 0.8);
}
`;

const SURFACE = /* glsl */`roughnessFactor = clamp(g_rough, 0.03, 1.0); metalnessFactor = g_metal;`;
const NORMAL = /* glsl */`
  if (vWNormal.y > 0.5) { normal = worldToViewDir(normalize(vec3(-g_grad.x, 1.0, -g_grad.y))); }
`;
// fake glossy reflection of the street lights (sampled from the top-down light map along the mirrored view ray)
const EMISSIVE = /* glsl */`
  if (uNight > 0.01 && vWNormal.y > 0.5) {
    vec3 V_ = normalize(uCamPos - vWPos);
    vec2 Rh_ = -V_.xz / max(V_.y, 0.045);
    float gls_ = 1.0 - g_rough; gls_ *= gls_;
    float F_ = 0.04 + 0.96 * pow(1.0 - clamp(V_.y, 0.0, 1.0), 5.0);
    vec2 q1_ = (vWPos.xz + Rh_ * 4.0 - uCityLightRect.xy) / uCityLightRect.zw;
    vec2 q2_ = (vWPos.xz + Rh_ * 8.5 - uCityLightRect.xy) / uCityLightRect.zw;
    vec3 lr_ = texture2D(uCityLights, q1_).rgb + texture2D(uCityLights, q2_).rgb;
    totalEmissiveRadiance += lr_ * (0.4 * F_ * gls_ * uNight);
  }
`;
// The quay railing of the promenade (harbor/quay.js: ~2 m panels, 15 bays of pickets, rings under the top rail) is
// mirrored analytically in the promenade puddles. Where the panels really stand is read once from the harbor module's
// instanced railing meshes ('hbr_rail_*') into a 1-D lookup along z: (panel start z, panel length, present).
function makeRailLookup(layout) {
  const N = 4096, z0 = layout.harbor.quay.z0, z1 = layout.harbor.quay.z1, railX = layout.QUAY_X + 0.3;
  const data = new Float32Array(N * 4);
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  let done = false;
  const fill = root => {
    if (done || !root) return; done = true;
    const m = new THREE.Matrix4(), e = m.elements;
    root.traverse(o => {
      if (!o.isInstancedMesh || !/^hbr_rail_/.test(o.name)) return;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        const seg = 2 * Math.hypot(e[0], e[1], e[2]);
        if (seg < 0.3 || Math.abs(e[12] - railX) > 0.06 || Math.abs(e[2]) < 0.45 * seg) continue;      // bay quay, running along z
        const za = Math.min(e[14], e[14] + Math.sign(e[2]) * seg), zb = za + seg;
        const k0 = Math.max(0, Math.floor((za - z0) / (z1 - z0) * N)), k1 = Math.min(N - 1, Math.ceil((zb - z0) / (z1 - z0) * N));
        for (let k = k0; k <= k1; k++) {
          const zc = z0 + (k + 0.5) / N * (z1 - z0);
          if (zc >= za && zc < zb) { data[k * 4] = za; data[k * 4 + 1] = seg; data[k * 4 + 2] = 1; }
        }
      }
    });
    tex.needsUpdate = true;
  };
  return { tex, ref: new THREE.Vector3(z0, 1 / (z1 - z0), railX), fill };
}
// sky reflections are blocked by the street walls except along the open axis of the street
const AO = /* glsl */`
  {
    vec3 V_ = normalize(uCamPos - vWPos);
    vec3 R_ = normalize(vec3(-V_.x, max(V_.y, 0.02), -V_.z));
    float ax_ = vC.x > 1.5 ? max(R_.x, 0.0) : abs(R_.x) * (1.0 - vC.x);
    float az_ = abs(R_.z) * (1.0 - vC.y);
    float across_ = sqrt(ax_ * ax_ + az_ * az_);
    float vis_ = smoothstep(0.3, 0.62, R_.y / (R_.y + 3.2 * across_ + 1e-4));
    reflectedLight.indirectSpecular *= mix(0.14, 1.0, vis_);
    float railT_ = 1.0;
#ifdef GND_PROM
    {
      float railX_ = uRailRef.z;
      float tt_ = (railX_ - vWPos.x) / min(R_.x, -1e-3);
      float ry_ = tt_ * R_.y - 0.06; float rz_ = vWPos.z + tt_ * R_.z;
      float fy_ = max(fwidth(ry_), 1e-4), fz_ = max(fwidth(rz_), 1e-4); float fm_ = max(fy_, fz_);
      vec4 rl_ = textureLod(uRailTex, vec2((rz_ - uRailRef.x) * uRailRef.y, 0.5), 0.0);
      float rs0_ = rl_.r, rsg_ = max(rl_.g, 0.5), rin_ = rl_.b;
      float zq_ = (rz_ - rs0_) / rsg_; float lq_ = fract(zq_) * 15.0; float bay_ = rsg_ / 15.0;
      float dpk_ = (0.5 - abs(fract(lq_) - 0.5)) * bay_;
      float dps_ = (0.5 - abs(fract(zq_) - 0.5)) * rsg_;
      float o_ = max(max(lineCov(abs(ry_ - 1.05), 0.0165, fy_), lineCov(abs(ry_ - 0.88), 0.02, fy_)), lineCov(abs(ry_ - 0.13), 0.0225, fy_));
      o_ = max(o_, lineCov(dpk_, 0.007, fz_) * step(0.13, ry_) * step(ry_, 0.88));
      o_ = max(o_, lineCov(dps_, 0.0425, fz_) * step(ry_, 1.14));
      o_ = max(o_, areaCov(length(vec2(dps_, ry_ - 1.2)) - 0.062, fm_));
      float drg_ = (fract((lq_ - 0.5) * 0.5) - 0.5) * 2.0 * bay_;
      o_ = max(o_, lineCov(abs(length(vec2(drg_, ry_ - 0.965)) - 0.058), 0.012, fm_));
      o_ *= rin_ * step(-0.06, ry_) * step(0.0, tt_) * step(vB.x, 1.5) * step(0.5, vB.x) * step(R_.x, -0.02) * step(railX_ + 0.2, vWPos.x);
      railT_ = 1.0 - o_;
    }
#endif
    // standing water: sharp sky reflection straight from the sky LUT (the prefiltered env map is too soft near the horizon)
    // the mirror image is tested against the top-down city height map so that puddles show dark buildings, not sky
    if (vWNormal.y > 0.5) {
      float Fw_ = 0.02 + 0.98 * pow(1.0 - clamp(V_.y, 0.0, 1.0), 5.0);
      vec3 skyR_ = skyLUT(uSkyLUT, R_) * Fw_;
      reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, skyR_ * mix(0.1, 1.0, vis_), g_damp * 0.08);
      if (g_pud > 0.004) {
        float hl_ = max(length(R_.xz), 1e-3); vec2 rd_ = R_.xz / hl_; float sl_ = R_.y / hl_;
        vec3 hs_ = vec3(textureLod(uCityHeight, (vWPos.xz + rd_ * 6.0 - uCityRect.xy) / uCityRect.zw, 0.0).r,
                        textureLod(uCityHeight, (vWPos.xz + rd_ * 18.0 - uCityRect.xy) / uCityRect.zw, 0.0).r,
                        textureLod(uCityHeight, (vWPos.xz + rd_ * 50.0 - uCityRect.xy) / uCityRect.zw, 0.0).r);
        vec3 oc_ = smoothstep(vec3(0.0), vec3(2.5), hs_ - (vWPos.y + vec3(6.0, 18.0, 50.0) * sl_));
        float bo_ = max(oc_.x, max(oc_.y, oc_.z));
        reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular, skyR_ * (1.0 - 0.88 * bo_) * railT_, g_pud);
      }
    }
  }
`;
const COLOR_MAIN = fn => /* glsl */`
  {
    vec2 p_ = vWPos.xz;
    g_fw2 = fwidth(p_); g_fw = max(g_fw2.x, g_fw2.y);
    g_grad = vec2(0.0); g_hgt = 0.0; g_metal = 0.0; g_damp = 0.0; g_pud = 0.0; g_rough = 0.9; g_alb = vec3(0.2);
    ${fn}(p_);
    g_grad += gradFromScreen(p_, g_hgt);
    g_grad *= 1.0 - g_pud;
    if (g_pud > 0.004) {
      // faint standing ripples on the puddles: resolved close up, folded into the roughness further away
      float rf_ = 1.0 - smoothstep(0.01, 0.06, g_fw);
      vec2 rp_ = p_ * 3.1;
      g_grad += g_pud * rf_ * 0.012 * (vec2(vnoise(rp_ + 3.0), vnoise(rp_ + 47.0)) - 0.5);
      g_rough += g_pud * 0.06 * (1.0 - rf_);
    }
    diffuseColor.rgb = g_alb;
  }
`;

// ---------------------------------------------------------------------------------------------------
const ASPHALT = /* glsl */`
void shadeAsphalt(vec2 p) {
  float kind = vB.x, park = vB.y, p2 = vB.z;
  float u = vA.x, v = vA.y, L = vA.z, hw = vA.w;
  float fw = g_fw;
  float micro = 1.0 - smoothstep(0.003, 0.012, fw);
  float fine = 1.0 - smoothstep(0.012, 0.07, fw);
  float meso = 1.0 - smoothstep(0.07, 0.5, fw);
  float big = vnoise(p * 0.045 + 3.1);
  float mid = vnoise(p * 0.8 + 11.0);
  bool seg = kind > 0.5 && kind < 4.5;
  bool oneway = kind > 1.5 && kind < 2.5;
  bool tram = kind > 3.5 && kind < 4.5;
  float au = abs(u);
  float de = min(v, L - v);
  float inner = tram ? p2 : 0.0;
  float gutD = seg ? hw - au : 9.0;                     // distance to the kerb
  // the surface was laid in lots of different age (one paver pass per side, a transverse joint every ~70 m)
  float lv = v / 67.0 + 0.3;
  float lot = hash11(floor(lv) * 7.1 + floor(L) * 0.37 + step(0.0, u) * 3.0 + kind);
  vec3 col = vec3(0.098, 0.096, 0.094) * (0.8 + 0.32 * big + 0.16 * (mid - 0.5) * meso) * (0.84 + 0.3 * lot);
  float rough = 0.88;

  // repair patches (newer, darker asphalt with a sealed edge)
  vec2 pc = p / vec2(9.0, 13.0) + 0.37; vec2 pi = floor(pc); vec2 pf = fract(pc);
  vec3 ph = hash32(pi + 17.0);
  vec2 pd = (abs(pf - 0.5 - (ph.yx - 0.5) * 0.3) - (0.1 + 0.22 * ph.xy)) * vec2(9.0, 13.0);
  float patchD = max(pd.x, pd.y);
  float isPatch = step(ph.z, 0.3);
  float patchM = isPatch * areaCov(patchD, fw);
  float blot = vnoise(p * 2.9 + 21.0);
  col *= 1.0 + 0.2 * (blot - 0.5) * meso;
  col = mix(col, vec3(0.085, 0.084, 0.083) * mix(0.62, 0.86, ph.x) * (0.9 + 0.2 * mid), patchM);
  float tar = isPatch * lineCov(abs(patchD), 0.028, fw);
  // utility trenches along the street, the transverse lot joint
  if (seg) {
    float tl = v / 46.0 + 0.6; vec2 th = hash22(vec2(floor(tl), floor(L * 0.5) + 2.0));
    float trD = max(abs(u - (th.x - 0.5) * 1.5 * (hw - park)) - 0.36, abs(fract(tl) - 0.5) * 46.0 - 4.0 - 34.0 * th.y);
    float trOn = step(th.y, 0.42);
    col = mix(col, col * mix(0.66, 1.18, th.x), trOn * areaCov(trD, fw));
    tar = max(tar, trOn * lineCov(abs(trD), 0.022, fw));
    tar = max(tar, 0.8 * lineCov((0.5 - abs(fract(lv) - 0.5)) * 67.0, 0.018, fw) * step(6.0, de));
  }
  // sealed cracks: transverse thermal cracks and long cracks beside the paver joints; meandering ones in the junctions
  float cw = vnoise(p * 1.9 + 9.0) - 0.5;
  float cm = smoothstep(0.42, 0.62, vnoise(p * 0.07 + 40.0));
  if (seg) {
    float tc = v / 12.3 + 0.17; float tch = hash11(floor(tc) * 3.7 + floor(L));
    float tD = abs((fract(tc) - 0.5) * 12.3 + cw * 0.7 + (mid - 0.5) * 1.2);
    float tOn = step(tch, 0.55) * step(abs(u - (tch - 0.27) * 3.0 * hw), hw * (0.5 + 1.5 * tch));
    float lD = abs(au - hw * (0.18 + 0.5 * lot) + cw * 0.25 + (mid - 0.5) * 0.6);
    tar = max(tar, max(tOn * lineCov(tD, 0.013, fw), cm * lineCov(lD, 0.011, fw)) * step(3.0, de));
  } else {
    float cn = vnoise(p * 0.31 + 5.0) + 0.6 * cw;
    tar = max(tar, cm * lineCov(abs(cn - 0.5) * 1.2, 0.012, fw));
  }
  // hairline cracks
  float hn = vnoise(p * 1.3 + 70.0) + 0.25 * vnoise(p * 7.0);
  float hair = lineCov(abs(hn - 0.6) * 0.5, 0.004, fw) * smoothstep(0.35, 0.6, vnoise(p * 0.21 + 90.0)) * fine;

  // wheel paths (polished, slightly rutted), oil along the lane centre, drips where cars park
  float track = 0.0;
  if (seg) {
    float lu; float travel;
    if (oneway) { lu = u; travel = hw - park; }
    else { float lo = inner + ((kind < 1.5 && p2 > 0.5 && p2 < 1.5) ? 1.9 : 0.0); travel = (hw - park - lo) * 0.5; lu = au - (lo + travel); }
    float inLane = step(abs(lu), travel);
    track = exp(-pow((abs(lu) - 0.8) / 0.3, 2.0)) * inLane * (0.7 + 0.6 * mid);
    col *= 1.0 + 0.3 * track; rough -= 0.15 * track;
    float oil = exp(-pow(lu / 0.4, 2.0)) * inLane * (0.25 + 0.75 * smoothstep(28.0, 3.0, de)) * (0.4 + 0.6 * vnoise(vec2(u * 2.0, v * 0.3) + 13.0));
    float drip = 0.0;
    if (park > 0.1) {
      // one stain per parking bay, under the engine
      float bl = v / 5.8; vec3 bh = hash32(vec2(floor(bl), step(0.0, u) + floor(L)));
      vec2 od = vec2(au - (hw - park * 0.52) - (bh.x - 0.5) * 0.5, (fract(bl) - 0.25 - 0.5 * bh.y) * 5.8);
      float rr = dot(od, od) / (0.02 + 0.09 * bh.z);
      drip = step(0.3, bh.z) * exp(-rr * (0.6 + 0.8 * mid)) * step(6.5, de);
      drip = max(drip, 0.5 * step(hw - park, au) * smoothstep(0.66, 0.8, mid) * smoothstep(0.4, 0.7, big));
    }
    col *= 1.0 - 0.32 * oil - 0.5 * drip;
    rough -= 0.16 * oil + 0.3 * drip;
  }

  // road markings
  float wM = 0.0, yM = 0.0;
  if (kind > 0.5 && kind < 1.5) {
    float body = step(1.1, de);
    if (p2 < 0.5) yM = lineCov(abs(au - 0.12), 0.05, fw) * body;
    else if (p2 < 1.5) {
      yM = lineCov(abs(au - 1.9), 0.06, fw) * body;
      yM = max(yM, step(22.0, de) * step(au, 1.9) * lineCov(abs(fract((v + u) / 2.6) - 0.5) * 1.84, 0.09, fw));
    } else wM = lineCov(au, 0.06, fw) * step(fract(v / 9.0), 0.34) * body;
  }
  if (tram) wM = lineCov(abs(au - (inner + 0.3)), 0.06, fw) * step(1.1, de);
  if (seg) {
    if (park > 0.1) {
      float farE = step(6.5, de);
      float pl = lineCov(abs(au - (hw - park)), 0.05, fw);
      float tick = lineCov(abs(fract(v / 5.8) - 0.5) * 5.8, 0.05, fw) * step(hw - park, au) * step(au, hw - park + 0.9);
      wM = max(wM, max(pl, tick) * farE);
    }
    float sEnd; float lat;
    if (oneway) { sEnd = p2 > 0.0 ? L - v : v; lat = step(au, hw - park - 0.15); }
    else { sEnd = u > 0.0 ? L - v : v; lat = step(au, hw - park - 0.15) * step(inner + 0.15, au); }
    wM = max(wM, lat * lineCov(abs(sEnd - 0.7), 0.2, fw));
  }
  if (kind > 4.5) wM = lineCov(abs(fract(u + 0.5) - 0.5), 0.26, fw) * step(au, hw - 0.3) * step(0.4, v) * step(v, L - 0.4);

  float ironM = 0.0;
  if (seg) {
    // manhole covers
    vec2 gc = floor(p / 33.0); vec2 hh = hash22(gc + 3.3);
    vec2 c = (gc + 0.2 + 0.6 * hh) * 33.0; vec2 dc = p - c; float r = length(dc);
    float uc = vC.y > 0.5 ? u + dc.x : u - dc.y;
    if (abs(uc) < hw - 0.9 && de > 4.0 && r < 1.0) {
      float sq = max(abs(dc.x), abs(dc.y));
      col = mix(col, col * 0.72, areaCov(sq - 0.62, fw));
      float disc = areaCov(r - 0.36, fw);
      float pat = step(0.5, fract(dc.x * 9.0)) * step(0.5, fract(dc.y * 9.0));
      vec3 iron = vec3(0.07, 0.062, 0.055) * (0.75 + 0.5 * pat * fine);
      iron *= 1.0 - 0.6 * lineCov(abs(r - 0.31), 0.012, fw);
      col = mix(col, iron, disc); rough = mix(rough, 0.5, disc); ironM = disc;
    }
    // gutter drain grates
    float gv = v - (floor(v / 29.0) + 0.5) * 29.0;
    float gm = areaCov(max(abs(au - (hw - 0.36)) - 0.24, abs(gv) - 0.34), fw) * step(5.0, de);
    float slots = mix(0.5, step(0.45, fract(gv * 16.0)), fine);
    col = mix(col, mix(vec3(0.012), vec3(0.07, 0.065, 0.06), slots), gm); rough = mix(rough, 0.55, gm); ironM = max(ironM, gm);
  }
  wM *= 1.0 - ironM; yM *= 1.0 - ironM;

  // worn paint: every street was last repainted at a different time, wheels wear the paint first
  float age = hash11(floor(L) * 1.31 + kind * 5.0 + floor(hw * 3.0));
  float wearN = vnoise(p * 1.3 + 3.0) * 0.55 + vnoise(p * 7.0 + 1.0) * 0.45;
  float wear = mix(1.0, smoothstep(0.14 + 0.2 * age, 0.56 + 0.2 * age, wearN + 0.22 * (1.0 - track)), meso * 0.9 + 0.1) * (0.94 - 0.2 * age);
  col = mix(col, vec3(0.60, 0.60, 0.58), wM * wear);
  col = mix(col, vec3(0.60, 0.42, 0.065), yM * wear);
  rough = mix(rough, 0.62, max(wM, yM) * wear);
  // tar on top
  col = mix(col, vec3(0.026), tar * 0.85 * (1.0 - ironM)); rough = mix(rough, 0.36, tar * (1.0 - ironM));
  col *= 1.0 - 0.5 * hair;

  // aggregate: single stones close up (a few pale chips), grain further away; polished smoother in the wheel paths
  float ag = hash12(floor(p * 150.0));
  float n30 = vnoise(p * 34.0);
  float n8 = vnoise(p * 7.5 + 4.0);
  float pol = 1.0 - 0.45 * track;
  col *= 1.0 + micro * pol * ((ag - 0.5) * 0.6 + 0.9 * step(0.94, ag)) + fine * pol * (n30 - 0.5) * 0.34 + meso * (n8 - 0.5) * 0.16;
  rough = clamp(rough - micro * step(0.9, ag) * 0.45 * (1.0 - tar), 0.2, 1.0);
  g_hgt = micro * ag * 0.0022 + fine * n30 * 0.005 - hair * 0.002;
  g_metal = ironM * 0.55;

  // silt, grit and leaves washed against the kerb
  float gut = smoothstep(1.3, 0.1, gutD);
  float heap = smoothstep(0.3, 0.7, n8 * 0.5 + mid * 0.5);
  float silt = smoothstep(0.5, 0.03, gutD) * (0.25 + 0.75 * heap) * (1.0 - ironM);
  col = mix(col, vec3(0.19, 0.17, 0.14) * (0.75 + 0.5 * n30 * fine + 0.25 * (1.0 - fine)), silt * 0.6);
  vec3 lc; float lf = g_leaf(p, 0.004 + 0.45 * gut * gut * heap, lc) * (1.0 - ironM);
  col = mix(col, lc, lf); rough = mix(rough, 0.85, lf);

  float low = gut * (0.05 + 0.1 * mid) + 0.03 * track + 0.035 * patchM - 0.025;
  g_wet(p, vC.z + low, vC.z + low + (lot - 0.5) * 0.1 + (n8 - 0.5) * 0.09 + (blot - 0.5) * 0.09);
  g_alb = col; g_rough = rough; g_applyWet(1.0);
}
`;

// ---------------------------------------------------------------------------------------------------
const PAVED = /* glsl */`
uniform vec2 uPlazaC;
uniform vec3 uGndRef;       // canal centre z, centre z of the north / south quay road
uniform sampler2D uRailTex; uniform vec3 uRailRef;     // railing lookup along the bay quay: (z0, 1 / length, x of the railing)
void shadePaved(vec2 p) {
  float type = vB.x; float fw = g_fw;
  float micro = 1.0 - smoothstep(0.003, 0.012, fw);
  float fine = 1.0 - smoothstep(0.012, 0.07, fw);
  float meso = 1.0 - smoothstep(0.07, 0.5, fw);
  vec3 col; float rough; float porous = 1.0; float low = vC.z; float lowD = 0.0; float dens = 0.0;
  float lowJ = 0.0; float jw = 0.0;         // joints: extra depth, resolved joint mask (for water standing in the joints)
  float grime = vnoise(p * 0.11 + 2.0) * 0.6 + vnoise(p * 0.53 + 8.0) * 0.4;
  float sp1 = hash12(floor(p * 160.0));
  if (type < 0.5) {
    // ---- concrete sidewalk slabs ----
    float d = vA.x;
    vec2 sp = p / 1.5; vec2 si = floor(sp); vec2 sf = fract(sp);
    float h1 = hash12(si + 7.7), h2 = hash12(si + 91.3);
    col = vec3(0.335, 0.32, 0.30) * (0.86 + 0.24 * h1);
    col *= h2 > 0.93 ? 1.18 : (h2 < 0.07 ? 0.8 : 1.0);
    col *= 0.78 + 0.42 * grime;
    vec2 jd = min(sf, 1.0 - sf) * 1.5;
    float jm = jointCov(jd, 0.011, g_fw2);
    float jh = smoothstep(0.07, 0.0, min(jd.x, jd.y)) * fine;        // dirt halo of the joints
    float mossy = smoothstep(0.55, 0.75, grime);
    col = mix(col, mix(vec3(0.11, 0.10, 0.09), vec3(0.06, 0.08, 0.03), mossy), jm * 0.8);
    col *= 1.0 - 0.14 * jh;
    // cracked slabs
    float ck = step(0.3, h2) * step(h2, 0.42);
    vec2 cdir = normalize(vec2(h1 - 0.5, h2 - 0.2));
    float cl = abs(dot(sf - 0.5, cdir) + 0.06 * sin(dot(sf, cdir.yx) * 14.0 + h1 * 40.0)) * 1.5;
    float crack = ck * lineCov(cl, 0.005, fw) * fine;
    col *= 1.0 - 0.6 * crack;
    // stains and spills
    float st = smoothstep(0.6, 0.8, vnoise(p * 0.85 + 50.0)) * smoothstep(0.35, 0.6, vnoise(p * 0.21 + 13.0));
    col *= 1.0 - 0.36 * st;
    // drip stains where benches and bins stand along the kerb
    float al = vC.x > 0.5 ? p.x : p.y;
    float sl = al / 7.3; vec2 sh = hash22(vec2(floor(sl), floor(al * 0.011) + 4.0));
    vec2 sd = vec2((fract(sl) - 0.2 - 0.6 * sh.x) * 7.3, (d - 0.8) * 1.4);
    float drip = step(sh.y, 0.55) * exp(-dot(sd, sd) / (0.1 + 0.25 * sh.y)) * (0.55 + 0.9 * (sp1 - 0.5) * fine);
    col *= 1.0 - 0.42 * drip;
    g_gum(p, col);
    // small utility lids
    vec2 lc_ = p / 17.0; vec2 li = floor(lc_); vec2 lh = hash22(li + 9.1);
    vec2 ld = abs((fract(lc_) - 0.25 - 0.5 * lh) * 17.0) - vec2(0.3, 0.22);
    float lid = areaCov(max(ld.x, ld.y), fw) * step(0.6, d) * step(lh.x, 0.6);
    float dia = step(0.5, fract((p.x + p.y) * 12.0)) * step(0.5, fract((p.x - p.y) * 12.0));
    col = mix(col, vec3(0.085, 0.078, 0.07) * (0.8 + 0.4 * dia * fine), lid);
    col *= 1.0 - 0.5 * lineCov(abs(max(ld.x, ld.y)), 0.006, fw) * step(0.6, d) * step(lh.x, 0.6);
    rough = mix(0.9, 0.55, lid); g_metal = lid * 0.5;
    // broom finish / speckle
    float sp2 = vnoise(p * 40.0);
    col *= 1.0 + micro * (sp1 - 0.5) * 0.3 + fine * (sp2 - 0.5) * 0.2;
    g_hgt = fine * sp2 * 0.002;
    // tactile paving (blister studs) around the street corners
    if (vC.x > 0.5 && vC.y > 0.5 && d < 5.0) {
      float tb = areaCov(abs(d - 0.66) - 0.3, fw);
      vec2 tq = fract(p / 0.0667) - 0.5; float tr = length(tq) * 0.0667;
      float stud = areaCov(tr - 0.0125, fw) * fine;
      vec2 tj = (0.5 - abs(fract(p / 0.4) - 0.5)) * 0.4;
      vec3 tc = vec3(0.40, 0.31, 0.15) * (0.7 + 0.35 * grime) * (1.0 + 0.3 * stud + micro * (sp1 - 0.5) * 0.3);
      tc *= 1.0 - 0.5 * jointCov(tj, 0.005, g_fw2);
      col = mix(col, tc, tb); rough = mix(rough, 0.72, tb);
      g_hgt += tb * stud * 0.004 * smoothstep(0.0125, 0.006, tr);
    }
    // granite kerb stones with chipped arrises
    float ka = (p.x + p.y) / 1.2;
    float cb = areaCov(d - 0.17, fw);
    vec3 gran = vec3(0.37, 0.365, 0.36) * (0.78 + 0.3 * vnoise(p * 2.6 + 4.0)) * (1.0 + micro * (sp1 - 0.5) * 0.5) * (0.88 + 0.24 * hash11(floor(ka) + 0.5));
    gran *= 1.0 - 0.55 * lineCov(abs(fract(ka) - 0.5) * 1.2, 0.008, fw);
    gran *= 0.9 + 0.2 * grime;
    float chip = smoothstep(0.58, 0.8, vnoise(vec2(ka * 6.0, 7.0))) * smoothstep(0.05, 0.0, d - 0.01 * sp2) * fine;
    gran = mix(gran, vec3(0.5, 0.49, 0.47), chip * 0.7);
    col = mix(col, gran, cb); rough = mix(rough, 0.7, cb); g_metal *= 1.0 - cb;
    col *= 1.0 - 0.5 * lineCov(abs(d - 0.17), 0.008, fw);
    // dirt gathers along the kerb joint and the building line
    col *= 1.0 - 0.18 * smoothstep(0.9, 0.2, d) * (1.0 - cb);
    dens = 0.012 + 0.16 * smoothstep(0.55, 0.85, grime) * (1.0 - cb);
    low += (h2 - 0.5) * 0.06 + 0.04 * smoothstep(1.2, 0.2, d) - 0.035 - 0.2 * cb;
    lowD = (h1 - 0.5) * 0.1 + 0.06 * jh + 0.06 * crack;
    lowJ = 0.07; jw = max(jm, crack) * fine * (1.0 - cb);
  } else if (type < 1.5) {
    // ---- promenade: large granite pavers with bands of dark setts, coping at the quay edge ----
    float dq = vA.x;
    float zb = abs(fract(p.y / 9.0) - 0.5) * 9.0;
    float band = max(step(zb, 0.36), step(abs(dq - 13.2), 0.36));
    float coping = step(dq, 1.2);
    band *= 1.0 - coping;
    vec2 lf; vec2 dj; vec3 sg; vec3 base; float tilt; float jw; vec2 f2 = g_fw2.yx;
    if (coping > 0.5) { sg = stoneGrid(vec2(p.y, dq), vec2(1.5, 1.2), 0.0, lf, dj); base = vec3(0.40, 0.385, 0.36); tilt = 0.012; jw = 0.008; }
    else if (band > 0.5) { sg = stoneGrid(p, vec2(0.14, 0.14), 1.0, lf, dj); base = vec3(0.115, 0.115, 0.12); tilt = 0.09; jw = 0.008; f2 = g_fw2; }
    else { sg = stoneGrid(p.yx, vec2(0.9, 0.6), 1.0, lf, dj); base = vec3(0.325, 0.305, 0.28); tilt = 0.035; jw = 0.006; }
    float size = band > 0.5 ? 0.14 : 0.6;
    float sfade = 1.0 - smoothstep(0.3 * size, 1.2 * size, fw);
    float h1 = hash12(sg.xy + 3.0), h2 = hash12(sg.xy + 51.0);
    col = base * (0.78 + 0.42 * h1) * mix(vec3(1.0), vec3(1.06, 1.0, 0.92), h2);
    col *= 0.8 + 0.4 * grime;
    // footfall polish along the railing walk and down the middle
    float polish = (exp(-pow((dq - 4.6) / 2.2, 2.0)) + 0.6 * exp(-pow((dq - 19.0) / 5.0, 2.0))) * (0.5 + 0.5 * grime);
    col *= 1.0 + 0.09 * polish;
    // joints: packed sand where people walk, moss towards the quay edge and in quiet corners
    float jc = jointCov(dj, jw, f2);
    float mossy = smoothstep(0.5, 0.75, grime + 0.3 * smoothstep(5.0, 1.0, dq) - 0.35 * polish);
    col = mix(col, mix(vec3(0.13, 0.115, 0.09), vec3(0.045, 0.065, 0.022), mossy), jc * 0.88);
    float edge = smoothstep(0.05, 0.0, sg.z) * sfade;
    col *= 1.0 - 0.17 * edge;
    // chipped corners, cracked flags
    float flag = 1.0 - band;
    col *= 1.0 - 0.45 * step(0.7, h2) * smoothstep(0.1, 0.03, length(dj)) * sfade * flag;
    vec2 cdir = normalize(vec2(h1 - 0.5, h2 * 9.0 - 0.45) + 0.001);
    float cl = abs(dot(lf - 0.5, cdir) + 0.05 * sin(dot(lf, cdir.yx) * 11.0 + h1 * 40.0)) * 0.6;
    float crack = step(h2, 0.1) * lineCov(cl, 0.004, fw) * fine * flag * (1.0 - coping);
    col *= 1.0 - 0.55 * crack;
    // rust weeping from the railing posts onto the coping
    float rs = exp(-pow((fract(p.y / 2.0) - 0.5) * 2.0 / 0.16, 2.0)) * smoothstep(1.25, 0.5, dq) * step(0.45, dq) * (0.4 + 0.6 * grime);
    col = mix(col, col * vec3(0.9, 0.6, 0.38), rs * 0.55);
    g_gum(p, col);
    float sp2 = vnoise(p * 36.0);
    col *= 1.0 + micro * (sp1 - 0.5) * 0.45 + fine * (sp2 - 0.5) * 0.18;
    g_grad += (hash22(sg.xy + 11.0) - 0.5) * tilt * sfade;
    g_hgt = fine * sp2 * 0.0015;
    rough = 0.72 - 0.16 * polish + (1.0 - sfade) * 0.08;
    // slot drain near the edge (two steel lips, a dark slot)
    float dr = lineCov(abs(dq - 2.1), 0.045, fw);
    col = mix(col, vec3(0.16, 0.15, 0.14), dr * 0.9);
    col = mix(col, vec3(0.015), lineCov(abs(dq - 2.1), 0.012, fw) * 0.95);
    g_metal = dr * 0.6; rough = mix(rough, 0.45, dr);
    // leaves under the tree row and blown against the railing
    dens = 0.012 + (0.3 * exp(-pow((dq - 13.2) / 2.6, 2.0)) + 0.3 * smoothstep(2.0, 1.25, dq) * step(1.2, dq)) * smoothstep(0.3, 0.7, grime);
    low = vC.z * 0.4 + (0.5 - h1) * 0.035 * flag * sfade + 0.06 * exp(-pow((dq - 2.7) / 0.7, 2.0)) - 0.25 * coping - 0.1 * dr;
    lowD = 0.04 + (h2 - 0.5) * 0.13 * sfade + 0.06 * edge + 0.06 * crack;
    lowJ = 0.08; jw = max(jc, crack) * sfade * (1.0 - coping);
  } else if (type < 2.5) {
    // ---- granite setts / cobbles: quay roads (0), the station square laid in arcs (1), tram median (2) ----
    vec2 q = p; float style = vB.y; vec2 f2 = g_fw2;
    vec2 sz = vec2(0.17, 0.115);
    float lane = 0.0; float chS = 9.0; float chDir = -1.0;   // worn lanes; signed distance to the centre of a drainage channel
    if (style < 0.5) {
      float uq = abs(p.y - (p.y < uGndRef.x ? uGndRef.y : uGndRef.z));
      lane = exp(-pow((uq - 0.8) / 0.36, 2.0));
      chS = uq - 2.72; chDir = sign(p.y - (p.y < uGndRef.x ? uGndRef.y : uGndRef.z));
    } else if (style < 1.5) {
      q.y += 0.42 * abs(sin(q.x * 1.9635)); sz = vec2(0.115, 0.1);
      lane = 0.8 * exp(-pow((fract((p.x + p.y) / 27.0) - 0.5) * 19.0 / 1.4, 2.0)) + 0.7 * exp(-pow((fract((p.x - p.y) / 33.0) - 0.5) * 23.3 / 1.2, 2.0));
      chS = (fract(p.y / 15.5 + 0.31) - 0.5) * 15.5;
      chS = (0.5 * 15.5 - abs(chS)) * sign(chS);
    } else { q = p.yx; sz = vec2(0.22, 0.15); f2 = g_fw2.yx; }
    float chan = abs(chS);
    float inCh = step(chan, 0.21);
    if (inCh > 0.5) { q = p; sz = vec2(0.27, 0.14); f2 = g_fw2; }      // channel: three courses laid lengthwise, dished
    q.x += 0.45 * sz.x * (vnoise(vec2(q.x * 1.7, floor(q.y / sz.y) * 7.7)) - 0.5);     // hand-cut stones: uneven lengths
    vec2 lf; vec2 dj; vec3 sg = stoneGrid(q, sz, 1.0, lf, dj);
    float h1 = hash12(sg.xy + 3.0), h2 = hash12(sg.xy + 71.0);
    float sp2 = vnoise(p * 43.0 + sg.xy * 7.3);                     // cleft granite faces, ragged arrises
    dj = max(dj + (sp2 - 0.5) * 0.012 - 0.006 * h1, 0.0); sg.z = min(dj.x, dj.y);
    col = mix(vec3(0.15, 0.147, 0.145), vec3(0.265, 0.245, 0.22), h1);
    col = mix(col, vec3(0.21, 0.155, 0.125), step(0.8, h2) * 0.65);
    col = mix(col, vec3(0.31, 0.30, 0.28), step(h2, 0.05));
    if (style > 1.5) col *= 0.82;
    col *= (0.76 + 0.46 * grime) * (1.0 - 0.18 * inCh);
    float sfade = 1.0 - smoothstep(0.04, 0.15, fw);
    float crown = smoothstep(0.0, 0.035, sg.z);
    float wearm = lane * (0.45 + 0.55 * grime);
    col *= 1.0 + 0.2 * wearm * mix(1.0, crown, sfade);
    // joints: dirt and packed sand, moss where nobody walks
    float jc = jointCov(dj, 0.011, f2);
    float mossy = smoothstep(0.5, 0.72, grime - 0.4 * lane + 0.2 * inCh);
    vec3 jcol = mix(vec3(0.08, 0.07, 0.057), vec3(0.16, 0.14, 0.11), smoothstep(0.5, 0.25, grime));
    col = mix(col, mix(jcol, vec3(0.04, 0.058, 0.02), mossy), jc * 0.92);
    col *= 1.0 - 0.22 * (1.0 - crown) * sfade;
    vec2 c = lf - 0.5;
    vec2 gl = (-0.8 * c * c * c / sz + (hash22(sg.xy + 11.0) - 0.5) * 0.13) * sfade;
    g_grad += (style > 1.5 && inCh < 0.5) ? gl.yx : gl;
    g_grad.y += clamp(chS / 0.21, -1.0, 1.0) * 0.07 * inCh * chDir;
    col *= 1.0 + micro * (sp1 - 0.5) * 0.4 + fine * (sp2 - 0.5) * 0.3 * crown;
    g_hgt = fine * sp2 * 0.0035 * crown;
    rough = mix(0.7 - 0.3 * h2 * h2 * sfade - 0.2 * wearm, 0.92, jc) + (1.0 - sfade) * 0.06;
    // repairs filled with asphalt, inset cast iron covers
    vec2 pc = p / vec2(13.0, 11.0) + 0.21; vec3 ph = hash32(floor(pc) + 29.0);
    vec2 pa = abs(fract(pc) - 0.5 - (ph.yx - 0.5) * 0.4) * vec2(13.0, 11.0);
    float pD = max(pa.x - 0.3 - 1.2 * ph.x, pa.y - 0.3 - 0.8 * ph.y);
    float isP = step(ph.z, 0.2) * (1.0 - inCh);
    float pm = isP * areaCov(pD, fw);
    col = mix(col, vec3(0.075, 0.073, 0.07) * (0.8 + 0.5 * sp1 * micro + 0.25 * (1.0 - micro)), pm); g_hgt *= 1.0 - pm;
    col = mix(col, vec3(0.02), isP * lineCov(abs(pD), 0.02, fw) * 0.85);
    rough = mix(rough, 0.86, pm); g_grad *= 1.0 - pm;
    float cD = max(pa.x, pa.y) - 0.31;
    float isC = step(0.2, ph.z) * step(ph.z, 0.5) * (1.0 - inCh);
    float cm = isC * areaCov(cD, fw);
    float cpat = step(0.5, fract(p.x * 11.0)) * step(0.5, fract(p.y * 11.0));
    vec3 iron = vec3(0.075, 0.066, 0.058) * (0.75 + 0.5 * cpat * fine) * (1.0 - 0.6 * lineCov(abs(cD + 0.045), 0.008, fw));
    col = mix(col, iron, cm); rough = mix(rough, 0.5, cm); g_metal = cm * 0.55; g_grad *= 1.0 - cm;
    // gully grates in the channel
    float gx = (fract(p.x / 13.0 + 0.4) - 0.5) * 13.0;
    float gm = areaCov(max(abs(gx) - 0.2, chan - 0.19), fw);
    col = mix(col, mix(vec3(0.012), vec3(0.07, 0.065, 0.06), mix(0.5, step(0.45, fract(gx * 16.0)), fine)), gm);
    rough = mix(rough, 0.55, gm); g_metal = max(g_metal, gm * 0.55);
    float solid = max(max(pm, cm), gm);
    dens = (0.012 + 0.25 * smoothstep(0.5, 0.8, grime) * (1.0 - lane) + 0.3 * smoothstep(0.3, 0.0, chan)) * (1.0 - gm);
    low += (0.5 - h1) * 0.03 * sfade * (1.0 - solid) + 0.1 * smoothstep(0.25, 0.0, chan) + 0.03 * lane + 0.03 * pm - 0.3 * gm - 0.01;
    lowD = (h2 - 0.5) * 0.18 * sfade * (1.0 - solid);
    lowJ = 0.1; jw = 0.6 * (1.0 - crown) * sfade * (1.0 - solid);
  } else if (type < 3.5) {
    // ---- plaza: radial banded limestone + dark granite ----
    vec2 dp = p - uPlazaC; float r = length(dp); float th = atan(dp.y, dp.x);
    float ringW = 3.6; float rr = r / ringW; float ri = floor(rr); float rf = fract(rr);
    float course = floor(rf * 3.0); float cf = fract(rf * 3.0);
    float n = max(6.0, floor(6.2832 * (ri + 0.5) * ringW / 1.25));
    float a = th / 6.2832 * n + 0.5 * mod(course, 2.0) + 0.19 * ri; float ai = floor(a); float af = fract(a);
    float jr = min(cf, 1.0 - cf) * 1.2; float ja = min(af, 1.0 - af) * (6.2832 * r / n);
    float sector = floor(th / 6.2832 * 16.0 + 0.5);
    float spoke = abs(fract(th / 6.2832 * 16.0) - 0.5) * (6.2832 * r / 16.0);       // distance to the spoke centre line
    float dark = max(step(rf, 0.19), step(spoke, 0.36) * step(7.0, r));
    float alt = mod(ri + sector, 2.0);
    vec2 sid = vec2(ai + course * 37.0, ri);
    float h1 = hash12(sid + 3.0), h2 = hash12(sid + 61.0);
    vec3 lime = mix(vec3(0.50, 0.455, 0.38), vec3(0.34, 0.325, 0.30), alt) * (0.84 + 0.28 * h1) * mix(vec3(1.0), vec3(1.05, 1.0, 0.93), h2);
    vec3 gran = vec3(0.075, 0.075, 0.082) * (0.8 + 0.4 * h1);
    col = mix(lime, gran, dark);
    col *= 0.82 + 0.36 * grime;
    float jc = max(lineCov(jr, 0.005, fw), lineCov(ja, 0.005, fw));
    float jn = min(jr, ja);
    float sfade = 1.0 - smoothstep(0.3, 1.2, fw);
    float edge = smoothstep(0.05, 0.0, jn) * sfade;
    col = mix(col, mix(vec3(0.12, 0.105, 0.085), vec3(0.05, 0.065, 0.025), smoothstep(0.55, 0.75, grime)), jc * 0.8);
    col *= 1.0 - 0.15 * edge;
    float st = smoothstep(0.62, 0.8, vnoise(p * 0.85 + 50.0)) * smoothstep(0.3, 0.6, grime);
    col *= 1.0 - 0.3 * st;
    g_gum(p, col);
    float sp2 = vnoise(p * 30.0);
    col *= 1.0 + micro * (sp1 - 0.5) * 0.35 + fine * (sp2 - 0.5) * 0.14;
    g_grad += (hash22(sid * vec2(1.0, 3.0) + 11.0) - 0.5) * 0.025 * sfade;
    g_hgt = fine * sp2 * 0.001;
    rough = mix(0.62, 0.5, dark);
    dens = 0.012 + 0.22 * smoothstep(0.55, 0.8, grime);
    low += (0.5 - h1) * 0.035 * sfade - 0.01;
    lowD = (h2 - 0.5) * 0.13 * sfade + 0.06 * edge;
    lowJ = 0.08; jw = jc * sfade;
  } else {
    // ---- kerb face (vertical granite) ----
    float along = vA.x; float hy = vA.y;
    float ka = along / 1.2;
    col = vec3(0.34, 0.335, 0.33) * (0.75 + 0.3 * vnoise(vec2(along * 2.6, hy * 2.0) + 4.0)) * (0.88 + 0.24 * hash11(floor(ka) + 0.5));
    col *= 1.0 - 0.5 * lineCov(abs(fract(ka) - 0.5) * 1.2, 0.008, fw);
    col *= mix(0.55, 1.0, smoothstep(0.0, 0.8, hy));          // grime at the gutter line
    col *= 1.0 - 0.45 * smoothstep(0.55, 0.8, vnoise(vec2(along * 0.7, 3.0)));   // tyre scuffs
    float chip = smoothstep(0.58, 0.8, vnoise(vec2(ka * 6.0, 7.0))) * smoothstep(0.62, 0.95, hy) * fine;
    col = mix(col, vec3(0.5, 0.49, 0.47), chip * 0.6);
    col *= mix(1.0, 0.72, smoothstep(0.8, 0.1, hy) * uGroundWet);      // splash zone stays damp
    rough = 0.75; porous = 0.0; low = -1.0; lowD = -1.0;
  }
  if (type < 3.5) {
    vec3 lc; float lf = g_leaf(p, dens, lc) * clamp(1.0 - g_metal * 2.0, 0.0, 1.0);
    col = mix(col, lc, lf); rough = mix(rough, 0.85, lf);
  }
  g_wet(p, low, low + lowD);
  g_jointWater(low + lowJ, jw);
  g_alb = col; g_rough = rough; g_applyWet(porous);
}
`;

// ---------------------------------------------------------------------------------------------------
const SOFT = /* glsl */`
${PARK_PATH_GLSL}
void shadeSoft(vec2 p) {
  float type = vB.x; float fw = g_fw;
  float micro = 1.0 - smoothstep(0.004, 0.02, fw);
  float fine = 1.0 - smoothstep(0.02, 0.1, fw);
  float meso = 1.0 - smoothstep(0.1, 0.8, fw);
  vec3 col; float rough = 0.95;
  float n1 = vnoise(p * 0.13 + 5.0), n2 = vnoise(p * 1.1 + 9.0), n3 = vnoise(p * 9.0), n4 = hash12(floor(p * 90.0));
  float pathM = 0.0; float edge = 0.0;
  if (type < 0.5) {
    if (vB.y > 0.5) {
      float pd = vB.y > 1.5 ? min(max(abs(vA.x) - 1.2, abs(vA.y) - vA.w), max(abs(vA.y) - 1.2, abs(vA.x) - vA.z)) : parkPathDist(vA.xy, vA.zw);
      // paved rim along the block edge
      float rim = min(vA.z - abs(vA.x), vA.w - abs(vA.y)) - 0.5;
      pd = min(pd, rim);
      pathM = areaCov(pd, fw);
      edge = lineCov(abs(pd), 0.07, fw);
    }
  } else if (type < 1.5) pathM = 1.0;
  if (type < 1.5) {
    // late-summer lawn
    vec3 g = mix(vec3(0.040, 0.070, 0.018), vec3(0.085, 0.115, 0.030), n1);
    g = mix(g, vec3(0.135, 0.125, 0.05), smoothstep(0.5, 0.9, n2) * 0.45 * smoothstep(0.3, 0.7, vnoise(p * 0.3 + 2.0)));
    g *= 0.82 + 0.3 * n3 * meso + (n4 - 0.5) * 0.5 * micro;
    // mowing stripes
    g *= 0.95 + 0.07 * step(0.5, fract(p.x / 3.2));
    // gravel
    vec3 gv = vec3(0.34, 0.295, 0.225) * (0.8 + 0.3 * n1) * (0.9 + 0.2 * n2);
    gv *= 1.0 + (n4 - 0.5) * 0.7 * micro + (n3 - 0.5) * 0.3 * fine;
    col = mix(g, gv, pathM);
    col = mix(col, vec3(0.3, 0.29, 0.27), edge * 0.8);
    rough = mix(0.95, 0.9, pathM);
    g_hgt = (n3 * 0.02 * meso + n4 * 0.01 * micro) * (1.0 - pathM) + n4 * 0.004 * micro * pathM;
    // leaves on the lawn and the paths
    vec3 lc; float lf = g_leaf(p, 0.03 + 0.25 * smoothstep(0.45, 0.8, n1 * 0.6 + n2 * 0.4), lc);
    col = mix(col, lc, lf * 0.9);
    g_wet(p, -0.01, 0.04 + (n2 - 0.5) * 0.1);
    g_damp *= pathM; g_pud *= pathM;
  } else {
    // outskirts: dry dirt, gravel and weeds
    vec3 dirt = mix(vec3(0.17, 0.145, 0.115), vec3(0.24, 0.215, 0.17), n1);
    vec3 weed = mix(vec3(0.07, 0.085, 0.03), vec3(0.13, 0.12, 0.05), n2);
    float wm = smoothstep(0.45, 0.65, vnoise(p * 0.05 + 3.0) * 0.6 + n2 * 0.4);
    col = mix(dirt, weed, wm);
    col *= 0.85 + 0.3 * n3 * meso + (n4 - 0.5) * 0.4 * micro;
    g_hgt = n3 * 0.015 * meso;
    g_wet(p, 0.0, 0.03);
    g_pud *= 1.0 - wm;
  }
  g_alb = col; g_rough = rough; g_applyWet(1.0);
}
`;

export function buildGround(ctx, plan) {
  const { makeMaterial, GROUND_Y, layout } = ctx;
  const group = new THREE.Group(); group.name = 'ground';
  initWet(ctx);
  const rail = makeRailLookup(layout);
  const hooks = (body, fn, uniforms = {}, defines = undefined) => ({
    key: 'streets-ground-' + fn, uniforms: { ...WET, ...uniforms }, defines,
    vertexPars: VERT_PARS, vertex: VERT,
    fragPars: COMMON + body, color: COLOR_MAIN(fn), surface: SURFACE, normal: NORMAL, emissive: EMISSIVE, ao: AO,
  });
  const qN = plan.sts.find(s => s.quay === 'N'), qS = plan.sts.find(s => s.quay === 'S');
  const cMid = (layout.canal.z0 + layout.canal.z1) / 2;
  const mats = {
    A: makeMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }, hooks(ASPHALT, 'shadeAsphalt')),
    P: makeMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 }, hooks(PAVED, 'shadePaved', {
      uPlazaC: { value: new THREE.Vector2(layout.lantern.x, layout.lantern.z) },
      uGndRef: { value: new THREE.Vector3(cMid, qN ? qN.cz : cMid - 18, qS ? qS.cz : cMid + 18) },
      uRailTex: { value: rail.tex }, uRailRef: { value: rail.ref },
    }, { GND_PROM: 1 })),
    S: makeMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 }, hooks(SOFT, 'shadeSoft')),
  };
  const syncWet = wetSync(ctx);
  const sync = () => { syncWet(); if (ctx.modules && ctx.modules.harbor) rail.fill(ctx.modules.harbor.group); };
  let tris = 0;
  for (const k of ['A', 'P', 'S']) {
    const b = plan.bufs[k];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    g.setAttribute('aA', new THREE.Float32BufferAttribute(b.a, 4));
    g.setAttribute('aB', new THREE.Float32BufferAttribute(b.b, 4));
    g.setAttribute('aC', new THREE.Float32BufferAttribute(b.c, 4));
    g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats[k]);
    m.receiveShadow = true; m.castShadow = false; m.name = 'ground_' + k; m.matrixAutoUpdate = false;
    m.onBeforeRender = sync;
    group.add(m); tris += b.idx.length / 3;
  }
  group.userData.wet = WET.uGroundWet; group.userData.setWetness = setGroundWetness;
  return { group, tris };
}
