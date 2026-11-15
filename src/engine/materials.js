// Material factory: MeshStandard/Physical materials wired into the engine (shared uniforms, SSAO,
// world-space varyings) with optional GLSL hooks. All lit world materials should be created here.
import * as THREE from 'three';
import { G_GLSL, COMMON_GLSL, globalUniforms } from './globals.js';

function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

const AO_FN = /* glsl */`
float engineAO() {
  if (uAOOn < 0.5) return 1.0;
  vec2 hres = ceil(uResolution * 0.5);
  vec2 p = gl_FragCoord.xy * 0.5 - 0.5;
  vec2 base = floor(p); vec2 f = p - base;
  float myD = vViewPosition.z;
  float sum = 0.0; float wsum = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 uv = (base + vec2(float(i), float(j)) + 0.5) / hres;
    vec4 t = textureLod(uAOTex, uv, 0.0);
    float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float dw = 1.0 / (1.0 + 300.0 * abs(t.g - myD) / max(myD, 0.05));
    float w = bw * dw + 1e-5;
    sum += t.r * w; wsum += w;
  }
  return sum / wsum;
}
// large-scale sky visibility from the top-down city height map (street canyons, courtyards, under towers)
float citySkyVis() {
  vec2 n2 = vWNormal.xz;
  vec2 p0 = vWPos.xz + n2 * 2.4;
  float y = vWPos.y + 0.5;
  float jit = fract(ign(gl_FragCoord.xy) + uFrame * 0.618034);
  float sum = 0.0; float cnt = 0.0;
  for (int i = 0; i < 4; i++) {
    float a = (float(i) + jit) * 1.5707963;
    vec2 dir = vec2(cos(a), sin(a));
    if (dot(dir, n2) < -0.25) continue;
    float m = 0.0;
    for (int k = 0; k < 3; k++) {
      float r = k == 0 ? 5.0 : (k == 1 ? 14.0 : 36.0);
      float h = textureLod(uCityHeight, (p0 + dir * r - uCityRect.xy) / uCityRect.zw, 0.0).r;
      m = max(m, (h - y) / r);
    }
    sum += 1.0 / (1.0 + m * m); cnt += 1.0;
  }
  return cnt > 0.0 ? sum / cnt : 1.0;
}
`;

/**
 * hooks (all optional GLSL snippets):
 *   uniforms     : extra uniforms { name: {value} }
 *   defines      : extra #defines
 *   vertexPars   : declarations for the vertex shader
 *   vertex       : runs right after <begin_vertex>; may modify `transformed` (object space)
 *   vertexEnd    : runs at the end of the vertex main (vWPos / vWNormal are set)
 *   fragPars     : declarations/functions for the fragment shader
 *   color        : after base colour; modify `diffuseColor` (vec4, linear)
 *   surface      : after roughness/metalness; modify `roughnessFactor`, `metalnessFactor`
 *   normal       : after normal maps; modify `normal` (VIEW space). Helpers: worldToViewDir(), viewToWorldDir()
 *   emissive     : add to `totalEmissiveRadiance`
 *   ao           : after lighting; `ssao_` is the screen AO; modify `reflectedLight.*`
 *   final        : modify `outgoingLight` just before output
 * Available in fragment: vWPos (world position), vWNormal (world geometric normal), all shared uniforms (uTime, uSunDir, uNight ...)
 * and helpers from COMMON_GLSL (hash*, vnoise, fbm2/3, skyLUT).
 */
export function makeMaterial(params = {}, hooks = {}, Base = THREE.MeshStandardMaterial) {
  const mat = new Base(params);
  const key = 'eng:' + (hooks.key || strHash(JSON.stringify(Object.entries(hooks).filter(([k]) => k !== 'uniforms').map(([k, v]) => [k, String(v)]))));
  mat.userData.hooks = hooks;
  if (hooks.defines) mat.defines = { ...(mat.defines || {}), ...hooks.defines };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, globalUniforms(), hooks.uniforms || {});
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\n${G_GLSL}\n${hooks.vertexPars || ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${hooks.vertex || ''}`)
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>\nvWNormal = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        { vec4 wpos_ = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpos_ = instanceMatrix * wpos_;
        #endif
          wpos_ = modelMatrix * wpos_; vWPos = wpos_.xyz; }
        ${hooks.vertexEnd || ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\n${G_GLSL}\n${COMMON_GLSL}
        vec3 worldToViewDir(vec3 d) { return normalize((viewMatrix * vec4(d, 0.0)).xyz); }
        vec3 viewToWorldDir(vec3 d) { return normalize((vec4(d, 0.0) * viewMatrix).xyz); }`)
      .replace('#include <clipping_planes_pars_fragment>', `#include <clipping_planes_pars_fragment>\n${AO_FN}\n${hooks.fragPars || ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${hooks.color || ''}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${hooks.surface || ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${hooks.normal || ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${hooks.emissive || ''}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        float ssao_ = engineAO();
        reflectedLight.indirectDiffuse *= ssao_;
        #if defined( USE_ENVMAP ) && defined( STANDARD )
          reflectedLight.indirectSpecular *= computeSpecularOcclusion( saturate( dot( geometryNormal, geometryViewDir ) ), ssao_, material.roughness );
        #endif
        reflectedLight.directDiffuse *= mix(1.0, ssao_, 0.18);
        #ifndef NO_CITY_AO
        {
          float cvis_ = citySkyVis();
          reflectedLight.indirectDiffuse *= mix(1.0, cvis_, 0.78);
          reflectedLight.indirectSpecular *= mix(1.0, cvis_, 0.6);
          // warm bounce from sunlit facades / ground into enclosed spaces
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uLightColor * (0.05 * (1.0 - cvis_) + 0.006) * mix(0.5, 1.0, ssao_);
        }
        #endif
        #ifndef NO_CITY_LIGHTS
        if (uNight > 0.001) {
          vec2 cluv_ = (vWPos.xz - uCityLightRect.xy) / uCityLightRect.zw;
          vec3 cl_ = texture2D(uCityLights, cluv_).rgb;
          float hf_ = exp(-max(vWPos.y - 9.0, 0.0) / 6.5) * (0.55 + 0.45 * clamp(vWNormal.y, 0.0, 1.0));
          reflectedLight.indirectDiffuse += diffuseColor.rgb * cl_ * hf_ * (uNight * uCityGain) * mix(0.55, 1.0, ssao_);
          // faint city sky-glow so unlit facades keep their shape at night
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(0.060, 0.052, 0.050) * uNight * mix(1.0, 0.4, smoothstep(8.0, 120.0, vWPos.y)) * (0.35 + 0.65 * ssao_);
        }
        #endif
        ${hooks.ao || ''}`)
      .replace('#include <opaque_fragment>', `${hooks.final || ''}\n#include <opaque_fragment>`);
    if (hooks.onCompile) hooks.onCompile(shader);
  };
  mat.customProgramCacheKey = () => key;
  return mat;
}

/** Unlit additive/emissive ShaderMaterial helper sharing the global uniforms (for glows, light sprites, etc.). */
export function makeShaderMaterial({ uniforms = {}, vertexShader, fragmentShader, ...rest }) {
  return new THREE.ShaderMaterial({
    uniforms: { ...globalUniforms(), ...uniforms },
    vertexShader: `${G_GLSL}\n${vertexShader}`,
    fragmentShader: `precision highp float;\n${G_GLSL}\n${COMMON_GLSL}\n${fragmentShader}`,
    toneMapped: false, ...rest,
  });
}
