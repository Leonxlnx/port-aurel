# Port Aurel — architecture notes (read this first)

A fictional harbor city rendered with three.js r187 (WebGL2) through a custom offline-quality pipeline, to be filmed as a
60 s 4K clip with a 35mm-film look (golden hour -> sunset -> blue hour -> city lights). **No people anywhere.** Everything
is procedural: no downloaded models/textures. Style references (for LOOK only — never copy their content/landmarks):
`refs/1.jpg … refs/4.jpg` (analog film photos: warm highlights, cool shadows, haze, silhouettes, frame-in-frame, grain).

## World conventions
- Units metres. **X = east, Z = south, Y = up.** Water surface y = 0. City street level `GROUND_Y = 2.4`.
- The bay is west of the quay wall (`x < QUAY_X = -150`). The sun sets due **west (-X)**, aligned with the canal
  (z 140..166) and all east-west streets. Sun direction = `(cos az·cos el, sin el, sin az·cos el)`, az = 180°.
- `src/world/layout.js` is the single source of truth for the plan (`LAYOUT`: blocks, buildings with tiers/style/seed,
  streets, bridges, canal, basin, plaza, lantern tower, tram, harbor, hills, `isWater(x,z)`). Run `node tools/map.mjs`
  and open `out/shots/map.png` for a top-down plan. **Do not edit layout.js** (ask the lead if something is missing;
  derive extra detail deterministically from the data + `ctx.rng(name)`).
- Determinism: everything must be a pure function of time `t` (seconds). No `Math.random()`, no `Date.now()`, no
  accumulating state in `update`. Use `ctx.rng('name')` (seeded mulberry32) at build time.

## Module contract
Each content module is ONE entry file `src/world/<name>.js` (helpers may live in `src/world/<name>/*.js`):
```js
export async function build(ctx) { /* ... */ return { group, update(t, engine) {}, onEnvironment(atm) {} /* all optional */ }; }
```
`ctx = { engine, scene, layout, G, THREE, GROUND_Y, makeMaterial, makeShaderMaterial, rng(name), lights, params, modules }`
- Return a `THREE.Group`; the loader adds it to the scene. Loader: `src/world/world.js` (do not edit; module list is
  fixed: sky, streets, buildings, rooftops, harbor, seascape, water, transit, life). Develop in isolation with
  `--q=only=<yourmodule>` (comma list allowed) — missing modules are skipped and a fallback ground/water plane appears.
- `ctx.lights.add({x, z, y, color:[r,g,b], intensity, radius})` registers a small night light (street lamp, shop front).
  They are baked into a top-down light map that lights every surface near it when `uNight > 0` (automatic in makeMaterial).

## Materials (important)
Create ALL lit materials with `makeMaterial(params, hooks, Base?)` from `src/engine/materials.js`
(MeshStandardMaterial/MeshPhysicalMaterial + engine wiring: SSAO, night light map, shared uniforms, world-space varyings).
Read the header comment of that file for the hook points (`vertex`, `color`, `surface`, `normal`, `emissive`, `final`, …).
In hooks you have `vWPos` (world position), `vWNormal`, and shared uniforms: `uTime`, `uSunDir`, `uSunColor`, `uLightDir`,
`uLightColor`, `uAmbient`, `uNight` (0 day … 1 night: drive all artificial lights with it), `uSunElev` (deg), `uFrame`
(changes every accumulated sample — use it to decorrelate stochastic effects), `uCamPos`, `uResolution`, `uSkyLUT`
(use `skyLUT(uSkyLUT, dir)` for sky radiance in a world direction), plus noise helpers (`hash12`, `vnoise`, `fbm2`, …).
For unlit/additive stuff (glows, light sprites) use `makeShaderMaterial`.
- HDR, linear, physically based units: sun irradiance ≈ 12·T, sky radiance ≈ 0.05–1. Emissive values for lamps/windows at
  night should be roughly 2–40 (bright filaments more) so bloom/halation react; multiply by `uNight`.
- Prefer procedural detail in shaders (triplanar / world-space) over geometry; fade micro detail with distance
  (use `fwidth`) — the renderer supersamples (8–24 jittered samples per frame) but huge sub-pixel contrast still shimmers.
- Everything must look right from golden hour through night: check at sun elevation 12°, 2°, −4°, −8°.

## Renderer facts
- Pipeline per sample: shadow maps (2 cascades, 900 m) -> depth prepass -> SSAO -> lit pass -> aerial perspective ->
  accumulation; then bloom/halation/film grade/grain once per frame. Reversed-Z float depth; camera near 0.3 far 60000.
- **Layers:** layer 0 = solid opaque static geometry (it is drawn in the depth prepass with a plain override material,
  so NO vertex displacement and NO alpha test on layer 0). Anything vertex-animated, alpha-tested, additive or
  transparent must do `mesh.layers.set(1)` (drawn only in the lit pass). Avoid alpha blending; prefer opaque/alpha-test/additive.
- Set `castShadow` / `receiveShadow` sensibly (tiny props: no castShadow). Use `InstancedMesh` / merged geometry:
  target < 150 draw calls and < 1.5 M triangles per module. Call `computeBoundingSphere()` for instanced meshes.
- `engine.hooks.beforeSample.push(fn(engine, scene, camera, i))` and `engine.renderAux(scene, cam, target, {layersMask})`
  exist for auxiliary renders (planar reflections). `engine.atmosphere.setCloudHook({pars, main, uniforms})` injects
  code into the sky shader.
- Do not edit files under `src/engine/` or other modules' files unless your brief says so; report needed engine changes instead.

## Looking at your work (use sparingly — the GPU is a shared laptop iGPU and other agents render too)
```bash
node tools/shot.mjs --q=only=buildings,streets --out=myname_01.jpg --w=1280 --h=720 --spp=6 --cam=X,Y,Z,TX,TY,TZ --fov=40 --elev=9
node tools/shot.mjs --json=tools/myspecs.json --w=1280 --h=720 --spp=6      # several stills in one browser session (preferred)
node tools/sheet.mjs --out=sheet_myname.jpg --cols=3 --cell=640 a.jpg b.jpg c.jpg   # contact sheet -> view ONE image
```
Spec fields: `out, cam:{pos,target,fov,roll,focus,aperture}, elev, az(180), ev (stops), t (seconds), spp, set:{engine.settings…}`.
Images land in `out/shots/`. Prefix your files with your module name. Rules: max 1280×720 and ≤ 8 spp while iterating
(one 1920×1080 check at the end is fine); never run two captures at once; always let the tool exit (it closes Chrome).
Exposure is metered automatically; page errors and shader compile errors are printed to the console — fix them all.
Use the Read tool on the JPG / contact sheet to judge the result critically against the film references, then iterate.
