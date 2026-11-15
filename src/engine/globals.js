// Shared uniforms. Every custom shader in the project references these objects directly,
// so updating `.value` once per (sub)frame updates all materials.
import * as THREE from 'three';

export const G = {
  time:       { value: 0 },                        // world animation time in seconds
  frame:      { value: 0 },                        // running sub-sample index (noise decorrelation)
  resolution: { value: new THREE.Vector2(1, 1) },  // render resolution in pixels
  proj:       { value: new THREE.Matrix4() },
  projInv:    { value: new THREE.Matrix4() },
  camWorld:   { value: new THREE.Matrix4() },
  camPos:     { value: new THREE.Vector3() },

  sunDir:     { value: new THREE.Vector3(0, 1, 0) },   // unit vector TOWARD the sun (true sun, also below horizon)
  sunColor:   { value: new THREE.Color(1, 1, 1) },     // sun irradiance reaching the ground (linear)
  lightDir:   { value: new THREE.Vector3(0, 1, 0) },   // direction toward the key light (sun or moon)
  lightColor: { value: new THREE.Color(1, 1, 1) },     // key light irradiance
  ambient:    { value: new THREE.Color(0.1, 0.1, 0.1) }, // average sky irradiance / PI (rough), for cheap shaders
  night:      { value: 0 },                            // 0 = day, 1 = full night (drives city lights)
  sunElev:    { value: 30 },                           // degrees

  skyLUT:     { value: null },                         // equirect sky radiance (custom v mapping), RGBA16F
  aoTex:      { value: null },                         // half-res: r = AO, g = linear view depth
  aoOn:       { value: 1 },
  cityGain:   { value: 1 },                            // per-shot gain on the baked street-light map
  aux:        { value: 0 },                            // 1 while an auxiliary view (planar reflection) is rendered: use cheap paths

  // height fog / aerial perspective (also used by materials that want matching haze, e.g. water far field)
  fogA:       { value: new THREE.Vector4(0.00012, 1 / 140, 0, 0.985) }, // density, 1/falloff height, base height, max opacity
  fogB:       { value: new THREE.Vector4(0.000012, 1.0, 0, 0) },        // uniform density, brightness, -, -
  fogTint:    { value: new THREE.Color(1, 1, 1) },

  // city helper textures (set by the world when available)
  cityHeight: { value: null },                         // top-down height map of the city (R = roof height in m)
  cityRect:   { value: new THREE.Vector4(-1000, -1000, 2000, 2000) }, // xmin, zmin, sizeX, sizeZ of cityHeight
  cityLights: { value: null },                         // top-down map of local night lights (rgb = radiance on white ground)
  cityLightRect: { value: new THREE.Vector4(-1000, -1000, 2000, 2000) },
};

{
  const t = new THREE.DataTexture(new Float32Array([0, 0, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.FloatType); t.needsUpdate = true;
  G.cityLights.value = t; G.cityHeight.value = t; G.aoTex.value = t; G.skyLUT.value = t;
}

// GLSL declarations for the shared uniforms (include in custom shaders as needed).
export const G_GLSL = /* glsl */`
uniform float uTime;
uniform float uFrame;
uniform vec2 uResolution;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform float uNight;
uniform float uSunElev;
uniform sampler2D uSkyLUT;
uniform sampler2D uAOTex;
uniform float uAOOn;
uniform float uAux;
uniform float uCityGain;
uniform vec4 uFogA;
uniform vec4 uFogB;
uniform vec3 uFogTint;
uniform sampler2D uCityHeight;
uniform vec4 uCityRect;
uniform sampler2D uCityLights;
uniform vec4 uCityLightRect;
`;

/** Returns the uniform map (uXxx -> shared uniform object) to merge into a material's uniforms. */
export function globalUniforms() {
  return {
    uTime: G.time, uFrame: G.frame, uResolution: G.resolution,
    uProj: G.proj, uProjInv: G.projInv, uCamWorld: G.camWorld, uCamPos: G.camPos,
    uSunDir: G.sunDir, uSunColor: G.sunColor, uLightDir: G.lightDir, uLightColor: G.lightColor,
    uAmbient: G.ambient, uNight: G.night, uSunElev: G.sunElev,
    uSkyLUT: G.skyLUT, uAOTex: G.aoTex, uAOOn: G.aoOn, uAux: G.aux, uCityGain: G.cityGain,
    uFogA: G.fogA, uFogB: G.fogB, uFogTint: G.fogTint,
    uCityHeight: G.cityHeight, uCityRect: G.cityRect,
    uCityLights: G.cityLights, uCityLightRect: G.cityLightRect,
  };
}

// Shared GLSL helpers.
export const COMMON_GLSL = /* glsl */`
#ifndef PI
#define PI 3.141592653589793
#endif
// sky LUT lookup (dir must be normalized)
vec3 skyLUT(sampler2D lut, vec3 dir) {
  float az = atan(dir.z, dir.x);
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float v = 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5 * PI));
  return texture2D(lut, vec2(az / (2.0 * PI) + 0.5, v)).rgb;
}
float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }
vec3 hash33(vec3 p3) { p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm2(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.7; a *= 0.5; } return s; }
float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise3(p); p = p * 2.03 + 17.7; a *= 0.5; } return s; }
`;
