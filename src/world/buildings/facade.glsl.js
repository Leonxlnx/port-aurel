// Facade shader for the merged building mesh (hooks for engine/materials.js makeMaterial).
// Wall space: u along the wall (metres, to the right when seen from outside), v = height above the street.
// Tangent space used everywhere below: x along u, y up, z out of the wall.

export const VERT_PARS = /* glsl */`
attribute vec4 aFUv;      // u, v, opposite building height, distance to it
attribute vec4 aFWall;    // wall width, bay count, margin, kind
attribute vec4 aFTier;    // tier base v, tier deck v, wall seed (int), building index
uniform highp sampler2D uBldTex;
varying vec4 vFUv; varying vec4 vFWall; varying vec4 vFTier;
varying vec4 vP0; varying vec4 vP1; varying vec4 vP2; varying vec4 vP3; varying vec4 vP4; varying vec4 vP5; varying vec4 vP6; varying vec4 vP7;
`;

export const VERT_MAIN = /* glsl */`
vFUv = aFUv; vFWall = aFWall; vFTier = aFTier;
{ int bI_ = int(aFTier.w + 0.5);
  vP0 = texelFetch(uBldTex, ivec2(0, bI_), 0); vP1 = texelFetch(uBldTex, ivec2(1, bI_), 0);
  vP2 = texelFetch(uBldTex, ivec2(2, bI_), 0); vP3 = texelFetch(uBldTex, ivec2(3, bI_), 0);
  vP4 = texelFetch(uBldTex, ivec2(4, bI_), 0); vP5 = texelFetch(uBldTex, ivec2(5, bI_), 0);
  vP6 = texelFetch(uBldTex, ivec2(6, bI_), 0); vP7 = texelFetch(uBldTex, ivec2(7, bI_), 0); }
`;

