// Rain water on the ground: one shared wetness parameter + the GLSL that turns it into puddles and damp patches.
// Used by the street ground (ground.js) and by the walking surfaces of the harbor module (harbor/materials.js).
//
// WETNESS (0 = bone dry, 0.5 = default, moderately damp after rain, 1 = just after a downpour):
//   - per shot from the film:  set: { groundWet: 0.8 }   (read from engine.settings.groundWet whenever the ground is drawn.
//     So that shots without the key fall back to the default, wetSync() registers `groundWet` in the app's default
//     settings (window.__app.defaultSettings) the first time it runs; a proper entry in the engine defaults would be
//     cleaner, the lookup works either way.)
//   - from code:               import { setGroundWetness } from './world/streets/wet.js'; setGroundWetness(0.3)
//                              (also reachable as modules.streets.group.getObjectByName('ground').userData.setWetness)
//   - from the URL / shot tool: ?wet=0.8   (--q=wet=0.8)
export const WET = { uGroundWet: { value: 0.5 } };
let base = 0.5;
export function setGroundWetness(v) { base = Math.min(1, Math.max(0, +v)); WET.uGroundWet.value = base; registerDefault(); }
function registerDefault() {
  try {
    const app = typeof window !== 'undefined' ? window.__app : null;
    if (app && app.defaultSettings && app.defaultSettings.groundWet !== base) app.defaultSettings.groundWet = base;
  } catch (e) { /* no app shell (tests): the base value is used */ }
}
export function initWet(ctx) {
  const q = ctx.params && ctx.params.get && ctx.params.get('wet');
  if (q != null && q !== '' && !isNaN(+q)) setGroundWetness(+q);
}
/** returns a callback (for mesh.onBeforeRender / material.onBeforeRender) that syncs the uniform with engine.settings.groundWet */
export function wetSync(ctx) {
  const eng = ctx.engine;
  return () => {
    registerDefault();
    const s = eng && eng.settings ? eng.settings.groundWet : null;
    WET.uGroundWet.value = (s != null && !isNaN(+s)) ? Math.min(1, Math.max(0, +s)) : base;
  };
}

// wetField: where rain water collects (0..1, world space, features of 0.7..5 m). `low` = how far the surface lies below
// its surroundings in the same units (joints, sunk slabs, gutters: +0.03..0.15), lowDamp = the same for the damp
// darkening (add a per-stone term so single stones dry at their own pace), fw = pixel footprint in metres.
// wetMask returns (puddle 0..1 with a crisp shoreline, damp 0..1 with a wide soft halo).
export const WET_GLSL = /* glsl */`
uniform float uGroundWet;
float wetField(vec2 p) {
  p += vec2(72.0, 168.0);      // phase chosen so that the promenade shot of the film has puddles on its sun line
  return vnoise(p * 0.21 + 31.7) * 0.34 + vnoise(p * 0.57 + 7.3) * 0.38 + vnoise(p * 1.43 + 2.9) * 0.28;
}
// water level relative to the mean surface (> 0: standing water); ~2 % of a level surface is puddle at wetness 0.5
float wetLevel(vec2 p) { return wetField(p) - (0.84 - 0.30 * uGroundWet); }
vec2 wetMaskW(float w, float low, float lowDamp, float fw) {
  float pud = smoothstep(0.0, max(0.012, fw * 0.5), w + low);
  float damp = smoothstep(-0.20, -0.10, w + lowDamp) * smoothstep(0.0, 0.25, uGroundWet);       // a fairly sharp drying front
  return vec2(pud, max(damp, pud));
}
vec2 wetMask(vec2 p, float low, float lowDamp, float fw) { return wetMaskW(wetLevel(p), low, lowDamp, fw); }
`;
