// Materials of the transit module (all through ctx.makeMaterial so they get SSAO / night light map / shared uniforms).
import * as THREE from 'three';

const FACE_V = { vertexPars: 'attribute vec4 aFace; varying vec4 vFace;', vertex: 'vFace = aFace;' };

// tangent-frame perturbation from face coordinates (vFace.xy in metres) + rivet rows along the face edges
const RIVET_GLSL = /* glsl */`
varying vec4 vFace;
vec3 rv_ = vec3(0.0); float rust_ = 0.0; float nf_ = 0.5;
vec3 perturbFace(vec3 N, vec2 g) {
  vec3 q = -vViewPosition;
  vec3 dp1 = dFdx(q), dp2 = dFdy(q);
  vec2 du1 = dFdx(vFace.xy), du2 = dFdy(vFace.xy);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * du1.x + dp1perp * du2.x;
  vec3 B = dp2perp * du1.y + dp1perp * du2.y;
  float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
  return normalize(N + (T * g.x + B * g.y) * inv);
}
vec3 rivetField(vec2 uv, vec2 size) {
  const float pitch = 0.11; const float inset = 0.045; const float rad = 0.017;
  vec3 best = vec3(0.0);
  if (size.x < 0.16 || size.y < 0.16) return best;
  for (int k = 0; k < 4; k++) {
    vec2 p;
    if (k == 0) p = vec2(uv.x, uv.y - inset);
    else if (k == 1) p = vec2(uv.x, uv.y - (size.y - inset));
    else if (k == 2) p = vec2(uv.y, uv.x - inset);
    else p = vec2(uv.y, uv.x - (size.x - inset));
    vec2 d = vec2((fract(p.x / pitch) - 0.5) * pitch, p.y);
    float r = length(d);
    float m = smoothstep(rad, rad * 0.45, r);
    if (m > best.z) {
      vec2 g = d / max(r, 1e-4) * smoothstep(0.0, rad * 0.5, r) * smoothstep(rad * 1.3, rad * 0.75, r);
      best = vec3(k >= 2 ? g.yx : g, m);
    }
  }
  return best;
}
`;

// Tram saloon helpers (tram-local frame: x east, y above rail top, z along the set). The interior is lit by structured
// fake GI instead of a flat ambient: sky through the two window bands, sun bounce off the far side (strobed by the real
// shadow map), parallax-correct reflections of the windows on glossy surfaces and a back-light rim on thin fittings.
const TRAM_V = {
  vertexPars: 'attribute vec4 aFace; varying vec4 vFace; varying vec3 vTL;',
  vertex: 'vFace = aFace;',
  vertexEnd: /* glsl */`{
    vec4 tl_ = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      tl_ = instanceMatrix * tl_;
    #endif
    vTL = tl_.xyz; }`,
};
const TRAM_GLSL = /* glsl */`
varying vec3 vTL;
const float T_FL = 0.95; const float T_SILL = 1.75; const float T_HEAD = 2.72;
float trnWinZ(float z, float soft) {
  float zc = abs(mod(z + 7.6, 15.2) - 7.6);
  float m = 1.0 - smoothstep(0.81 - soft, 0.81 + soft, zc);
  m = max(m, 1.0 - smoothstep(0.81 - soft, 0.81 + soft, abs(zc - 1.93)));
  m = max(m, 1.0 - smoothstep(0.95 - soft, 0.95 + soft, abs(zc - 5.8)));
  m = max(m, 0.8 * (1.0 - smoothstep(0.21 - soft, 0.21 + soft, abs(abs(zc - 3.7) - 0.32))));
  return m * step(abs(z), 22.4);
}
float trnWin(float z, float y, float soft) {
  return trnWinZ(z, soft) * smoothstep(T_SILL - soft, T_SILL + soft, y) * (1.0 - smoothstep(T_HEAD - soft, T_HEAD + soft, y));
}
float trnSunVis(vec3 wp) {
  float shadow = 1.0;
  #ifdef USE_SHADOWMAP
  #if NUM_SUN_LIGHT_SHADOWS > 0
    float viewDepth = vSunShadowWorldPosition.w;
    for (int i = SUN_LIGHT_CASCADES - 1; i >= 0; i--) {
      vec4 cascade = sunShadowCascade[i];
      if (viewDepth >= cascade.x && viewDepth < cascade.y) {
        float cs = getShadow(sunShadowMap[0], sunLightShadows[0].shadowMapSize, sunLightShadows[0].shadowIntensity, sunLightShadows[0].shadowBias, sunLightShadows[0].shadowRadius, sunShadowMatrix[i] * vec4(wp, 1.0));
        shadow = mix(cs, shadow, smoothstep(cascade.z, cascade.y, viewDepth));
      }
    }
  #endif
  #endif
  return shadow;
}
vec3 trnSkyDir(vec3 d) {
  vec3 c = skyLUT(uSkyLUT, normalize(vec3(d.x, max(d.y, 0.03), d.z)));
  return c * mix(0.3, 1.0, smoothstep(-0.12, 0.05, d.y));          // streets / water below the horizon
}
uniform vec4 uTrnFill;      // sky strips, sun bounce, window reflections, rim
void trnInterior(inout ReflectedLight rl, vec3 albedo, vec3 F0, float rough, float metal, vec3 lp, vec3 Nw, float rimK, float ao) {
  vec3 Vw = normalize(uCamPos - vWPos);
  float day = 1.0 - 0.85 * uNight;
  vec3 dif = vec3(0.0);
  float yMid = 0.5 * (T_SILL + T_HEAD);
  float wz = mix(0.68, 1.0, trnWinZ(lp.z, 0.45));
  for (int k = 0; k < 2; k++) {
    float sd = k == 0 ? -1.0 : 1.0;
    float dx = max(sd * (sd * 1.2 - lp.x), 0.05);
    float ang = atan(T_HEAD - lp.y, dx) - atan(T_SILL - lp.y, dx);
    vec2 d2 = normalize(vec2(sd * dx, yMid - lp.y));
    float cosN = max(dot(Nw.xy, d2), 0.0);
    vec3 Ls = 0.5 * (skyLUT(uSkyLUT, normalize(vec3(sd, 0.30, 0.6))) + skyLUT(uSkyLUT, normalize(vec3(sd, 0.30, -0.6))));
    dif += Ls * ang * cosN * wz * mix(0.45, 1.0, smoothstep(-0.4, 0.3, Nw.y));
  }
  dif *= uTrnFill.x;
  // sun bounce off the side opposite the sun (seat backs / wall strip under the windows), strobed by the truss shadows
  float fs = uLightDir.x > 0.0 ? -1.0 : 1.0;
  vec3 pb = vec3(fs * 1.04, T_SILL - 0.10, lp.z);
  vec3 db = pb - lp;
  float visB = trnSunVis(vWPos + db);
  float lb = length(db.xy);
  float ffB = (0.30 + 0.70 * max(dot(Nw.xy, db.xy / max(lb, 0.05)), 0.0)) / (1.0 + 0.2 * lb * lb);
  dif += uLightColor * vec3(1.0, 0.72, 0.55) * uTrnFill.y * (0.35 + 0.65 * visB) * ffB * trnWinZ(lp.z, 0.6);
  rl.indirectDiffuse += albedo * (1.0 - metal) * dif * mix(0.4, 1.0, ao) * day;
  // glossy reflection of the bright windows
  vec3 R = reflect(-Vw, Nw);
  float ndv = max(dot(Nw, Vw), 0.0);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - ndv, 5.0);
  vec3 spec = vec3(0.0);
  if (abs(R.x) > 0.03) {
    float sd = sign(R.x); float t = (sd * 1.21 - lp.x) / R.x;
    if (t > 0.0) {
      vec3 h = lp + R * t;
      float soft = 0.012 + rough * (0.12 + 0.45 * t);
      spec = trnSkyDir(R) * trnWin(h.z, h.y, soft);
    }
  }
  rl.indirectSpecular += F * spec * (1.0 - 0.8 * rough) * uTrnFill.z * mix(0.55, 1.0, ao) * day;
  // back-light rim on thin fittings (poles, rings, straps)
  if (rimK > 0.0) {
    float sv = trnSunVis(vWPos + uLightDir * 0.07);
    float rim = pow(1.0 - ndv, 3.0) * smoothstep(-0.9, 0.25, dot(Nw, uLightDir));
    rl.directSpecular += uLightColor * rimK * uTrnFill.w * rim * sv * mix(vec3(1.0), albedo, metal);
  }
}
`;
const TRN_FILL = { value: new THREE.Vector4(0.60, 0.07, 1.0, 1.0) };