export const FRAG_PARS = /* glsl */`
uniform sampler2D uNoiseTex;
uniform sampler2D uSignTex;
varying vec4 vFUv; varying vec4 vFWall; varying vec4 vFTier;
varying vec4 vP0; varying vec4 vP1; varying vec4 vP2; varying vec4 vP3; varying vec4 vP4; varying vec4 vP5; varying vec4 vP6; varying vec4 vP7;

vec3 F_alb; vec3 F_nW; vec3 F_emis; vec3 F_refl; vec3 F_inSun;
float F_rough; float F_metal; float F_sunVis; float F_ao; float F_glass; float F_specBoost; float F_glint;

const vec3 SHOPC[8] = vec3[8](
  vec3(0.020, 0.060, 0.040), vec3(0.130, 0.020, 0.020), vec3(0.015, 0.030, 0.090), vec3(0.550, 0.500, 0.380),
  vec3(0.012, 0.012, 0.014), vec3(0.420, 0.270, 0.050), vec3(0.050, 0.150, 0.170), vec3(0.300, 0.080, 0.040));
const vec3 AWNC[8] = vec3[8](
  vec3(0.45, 0.05, 0.04), vec3(0.04, 0.16, 0.09), vec3(0.05, 0.09, 0.28), vec3(0.62, 0.42, 0.08),
  vec3(0.55, 0.50, 0.40), vec3(0.30, 0.10, 0.05), vec3(0.08, 0.22, 0.25), vec3(0.50, 0.20, 0.10));

float sq(float x) { return x * x; }
float sat(float x) { return clamp(x, 0.0, 1.0); }
float bitf(float flags, float bit) { return step(0.5, mod(floor(flags / bit), 2.0)); }
vec3 skyL(vec3 d) {
  float az = atan(d.z, d.x); float el = asin(clamp(d.y, -1.0, 1.0));
  float vv = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * PI));
  return textureLod(uSkyLUT, vec2(az / (2.0 * PI) + 0.5, vv), 0.0).rgb;
}
vec4 ntex(vec2 p, float tile, float px) { return textureLod(uNoiseTex, p / tile, log2(max(px * 256.0 / tile, 1.0))); }
// box-filtered coverage of the interval [a,b] by a footprint of width w centred on x
float covLocal(float x, float a, float b, float w) { return clamp((min(x + 0.5 * w, b) - max(x - 0.5 * w, a)) / w, 0.0, 1.0); }
// sun visibility of a point at depth zd inside a recess whose mouth is the rect o = (xa, xb, ya, yb)
float recessSun(vec2 pos, float zd, vec3 L, vec4 o, float soft) {
  if (L.z <= 0.002) return 0.0;
  vec2 s = pos + L.xy * (zd / L.z);
  vec2 dd = min(s - o.xz, o.yw - s);
  return smoothstep(-soft, soft, min(dd.x, dd.y));
}

// ---------------------------------------------------------------------------------------------
// wall materials. style: 0 brick, 1 stone, 2 concrete, 3 stucco, 4 glass-tower panel, 5 deco stone
void wallMat(float style, vec2 p, vec2 pn, float px, vec3 colA, float flags, float rustic,
             out vec3 alb, out float rough, out vec2 bump) {
  vec4 n1 = ntex(pn, 19.0, px);
  vec4 n2 = ntex(pn.yx * 1.31 + 3.7, 2.3, px);
  float aa = px * 0.75 + 0.0008;
  bump = vec2(0.0);
  if (style < 0.5) {
    float painted = bitf(flags, 2.0);
    float darkM = bitf(flags, 32.0);
    const float cH = 0.0775; const float bL = 0.235; const float mw = 0.006;
    float row = floor(p.y / cH);
    float hdr = step(4.5, mod(row, 6.0));
    float lenx = bL / (1.0 + hdr);
    float bx = p.x / lenx + 0.5 * mod(row, 2.0);
    vec2 id = vec2(floor(bx), row);
    vec2 f = vec2(fract(bx), fract(p.y / cH));
    vec2 e = vec2(min(f.x, 1.0 - f.x) * lenx, min(f.y, 1.0 - f.y) * cH);
    float fade = 1.0 - smoothstep(0.016, 0.05, px);
    float m = 1.0 - smoothstep(mw - aa, mw + aa, min(e.x, e.y));
    vec3 hb = hash32(id + 17.0);
    vec3 bc = colA * (0.74 + 0.52 * hb.x);
    bc = mix(bc, bc * vec3(0.52, 0.46, 0.50), step(0.81, hb.y));              // over-burnt
    bc = mix(bc, bc * vec3(1.22, 1.15, 1.02) + 0.015, step(0.92, hb.z));       // pale, under-fired
    bc *= 1.0 - 0.12 * hdr;                                                     // header courses show darker ends
    bc = mix(bc, colA * (0.93 + 0.14 * hb.x), painted);
    // repointed / rebuilt patches: fresh pale mortar, cleaner brick
    vec2 pc = pn / vec2(4.7, 3.3); vec3 ph = hash32(floor(pc) + 5.0); vec2 pf = fract(pc);
    float pm = step(0.80, ph.x) * step(ph.y * 0.5, pf.x) * step(pf.x, 0.5 + ph.y * 0.5) * step(ph.z * 0.4, pf.y) * step(pf.y, 0.6 + ph.z * 0.4) * (1.0 - painted);
    vec3 mc = mix(mix(vec3(0.46, 0.43, 0.38), colA, 0.22), colA * 0.82, painted) * mix(1.0, 0.42, darkM);
    mc = mix(mc, vec3(0.60, 0.58, 0.53), pm * 0.85);
    vec3 avg = mix(colA * 0.925, mc, 0.2);
    alb = mix(avg, mix(bc, mc, m), fade);
    bump = sign(f - 0.5) * (1.0 - smoothstep(0.0, mw * 2.6, e)) * 0.6 * fade;
    rough = mix(0.88, 0.96, m * fade);
    // course rhythm beyond the single brick: firing-batch bands a few courses tall (fading at their Nyquist)
    float brow = floor(p.y / 0.62);
    vec3 hbt = hash32(vec2(brow, floor(p.x / 3.9 + hash11(brow * 1.7) * 7.0)) + 41.0);
    alb *= 1.0 + (hbt.x - 0.5) * 0.27 * (1.0 - smoothstep(0.2, 0.6, px)) * (1.0 - 0.6 * painted);
    alb *= 0.86 + 0.28 * n2.r;
    alb *= 0.82 + 0.36 * n1.r;
    alb = alb * mix(vec3(1.0), vec3(1.14, 1.07, 1.02), pm * 0.6) + 0.006 * pm;
    float eff = smoothstep(0.60, 0.82, n1.b) * smoothstep(0.35, 0.65, n2.g) * (1.0 - painted);     // efflorescence
    alb = mix(alb, vec3(0.58, 0.56, 0.52), eff * 0.30);
  } else if (style < 1.5 || style > 4.5) {
    float cH = mix(0.46, 0.62, rustic);
    float bL = cH * mix(2.7, 2.1, rustic);
    float row = floor(p.y / cH);
    float bx = p.x / bL + hash11(row * 1.37 + 5.0) + 0.5 * mod(row, 2.0);
    vec2 id = vec2(floor(bx), row);
    vec2 f = vec2(fract(bx), fract(p.y / cH));
    vec2 e = vec2(min(f.x, 1.0 - f.x) * bL, min(f.y, 1.0 - f.y) * cH);
    float jw = mix(0.005, 0.028, rustic);
    float fade = 1.0 - smoothstep(jw * 5.0, jw * 18.0, px);
    float m = 1.0 - smoothstep(jw - aa, jw + aa, min(e.x, e.y));
    vec3 hb = hash32(id + 3.0);
    vec3 sc = colA * (0.87 + 0.26 * hb.x) * mix(vec3(1.0), vec3(1.06, 1.0, 0.92), hb.y);
    sc = mix(sc, sc * 1.15 + 0.012, step(0.94, hb.z));                          // replaced blocks
    alb = mix(colA, mix(sc, sc * mix(0.5, 0.36, rustic), m), fade);
    bump = sign(f - 0.5) * (1.0 - smoothstep(0.0, jw * 2.2 + 0.004, e)) * mix(0.4, 1.1, rustic) * fade;
    alb *= 0.72 + 0.56 * n1.g;
    alb *= 0.90 + 0.20 * n2.g;
    rough = 0.84;
  } else if (style < 2.5 || style > 3.5) {
    float isPanel = step(3.5, style);
    float fy = fract(p.y / 0.32);
    float board = floor(p.y / 0.32);
    float fade = (1.0 - smoothstep(0.03, 0.12, px)) * (1.0 - isPanel);
    float tone = 0.94 + 0.12 * hash11(board * 1.7 + floor(p.x / 2.9) * 7.3);
    float ln = 1.0 - smoothstep(0.004 - aa, 0.004 + aa, min(fy, 1.0 - fy) * 0.32);
    alb = colA * mix(1.0, tone * (1.0 - 0.22 * ln), fade);
    vec2 th = (fract(p / vec2(0.62, 0.64)) - 0.5) * vec2(0.62, 0.64);
    float hole = 1.0 - smoothstep(0.016, 0.028, length(th));
    alb *= 1.0 - 0.5 * hole * (1.0 - smoothstep(0.008, 0.03, px)) * (1.0 - isPanel);
    alb *= mix(0.74 + 0.52 * n1.r, 0.94 + 0.12 * n1.r, isPanel);
    alb *= 0.95 + 0.1 * n2.b;
    rough = mix(0.88, 0.5, isPanel);
  } else {
    alb = colA * (0.70 + 0.60 * n1.r);
    vec2 pc = pn / vec2(5.3, 3.7) + n2.gb * 0.03; vec3 ph = hash32(floor(pc) + 11.0); vec2 pf = fract(pc);
    float pm = step(0.62, ph.x) * step(ph.y * 0.45, pf.x) * step(pf.x, 0.55 + ph.y * 0.45) * step(ph.z * 0.4, pf.y) * step(pf.y, 0.5 + ph.z * 0.5);
    alb *= mix(vec3(1.0), mix(vec3(0.78, 0.80, 0.83), vec3(1.17, 1.12, 1.03), ph.z), pm * 0.85);    // re-rendered patches
    float pt = smoothstep(0.66, 0.69, n1.g);
    alb = mix(alb, (alb * 1.12 + 0.03) * vec3(1.0, 0.99, 0.95), pt * 0.6);
    float cr = (1.0 - smoothstep(0.0, 0.0025 + px * 0.04, abs(n1.b - n1.a))) * smoothstep(0.5, 0.62, n1.r) * (1.0 - smoothstep(0.012, 0.06, px));
    alb *= 1.0 - 0.6 * cr;
    alb *= 0.94 + 0.12 * n2.r;
    bump = (n2.ga - 0.5) * 0.35 * (1.0 - smoothstep(0.008, 0.04, px));
    rough = 0.93;
  }
}

// ---------------------------------------------------------------------------------------------
// roofs, trim, awnings, metal
void miscKinds(float kind, vec2 uv, float px, vec3 N, vec3 colA, vec3 colB, vec3 colC, float wseed, float flags) {
  vec4 n1 = ntex(uv + wseed * 1.7, 19.0, px);
  vec4 n2 = ntex(uv.yx * 1.13 + 5.0, 2.7, px);
  if (kind < 2.5) {                       // flat roof deck, uv = world xz
    float hsel = hash11(wseed * 0.37 + 2.0);
    vec3 c = mix(vec3(0.07, 0.07, 0.075), vec3(0.20, 0.19, 0.17), step(0.45, hsel));
    c = mix(c, vec3(0.33, 0.32, 0.30), step(0.86, hsel));
    c *= 0.72 + 0.56 * n1.r; c *= 0.88 + 0.24 * n2.g;
    c *= 1.0 - 0.4 * smoothstep(0.55, 0.75, n1.b);
    vec2 sm = abs(fract(uv / vec2(1.3, 9.0)) - 0.5);
    c *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 0.02 + px, min(sm.x * 1.3, sm.y * 9.0))) * (1.0 - smoothstep(0.03, 0.2, px));
    F_alb = c; F_rough = 0.92;
  } else if (kind < 3.5) {                // stone / plaster trim
    vec3 c = colB * (0.84 + 0.32 * n1.g) * (0.93 + 0.14 * n2.r);
    c *= mix(0.6, 1.0, smoothstep(-0.6, 0.3, N.y));
    vec4 n3 = ntex(vec2(uv.x * 5.0 + wseed, uv.y * 0.7), 19.0, px * 5.0);
    c *= 1.0 - 0.42 * smoothstep(0.42, 0.8, n3.r) * (1.0 - abs(N.y));
    c *= 1.0 - 0.22 * smoothstep(0.5, 0.8, n1.b) * step(0.5, N.y);
    vec4 n5 = ntex(vec2(uv.x * 23.0 + wseed, uv.y * 1.6), 19.0, px * 23.0);
    float bird = smoothstep(0.72, 0.78, n5.r) * smoothstep(0.42, 0.6, n1.a) * (1.0 - smoothstep(0.02, 0.08, px));
    c = mix(c, vec3(0.66, 0.66, 0.62), bird * 0.55 * (1.0 - 0.6 * abs(N.y)) * (1.0 - bitf(flags, 4.0)));
    F_alb = c; F_rough = 0.86;
    if (bitf(flags, 4.0) > 0.5) {         // Lantern Tower flood lighting on the piers
      float fl0 = max(uv.y - vFTier.x, 0.0);
      F_emis = c * vec3(1.0, 0.66, 0.34) * (uNight * (0.10 + 1.15 / (1.0 + sq(fl0 / 10.0))));
    }
  } else if (kind < 4.5) {                // pitched roof: u along the eaves, v up the slope
    float sel = fract(vP0.x * 7.31);
    float row = floor(uv.y / 0.30);
    float tx = uv.x / 0.24 + 0.5 * mod(row, 2.0);
    vec2 id = vec2(floor(tx), row); vec2 f = vec2(fract(tx), fract(uv.y / 0.30));
    vec3 base = sel < 0.45 ? vec3(0.40, 0.165, 0.095) : (sel < 0.80 ? vec3(0.085, 0.095, 0.115) : vec3(0.20, 0.155, 0.125));
    float fade = 1.0 - smoothstep(0.04, 0.16, px);
    vec3 hv = hash32(id + 9.0);
    vec3 c = base * mix(1.0, 0.72 + 0.56 * hv.x, fade);
    c = mix(c, c * vec3(0.7, 0.75, 0.8), step(0.9, hv.y) * fade);
    c *= 1.0 - 0.4 * fade * smoothstep(0.72, 1.0, f.y);
    c *= 1.0 - 0.25 * fade * (1.0 - smoothstep(0.0, 0.03, min(f.x, 1.0 - f.x) * 0.24));
    c *= 0.78 + 0.44 * n1.r;
    c = mix(c, vec3(0.085, 0.095, 0.06), smoothstep(0.58, 0.8, n1.b) * 0.45);
    vec4 n3 = ntex(vec2(uv.x * 4.0 + wseed, uv.y * 0.5), 19.0, px * 4.0);
    c *= 1.0 - 0.25 * smoothstep(0.5, 0.8, n3.g);
    F_alb = c; F_rough = sel >= 0.45 && sel < 0.8 ? 0.5 : 0.86;
    F_nW = normalize(N + vec3(0.0, 0.0, 0.0));
  } else if (kind < 5.5) {                // awning canvas
    vec3 h = hash32(vec2(wseed, 3.0));
    vec3 c1 = AWNC[int(h.x * 7.99)];
    vec3 c2 = h.y < 0.62 ? vec3(0.80, 0.76, 0.66) : c1 * 0.8;
    float sw = mix(0.16, 0.36, h.z);
    float tri = abs(fract(uv.x / sw) - 0.5) * 2.0;
    float a = clamp(2.0 * px / sw, 0.005, 0.5);
    vec3 c = mix(c1, c2, smoothstep(0.5 - a, 0.5 + a, tri));
    c *= 0.8 + 0.3 * n1.g; c *= 0.92 + 0.16 * n2.r;
    F_alb = c; F_rough = 0.9;
  } else {                                // dark painted metal
    F_alb = vec3(0.028, 0.03, 0.033) * (0.8 + 0.5 * n2.r); F_rough = 0.5;
  }
}

// ---------------------------------------------------------------------------------------------
// NOTE: deliberately written as a flat sequence of shallow blocks (no deep if-nesting): the D3D compiler's
// time grows explosively with nested conditionals of this size.
void facadeMain() {
  vec3 N = normalize(vWNormal);
  float kind = floor(vFWall.w + 0.5);
  vec2 uv = vFUv.xy;
  vec2 pxv = max(fwidth(uv), vec2(1e-4));
  float px = max(pxv.x, pxv.y);
  float style = floor(vP0.y + 0.5);
  float flags = floor(vP5.w + 0.5);
  vec3 colA = vP3.rgb, colB = vP4.rgb, colC = vP5.rgb;
  float wseed = floor(vFTier.z + 0.5);
  vec3 Vw = normalize(vWPos - uCamPos);
  F_nW = N; F_emis = vec3(0.0); F_sunVis = 1.0; F_ao = 1.0; F_glass = 0.0; F_refl = vec3(0.0); F_inSun = vec3(0.0);
  F_metal = 0.0; F_specBoost = 1.0; F_rough = 0.9; F_alb = colA; F_glint = 0.0;
  if (kind > 1.5 && kind < 6.5) { miscKinds(kind, uv, px, N, colA, colB, colC, wseed, flags); return; }

  vec3 T = vec3(N.z, 0.0, -N.x);
  vec3 Vt = vec3(dot(Vw, T), Vw.y, dot(Vw, N));
  vec3 Lt = vec3(dot(uLightDir, T), uLightDir.y, dot(uLightDir, N));
  float u = uv.x, v = uv.y, W = vFWall.x;
  float gH = vP0.w, fH = vP0.z, y0t = vFTier.x, y1t = vFTier.y;
  vec2 pn = uv + vec2(wseed * 3.17, wseed * 1.31);
  float lantern = bitf(flags, 4.0), warehouse = bitf(flags, 16.0);
  bool isFac = kind < 0.5;
  bool isBrick = style < 0.5, isStone = style > 0.5 && style < 1.5, isConc = style > 1.5 && style < 2.5;
  bool isStucco = style > 2.5 && style < 3.5, isTower = style > 3.5 && style < 4.5, isDeco = style > 4.5;

  // ---------------- layout: bay / floor cell and the opening inside it
  float nb = isFac ? max(1.0, floor(vFWall.y + 0.5)) : 1.0;
  float mg = isFac ? vFWall.z : 0.0;
  float bw = (W - 2.0 * mg) / nb;
  float bi = clamp(floor((u - mg) / bw), 0.0, nb - 1.0);
  float cu = mg + (bi + 0.5) * bw;
  float x = u - cu;
  bool inB = u > mg && u < W - mg;
  bool ground = isFac && v < gH && y0t < 0.5;
  bool upper = isFac && !ground;
  float gt = floor(vP2.w + 0.5), wt = floor(vP1.x + 0.5);
  float ww = vP1.y, wh = vP1.z, sl = vP1.w;
  float fl = ground ? 0.0 : floor((v - gH) / fH);
  float cv = ground ? 0.0 : gH + fl * fH;
  float y = v - cv;
  float cellH = ground ? gH : fH;
  float lowM = min(0.25, sl);
  bool okF = (cv + sl >= y0t + lowM) && (cv + sl + wh <= y1t - 0.4);
  bool okUp = (cv + fH + sl + wh <= y1t - 0.4);
  bool okDn = (fl > 0.5 || y0t > 0.5) && (cv - fH + sl >= y0t + lowM);
  bool topZone = upper && !okF && (cv + sl + wh > y1t - 0.4);
  bool has = isFac && inB && (ground || okF);
  float oxa = -0.5 * ww, oxb = 0.5 * ww, oya = sl, oyb = sl + wh, dep = vP2.x;
  float ar = vP2.y * mix(1.0, okUp ? 0.0 : 1.0, bitf(flags, 1.0));
  float sx = 1.0, sub = 0.0, foldOff = 0.0;
  float roomKind = vP3.w;
  vec2 fdiv = vP7.xy; float fsplit = 0.0, frameW = vP7.w;
  float opaque = 0.0, opaqueTop = 1e3, isDoor = 0.0;
  float unit = 0.0, unitU0 = 0.0, unitW = 1.0, doorX = 0.0;
  float dutyX = ww / bw;
  bool contY = upper && (wt > 2.5 && wt < 3.5 || wt > 4.5);
  bool contX = upper && wt > 3.5;
  bool gShop = ground && gt < 0.5, gLobby = ground && gt > 0.5 && gt < 1.5, gRes = ground && gt > 1.5 && gt < 2.5, gWare = ground && gt > 2.5;

  if (upper && wt > 0.5 && wt < 1.5) {          // paired windows: fold the bay about its centre
    foldOff = 0.5 * ww + 0.17; sub = step(0.0, x); sx = sub * 2.0 - 1.0; x = abs(x) - foldOff; dutyX = 2.0 * ww / bw;
  }
  if (contX || contY) ar = 0.0;
  if (contX) { oxa = bi < 0.5 ? -0.5 * bw : -50.0; oxb = bi > nb - 1.5 ? 0.5 * bw : 50.0; dutyX = 1.0; }
  if (ground) { roomKind = 2.0; ar = 0.0; }
  if (gShop) {
    float span = 1.0 + bitf(flags, 256.0);
    unit = floor(bi / span);
    float ub0 = unit * span, un = min(span, nb - ub0);
    unitU0 = mg + ub0 * bw; unitW = un * bw;
    vec3 hu = hash32(vec2(unit, wseed) + 3.3);
    isDoor = step(abs(bi - (ub0 + floor(hu.x * un))), 0.5);
    oxa = -0.5 * bw + 0.27; oxb = 0.5 * bw - 0.27; oya = 0.05; oyb = gH - 1.3; dep = mix(0.24, 0.9, isDoor);
    doorX = (floor(hu.y * 3.0) - 1.0) * (0.5 * bw - 0.89);
    fdiv = vec2(isDoor > 0.5 ? 1.0 : max(1.0, floor((oxb - oxa) / 1.9 + 0.5)), 2.0); fsplit = 0.74; frameW = 0.03;
  }
  if (gLobby) {
    roomKind = 3.0;
    oxa = -0.5 * bw + 0.42; oxb = 0.5 * bw - 0.42; oya = 0.12; oyb = gH - 1.0; dep = 0.4;
    ar = lantern * 0.8; fdiv = vec2(2.0, 2.0); fsplit = 0.7; frameW = 0.035;
  }
  if (gRes) {                                   // residential ground floor: windows and one door
    roomKind = vP3.w;
    isDoor = step(abs(bi - floor(hash11(wseed * 1.7 + 0.31) * nb)), 0.5);
    float hwd = isDoor > 0.5 ? 0.62 : 0.5 * min(ww, 1.45);
    oxa = -hwd; oxb = hwd;
    oya = isDoor > 0.5 ? 0.02 : 1.3; oyb = isDoor > 0.5 ? min(2.8, gH - 0.5) : min(1.3 + wh, gH - 0.55);
    opaque = isDoor; opaqueTop = oyb - 0.5; dep = mix(dep, 0.32, isDoor);
    fdiv = mix(fdiv, vec2(1.0), isDoor);
  }
  if (gWare) {                                  // warehouse: cart doors and small barred windows
    isDoor = step(hash12(vec2(bi, wseed) + 9.1), 0.45);
    float hwd = isDoor > 0.5 ? min(0.5 * bw - 0.45, 1.75) : 0.55;
    oxa = -hwd; oxb = hwd; oya = isDoor > 0.5 ? 0.0 : max(1.7, gH - 2.4); oyb = gH - mix(0.9, 0.75, isDoor);
    ar = mix(0.18, 0.45, isDoor); opaque = isDoor; dep = mix(dep, 0.28, isDoor);
    fdiv = mix(vec2(2.0, 2.0), fdiv, isDoor); roomKind = 0.0;
  }
  if (upper && warehouse > 0.5 && wt < 0.5 && nb > 2.5 && abs(bi - floor(nb * 0.5)) < 0.5) {   // hoist doors on every floor
    float hwd = min(0.95, 0.5 * bw - 0.4);
    oxa = -hwd; oxb = hwd; oya = 0.06; oyb = min(2.4, fH - 0.55); opaque = 1.0; isDoor = 1.0;
  }
  if (ground) dutyX = (oxb - oxa) / bw;
  float acHere = (upper && y0t < 0.5 && wt < 0.5 && okF && inB && bitf(flags, 16384.0) > 0.5
                  && mod(bi * 7.0 + fl * 13.0 + wseed + 0.5, 23.0) < 2.0 + floor(mod(wseed + 0.5, 3.0))) ? 1.0 : 0.0;
  float gya = oya, gyb = oyb;
  float dutyY = contY ? 1.0 : (oyb - oya) / cellH;
  if (contY && okDn) oya = -50.0;
  if (contY && okUp) oyb = 50.0;

  float xc = 0.5 * (oxa + oxb), hwid = 0.5 * (oxb - oxa);
  float cov = 0.0;
  if (has) {
    float cx_ = mix(covLocal(x, oxa, oxb, pxv.x), dutyX, smoothstep(0.35, 0.9, pxv.x / bw));
    float cy_ = mix(covLocal(y, oya, oyb, pxv.y), dutyY, smoothstep(0.35, 0.9, pxv.y / cellH));
    float yt_ = oyb - ar * sq(clamp((x - xc) / hwid, -1.0, 1.0));
    cov = cx_ * cy_ * (ar > 0.0 ? sat((yt_ - y) / pxv.y + 0.5) : 1.0);
  }
  bool win = cov > 0.003;

  // ---------------- recess ray (tangent space), per-window random state
  vec2 p = vec2(clamp(x, oxa + 0.004, oxb - 0.004), clamp(y, oya + 0.004, oyb - 0.004));
  p.y = min(p.y, oyb - ar * sq(clamp((p.x - xc) / hwid, -1.0, 1.0)) - 0.004);
  vec3 V = vec3(Vt.x * sx, Vt.y, min(Vt.z, -0.03));
  vec3 L = vec3(Lt.x * sx, Lt.y, Lt.z);
  vec3 iv = 1.0 / max(abs(V), vec3(1e-4));
  float tg = dep * iv.z;
  vec2 q = p + V.xy * tg;
  float ytq = oyb - ar * sq(clamp((q.x - xc) / hwid, -1.0, 1.0));
  float tx = (V.x > 0.0 ? oxb - p.x : p.x - oxa) * iv.x;
  float ty = (V.y > 0.0 ? max(ytq - p.y, 0.0) : p.y - oya) * iv.y;
  float tr = min(tx, ty);
  vec4 orect = vec4(oxa, oxb, oya, ytq);
  float soft = 0.012 + 0.6 * px;
  float dbx = contX ? floor(q.x / bw + 0.5) : 0.0;
  float dfy = contY ? floor(q.y / cellH) : 0.0;
  vec2 qw = q - vec2(dbx * bw, dfy * cellH);
  float bi2 = clamp(bi + dbx, 0.0, nb - 1.0), fl2 = fl + dfy;
  vec3 hw = hash32(vec2(bi2 * 2.0 + sub, fl2 + 40.0) + wseed * 0.618);
  vec3 hc = hash32(vec2(bi2 * 2.0 + sub + 71.0, fl2 + 13.0) + wseed * 0.377);
  vec3 hs = hash32(vec2(unit, wseed) + 1.9);
  bool rRes = roomKind < 0.5, rOff = roomKind > 0.5 && roomKind < 1.5, rShop = roomKind > 1.5 && roomKind < 2.5, rLob = roomKind > 2.5;

  // night lighting of the room behind this window
  float thr = 0.07 + 1.8 * hw.x;
  vec3 lampCol = mix(vec3(1.0, 0.55, 0.23), vec3(1.0, 0.80, 0.56), hw.y * hw.y);
  lampCol = mix(lampCol, vec3(0.80, 0.93, 1.0), step(0.86, hc.y));                                    // cool tubes: kitchens, bathrooms
  lampCol = mix(lampCol, hc.x < 0.5 ? vec3(1.0, 0.30, 0.34) : vec3(0.45, 0.75, 1.0), step(0.97, hw.y)); // the odd coloured room
  float lampI = 1.4 + 6.0 * hw.z * hw.z;
  float stair = (rRes && upper && wt < 1.5 && nb > 2.5 && bitf(flags, 32768.0) > 0.5 && abs(bi2 - floor(mod(wseed * 3.0 + 1.5, nb))) < 0.5) ? 1.0 : 0.0;
  if (rRes && hc.z > 0.93) {                    // a television
    float tt_ = uTime * 4.0 + hw.z * 57.0;
    float fk = mix(hash11(floor(tt_)), hash11(floor(tt_) + 1.0), smoothstep(0.2, 0.8, fract(tt_)));
    lampCol = vec3(0.36, 0.55, 1.0); lampI = 1.2 + 2.2 * fk;
  }
  // stairwell: every landing lit from dusk, bare tubes or a dim warm bulb
  thr = mix(thr, 0.05 + 0.25 * hash11(wseed * 0.917), stair);
  lampCol = mix(lampCol, mix(vec3(0.80, 0.95, 0.78), vec3(1.0, 0.76, 0.48), step(0.5, hash11(wseed * 0.411))), stair);
  lampI = mix(lampI, 2.8, stair);
  if (rOff) {
    thr = 0.04 + (2.0 + 1.6 * sat(v / 150.0)) * mix(hw.x, hash11(fl2 * 1.31 + wseed * 0.77), 0.45);
    lampCol = mix(vec3(0.80, 0.92, 1.0), vec3(1.0, 0.85, 0.64), step(0.62, vP0.x));
    lampI = 4.0 + 2.5 * hw.z;
  }
  if (rShop) {
    thr = 0.02 + 1.25 * hs.x;
    lampCol = mix(vec3(1.0, 0.80, 0.55), vec3(0.88, 0.95, 1.0), step(0.72, hs.y));
    lampI = 5.0 + 4.0 * hs.z;
  }
  if (rLob) { thr = 0.02 + 0.45 * hw.x; lampCol = vec3(1.0, 0.78, 0.50); lampI = 7.0; }
  if (lantern > 0.5) {
    thr = rLob ? thr : 0.04 + 1.25 * mix(hw.x, hash11(bi2 * 3.1 + wseed), 0.6);
    lampCol = vec3(1.0, 0.72, 0.40); lampI = 4.5 + 2.5 * hw.z;
  }
  float lit = smoothstep(thr * vP7.z, thr * vP7.z + 0.06, uNight);

  vec3 wAlb = vec3(0.0), wEm = vec3(0.0), wNt = vec3(0.0, 0.0, 1.0), wRefl = vec3(0.0), wInSun = vec3(0.0), spill = vec3(0.0);
  float wRough = 0.6, wSun = 1.0, wAO = 1.0, wGlass = 0.0, wSpec = 1.0, wMetal = 0.0, sillTop = 0.0;
  vec2 mp = uv; vec3 rvp = vec3(0.0); float wGlint = 0.0;
  bool rev = win && tr < tg;
  bool gls = win && !rev;

  // ---------------- reveal (jamb / sill / lintel), shaded as masonry
  if (rev) {
    vec2 hp = p + V.xy * tr; float zd = -V.z * tr;
    bool jamb = tx < ty;
    wNt = jamb ? vec3(-sign(V.x) * sx, 0.0, 0.0) : vec3(0.0, -sign(V.y), 0.0);
    mp = vec2(cu + sx * (hp.x + foldOff), cv + hp.y) + (jamb ? vec2(zd, 0.0) : vec2(0.0, zd));
    vec4 o2 = orect + (jamb ? (V.x > 0.0 ? vec4(0.0, 1.0, 0.0, 0.0) : vec4(-1.0, 0.0, 0.0, 0.0)) : (V.y > 0.0 ? vec4(0.0, 0.0, 0.0, 1.0) : vec4(0.0, 0.0, -1.0, 0.0)));
    wSun = recessSun(hp, zd, L, o2, soft);
    float zf = zd / dep;
    wAO = mix(1.0, 0.55, zf);
    sillTop = (!jamb && V.y < 0.0) ? 1.0 : 0.0;
    spill = lit * lampCol * lampI * 0.11 * zf * (1.0 - opaque);
    rvp = vec3(hp, zd);
  }

  // ---------------- glass plane: frames, panels, doors
  vec2 g0 = vec2(contX ? -0.5 * bw : oxa, gya);
  vec2 g1 = vec2(contX ? 0.5 * bw : oxb, gyb);
  vec2 gsz = max(g1 - g0, vec2(0.01));
  float inG = (qw.y >= g0.y && qw.y <= g1.y) ? 1.0 : 0.0;
  vec2 tt = (qw - g0) / gsz;
  vec2 seg = gsz / fdiv;
  if (fsplit > 0.0) {
    seg.y = tt.y < fsplit ? gsz.y * fsplit : gsz.y * (1.0 - fsplit);
    tt.y = tt.y < fsplit ? tt.y * 0.5 / fsplit : 0.5 + 0.5 * (tt.y - fsplit) / (1.0 - fsplit);
  }
  vec2 tn = tt * fdiv;
  vec2 dd = abs(tn - floor(tn + 0.5)) * seg;
  float topE = (ar > 0.0 ? ytq : g1.y) - qw.y;
  float eo = min(min(qw.x - g0.x, g1.x - qw.x), min(qw.y - g0.y, topE));
  float fr = clamp((frameW + 0.5 * px - min(dd.x, dd.y)) / px, 0.0, min(1.0, 2.0 * frameW / px));
  fr = max(fr, clamp((1.7 * frameW - eo) / px + 0.5, 0.0, 1.0) * min(1.0, 3.4 * frameW / px + 0.2)) * inG;
  vec3 shopC = SHOPC[int(hash32(vec2(unit, wseed) + 21.0).x * 7.99)];
  float shopRiser = 0.0;
  if (gShop) {
    float dzd = abs(qw.x - doorX);
    float inDoor = isDoor * step(dzd, 0.5);
    float dbar = isDoor * clamp((frameW + 0.5 * px - abs(dzd - 0.5)) / px, 0.0, min(1.0, 2.0 * frameW / px)) * step(qw.y, g0.y + gsz.y * fsplit);
    shopRiser = max((1.0 - inDoor) * step(qw.y, 0.55), inDoor * step(qw.y, 0.26));
    fr = max(fr, dbar) * (1.0 - shopRiser);
  }
  float spGlass = (wt > 4.5 && upper) ? 1.0 : 0.0;      // curtain wall: spandrels are back-painted glass
  float acP = acHere * step(qw.y, gya + 0.45);
  float op = max(max(opaque * step(qw.y, opaqueTop), shopRiser), acP);
  fr *= 1.0 - opaque * step(qw.y, opaqueTop);
  float gl = gls ? (1.0 - op) * max(inG, spGlass) * (1.0 - fr) : 0.0;
  vec3 solidA = colC; float solidR = 0.42, solidM = 0.0;
  if (gls) {
    float nearD = 1.0 - smoothstep(0.012, 0.06, px);
    vec3 span_ = colC * mix(0.92, 0.72 + 0.4 * (0.5 + 0.5 * cos(qw.x * 52.0)), nearD) * mix(1.0, 0.9 + 0.2 * step(0.5, fract(qw.y * 2.2)), nearD);
    float pl = fract(qw.x / 0.15);
    float gap = 1.0 - smoothstep(0.0, 0.012 + px, min(pl, 1.0 - pl) * 0.15);
    vec3 timb = colC * mix(1.0, 0.78 + 0.44 * hash11(floor(qw.x / 0.15) + bi * 13.0 + wseed), nearD) * (1.0 - 0.6 * gap * nearD);
    timb *= 1.0 - 0.12 * nearD * (1.0 - smoothstep(0.07, 0.09, abs(fract(qw.y / 1.25 + 0.3) - 0.5) * 1.25));
    timb *= 1.0 - 0.35 * exp(-max(qw.y, 0.0) / 0.5);
    timb *= 1.0 - 0.7 * nearD * (1.0 - smoothstep(0.008, 0.02 + px, abs(qw.x - xc))) * step(1.6, oxb - oxa);   // double doors meet in the middle
    // stall riser: glazed tiles (checker or plain with grout) or panelled timber
    vec2 tl = qw / 0.15; vec2 tf = abs(fract(tl) - 0.5);
    float tiled = step(0.4, hs.y);
    float grout = smoothstep(0.445, 0.49, max(tf.x, tf.y)) * nearD;
    float chk = mix(mod(floor(tl.x) + floor(tl.y), 2.0), 0.5, 1.0 - nearD) * step(0.55, hs.x);
    vec3 tileC = mix(shopC * 1.15 + 0.012, mix(shopC * 0.6 + 0.16, shopC * 0.4, step(0.8, hs.x)), chk);
    vec3 panC = (shopC * 0.6 + 0.004) * (1.0 - 0.4 * nearD * step(abs(abs(fract(qw.x / 0.8) - 0.5) - 0.36), 0.03)) * (1.0 - 0.3 * nearD * step(abs(qw.y - 0.29), 0.02));
    vec3 ris = mix(panC, mix(tileC, tileC * 0.5 + 0.02, grout), tiled) * (1.0 - 0.4 * exp(-max(qw.y, 0.0) / 0.25));
    float isT = step(0.5, op) * (1.0 - shopRiser);
    solidA = mix(mix(span_, timb, isT), ris, shopRiser);
    solidA = mix(solidA, vec3(0.40, 0.39, 0.36) * (0.75 + 0.4 * hw.x), acP);
    solidR = mix(mix(0.42, 0.72, isT), mix(0.38, 0.16, tiled), shopRiser);
    solidM = (isDeco ? 0.5 : 0.0) * (1.0 - isT) * (1.0 - shopRiser) * (1.0 - fr);
    vec3 fcol = gShop ? mix(vec3(0.02), vP6.rgb, 0.35) : vP6.rgb;
    solidA = mix(solidA, fcol, fr); solidR = mix(solidR, 0.5, fr);
  }

  // ---------------- glass: pane normal, what it mirrors, daylight reaching the room
  bool glassOn = gl > 0.01;
  vec3 gN = vec3(0.0, 0.0, 1.0), Lwin = vec3(0.0), roomCol = vec3(0.5), radFlat = vec3(0.0), sunFlat = vec3(0.0), hp3 = vec3(0.5), curtC = vec3(0.7);
  float cDrape = 0.0, cBlind = 0.0, cSheer = 0.0, cL = 0.0, cR = 0.0, cB = 0.0;
  float fres = 0.0, f0 = vP6.w, towerGlass = isTower ? 1.0 : 0.0;
  float lodI = smoothstep(0.10, 0.30, px);
  if (glassOn) {
    float glassOld = vP2.z * (ground ? 0.3 : 1.0);
    vec2 pcn = fract(tn) - 0.5;
    hp3 = hash32(floor(tn) * 3.0 + vec2(bi2 * 7.0 + sub * 3.0, fl2 * 5.0) + wseed * 0.13);
    float nearF = 1.0 - smoothstep(0.06, 0.35, px);
    vec2 tilt = (hp3.xy - 0.5) * mix(0.008, 0.034, glassOld);
    vec2 wv = vec2(sin(qw.y * 8.0 + hp3.x * 20.0 + qw.x * 3.1), cos(qw.x * 6.3 + hp3.y * 20.0 - qw.y * 2.3)) * (0.014 * glassOld * nearF)
            + pcn * (mix(0.03, 0.008, glassOld) * nearF);
    gN = normalize(vec3(tilt + wv, 1.0));
    gN.x *= sx;
    vec3 nW = normalize(T * gN.x + vec3(0.0, gN.y, 0.0) + N * gN.z);
    vec3 Rr = reflect(Vw, nW);
    vec3 hv = hash32(vec2(bi2 * 3.0 + sub + 5.0, fl2 * 3.0 + 9.0) + wseed * 0.211);
    float openW = ((rRes || (rOff && !isTower)) && !ground && hv.x > 0.93) ? 1.0 : 0.0;     // a sash thrown open: a dark hole
    f0 *= (0.6 + 0.8 * hv.y) * (0.9 + 0.2 * hp3.z) * (1.0 - 0.9 * openW);                   // panes differ in coating / dirt
    fres = f0 + (1.0 - f0) * pow(1.0 - sat(-dot(Vw, nW)), 5.0);
    float rxz = max(length(Rr.xz), 1e-3);
    float tanEl = Rr.y / rxz;
    float facing = max(dot(Rr.xz, N.xz) / rxz, 0.08);
    float oppH = vFUv.z, oppD = vFUv.w;
    float hitY = v + oppD / facing * tanEl;
    float occ = 1.0 - smoothstep(oppH - 2.0, oppH + 2.0, hitY);
    vec3 sky = skyL(normalize(vec3(Rr.x, max(Rr.y, 0.012), Rr.z)));
    float sunOpp = max(dot(-N, uLightDir), 0.0);
    float litOpp = smoothstep(-2.0, 4.0, hitY - (vP4.w - oppD * uLightDir.y / max(length(uLightDir.xz), 0.05)));
    // the street wall opposite, mirrored in near glass: bays, floors, shopfronts, a few lit rooms at night
    float rfl = 1.0 - smoothstep(0.02, 0.12, px);
    vec3 Rs = normalize(mix(reflect(Vw, N), Rr, 0.25));
    float rxs = max(length(Rs.xz), 1e-3), facS = max(dot(Rs.xz, N.xz) / rxs, 0.08);
    float hitU = u + oppD * dot(Rs.xz, T.xz) / (rxs * facS), hitYs = v + oppD * Rs.y / (rxs * facS);
    vec2 fc = vec2(hitU / 3.1 + wseed * 0.37, (hitYs - 4.6) / 3.3);
    float wm = step(abs(fract(fc.x) - 0.5), 0.21) * step(abs(fract(fc.y) - 0.5), 0.29) * step(0.0, fc.y);
    wm = max(wm, 0.75 * step(hitYs, 3.6) * step(abs(fract(fc.x * 0.5) - 0.5), 0.42));
    float oppH_ = hash12(floor(fc) + wseed);
    vec3 oppC = mix(vec3(0.34, 0.20, 0.15), vec3(0.42, 0.38, 0.31), fract(wseed * 0.173));
    wm *= 0.75 + 0.25 * fract(oppH_ * 7.0);
    vec3 cityC = mix(vec3(0.30, 0.27, 0.24), oppC * (1.0 - 0.55 * wm), rfl) * (uAmbient * 0.9 + uLightColor * (sunOpp * litOpp * 0.3))
               + uNight * (vec3(0.05, 0.035, 0.02) + vec3(0.8, 0.55, 0.3) * (rfl * wm * step(0.62, oppH_) * step(0.0, fc.y)));
    vec3 grdC = vec3(0.13, 0.13, 0.14) * (uAmbient + uLightColor * (0.12 * max(uLightDir.y, 0.0))) + uNight * vec3(0.03, 0.02, 0.012);
    vec3 env = mix(mix(sky, cityC, occ), grdC, smoothstep(0.03, -0.1, tanEl));
    wRefl = env * fres * mix(vec3(1.0), colC, towerGlass * 0.75) * (1.0 - openW);
    // low-sun glints: the glass of each window sits at its own slight angle, so the reflected sun sweeps across a facade
    vec2 tw_ = (hv.zx - 0.5) * (0.085 * (1.0 - smoothstep(0.4, 1.2, px)));
    vec3 nGl = normalize(N + T * tw_.x + vec3(0.0, tw_.y, 0.0));
    float sdg = dot(reflect(Vw, nGl), uLightDir);
    wGlint = (smoothstep(0.9978, 0.99985, sdg) + 0.08 * smoothstep(0.990, 0.9990, sdg)) * fres * 7.0 * (1.0 - openW);
    float skyVis = 1.0 - 0.55 * sat((oppH - v) / (oppD * 1.2 + 1.0));
    Lwin = (0.5 * skyL(normalize(N + vec3(0.0, 0.5, 0.0))) + 0.5 * uAmbient) * skyVis;
    roomCol = mix(vec3(0.60, 0.55, 0.47), vec3(0.46, 0.40, 0.35), hw.z);
    roomCol = mix(roomCol, mix(vec3(0.30, 0.38, 0.36), vec3(0.50, 0.30, 0.22), step(0.5, hc.x)), step(0.8, hc.y) * (rRes ? 1.0 : 0.0));
    roomCol = rOff ? vec3(0.55, 0.55, 0.53) : (rShop ? mix(vec3(0.46, 0.42, 0.37), shopC + 0.08, 0.3 * hw.x) : (rLob ? vec3(0.42, 0.30, 0.19) : roomCol));
    // far LOD: the room and its (average) curtains collapse into one flat radiance per window
    float cOk = (1.0 - lantern) * (1.0 - stair);
    cDrape = (rRes && hc.x > 0.28 && hc.x < 0.74) ? cOk : 0.0;
    cBlind = ((rRes && hc.x >= 0.74 && hc.x < 0.9) || (rOff && hc.x > mix(0.62, 0.86, towerGlass))) ? cOk : 0.0;
    cSheer = (rRes && hc.x >= 0.9) ? cOk : 0.0;
    cL = hw.x > 0.78 ? 0.55 : 0.05 + 0.30 * hw.y; cR = hw.x > 0.78 ? 0.55 : 0.05 + 0.30 * hc.y;
    cB = 0.15 + 0.85 * (rOff ? mix(hc.y, hash11(fl2 * 3.7 + wseed), 0.6) : hc.y);
    vec3 ccC = hc.y < 0.25 ? vec3(0.42, 0.17, 0.12) : (hc.y < 0.5 ? vec3(0.22, 0.32, 0.27) : (hc.y < 0.75 ? vec3(0.27, 0.33, 0.47) : vec3(0.66, 0.50, 0.22)));
    curtC = rOff ? vec3(0.70, 0.70, 0.68) : (hc.z > 0.82 ? ccC : mix(vec3(0.40, 0.36, 0.31), vec3(0.82, 0.80, 0.76), fract(hc.z * 7.3)));
    vec2 cn0 = clamp(tt, 0.0, 1.0); vec2 cw0 = clamp(vec2(px) / gsz, 0.002, 1.0);
    float cmF = max(cDrape * max(1.0 - smoothstep(cL - cw0.x, cL + cw0.x, cn0.x), smoothstep(1.0 - cR - cw0.x, 1.0 - cR + cw0.x, cn0.x)),
                    max(cBlind * smoothstep(1.0 - cB - cw0.y, 1.0 - cB + cw0.y, cn0.y) * (rOff ? 0.72 : 0.86), cSheer * 0.5)) * 0.92;
    radFlat = mix(roomCol * (Lwin * 0.07 + lit * lampCol * lampI * 0.5), curtC * 0.86 * (Lwin * 0.8 + lit * lampCol * lampI * 0.30), cmF);
    sunFlat = mix(roomCol * 0.04, curtC * 0.7, cmF) * (max(L.z, 0.0) / PI);
  }

  // ---------------- interior mapping: the room box behind the pane
  vec3 rad = radFlat, sunA = vec3(0.0);
  bool roomOn = glassOn && inG > 0.5 && lodI < 0.999;
  float yF = 0.03, yC = cellH - (ground ? 0.55 : 0.42), tRoom = 0.0;
#if (BLD_DBG & 1) == 0
  if (roomOn) {
    float rxa = -foldOff - 0.5 * bw * (1.0 + step(0.01, foldOff)), rxb = 0.5 * bw - foldOff;
    float D = rRes ? mix(3.6 + 2.2 * hw.y, 2.5, stair) : (rOff ? 7.5 : (rShop ? 5.5 + 3.5 * hw.y : 10.0));
    float t1 = max((V.x > 0.0 ? rxb - qw.x : qw.x - rxa), 0.0) * iv.x;
    float t2 = max((V.y > 0.0 ? yC - qw.y : qw.y - yF), 0.0) * iv.y;
    float t3 = D * iv.z;
    float t = min(t1, min(t2, t3));
    tRoom = t;
    vec3 P = vec3(qw + V.xy * t, V.z * t);
    bool hB = t3 <= t; bool hY = !hB && t2 <= t;
    bool upw = V.y > 0.0;
    vec3 nI = hB ? vec3(0.0, 0.0, 1.0) : (hY ? vec3(0.0, -sign(V.y), 0.0) : vec3(-sign(V.x), 0.0, 0.0));
    vec3 ia = roomCol * (hB || hY ? 1.0 : 0.9);
    vec3 selfE = vec3(0.0);
    float nearS = 1.0 - smoothstep(0.03, 0.12, px);
    float hgt = P.y - yF;
    if (hY) {                                   // floors, ceilings and their light fittings
      vec3 flr = rRes ? mix(vec3(0.20, 0.13, 0.08), vec3(0.30, 0.26, 0.22), hc.y) : vec3(0.26, 0.25, 0.24);
      flr = rShop ? mix(vec3(0.20, 0.15, 0.11), vec3(0.34, 0.32, 0.29), step(0.5, hw.y)) * (0.88 + 0.24 * nearS * step(0.5, fract(P.x * 1.1 + floor(P.z * 1.1) * 0.5))) : flr;
      ia = upw ? ((rShop || rLob) ? vec3(0.42, 0.40, 0.37) : vec3(0.72, 0.70, 0.66)) : flr;
      vec2 lg = abs(fract(vec2(P.x / 1.5, P.z / 1.9)) - 0.5);
      float strip = step(0.5, hash11(fl2 * 1.31 + wseed * 0.77));       // whole floors share their fittings: tube runs or panels
      float pan = rOff ? mix(step(lg.x, 0.3) * step(lg.y, 0.2), step(lg.y, 0.065), strip) : step(length(lg * vec2(1.5, 1.9)), 0.13);
      selfE = ((upw && !rRes) ? pan : 0.0) * lampCol * lit * (rOff ? mix(14.0, 22.0, strip) : 30.0);
    }
    if (hB && rRes) {                           // pictures, a doorway, furniture
      vec2 cg = P.xy / vec2(1.15, 0.95) + hw.xy * 7.0; vec3 hh = hash32(floor(cg) + 31.0); vec2 cf = fract(cg);
      float bx_ = step(0.5, hh.x) * step(0.16, cf.x) * step(cf.x, 0.5 + 0.4 * hh.y) * step(0.14, cf.y) * step(cf.y, 0.55 + 0.35 * hh.z);
      ia = mix(ia, hh.zxy * 0.45 + 0.04, bx_ * 0.85);
      float furn = step(hgt, 0.55 + 0.5 * hw.x) * step(0.3, fract(P.x * 0.37 + hw.y * 3.0));
      ia = mix(ia, vec3(0.09, 0.07, 0.055) + hc * 0.07, furn);
      ia = mix(ia, roomCol * 1.1, stair);                        // stairwell: bare walls
    }
    if (hB && rOff) {                           // partition door, desks
      ia = mix(ia, vec3(0.22, 0.16, 0.11), step(abs(fract(P.x / 3.4 + hw.x) - 0.5), 0.14) * step(P.y, 2.1));
      ia = mix(ia, vec3(0.10, 0.10, 0.11), step(P.y, 0.78) * step(0.35, fract(P.x * 0.6 + hw.y)));
    }
    if (!hY && rShop) {                         // shelves full of goods on the back and side walls, a counter
      vec2 sg = vec2((hB ? P.x : P.z) / 0.12, hgt / 0.38);
      vec3 hg = hash32(vec2(floor(sg.x / 6.0), floor(sg.y)) + floor(hw.xy * 40.0));
      float hi = hash12(floor(sg) + 3.0);
      vec3 goods = mix(mix(vec3(0.17, 0.14, 0.115), vec3(0.29, 0.26, 0.21), hs.x), hg * vec3(1.0, 0.9, 0.75), 0.06 + 0.16 * hs.z) * mix(0.85, 0.5 + 0.7 * hi, nearS);
      goods *= 1.0 - nearS * 0.7 * max(step(fract(sg.y), 0.13), step(fract(sg.x), 0.12) * step(0.5, hi));
      ia = mix(ia, goods, step(hgt, 2.25 + 0.5 * hw.y));
      float ctr = (hB ? 1.0 : 0.0) * step(hgt, 1.0) * step(abs(P.x - (hw.z - 0.5) * 1.5), 0.3 * bw);
      ia = mix(ia, vec3(0.13, 0.08, 0.05) + 0.2 * shopC, ctr);
    }
    if (hB && rLob) {                           // stone panelling and bronze lift doors
      ia = roomCol * (0.75 + 0.25 * step(abs(fract(P.x / 1.6) - 0.5), 0.47));
      ia = mix(ia, vec3(0.30, 0.20, 0.08), step(abs(fract(P.x / 3.2 + 0.25) - 0.5), 0.17) * step(P.y, 2.3));
    }
    float dz = -P.z;
    vec3 toW = vec3(0.5 * (g0 + g1) - P.xy, dz);
    float dW2 = dot(toW, toW) + 1e-3;
    float Aw = gsz.x * gsz.y;
    float ffD = Aw * max(dot(nI, toW) * inversesqrt(dW2), 0.0) * (dz * inversesqrt(dW2)) / (PI * dW2 + Aw) + 0.035;
    vec3 Lp = vec3(0.5 * (rxa + rxb) + (hw.y - 0.5) * 0.9, yC - 0.4, -D * 0.45);
    vec3 dl = Lp - P;
    float d2 = dot(dl, dl);
    float En = 0.20 + 1.5 * (0.3 + 0.7 * max(dot(nI, dl) * inversesqrt(d2 + 1e-4), 0.0)) / (0.7 + d2);
    rad = ia * (Lwin * ffD + lit * lampCol * lampI * En) + selfE;
    vec3 lq = Lp - vec3(qw, 0.0);               // the lamp itself (apartments): a small hot blob
    float tl = dot(lq, V);
    vec3 cl_ = lq - V * tl;
    rad += (rRes ? 1.0 : 0.0) * lit * lampCol * 22.0 * exp(-dot(cl_, cl_) / 0.018) * step(tl, t);
    vec2 s = P.xy + L.xy * (dz / max(L.z, 0.02));     // sun patch through the window
    vec2 e2 = min(s - g0, g1 - s);
    sunA = ia * (smoothstep(0.0, 0.05, min(e2.x, e2.y)) * max(dot(nI, L), 0.0) * recessSun(s, dep, L, orect, 0.03) / PI);
  }
  if (roomOn && rShop) {                        // pendant lamps hanging inside the shop
    vec2 pl = qw + V.xy * (1.5 * iv.z);
    float lx = (fract(pl.x / 1.4 + hs.y * 3.0) - 0.5) * 1.4, ly = pl.y - (yC - 0.85);
    float inR = step(1.5 * iv.z, tRoom) * step(0.35, hs.x);
    float shade = step(abs(lx), 0.05 + 0.55 * clamp(-ly, 0.0, 0.2)) * step(-0.2, ly) * step(ly, 0.0);
    float cord = step(abs(lx), 0.007 + 0.5 * px) * step(0.0, ly) * step(pl.y, yC);
    rad = mix(rad, vec3(0.012) + shopC * 0.05 * Lwin, max(shade, cord * 0.7) * inR);
    sunA *= 1.0 - shade * inR;
    rad += inR * lit * lampCol * 24.0 * exp(-(lx * lx + sq(ly + 0.22)) / 0.005);
    // window display on a platform behind the glass: bottles, stacks, cards on easels, boxes, globes on stands
    vec2 pd = qw + V.xy * (0.45 * iv.z);
    float cwd = 0.42 + 0.3 * hs.x;
    float cxx = pd.x / cwd + hw.x * 9.0;
    vec3 hd = hash32(vec2(floor(cxx), unit + wseed) + 2.0);
    float fx = (fract(cxx) - 0.5) * cwd, hy = pd.y - 0.78;
    float typ = floor(mod(hd.x * 3.0 + hs.y * 3.0, 3.0));
    float ht = 0.3 + 0.75 * hd.z;
    float q3 = clamp(hy / ht, 0.0, 1.0);
    float wd = typ < 0.5 ? mix(0.075, 0.026, step(0.62, q3)) : (typ < 1.5 ? 0.19 - 0.055 * floor(3.0 * q3) : mix(0.012, 0.13, step(0.3, q3)));
    float itm = step(abs(fx), wd) * step(0.0, hy) * step(hy, ht) * step(0.36, hd.y);
    float base_ = step(pd.y, 0.78);
    vec3 ic = mix(mix(vec3(0.20, 0.18, 0.155), hd.zxy * vec3(1.0, 0.85, 0.7), 0.28), vec3(0.36, 0.33, 0.28) + 0.25 * shopC, base_);
    float m_ = max(itm, base_) * (1.0 - isDoor);
    rad = mix(rad, ic * (Lwin * 0.5 + lit * lampCol * lampI * 0.3), m_);
    sunA = mix(sunA, ic * max(L.z, 0.0) / PI * recessSun(pd, dep + 0.45, L, orect, 0.03), m_);
  }
  if (roomOn && (rRes || rOff) && lantern < 0.5 && stair < 0.5) {   // curtains and blinds just behind the glass
    vec2 pc2 = qw + V.xy * (0.10 * iv.z);
    vec2 cn = (pc2 - g0) / gsz;
    float nearC = 1.0 - smoothstep(0.02, 0.08, px);
    float drape = cDrape, blind = cBlind, sheer = cSheer;
    float cm = max(drape * max(step(cn.x, cL), step(1.0 - cR, cn.x)), max(blind * step(1.0 - cB, cn.y), sheer));
    float fold = mix(0.86, 0.70 + 0.30 * sin(pc2.x * 42.0 + sin(pc2.y * 1.3 + hw.z * 6.0) * 2.0), nearC * drape);
    fold = mix(fold, mix(0.92, 0.84 + 0.16 * step(0.5, fract(pc2.y / 0.07)), nearC), blind);
    vec3 cc = curtC;
    float cw_ = cm * mix(0.92, 0.5, sheer);
    cw_ *= mix(1.0, mix(0.72, 0.45 + 0.55 * step(0.5, fract(pc2.y / 0.07)), nearC), blind * (rOff ? 1.0 : 0.5));   // slats left ajar
    rad = mix(rad, cc * fold * (Lwin * 0.8 + lit * lampCol * lampI * 0.30), cw_);
    sunA = mix(sunA, cc * fold * (max(L.z, 0.0) / PI) * recessSun(pc2, dep + 0.1, L, orect, 0.02), cw_);
  }
#endif
  if (glassOn) {
    vec3 spc = (colC * 0.30 + colA * 0.22) * mix(0.75, 1.25, hp3.z) + vec3(0.01);
    rad = inG < 0.5 ? spc * Lwin * 1.2 : mix(rad, radFlat, lodI);
    sunA = inG < 0.5 ? spc * max(L.z, 0.0) / PI : mix(sunA, sunFlat, lodI);
    float trans = (1.0 - fres) * mix(0.9, 0.42, smoothstep(0.08, 0.28, f0));
    vec3 gtint = mix(vec3(1.0), mix(vec3(1.0), colC, 0.5), towerGlass);
    wEm = rad * trans * gtint * gl;
    wInSun = sunA * trans * gtint * gl;
    wSpec = mix(1.0, f0 / 0.04, gl);
  }
  if (gls) {
    wGlass = gl;
    wAlb = mix(solidA, vec3(0.022), gl);
    wRough = mix(solidR, mix(0.07, 0.16, vP2.z), gl);
    wMetal = solidM * (1.0 - gl);
    wNt = normalize(mix(vec3(0.0, 0.0, 1.0), gN, gl));
    wSun = recessSun(q, dep, L, orect, soft);
    wGlint *= gl * wSun;
    wAO = mix(0.72, 1.0, smoothstep(0.0, 0.22, eo));
  }

  // ---------------- wall material at the shading point
  float mv = mp.y;
  float rustic = ((isStone || isDeco) && y0t < 0.5) ? 1.0 - step(gH, mv) : 0.0;
  vec3 mAlb; float mRough; vec2 mBump;
#if (BLD_DBG & 4) == 0
  wallMat(style, mp, mp + vec2(wseed * 3.17, wseed * 1.31), px, colA, flags, rustic, mAlb, mRough, mBump);
#else
  mAlb = colA; mRough = 0.9; mBump = vec2(0.0);
#endif
  vec2 pm_ = mp + vec2(wseed * 3.17, wseed * 1.31);
  vec4 n3 = ntex(vec2(pm_.x * 5.0, pm_.y * 0.3), 19.0, px * 5.0);
  vec4 n5 = ntex(vec2(pm_.x * 11.0 + 3.1, pm_.y * 0.55), 19.0, px * 11.0);      // narrow rain streaks
  vec4 n6 = ntex(pm_ + 31.7, 41.0, px);                                          // blotches several metres across
  float wNear = 1.0 - smoothstep(0.08, 0.5, px);
  float fadeR = 1.0 - smoothstep(0.04, 0.2, px);
  float dMetal = 0.0, dAO = 1.0; vec3 dEm = vec3(0.0); vec2 dN = mBump;
  float nz = 0.88 + 0.24 * n3.b;
  float flat_ = 0.0;                            // dressed surfaces lose the masonry bump
  bool dress = isFac && !rev;
  bool dUp = dress && !ground;
  bool punched = dUp && has && !contX && !contY;
  float ytop = oyb - ar * sq(clamp((x - xc) / hwid, -1.0, 1.0));
  float cxo = covLocal(x, oxa - 0.07, oxb + 0.07, pxv.x);

#if (BLD_DBG & 2) == 0
  if (dUp && bitf(flags, 2048.0) > 0.5) {       // quoins at the ends of the wall
    float ql = min(mod(floor(v / 0.36), 2.0) < 0.5 ? 0.64 : 0.40, mg - 0.05);
    float qm = covLocal(min(u, W - u), -1.0, ql, pxv.x);
    float qj = 1.0 - smoothstep(0.006, 0.012 + px, min(fract(v / 0.36), 1.0 - fract(v / 0.36)) * 0.36);
    mAlb = mix(mAlb, colB * nz * (1.0 - 0.35 * qj * (1.0 - smoothstep(0.03, 0.12, px))), qm); flat_ = max(flat_, qm);
  }
  if (dUp && bitf(flags, 1024.0) > 0.5 && !contY) {   // belt courses at the floor lines
    float bm = max(covLocal(y, -1.0, 0.10, pxv.y), covLocal(y, cellH - 0.07, cellH + 1.0, pxv.y));
    mAlb = mix(mAlb, colB * nz, bm); flat_ = max(flat_, bm);
    mAlb *= 1.0 - 0.35 * covLocal(y, cellH - 0.14, cellH - 0.07, pxv.y);
  }
  if (punched && bitf(flags, 4096.0) > 0.5 && opaque < 0.5) {   // towers: spandrel strips tie the windows of a bay into a vertical
    float spM = covLocal(x, oxa - 0.06, oxb + 0.06, pxv.x) * (1.0 - covLocal(y, oya - 0.10, ytop + 0.02, pxv.y));
    mAlb = mix(mAlb, mix(mAlb * vec3(0.70, 0.72, 0.77), colB * nz * 0.8, isBrick ? 0.45 : 0.0), spM);
    float edge = covLocal(abs(x - xc) - hwid, 0.06, 0.11, pxv.x) * (1.0 - smoothstep(0.03, 0.15, px));
    mAlb *= 1.0 + 0.06 * edge;
  }
  if (punched || (dress && gRes && has && opaque < 0.5)) {   // sill, lintel / surround, streaks under the sill
    float sillM = cxo * covLocal(y, oya - 0.10, oya, pxv.y) * (isConc ? 0.0 : 1.0);
    vec3 sc = (isBrick || isStucco || ground) ? colB : colA * 1.1;
    mAlb = mix(mAlb, sc * nz, sillM); dN = mix(dN, vec2(0.0, 0.5), sillM); mRough = mix(mRough, 0.8, sillM);
    mAlb *= 1.0 - 0.5 * cxo * covLocal(y, oya - 0.17, oya - 0.10, pxv.y);
    float lintM = covLocal(x, oxa - 0.12, oxb + 0.12, pxv.x) * covLocal(y, ytop, ytop + 0.22, pxv.y) * (isBrick ? 1.0 : 0.0);
    float stoneL = bitf(flags, 64.0);
    mAlb = mix(mAlb, mix(mAlb * 0.8, colB * nz, stoneL), lintM); flat_ = max(flat_, lintM * stoneL);
    float sur = (isStucco && !ground ? 1.0 : 0.0) * bitf(flags, 128.0) * covLocal(x, oxa - 0.14, oxb + 0.14, pxv.x) * covLocal(y, oya - 0.10, ytop + 0.16, pxv.y);
    mAlb = mix(mAlb, colB * nz, sur); flat_ = max(flat_, sur);
    float sd = oya - 0.10 - y;
    float strk = step(0.0, sd) * exp(-sd / (0.9 + 1.5 * n3.b)) * (0.9 * exp(-sq((abs(x - xc) - hwid) / 0.15)) + 0.5 * step(abs(x - xc), hwid + 0.06) * smoothstep(0.3, 0.7, n5.r));
    mAlb *= mix(vec3(1.0), vec3(0.48, 0.47, 0.45), min(1.05 * strk, 1.0) * (1.0 - smoothstep(0.05, 0.3, px)));
    // drips under air conditioners
    float acS = acHere * step(0.0, sd) * exp(-sd / 1.3) * exp(-sq((x - xc + 0.1) / (0.07 + 0.05 * sd)));
    mAlb *= mix(vec3(1.0), vec3(0.55, 0.50, 0.44), 0.7 * acS * fadeR);
    // a lit room throws a little light onto the wall around its window
    vec2 dq = max(abs(vec2(x - xc, y - 0.5 * (oya + oyb))) - vec2(hwid, 0.5 * (oyb - oya)), 0.0);
    dEm += mAlb * lampCol * (lit * lampI * 0.05 * exp(-length(dq) / 0.3) * (1.0 - opaque));
  }
  if (punched && bitf(flags, 512.0) > 0.5 && wt < 0.5 && ar < 0.01 && opaque < 0.5) {   // louvred shutters folded back
    float sw = min(hwid, 0.5 * bw - hwid - 0.06);
    float ax = abs(x - xc) - hwid;
    float shM = covLocal(ax, 0.02, sw, pxv.x) * covLocal(y, oya - 0.02, oyb + 0.02, pxv.y) * step(0.28, sw);
    float nearL = 1.0 - smoothstep(0.012, 0.05, px);
    float lv = fract(y / 0.07);
    vec3 shc = colC * (0.9 + 0.3 * n3.g) * mix(0.9, 0.72 + 0.36 * smoothstep(0.1, 0.6, lv) * (1.0 - smoothstep(0.75, 0.95, lv)), nearL);
    shc *= 1.0 - 0.25 * nearL * (1.0 - smoothstep(0.0, 0.035, min(min(ax - 0.02, sw - ax), min(y - oya + 0.02, oyb + 0.02 - y))));
    mAlb = mix(mAlb, shc, shM); flat_ = max(flat_, shM); mRough = mix(mRough, 0.6, shM);
    mAlb *= 1.0 - 0.4 * covLocal(ax, sw, sw + 0.05, pxv.x) * covLocal(y, oya - 0.05, oyb, pxv.y) * step(0.28, sw);
  }
  if (dUp && has && contX && !contY) {          // ribbon windows: a continuous sill
    mAlb = mix(mAlb, colB * 0.9, covLocal(y, oya - 0.09, oya, pxv.y) * 0.7);
    float sd = oya - 0.09 - y;
    mAlb *= 1.0 - 0.3 * step(0.0, sd) * exp(-sd / 0.7) * smoothstep(0.35, 0.7, n3.r);
  }
  if (dUp && isConc) {                          // precast panel joints
    float jd = min(0.5 * bw - abs(u - cu), min(y, cellH - y));
    mAlb *= 1.0 - 0.55 * clamp((0.012 + 0.5 * px - jd) / px, 0.0, min(1.0, 0.024 / px));
  }
  if (dUp && isDeco) {                          // fluted piers
    float fade = (1.0 - smoothstep(0.02, 0.08, px)) * step(0.5 * ww + 0.06, abs(x));
    float ph_ = (u - cu) * 6.2832 / 0.17;
    mAlb *= 1.0 - 0.10 * fade * (0.5 + 0.5 * cos(ph_));
    dN.x += 0.35 * fade * sin(ph_);
  }
  if (topZone && dress) {                       // frieze / ornament band under the cornice
    float yb_ = y1t - v;
    float lvl = (yb_ - 0.25) / (1.0 + 0.8 * lantern);
    float band = step(0.0, lvl) * step(lvl, 1.0) * (isDeco ? 1.0 : 0.0);
    float chev = step(fract(lvl * 2.0 + abs(fract(u / (1.1 + 0.7 * lantern)) - 0.5) * 2.0), 0.5) * (1.0 - smoothstep(0.1, 0.5, px));
    mAlb = mix(mAlb, mix(colC, colC * 1.9 + 0.03, chev) * mix(1.0, 1.5, lantern), band); dMetal = 0.5 * band; mRough = mix(mRough, 0.45, band);
    float dent = step(0.3, yb_) * step(yb_, 0.52) * step(0.5, fract(u / 0.34)) * ((isBrick || isStone) ? 1.0 : 0.0);
    mAlb *= 1.0 - 0.45 * dent * (1.0 - smoothstep(0.05, 0.2, px));
    float fz = max(covLocal(yb_, 0.62, 0.74, pxv.y) * (isStone ? 1.0 : 0.0), covLocal(yb_, 0.1, 0.75, pxv.y) * (isStucco ? 1.0 : 0.0));
    mAlb = mix(mAlb, colB * nz * 0.95, fz); flat_ = max(flat_, max(fz, band));
  }
  if (dress && gShop) {                         // shopfront: fascia, lettering, pilasters
    vec3 hu3 = hash32(vec2(unit, wseed) + 21.0);
    float shopLit = smoothstep(0.02 + 1.25 * hs.x, 0.08 + 1.25 * hs.x, uNight);
    float xs = u - (unitU0 + 0.5 * unitW);
    float inUnit = covLocal(abs(xs), -1.0, 0.5 * unitW - 0.16, pxv.x);
    float tw = min(unitW - 0.9, 1.84);
    vec2 suv = vec2(xs / tw + 0.5, (v - (gH - 0.80)) / 0.46 + 0.5);
    float cell = floor(hu3.y * 31.99);
    float txt = textureLod(uSignTex, (vec2(mod(cell, 4.0), floor(cell / 4.0)) + clamp(suv, 0.0, 1.0)) / vec2(4.0, 8.0), log2(max(px * 256.0 / tw, 1.0))).r;
    txt *= step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0);
    vec3 letC = mix(vec3(0.03), mix(vec3(0.70, 0.52, 0.18), vec3(0.78, 0.74, 0.62), step(0.5, hu3.z)), step(luminance(shopC), 0.2));
    float fm = covLocal(y, gH - 1.25, gH - 0.36, pxv.y) * inUnit;
    vec3 fasC = mix(shopC * nz, letC, txt);
    mAlb = mix(mAlb, fasC, fm); mRough = mix(mRough, 0.5, fm);
    float headM = covLocal(y, gH - 0.36, gH + 0.2, pxv.y) * 0.8;
    mAlb = mix(mAlb, colB * nz, headM);
    float pilM = (1.0 - covLocal(x, oxa, oxb, pxv.x)) * covLocal(y, -2.0, gH - 1.25, pxv.y) * step(0.5, hu3.z) * inUnit;
    mAlb = mix(mAlb, shopC * 0.8 * nz + 0.004, pilM); flat_ = max(flat_, max(fm, max(headM, pilM)));
    mAlb *= 1.0 - 0.3 * covLocal(y, -2.0, 0.42, pxv.y);
    float neon = step(0.55, hs.z);
    vec3 glowC = hu3.x < 0.25 ? vec3(1.0, 0.16, 0.10) : (hu3.x < 0.5 ? vec3(1.0, 0.62, 0.22) : (hu3.x < 0.75 ? vec3(0.25, 0.85, 1.0) : vec3(1.0, 0.86, 0.66)));
    dEm += fm * shopLit * (txt * glowC * 13.0 * neon + fasC * vec3(1.0, 0.82, 0.6) * (1.6 * (1.0 - neon)) * (0.4 + 0.6 * sat((v - (gH - 1.25)) / 0.9)));
    dEm += mAlb * shopLit * vec3(1.0, 0.8, 0.55) * 0.35 * (1.0 - fm) * exp(-max(abs(x) - 0.5 * bw + 0.27, 0.0) / 0.3) * step(y, gH - 1.2);
  }
  if (dress && gLobby) {
    float headM = covLocal(y, gH - 1.0, gH - 0.2, pxv.y) * (1.0 - lantern);
    mAlb = mix(mAlb, isTower ? vec3(0.03, 0.03, 0.034) : colB * nz, headM * 0.85); flat_ = max(flat_, headM);
    mAlb *= 1.0 - 0.3 * covLocal(y, -2.0, 0.5, pxv.y);
  }
  if (dress && (gRes || gWare)) {               // plinth, door surround
    float pl = covLocal(y, -2.0, 0.95, pxv.y);
    mAlb = mix(mAlb, isBrick ? colB * nz * 0.75 : mAlb * 0.66, pl); flat_ = max(flat_, isBrick ? pl : 0.0);
    float sur = (has && opaque > 0.5 && gRes ? 1.0 : 0.0) * covLocal(x, oxa - 0.16, oxb + 0.16, pxv.x) * covLocal(y, -2.0, oyb + 0.2, pxv.y);
    mAlb = mix(mAlb, colB * nz, sur); flat_ = max(flat_, sur);
  }
#endif
  dN *= 1.0 - sat(flat_);
  if (kind > 0.5 && vFWall.z > 0.5) {           // painted lettering: warehouse parapet bands, ghost signs on party walls
    float th = (kind < 6.5 && vFWall.y > 0.1) ? vFWall.y : 0.8;
    float tw = min(W - 1.6, th * 6.0);
    vec2 suv = vec2((u - 0.5 * W) / tw + 0.5, (v - vFWall.z) / th + 0.5);
    float cell = floor(hash11(wseed * 0.731 + 4.0) * 31.99);
    float txt = textureLod(uSignTex, (vec2(mod(cell, 4.0), floor(cell / 4.0)) + clamp(suv, 0.0, 1.0)) / vec2(4.0, 8.0), log2(max(px * 256.0 / tw, 1.0))).r;
    txt *= step(0.0, suv.x) * step(suv.x, 1.0) * step(0.0, suv.y) * step(suv.y, 1.0) * step(2.5, tw);
    float wear = smoothstep(0.25, 0.65, n3.b) * (0.6 + 0.4 * smoothstep(0.3, 0.6, n3.g));
    mAlb = mix(mAlb, vec3(0.70, 0.66, 0.56), txt * (0.25 + 0.6 * wear));
  }
  if (kind > 6.5) {                             // gable front: a round attic window
    vec2 gc = vec2(u - 0.5 * W, v - (y1t + vFWall.y * 0.42));
    float rd = length(gc);
    float r0 = clamp(vFWall.y * 0.16, 0.35, 0.7);
    float big = step(2.4, vFWall.y);
    float ring = covLocal(rd, r0, r0 + 0.14, px) * big;
    float disc = covLocal(rd, -1.0, r0, px) * big;
    mAlb = mix(mAlb, colB * nz, ring);
    mAlb = mix(mAlb, mix(vec3(0.02), vP6.rgb, max(step(abs(gc.x), 0.025), step(abs(gc.y), 0.025))), disc); mRough = mix(mRough, 0.12, disc);
    dN *= 1.0 - max(ring, disc);
  }

  // ---------------- weathering
  float topD = max((kind > 6.5 ? y1t + vFWall.y : y1t) - mv, 0.0);
  float stainAmt = isBrick ? 0.26 : (isStone ? 0.42 : (isConc ? 0.50 : (isStucco ? 0.40 : (isTower ? 0.15 : 0.34))));
  // run-off below the parapet / cornice: soot curtains of irregular length, rain-washed pale lanes between them
  float run = smoothstep(0.40, 0.72, 0.6 * n3.r + 0.4 * n5.r) * exp(-topD / (1.6 + 6.0 * n3.g)) * (0.35 + 0.65 * smoothstep(0.3, 0.62, n6.g));
  mAlb *= mix(vec3(1.0), vec3(0.50, 0.49, 0.47), min(stainAmt * 1.5 * run, 1.0));
  // soot blotches and paler scoured areas
  mAlb *= 1.0 - 0.36 * smoothstep(0.42, 0.78, n6.r) * (isTower ? 0.3 : 1.0);
  float scour = 0.7 * smoothstep(0.52, 0.8, n6.b) + 0.5 * smoothstep(0.60, 0.84, n5.g) * exp(-topD / 10.0) * wNear;
  mAlb = mAlb * (1.0 + 0.13 * scour) + 0.008 * scour;
  mAlb *= mix(vec3(1.06, 1.0, 0.92), vec3(0.94, 1.0, 1.07), smoothstep(0.25, 0.75, n6.a));
  // every storey sheds its own dirt: streaks hanging from the sill line, strongest on render and stone
  float sdl = mod(sl - 0.1 - y + cellH, cellH);
  float flS = floor((v - gH - sl + 0.1) / fH);
  vec4 n7 = ntex(vec2(pm_.x * 8.0 + flS * 5.7, pm_.y * 0.35 + flS * 3.1), 19.0, px * 8.0);
  float led = smoothstep(0.45, 0.78, n7.r) * exp(-sdl / (0.3 + 2.2 * n7.b)) * ((upper && !contY) ? fadeR : 0.0) * (0.3 + 0.7 * smoothstep(0.35, 0.65, n6.b));
  mAlb *= mix(vec3(1.0), vec3(0.55, 0.54, 0.52), led * (isBrick ? 0.3 : (isTower ? 0.0 : 0.6)));
  // rising damp: a dark irregular skirt, a tide line of salts above it, splash dirt at the pavement
  float hv_ = max(mv, 0.0);
  float dampH = 0.35 + 1.5 * n6.g + 0.7 * n3.g;
  float damp = (1.0 - smoothstep(dampH * 0.45, dampH, hv_)) * (y0t < 0.5 ? 1.0 : 0.0);
  mAlb *= 1.0 - (0.30 * damp + 0.22 * exp(-hv_ / 0.35) + 0.08 * exp(-hv_ / 8.0)) * (0.6 + 0.8 * n3.g);
  // sun-bleached, rain-washed upper storeys against grimier lower ones
  float upF = smoothstep(3.0, 26.0, mv);
  mAlb *= mix(0.93, 1.05, upF);
  // repainting / different batches per floor and pair of bays
  vec3 hrp = hash32(vec2(ground ? 97.0 : fl, floor(bi * 0.5 + hash11(fl * 3.1 + wseed) * 2.0)) + wseed * 0.71);
  float rpA = isFac ? (isStucco ? 1.0 : (isConc ? 0.8 : (bitf(flags, 2.0) > 0.5 ? 1.0 : 0.35))) : 0.0;
  float rpS = step(0.84, hrp.y);
  mAlb *= 1.0 + rpA * ((hrp.x - 0.5) * 0.12 + rpS * (hrp.z - 0.45) * 0.28);
  mAlb *= mix(vec3(1.0), mix(vec3(0.97, 1.0, 1.03), vec3(1.04, 1.0, 0.94), hrp.z), rpA * rpS * 0.8);
  mAlb *= 1.0 + 0.12 * (n3.b - 0.5);
  vec4 n4 = ntex(vec2(pn.x, pn.y * 0.22) + 7.7, 67.0, px);       // building-scale drift that survives at skyline distances
  mAlb *= (0.80 + 0.40 * n4.r) * mix(vec3(1.0), vec3(1.05, 1.0, 0.94), (n4.g - 0.5) * 1.6);
  mAlb *= 1.0 - 0.22 * smoothstep(1.4, 0.0, topD) * step(mv, y1t);
  mAlb *= 1.0 - 0.1 * step(y1t, mv);
  dEm += lantern * mAlb * vec3(1.0, 0.66, 0.34) * (uNight * (0.10 + 1.15 / (1.0 + sq(max(mv - y0t, 0.0) / 10.0))));

  // ---------------- combine wall and window
  // shopfront reveals: painted timber returns, glazed sides and a tiled threshold in the door recess
  vec2 tlr = rvp.xz / 0.2;
  float chkR = mix(mod(floor(tlr.x) + floor(tlr.y), 2.0), 0.5, smoothstep(0.03, 0.12, px));
  float gzR = step(0.62, rvp.y) * step(rvp.y, oyb - 0.12) * step(0.06, rvp.z) * isDoor;
  vec3 shA = mix(mix((shopC * 0.5 + 0.004) * nz, vec3(0.022), gzR), mix((shopC * 0.4 + 0.02) * nz, mix(vec3(0.30, 0.29, 0.26), vec3(0.085, 0.085, 0.09), chkR), isDoor), sillTop);
  float gS = gShop ? 1.0 : 0.0;
  if (rev) {
    wAlb = mix(mix(mAlb * 0.94, colB * 0.9 * nz, sillTop * ((isBrick || isStucco) ? 1.0 : 0.0)), shA, gS);
    wRough = mix(mRough, mix(mix(0.5, 0.1, gzR), 0.35, sillTop), gS);
    wEm = wAlb * spill + dEm * 0.5;
  }
  vec3 nT = normalize(mix(vec3(dN, 1.0), wNt, cov));
  F_alb = mix(mAlb, wAlb, cov);
  F_rough = mix(mRough, wRough, cov);
  F_metal = mix(dMetal, wMetal, cov);
  F_emis = mix(dEm, wEm, cov);
  F_sunVis = mix(1.0, wSun, cov);
  F_ao = mix(dAO, wAO, cov);
  F_glint = (gls ? wGlint : 0.0) * cov;
  F_glass = wGlass * cov; F_refl = wRefl; F_inSun = wInSun * cov; F_specBoost = mix(1.0, wSpec, cov);
  F_nW = normalize(T * nT.x + vec3(0.0, nT.y, 0.0) + N * nT.z);
}
`;

export const HOOK_COLOR = /* glsl */`facadeMain(); diffuseColor.rgb = F_alb;`;
export const HOOK_SURFACE = /* glsl */`roughnessFactor = F_rough; metalnessFactor = F_metal;`;
export const HOOK_NORMAL = /* glsl */`normal = worldToViewDir(F_nW);`;
export const HOOK_EMISSIVE = /* glsl */`totalEmissiveRadiance += F_emis;`;
export const HOOK_AO = /* glsl */`
  reflectedLight.directDiffuse *= F_sunVis;
  reflectedLight.directSpecular *= F_sunVis * F_specBoost;
  reflectedLight.indirectDiffuse *= F_ao;
  reflectedLight.indirectSpecular = mix(reflectedLight.indirectSpecular * F_ao, F_refl, F_glass);
  reflectedLight.directDiffuse += F_inSun * directLight.color;
  reflectedLight.directSpecular += F_glint * directLight.color;
`;