export function makeMaterials(ctx, atlas) {
  const mk = ctx.makeMaterial;
  const M = {};

  // ---- painted riveted steel -------------------------------------------------------------------
  const steelHooks = (rustBias) => ({
    ...FACE_V, key: 'trn_steel',
    uniforms: { uRustBias: { value: rustBias } },
    fragPars: RIVET_GLSL + 'uniform float uRustBias;',
    color: /* glsl */`{
      vec3 wp = vWPos; vec2 sz = vFace.zw; vec2 fuv = vFace.xy;
      float hasF = step(0.001, sz.x);
      vec2 dE = min(fuv, sz - fuv); float edge = mix(1.0, min(dE.x, dE.y), hasF);
      float px = length(fwidth(fuv));
      float fade = smoothstep(0.03, 0.007, px) * hasF;
      rv_ = rivetField(fuv, sz) * fade;
      float nb = fbm3(wp * vec3(0.5, 0.85, 0.5));
      nf_ = fbm3(wp * 6.0 + 7.0);
      float streak = fbm2(vec2((wp.x + wp.z) * 5.0, wp.y * 0.45));
      float up = vWNormal.y;
      float thin = smoothstep(0.09, 0.24, min(sz.x, sz.y));
      float amt = nb * 0.62 + nf_ * 0.20 + streak * 0.2 + smoothstep(0.10, 0.0, edge) * mix(0.07, 0.28, thin) * hasF + rv_.z * 0.22 + max(-up, 0.0) * 0.05 + uRustBias;
      rust_ = smoothstep(0.66, 0.88, amt);
      float stain = smoothstep(0.50, 0.78, amt);
      vec3 paint = diffuseColor.rgb * (0.80 + 0.40 * nf_);
      paint = mix(paint, paint * 1.3 + 0.012, smoothstep(0.3, 1.0, up) * 0.4);
      paint *= 1.0 - 0.25 * smoothstep(0.03, 0.0, edge) * hasF;
      vec3 rustC = mix(vec3(0.17, 0.060, 0.022), vec3(0.34, 0.15, 0.055), nf_);
      paint = mix(paint, mix(paint, rustC, 0.6), stain * 0.6);
      diffuseColor.rgb = mix(paint, rustC, rust_);
    }`,
    surface: 'roughnessFactor = mix(0.46 + 0.2 * nf_, 0.93, rust_); metalnessFactor = 0.0;',
    normal: 'normal = perturbFace(normal, rv_.xy * 1.1);',
  });
  M.steel = mk({ color: 0x34493d, roughness: 0.55, metalness: 0, vertexColors: true }, steelHooks(0.0));

  // ---- weathered timber (sleepers, planks, decking) ---------------------------------------------
  M.timber = mk({ color: 0xffffff, roughness: 0.9, metalness: 0, vertexColors: true }, {
    ...FACE_V, key: 'trn_timber',
    fragPars: 'varying vec4 vFace;',
    color: /* glsl */`{
      vec2 sz = vFace.zw; vec2 fuv = vFace.xy;
      bool alongU = sz.x >= sz.y;
      float la = alongU ? fuv.x : fuv.y; float ac = alongU ? fuv.y : fuv.x;
      float gap = 0.0; float pid = 0.0;
      if (min(sz.x, sz.y) > 0.6) {            // a deck slab: boards run across the long axis, 0.15 m wide
        float k = la / 0.15; pid = floor(k); float f = fract(k);
        gap = smoothstep(0.05, 0.0, min(f, 1.0 - f)) * smoothstep(0.08, 0.02, fwidth(k));
        float t = la; la = ac; ac = t;
      }
      float seed = hash11(pid * 7.13 + 1.7);
      float g = fbm2(vec2(ac * 34.0 + seed * 40.0, la * 1.4 + seed * 13.0));
      float g2 = vnoise(vec2(ac * 150.0, la * 5.0 + seed * 9.0));
      vec3 c = diffuseColor.rgb * (0.66 + 0.6 * g) * (0.88 + 0.24 * g2) * (0.82 + 0.36 * seed);
      float top = smoothstep(0.4, 0.9, vWNormal.y);
      c = mix(c, vec3(dot(c, vec3(0.34))) * vec3(1.06, 1.0, 0.92) * 1.25, top * 0.45);      // sun-bleached silver on top
      c *= 1.0 - 0.72 * gap;
      float oil = fbm2(vWPos.xz * 1.7);
      c *= 0.8 + 0.3 * oil;
      diffuseColor.rgb = c;
    }`,
    surface: 'roughnessFactor = 0.88;',
  });

  // ---- granite masonry / plinths -----------------------------------------------------------------
  M.stone = mk({ color: 0x8d877c, roughness: 0.9, metalness: 0, vertexColors: true }, {
    key: 'trn_stone',
    color: /* glsl */`{
      vec3 wp = vWPos; const float course = 0.44; const float bl = 0.95;
      float row = floor(wp.y / course);
      float h = (abs(vWNormal.x) > 0.5 ? wp.z : wp.x) + mod(row, 2.0) * bl * 0.5;
      float bid = floor(h / bl);
      vec2 f = vec2(fract(h / bl) * bl, fract(wp.y / course) * course);
      float jd = min(min(f.x, bl - f.x), min(f.y, course - f.y));
      float joint = (1.0 - smoothstep(0.004, 0.022, jd)) * step(abs(vWNormal.y), 0.5) * smoothstep(0.05, 0.012, fwidth(wp.y) + fwidth(h));
      float tone = hash12(vec2(bid, row));
      float n = fbm3(wp * 2.6); float nf = fbm3(wp * 19.0);
      vec3 c = diffuseColor.rgb * (0.78 + 0.34 * tone) * (0.78 + 0.3 * n) * (0.9 + 0.2 * nf);
      float damp = smoothstep(1.6, 0.0, wp.y - ${ctx.GROUND_Y.toFixed(2)}) * (0.4 + 0.6 * n);
      c = mix(c, c * vec3(0.5, 0.52, 0.5), damp * 0.6);
      float streak = fbm2(vec2((wp.x + wp.z) * 3.0, wp.y * 0.3));
      c *= 1.0 - 0.3 * smoothstep(0.5, 0.8, streak);
      diffuseColor.rgb = mix(c, c * 0.3, joint);
    }`,
  });

  // ---- sheet roofing (canopies: standing seams; sheds: corrugated iron). Underside = painted boards -----------
  const sheet = (pitch, sharp, key) => ({
    key, uniforms: { uPitch: { value: pitch }, uSharp: { value: sharp } },
    fragPars: 'uniform float uPitch; uniform float uSharp; float shG_ = 0.0; vec3 shAx_ = vec3(0.0, 0.0, 1.0); float shR_ = 0.5;',
    color: /* glsl */`{
      vec3 wp = vWPos; bool zf = abs(vWNormal.z) > 0.7;
      float co = zf ? wp.x : wp.z; shAx_ = zf ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
      float k = co / uPitch; float f = fract(k) - 0.5;
      float fade = smoothstep(1.0, 0.3, fwidth(k));
      float n = fbm3(wp * 1.3); float nf = fbm3(wp * 9.0);
      vec3 c;
      if (vWNormal.y < -0.15) {               // underside: painted boards
        float b = wp.z / 0.14; float bf = fract(b);
        c = vec3(0.62, 0.58, 0.47) * (0.85 + 0.3 * hash11(floor(b))) * (0.85 + 0.3 * nf);
        c *= 1.0 - 0.6 * smoothstep(0.06, 0.0, min(bf, 1.0 - bf)) * smoothstep(0.6, 0.2, fwidth(b));
        c *= 1.0 + 2.2 * uNight;                 // lamp-lit canopy soffit (the top-down light map is weak on down-facing surfaces)
        shG_ = 0.0; shR_ = 0.75;
      } else {
        c = diffuseColor.rgb * (0.75 + 0.4 * n) * (0.9 + 0.2 * nf);
        float streak = fbm2(vec2(co * 4.0, (wp.y + (zf ? 0.0 : wp.x) * 0.6) * 0.5));
        float rust = smoothstep(0.58, 0.85, n * 0.6 + streak * 0.45 + nf * 0.15);
        c = mix(c, mix(vec3(0.20, 0.08, 0.03), vec3(0.33, 0.16, 0.07), nf), rust * 0.75);
        if (uSharp > 0.5) { float seam = smoothstep(0.42, 0.47, abs(f)); shG_ = sign(f) * seam * 1.6 * fade; c *= 1.0 - 0.25 * seam * fade; }
        else { shG_ = -sin(f * 6.2831853) * 0.9 * fade; c *= 0.86 + 0.14 * cos(f * 6.2831853) * fade; }
        shR_ = mix(0.42, 0.9, rust);
      }
      diffuseColor.rgb = c;
    }`,
    surface: 'roughnessFactor = shR_; metalnessFactor = 0.0;',
    normal: 'normal = normalize(normal + worldToViewDir(shAx_) * shG_ * 0.55);',
  });
  M.roof = mk({ color: 0x5d6a66, roughness: 0.5, metalness: 0, vertexColors: true, side: THREE.DoubleSide }, sheet(0.46, 1, 'trn_roof'));
  M.corr = mk({ color: 0x566058, roughness: 0.6, metalness: 0, vertexColors: true, side: THREE.DoubleSide }, sheet(0.17, 0, 'trn_corr'));

  // ---- painted joinery / cast iron details (colour from vertex colours) ---------------------------
  M.paint = mk({ color: 0xffffff, roughness: 0.55, metalness: 0, vertexColors: true }, {
    key: 'trn_paint',
    fragPars: 'float pnf_ = 0.5;',
    color: /* glsl */`{
      vec3 wp = vWPos; float n = fbm3(wp * 2.2); pnf_ = fbm3(wp * 17.0);
      vec3 c = diffuseColor.rgb * (0.82 + 0.26 * n) * (0.9 + 0.2 * pnf_);
      float streak = fbm2(vec2((wp.x + wp.z) * 9.0, wp.y * 0.7));
      c *= 1.0 - 0.28 * smoothstep(0.45, 0.8, streak);
      float chip = smoothstep(0.71, 0.76, fbm3(wp * 5.0 + 3.0) * 0.7 + pnf_ * 0.3);
      c = mix(c, vec3(0.16, 0.11, 0.075), chip * 0.7);
      diffuseColor.rgb = c;
    }`,
    surface: 'roughnessFactor = 0.45 + 0.3 * pnf_;',
  });

  // ---- rails ------------------------------------------------------------------------------------
  M.rail = mk({ color: 0xffffff, roughness: 0.6, metalness: 0, vertexColors: true }, {
    key: 'trn_rail',
    fragPars: 'float rlTop_ = 0.0;',
    color: /* glsl */`{
      rlTop_ = smoothstep(0.7, 0.95, vWNormal.y) * diffuseColor.r;
      vec3 rustC = vec3(0.15, 0.075, 0.04) * (0.6 + 0.8 * fbm3(vWPos * 4.0));
      float wearN = 0.85 + 0.15 * vnoise(vWPos.xz * vec2(60.0, 0.7));
      diffuseColor.rgb = mix(rustC, vec3(0.70, 0.71, 0.73) * wearN, rlTop_);
    }`,
    surface: 'metalnessFactor = rlTop_; roughnessFactor = mix(0.9, 0.24, rlTop_);',
  });

  // ---- lamps (emissive = colour * mix(day, night, uNight); head/tail selection for trams) ---------
  const LAMP_FRAG = /* glsl */`
    varying vec4 vFace; uniform float uDir; uniform float uSpark;
    float lampSel() {
      if (vFace.w > 2.5) {                       // third-rail shoe arcing: brief random flashes on the side that touches the rail
        float fl = step(0.982, hash11(floor(uTime * 30.0) * 1.37 + vFace.w * 17.3 + vFace.z * 5.1));
        return step(0.0, vFace.z * uDir) * fl * uSpark * (0.12 + 0.88 * uNight);
      }
      if (vFace.w > 1.5) return step(0.0, -vFace.z * uDir);
      if (vFace.w > 0.5) return step(0.0, vFace.z * uDir);
      return 1.0;
    }`;
  M.makeLamp = (uDir = { value: 0 }, uSpark = { value: 0 }) => mk({ color: 0xffffff, roughness: 0.35, metalness: 0, vertexColors: true }, {
    ...FACE_V, key: 'trn_lamp', uniforms: { uDir, uSpark },
    fragPars: LAMP_FRAG,
    emissive: 'totalEmissiveRadiance += diffuseColor.rgb * mix(vFace.x, vFace.y, uNight) * lampSel();',
  });
  M.lamp = M.makeLamp();

  // ---- printed / enamelled surfaces from the canvas atlas ----------------------------------------
  M.makePrint = (uDir = { value: 0 }, tram = false) => mk({ color: 0xffffff, roughness: 0.38, metalness: 0, vertexColors: true, map: atlas }, {
    key: tram ? 'trn_print_t' : 'trn_print', uniforms: { uDir, uTrnFill: TRN_FILL }, defines: tram ? { NO_CITY_LIGHTS: 1, NO_CITY_AO: 1 } : {},
    vertexPars: 'attribute vec4 aFace; varying vec4 vFace; varying vec3 vTL; uniform float uDir;',
    vertex: 'vFace = aFace; vMapUv.y += aFace.z * step(uDir, -0.5);',
    vertexEnd: 'vTL = transformed;',
    fragPars: 'varying vec4 vFace;' + (tram ? TRAM_GLSL : ''),
    color: /* glsl */`{
      float n = fbm3(vWPos * 6.0); diffuseColor.rgb *= 0.86 + 0.22 * n;
    }`,
    emissive: 'totalEmissiveRadiance += diffuseColor.rgb * mix(vFace.x, vFace.y, uNight);',
    ao: tram ? /* glsl */`if (vFace.w > 0.5) {
      reflectedLight.indirectDiffuse *= 0.05; reflectedLight.indirectSpecular *= 0.05;
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.66, 0.36) * mix(0.02, 1.5, uNight) * 1.1 * mix(0.5, 1.0, ssao_);
      trnInterior(reflectedLight, diffuseColor.rgb, vec3(0.04), 0.4, 0.0, vTL, viewToWorldDir(normal), 0.0, ssao_);
    }` : '',
  });
  M.print = M.makePrint();

  // ---- tram: exterior paint (two-tone by local height) -------------------------------------------
  M.makeTramPaint = (low, up) => mk({ color: 0xffffff, roughness: 0.3, metalness: 0, vertexColors: true }, {
    ...FACE_V, key: 'trn_tpaint',
    uniforms: { uLow: { value: new THREE.Color(low) }, uUp: { value: new THREE.Color(up) } },
    fragPars: 'varying vec4 vFace; uniform vec3 uLow; uniform vec3 uUp; float pd_ = 0.0;',
    color: /* glsl */`{
      float y = vFace.y; float z = vFace.x; float x = vFace.z;
      float isBody = step(0.98, min(vColor.r, min(vColor.g, vColor.b)));
      vec3 c = mix(vec3(0.03, 0.03, 0.034), uLow, smoothstep(0.585, 0.60, y));
      c = mix(c, vec3(0.70, 0.50, 0.17), smoothstep(1.575, 1.59, y));
      c = mix(c, uUp, smoothstep(1.625, 1.64, y));
      c = mix(c, uLow, smoothstep(2.835, 2.85, y));
      c = mix(c, vec3(0.30, 0.31, 0.32), smoothstep(2.975, 2.99, y));
      float seamV = (1.0 - smoothstep(0.0, 0.006, abs(fract(z / 1.62 + 0.5) - 0.5) * 1.62)) * smoothstep(0.02, 0.004, fwidth(z)) * step(y, 2.94) * step(0.6, y);
      float seamH = (1.0 - smoothstep(0.0, 0.005, abs(y - 1.03))) * smoothstep(0.02, 0.004, fwidth(y));
      c *= 1.0 - 0.4 * max(seamV, seamH);
      c = mix(vColor.rgb, c, isBody);
      float n = fbm2(vec2(z * 1.3, y * 2.1) + x * 0.7);
      float nf = fbm2(vec2(z * 14.0, y * 9.0) + x * 3.0);
      float dust = smoothstep(1.35, 0.45, y) * (0.3 + 0.6 * n);
      float streak = fbm2(vec2(z * 22.0 + x * 5.0, y * 0.8)) * smoothstep(3.0, 2.3, y) * smoothstep(1.2, 2.7, y);
      float roofG = smoothstep(2.95, 3.3, y) * (0.3 + 0.6 * n);
      c *= 0.9 + 0.2 * nf;
      c = mix(c, vec3(0.085, 0.07, 0.055), clamp(dust * 0.55 + streak * 0.2 + roofG * 0.5, 0.0, 0.8));
      pd_ = clamp(dust * 0.8 + roofG + streak * 0.3, 0.0, 1.0);
      diffuseColor.rgb = c;
    }`,
    surface: 'roughnessFactor = mix(0.26, 0.82, pd_); metalnessFactor = 0.0;',
  });

  // ---- tram: everything else that is opaque (class per vertex in aFace.w; +10 = interior) ---------
  M.makeTramSolid = () => mk({ color: 0xffffff, roughness: 0.6, metalness: 0, vertexColors: true }, {
    ...TRAM_V, key: 'trn_tsolid', defines: { NO_CITY_LIGHTS: 1 },
    uniforms: { uInAmb: { value: 0.06 }, uLampCol: { value: new THREE.Color(1.0, 0.66, 0.36) }, uLampDay: { value: 0.02 }, uLampNight: { value: 1.5 }, uTrnFill: TRN_FILL },
    fragPars: 'varying vec4 vFace; uniform float uInAmb; uniform vec3 uLampCol; uniform float uLampDay; uniform float uLampNight; float tCls_ = 0.0; float tIn_ = 0.0; float tR_ = 0.7; float tM_ = 0.0; float tG_ = 0.0; float tGz_ = 0.0;' + TRAM_GLSL,
    color: /* glsl */`{
      float w = vFace.w; tIn_ = step(9.5, w); tCls_ = floor(mod(w, 10.0) + 0.5);
      vec3 lp = vec3(vFace.z, vFace.y, vFace.x);
      vec3 c = diffuseColor.rgb;
      float n = fbm3(lp * 3.0); float nf = fbm3(lp * 23.0);
      if (tCls_ < 0.5) { c *= 0.7 + 0.5 * n; c = mix(c, vec3(0.11, 0.09, 0.07), 0.4 * nf); tR_ = 0.85; }
      else if (tCls_ < 1.5) {                    // painted steel panels: semi-gloss enamel, scuffs, panel joints with screws
        c *= 0.88 + 0.2 * n;
        float scuff = smoothstep(1.95, 0.95, lp.y) * nf;
        c = mix(c, c * 0.55, scuff * 0.55); tR_ = 0.34 + 0.22 * nf;
        if (tIn_ > 0.5 && abs(vWNormal.x) > 0.8 && lp.y > T_SILL - 0.1) {
          float az = abs(mod(lp.z + 7.6, 15.2) - 7.6);
          float jz = min(min(abs(az - 1.0), abs(az - 2.9)), abs(az - 4.62));
          float fw = fwidth(lp.z) + fwidth(lp.y);
          float fade = 1.0 - smoothstep(0.003, 0.012, fw);
          float joint = (1.0 - smoothstep(0.0010, 0.0028, jz)) * fade;
          vec2 sp = vec2(jz - 0.022, (fract(lp.y / 0.13) - 0.5) * 0.13);
          vec2 sp2 = vec2((fract(lp.z / 0.16) - 0.5) * 0.16, lp.y - (T_HEAD + 0.215));
          float sr = min(length(sp), length(sp2));
          vec2 sq = length(sp) < length(sp2) ? sp : sp2;
          float screw = (1.0 - smoothstep(0.0042, 0.0056, sr)) * fade;
          float ha = hash12(floor(vec2(lp.z / 0.16, lp.y / 0.13))) * 3.14159;
          float slot = 1.0 - smoothstep(0.0005, 0.0011, abs(sq.x * cos(ha) + sq.y * sin(ha)));
          float ring = smoothstep(0.0056, 0.0075, sr) * (1.0 - smoothstep(0.0075, 0.012, sr)) * fade;
          c *= 1.0 - 0.6 * joint - 0.22 * ring;
          c = mix(c, vec3(0.50, 0.50, 0.52) * (1.0 - 0.75 * slot), screw);
          tR_ = mix(tR_, 0.3, screw); tM_ = screw;
        }
      } else if (tCls_ < 2.5) {
        float rib = lp.x / 0.05; float f = fract(rib) - 0.5;
        float fade = smoothstep(1.1, 0.3, fwidth(rib));
        float groove = smoothstep(0.22, 0.42, abs(f)) * fade;
        float wear = smoothstep(0.85, 0.1, abs(lp.x)) * (0.3 + 0.7 * fbm2(vec2(lp.x * 3.0, lp.z * 0.7)));
        c = mix(c, c * 2.1 + 0.02, wear * 0.55);
        float stain = fbm2(vec2(lp.x * 2.0 + 5.0, lp.z * 1.3));
        float scr = smoothstep(0.80, 0.95, vnoise(vec2(lp.x * 90.0 + lp.z * 8.0, lp.z * 3.0))) * (1.0 - groove);
        c *= (1.0 - 0.7 * groove) * (0.7 + 0.5 * nf) * (0.75 + 0.5 * stain);
        c = mix(c, c * 1.6 + 0.015, scr * 0.5);
        tG_ = sign(f) * groove * 1.1; tR_ = mix(0.62, 0.30, wear * (1.0 - groove));
      } else if (tCls_ < 3.5) {
        float g = fbm2(vec2((lp.x + lp.y) * 55.0, lp.z * 1.4));
        float g2 = vnoise(vec2((lp.x + lp.y) * 240.0, lp.z * 5.0));
        c *= (0.6 + 0.75 * g) * (0.86 + 0.28 * g2); tR_ = 0.26 + 0.3 * g;
      } else if (tCls_ < 4.5) {                  // aluminium / brass fittings: fine brushing along the car
        float br = vnoise(vec2((lp.x + lp.y) * 900.0, lp.z * 6.0)) * (1.0 - smoothstep(0.0008, 0.003, fwidth(lp.x + lp.y)));
        tM_ = 1.0; tR_ = 0.30 + 0.18 * nf + 0.10 * br; c *= (0.88 + 0.24 * n) * (0.94 + 0.12 * br);
      }
      else if (tCls_ < 5.5) { tR_ = 0.9; c *= 0.75 + 0.5 * nf; }
      else if (tCls_ < 6.5) {                    // strap leather (strap-local coordinates): burnished edges, saddle stitching
        float fy = fwidth(lp.y) + fwidth(lp.z);
        float fade = 1.0 - smoothstep(0.0012, 0.004, fy);
        float st = (1.0 - smoothstep(0.0007, 0.0015, abs(abs(lp.z) - 0.0096))) * step(0.38, fract(lp.y / 0.0058)) * fade;
        float gr = vnoise(lp.yz * 1300.0) * fade;
        c *= (0.72 + 0.5 * nf) * (0.85 + 0.3 * gr) * (1.0 - 0.45 * smoothstep(0.0105, 0.013, abs(lp.z)));
        c = mix(c, vec3(0.60, 0.50, 0.34), st * 0.85);
        tR_ = 0.48 + 0.2 * nf;
      } else if (tCls_ < 7.5) {                  // leatherette upholstery: padded panels, creases, wear on the nose and the top roll
        float xi = 1.18 - abs(lp.x); float yy = lp.y - T_FL;
        float pad = (mod(lp.z + 7.6, 15.2) - 7.6) / 0.4867; float pc = fract(pad) - 0.5;
        float fwp = fwidth(pad);
        float seam = (1.0 - smoothstep(0.010, 0.032, 0.5 - abs(pc))) * (1.0 - smoothstep(0.15, 0.6, fwp));
        float edge = smoothstep(0.40, 0.46, xi) * smoothstep(0.40, 0.44, yy) + smoothstep(0.655, 0.69, yy) * step(xi, 0.12);
        float crease = fbm2(vec2(lp.z * 13.0, (xi + yy) * 34.0));
        float crack = smoothstep(0.72, 0.9, vnoise(vec2(lp.z * 210.0, (xi - yy) * 260.0))) * (1.0 - smoothstep(0.001, 0.004, fwidth(lp.z)));
        float wear = clamp(edge * 0.75 + smoothstep(0.55, 0.85, crease) * 0.4 + (1.0 - 2.0 * abs(pc)) * 0.22, 0.0, 1.0);
        c = mix(c, c * 1.9 + vec3(0.035, 0.016, 0.010), wear * 0.6);
        c *= (0.82 + 0.34 * n) * (1.0 - 0.65 * seam) * (1.0 - 0.3 * crack * wear);
        tR_ = mix(0.52, 0.30, wear) + 0.12 * nf;
        tGz_ = (pc * 0.45 + sign(pc) * seam * 0.9) * (1.0 - smoothstep(0.15, 0.6, fwp));
      } else if (tCls_ < 8.5) {                  // brushed stainless: stanchions and grab rails, smudged at hand height
        float br = vnoise(vec2(lp.y * 700.0, (lp.x + lp.z) * 30.0)) * (1.0 - smoothstep(0.0008, 0.003, fwidth(lp.y)));
        float smudge = smoothstep(0.45, 0.8, fbm2(vec2((lp.x + lp.z) * 9.0, lp.y * 6.0))) * smoothstep(T_FL + 0.7, T_FL + 1.0, lp.y) * smoothstep(T_FL + 1.75, T_FL + 1.4, lp.y);
        tM_ = 1.0; tR_ = 0.20 + 0.10 * br + 0.22 * smudge; c *= 0.92 + 0.12 * n;
      } else {                                   // moulded plastic (strap rings, hammer box, door-edge strip)
        tR_ = 0.26 + 0.2 * nf; c *= (0.86 + 0.22 * n) * (0.9 + 0.2 * nf);
      }
      diffuseColor.rgb = c;
    }`,
    surface: 'roughnessFactor = tR_; metalnessFactor = tM_;',
    normal: 'normal = normalize(normal + worldToViewDir(vec3(1.0, 0.0, 0.0)) * tG_ + worldToViewDir(vec3(0.0, 0.0, 1.0)) * tGz_);',
    ao: /* glsl */`{
      float amb_ = mix(1.0, uInAmb, tIn_);
      reflectedLight.indirectDiffuse *= amb_; reflectedLight.indirectSpecular *= amb_;
      vec3 lamp_ = uLampCol * mix(uLampDay, uLampNight, uNight) * tIn_;
      float lg_ = (0.62 + 0.38 * vWNormal.y) * mix(0.5, 1.35, smoothstep(0.9, 3.3, vTL.y)) * mix(1.0, 0.72, smoothstep(0.25, 1.2, abs(vTL.x)));
      reflectedLight.indirectDiffuse += diffuseColor.rgb * (1.0 - tM_) * lamp_ * lg_ * mix(0.5, 1.0, ssao_);
      reflectedLight.indirectSpecular += lamp_ * 0.35 * tM_ * mix(0.5, 1.0, ssao_);
      if (tIn_ > 0.5) {
        float rimK_ = tCls_ > 7.5 ? 0.05 : (tCls_ > 5.5 && tCls_ < 6.5 ? 0.02 : (tCls_ > 3.5 && tCls_ < 4.5 ? 0.03 : 0.0));
        trnInterior(reflectedLight, diffuseColor.rgb, mix(vec3(0.04), diffuseColor.rgb, tM_), tR_, tM_, vTL, viewToWorldDir(normal), rimK_, ssao_);
      }
    }`,
  });

  // ---- tram glass: Fresnel sky reflection outside + back-lit dirt, premultiplied "over" with transmittance in alpha ----
  M.makeGlass = () => mk({
    color: 0xffffff, roughness: 1, metalness: 0, transparent: true, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  }, {
    ...TRAM_V, key: 'trn_glass', defines: { NO_CITY_LIGHTS: 1 },
    uniforms: { uDirt: { value: 0.55 }, uTrnFill: TRN_FILL },
    fragPars: /* glsl */`
      varying vec4 vFace; uniform float uDirt;
      ${TRAM_GLSL}
      // thin film + wiped arcs + dust settled on the lower edge
      float glassSmear(vec2 p, float s) {
        float blot = fbm2(p * 1.7 + s * 3.1);
        float d = 0.03 + 0.09 * smoothstep(0.45, 0.85, blot);
        vec2 wc = vec2(floor(p.x / 1.93 + 0.5) * 1.93 + 0.25, T_SILL - 0.45);
        vec2 dv = p - wc; float rr = length(dv);
        float streak = vnoise(vec2(rr * 130.0, atan(dv.y, dv.x) * 3.0 + s));
        float band = vnoise(vec2(rr * 31.0 + 5.0, 1.7 + s));
        d += (0.10 * smoothstep(0.55, 0.95, streak) + 0.07 * band) * smoothstep(0.38, 0.72, fbm2(p * 2.6 + 17.0));
        float yb = max(p.y - T_SILL, 0.0);
        d += exp(-yb / 0.05) * (0.30 + 0.55 * fbm2(vec2(p.x * 9.0, p.y * 40.0)));
        d += exp(-yb / 0.22) * 0.07;
        return d;
      }
      // rain-dried drop marks: mineral rings with a faint run-off tail
      float glassDrops(vec2 p) {
        float acc = 0.0;
        for (int L = 0; L < 2; L++) {
          float cs = L == 0 ? 0.036 : 0.075;
          vec2 g = p / cs; vec2 id = floor(g); vec2 f = fract(g);
          float h = hash12(id + float(L) * 17.3);
          float clump = fbm2(id * cs * 2.6 + 4.0);
          float prob = 0.05 + 0.30 * smoothstep(0.55, 0.85, clump);
          if (h < prob) {
            vec2 c = 0.3 + 0.4 * vec2(hash12(id * 1.7 + 3.1), hash12(id * 2.3 + 9.2));
            float rad = 0.10 + 0.15 * hash12(id + 31.0);
            vec2 q = f - c; float r = length(q);
            float ring = smoothstep(rad * 0.60, rad * 0.9, r) * (1.0 - smoothstep(rad * 0.9, rad * 1.08, r));
            float core = (1.0 - smoothstep(0.0, rad * 0.9, r)) * 0.22;
            float tail = (1.0 - smoothstep(0.0, rad * 0.3, abs(q.x))) * step(q.y, 0.0) * (1.0 - smoothstep(0.0, rad * 2.6, -q.y)) * 0.25;
            acc += (ring + core + tail) * (0.45 + 0.55 * h / prob);
          }
        }
        // fine dust specks
        vec2 g2 = p / 0.007; vec2 id2 = floor(g2); float h2 = hash12(id2 + 71.0);
        if (h2 < 0.07) { vec2 c2 = 0.25 + 0.5 * vec2(hash12(id2 * 1.3 + 5.0), hash12(id2 * 2.1 + 8.0)); acc += 0.9 * (1.0 - smoothstep(0.06, 0.16 + 0.12 * h2 / 0.07, length(fract(g2) - c2))); }
        return acc * (1.0 - smoothstep(0.004, 0.02, fwidth(p.x) + fwidth(p.y)));
      }
      // fine scratches: each one lights up only where the sun's deflection is perpendicular to it (the halo of
      // concentric scratches around a low sun)
      float glassScratch(vec2 p, vec2 kd, float s) {
        float acc = 0.0;
        float fade = 1.0 - smoothstep(0.0015, 0.006, fwidth(p.x) + fwidth(p.y));
        for (int i = 0; i < 6; i++) {
          float fi = float(i);
          float a = (fi + 0.37) * 0.5236 + s;
          vec2 d = vec2(cos(a), sin(a)); vec2 e = vec2(-d.y, d.x);
          vec2 q = vec2(dot(p, e), dot(p, d));
          q.x += 0.004 * sin(q.y * 9.0 + fi * 2.1);
          q.x += 0.012 * vnoise(vec2(q.y * 2.0 + fi * 3.0, q.x * 1.3));
          float line = vnoise(vec2(q.x * 330.0 + fi * 13.0, q.y * 7.0 + fi * 5.0));
          float sc = smoothstep(0.87, 0.975, line) * smoothstep(0.35, 0.7, vnoise(q * vec2(4.0, 2.2) + 7.0 * fi));
          float w = dot(kd, d);
          acc += sc * exp(-w * w / 0.05);
        }
        return acc * fade;
      }`,
    normal: '{ vec3 ld_ = worldToViewDir(uLightDir); if (dot(normal, ld_) < 0.0) normal = -normal; }',
    final: /* glsl */`{
      vec3 V_ = normalize(uCamPos - vWPos);
      vec3 Ng_ = normalize(vWNormal);
      float front_ = step(0.0, dot(Ng_, V_));
      vec3 Nf_ = Ng_ * (front_ * 2.0 - 1.0);
      float outside_ = front_ * step(vFace.w, 3.5);            // classes > 3 are interior partitions (no sky reflection)
      float ndv_ = clamp(dot(Nf_, V_), 0.0, 1.0);
      float F_ = 0.045 + 0.955 * pow(1.0 - ndv_, 5.0);
      vec3 R_ = reflect(-V_, Nf_);
      vec3 sky_ = skyLUT(uSkyLUT, normalize(vec3(R_.x, max(R_.y, 0.04), R_.z)));
      sky_ *= mix(0.22, 1.0, smoothstep(-0.05, 0.35, R_.y));
      vec3 sunE_ = reflectedLight.directDiffuse * PI;
      vec3 refl_ = mix(vec3(0.003), sky_, outside_) * F_;
      refl_ += outside_ * F_ * sunE_ * pow(max(dot(R_, uLightDir), 0.0), 900.0) * 60.0;
      if (front_ < 0.5 && vFace.w < 3.5) {       // seen from inside: double image of the ceiling lamps + ghost of the far side
        vec3 lp_ = vTL; float g_ = 0.0;
        if (R_.y > 0.02) {
          vec3 h_ = lp_ + R_ * ((3.28 - lp_.y) / R_.y);
          float dz_ = (fract(h_.z / 1.4667) - 0.5) * 1.4667;
          g_ = exp(-(h_.x * h_.x + dz_ * dz_) / 0.0075) + 0.45 * exp(-((h_.x + 0.035) * (h_.x + 0.035) + dz_ * dz_) / 0.0075);
        }
        refl_ += F_ * vec3(1.0, 0.80, 0.52) * (mix(0.12, 26.0, uNight) * g_ + 0.22 * mix(0.02, 1.5, uNight));
        if (abs(R_.x) > 0.05) {
          float sd_ = sign(R_.x); float t_ = (sd_ * 1.21 - lp_.x) / R_.x;
          vec3 h_ = lp_ + R_ * t_;
          float strip_ = trnWinZ(h_.z, 0.05) * smoothstep(T_SILL - 0.22, T_SILL - 0.17, h_.y) * (1.0 - smoothstep(T_SILL - 0.06, T_SILL - 0.02, h_.y)) * step(uLightDir.x * sd_, 0.0);
          refl_ += 2.0 * F_ * (trnSkyDir(R_) * trnWin(h_.z, h_.y, 0.03) * 0.8 + sunE_ * 0.03 * strip_) * (1.0 - 0.85 * uNight);
        }
      }
      vec2 gp_ = vFace.xy; float gs_ = floor(vFace.z * 0.5 + 0.5) * 1.7 + floor(vFace.x / 1.93 + 0.5) * 0.61;
      float smear_ = glassSmear(gp_, gs_) * uDirt;
      float drops_ = glassDrops(gp_ + gs_ * 3.3) * uDirt;
      vec3 kv_ = V_ + uLightDir; vec2 kp_ = kv_.zy; float km_ = length(kp_);
      float scr_ = glassScratch(gp_, kp_ / max(km_, 1e-4), gs_) * uDirt;
      float cosS_ = max(dot(-V_, uLightDir), 0.0);
      float fwd_ = 3.0 * pow(cosS_, 70.0) + 0.45 * pow(cosS_, 9.0) + 0.02;
vec3 back_ = front_ < 0.5 ? trnSkyDir(-V_) : vec3(0.0);                // bright sky / haze seen through the pane back-lights the film
      vec3 scat_ = (smear_ + 0.7 * drops_) * (sunE_ * fwd_ * 0.16 + uAmbient * 0.03 + back_ * 0.12);
      scat_ += sunE_ * scr_ * (0.5 / (1.0 + km_ * km_ * km_ * km_ / 0.004) + 0.003);
      outgoingLight = refl_ + scat_;
      diffuseColor.a = (1.0 - F_) * 0.965 * (1.0 - 0.10 * clamp(smear_, 0.0, 1.0) - 0.16 * clamp(drops_, 0.0, 1.0));
    }`,
  });

  return M;
}

/** canvas atlas with all the lettering / prints. Returns { tex, rect(name) -> [u0,v0,u1,v1], dv(a,b) } */
export function makeAtlas(stations, rng) {
  const W = 2048, H = 2048; const rects = {};
  const reg = (name, x, y, w, h) => { rects[name] = [x / W, 1 - (y + h) / H, (x + w) / W, 1 - y / H]; return [x, y, w, h]; };
  let tex;
  if (typeof document === 'undefined') {
    tex = new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1); tex.needsUpdate = true;
    stations.forEach((s, i) => reg('st' + i, 0, i * 200, 1400, 200));
    reg('destS', 0, 640, 900, 150); reg('destN', 0, 800, 900, 150); reg('clock', 1500, 0, 500, 500);
    for (let i = 0; i < 8; i++) reg('ad' + i, (i % 4) * 512, 1000 + Math.floor(i / 4) * 200, 512, 190);
    reg('way', 0, 1500, 700, 220); reg('line', 0, 1750, 1400, 120); reg('num', 1500, 600, 200, 200); reg('route', 720, 1500, 1300, 100);
    return { tex, rect: n => rects[n], rects };
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d');
  g.fillStyle = '#888'; g.fillRect(0, 0, W, H);
  const FONT = '"Gill Sans MT", "Gill Sans", "Segoe UI", "Trebuchet MS", sans-serif';
  const speckle = (x, y, w, h, n, col) => { for (let i = 0; i < n; i++) { g.fillStyle = col; const px = x + rng() * w, py = y + rng() * h, r = 0.6 + rng() * rng() * 5; g.beginPath(); g.arc(px, py, r, 0, 6.3); g.fill(); } };
  // enamel station name boards: deep blue, white lettering and border, chipped corners
  stations.forEach((s, i) => {
    const [x, y, w, h] = reg('st' + i, 0, i * 200, 1400, 200);
    g.fillStyle = '#0d2a52'; g.fillRect(x, y, w, h);
    g.strokeStyle = '#efe9da'; g.lineWidth = 9; g.strokeRect(x + 16, y + 16, w - 32, h - 32);
    g.fillStyle = '#efe9da'; g.font = `600 112px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = s.name.toUpperCase().split('').join(' ');
    g.fillText(txt, x + w / 2, y + h / 2 + 6, w - 120);
    speckle(x, y, w, h, 26, 'rgba(60,28,12,0.8)'); speckle(x, y, w, 26, 12, 'rgba(40,20,10,0.9)'); speckle(x, y + h - 26, w, 26, 12, 'rgba(40,20,10,0.9)');
  });
  // destination blinds (white on black)
  const blind = (name, y, txt) => {
    const [x, yy, w, h] = reg(name, 0, y, 900, 150);
    g.fillStyle = '#0a0a0a'; g.fillRect(x, yy, w, h);
    g.fillStyle = '#f4e9c8'; g.font = `700 104px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.fillText('1', x + 34, yy + h / 2 + 4);
    g.font = `600 84px ${FONT}`; g.textAlign = 'center'; g.fillText(txt, x + 500, yy + h / 2 + 4, 700);
  };
  const sorted = [...stations].sort((a, b) => a.z - b.z);
  blind('destS', 640, sorted[sorted.length - 1].name.toUpperCase()); blind('destN', 800, sorted[0].name.toUpperCase());
  // clock face
  {
    const [x, y, w, h] = reg('clock', 1500, 0, 500, 500); const cx = x + w / 2, cy = y + h / 2;
    g.fillStyle = '#16181a'; g.fillRect(x, y, w, h);
    g.fillStyle = '#efe6cf'; g.beginPath(); g.arc(cx, cy, 236, 0, 6.3); g.fill();
    g.strokeStyle = '#141414'; g.lineCap = 'butt';
    for (let i = 0; i < 60; i++) { const a = i / 60 * Math.PI * 2; const r0 = i % 5 === 0 ? 186 : 208; g.lineWidth = i % 5 === 0 ? 12 : 4; g.beginPath(); g.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); g.lineTo(cx + Math.sin(a) * 224, cy - Math.cos(a) * 224); g.stroke(); }
    const hand = (a, len, lw) => { g.lineWidth = lw; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx - Math.sin(a) * 30, cy + Math.cos(a) * 30); g.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len); g.stroke(); };
    hand((7 + 42 / 60) / 12 * Math.PI * 2, 126, 20); hand(42 / 60 * Math.PI * 2, 196, 13);
    g.fillStyle = '#141414'; g.beginPath(); g.arc(cx, cy, 16, 0, 6.3); g.fill();
  }
  // route number roundel
  {
    const [x, y, w, h] = reg('num', 1500, 600, 200, 200);
    g.fillStyle = '#e9e0c9'; g.fillRect(x, y, w, h); g.fillStyle = '#7a1420'; g.beginPath(); g.arc(x + 100, y + 100, 86, 0, 6.3); g.fill();
    g.fillStyle = '#f2ead6'; g.font = `700 130px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('1', x + 100, y + 108);
  }
  // abstract advertising cards (no real brands): colour fields, discs, stripes, a few fictional words
  const pal = [['#c9a35a', '#1e3b46', '#efe2c4'], ['#a8402f', '#f0dfbd', '#23201c'], ['#2f5d50', '#e8d9a8', '#c0562b'], ['#dcc9a0', '#3b2f52', '#b9482f'],
    ['#1f2f4f', '#d9a441', '#efe6d0'], ['#e6d6b8', '#2c4a3a', '#8f2f2a'], ['#8f9a8a', '#f1e7cf', '#30323a'], ['#d28b3c', '#2a2622', '#f3ead2']];
  const words = ['AUREL', 'SOL', 'MARE', 'NORD', 'LUX', 'ORO', 'VELA', 'FARO'];
  for (let i = 0; i < 8; i++) {
    const [x, y, w, h] = reg('ad' + i, (i % 4) * 512, 1000 + Math.floor(i / 4) * 200, 512, 190); const p = pal[i];
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = p[0]; g.fillRect(x, y, w, h);
    const k = i % 4;
    if (k === 0) { g.fillStyle = p[1]; g.beginPath(); g.arc(x + 120, y + 100, 74, 0, 6.3); g.fill(); g.fillStyle = p[2]; g.fillRect(x + 230, y + 120, 250, 14); }
    if (k === 1) { g.fillStyle = p[1]; for (let s = 0; s < 6; s++) g.fillRect(x + 20 + s * 34, y, 16, h); g.fillStyle = p[2]; g.beginPath(); g.moveTo(x + 250, y + 170); g.lineTo(x + 500, y + 170); g.lineTo(x + 500, y + 60); g.fill(); }
    if (k === 2) { g.fillStyle = p[1]; g.fillRect(x, y + 118, w, 72); g.fillStyle = p[2]; g.beginPath(); g.arc(x + 400, y + 118, 56, Math.PI, 0); g.fill(); }
    if (k === 3) { g.fillStyle = p[1]; g.beginPath(); g.moveTo(x, y + h); g.lineTo(x + 200, y + 30); g.lineTo(x + 330, y + h); g.fill(); g.fillStyle = p[2]; g.beginPath(); g.arc(x + 420, y + 64, 34, 0, 6.3); g.fill(); }
    g.fillStyle = k === 2 ? p[0] : p[2]; g.font = `700 64px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillText(words[i].split('').join(' '), x + (k === 0 ? 228 : k === 1 ? 250 : 26), y + (k === 2 ? 174 : k === 1 ? 52 : 100));
    g.restore();
    speckle(x, y, w, h, 14, 'rgba(40,30,20,0.25)');
  }
  // "WAY OUT" style direction board + line diagram strip
  {
    const [x, y, w, h] = reg('way', 0, 1500, 700, 220);
    g.fillStyle = '#efe6cf'; g.fillRect(x, y, w, h); g.strokeStyle = '#1c2b25'; g.lineWidth = 10; g.strokeRect(x + 14, y + 14, w - 28, h - 28);
    g.fillStyle = '#1c2b25'; g.font = `700 104px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TRAMWAY', x + w / 2, y + h / 2 + 6, w - 90);
    speckle(x, y, w, h, 20, 'rgba(70,40,20,0.5)');
  }
  {
    const [x, y, w, h] = reg('line', 0, 1750, 1400, 120);
    g.fillStyle = '#efe6cf'; g.fillRect(x, y, w, h); g.strokeStyle = '#7a1420'; g.lineWidth = 10; g.beginPath(); g.moveTo(x + 90, y + 44); g.lineTo(x + w - 90, y + 44); g.stroke();
    g.font = `600 34px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    sorted.forEach((s, i) => { const px = x + 90 + (w - 180) * (i / (sorted.length - 1)); g.fillStyle = '#efe6cf'; g.beginPath(); g.arc(px, y + 44, 17, 0, 6.3); g.fill(); g.lineWidth = 7; g.stroke(); g.fillStyle = '#1c1c1c'; g.fillText(s.name.toUpperCase(), Math.min(Math.max(px, x + 170), x + w - 170), y + 92); });
  }
  // route diagram strip for the saloon wall: line number roundel, the line with its stops, station names
  {
    const [x, y, w, h] = reg('route', 720, 1500, 1300, 100);
    g.fillStyle = '#e9dfc6'; g.fillRect(x, y, w, h);
    g.fillStyle = '#7a1420'; g.fillRect(x, y, w, 7); g.fillRect(x, y + h - 7, w, 7);
    g.beginPath(); g.arc(x + 62, y + 50, 30, 0, 6.3); g.fill();
    g.fillStyle = '#f2ead6'; g.font = `700 44px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('1', x + 62, y + 53);
    const xa = x + 190, xb = x + w - 110;
    g.strokeStyle = '#7a1420'; g.lineWidth = 8; g.beginPath(); g.moveTo(xa - 50, y + 34); g.lineTo(xb + 50, y + 34); g.stroke();
    g.font = `600 30px ${FONT}`;
    const stops = [sorted[0].name, null, sorted[1 % sorted.length].name, null, sorted[sorted.length - 1].name];
    stops.forEach((nm, i) => {
      const px = xa + (xb - xa) * i / (stops.length - 1);
      g.fillStyle = '#e9dfc6'; g.strokeStyle = '#7a1420'; g.lineWidth = nm ? 6 : 4; g.beginPath(); g.arc(px, y + 34, nm ? 13 : 7, 0, 6.3); g.fill(); g.stroke();
      if (nm) { g.fillStyle = '#1c1c1c'; g.fillText(nm.toUpperCase(), px, y + 72); }
    });
    speckle(x, y, w, h, 16, 'rgba(60,40,20,0.22)');
  }
  tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, rect: n => rects[n], rects };
}
