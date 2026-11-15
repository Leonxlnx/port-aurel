// Port Aurel — buildings + facades.
// One merged mesh (one draw call, layer 0) for every building in the layout, shaded by a procedural facade material:
// window recesses ray-traced in wall tangent space, interior mapping, weathered masonry, night lighting.
// Plus the facade hardware (iron, tin, signs): merged per region, 12 more draw calls, also layer 0.
//   buildings/params.js      per-building design (bay grid, window type, colours, roofs) from style/seed/district
//   buildings/geometry.js    tier walls, decks, parapet slabs, gables + pitched roofs, cornices, piers, awnings, balconies
//   buildings/facade.glsl.js the shader hooks (wall materials, windows, interiors, shopfronts, night)
//   buildings/textures.js    tiling noise + lettering atlases
//   buildings/hardware.js    fire escapes, AC boxes, railings, downpipes, cables, shutter boxes, lamps, blade / neon
//                            signs, clocks, flagpoles — placed on the bay grid; 2 x 3 spatial chunks x (casts shadow or not)
// Parapets: every tier carries a 1.3 m parapet slab (outer face 0.10 m proud of the wall, 0.52 m thick) that encloses
// the parapets/copings the rooftops module builds, so the facade material runs unbroken to the skyline.
import { deriveParams, packParams, bayGrid } from './buildings/params.js';
import { Mesher, buildAll } from './buildings/geometry.js';
import { makeNoiseTexture, makeSignTexture, makeBladeTexture } from './buildings/textures.js';
import * as HW from './buildings/hardware.js';
import * as GL from './buildings/facade.glsl.js';

export async function build(ctx) {
  const { THREE, layout, GROUND_Y } = ctx;
  const buildings = layout.buildings;
  const t0 = performance.now();

  // ---- per-building design -> parameter texture (8 texels per building)
  const params = buildings.map(b => deriveParams(b));
  const M = new Mesher();
  const { info, pitchedIds } = buildAll(M, buildings, params, GROUND_Y, ctx.lights);   // (may downgrade roof types)
  const HM = new HW.HwMesher();
  const hwStats = HW.buildHardware(HM, buildings, params, info, ctx.lights);
  const pdata = new Float32Array(buildings.length * 8 * 4);
  params.forEach((P, i) => packParams(P, pdata, i * 32));
  const bldTex = new THREE.DataTexture(pdata, 8, buildings.length, THREE.RGBAFormat, THREE.FloatType);
  bldTex.minFilter = bldTex.magFilter = THREE.NearestFilter; bldTex.generateMipmaps = false; bldTex.needsUpdate = true;

  // ---- geometry
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M.pos), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(M.nrm), 3));
  geo.setAttribute('aFUv', new THREE.BufferAttribute(new Float32Array(M.uv), 4));
  geo.setAttribute('aFWall', new THREE.BufferAttribute(new Float32Array(M.wall), 4));
  geo.setAttribute('aFTier', new THREE.BufferAttribute(new Float32Array(M.tier), 4));
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(M.idx), 1));
  geo.computeBoundingSphere(); geo.computeBoundingBox();

  // ---- material
  const signTex = makeSignTexture();
  // ?blddbg=<mask> strips parts for profiling: 1 interior mapping, 2 wall dressings, 4 wall materials, 8 no facade hardware
  const dbg = parseInt((ctx.params && ctx.params.get && ctx.params.get('blddbg')) || '0') || 0;
  const material = ctx.makeMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 }, {
    key: 'bld-facade-2-' + dbg,
    defines: { BLD_DBG: dbg },
    uniforms: {
      uNoiseTex: { value: makeNoiseTexture(ctx.rng('buildings-noise')) },
      uSignTex: { value: signTex },
      uBldTex: { value: bldTex },
    },
    vertexPars: GL.VERT_PARS, vertex: GL.VERT_MAIN,
    fragPars: GL.FRAG_PARS,
    color: GL.HOOK_COLOR, surface: GL.HOOK_SURFACE, normal: GL.HOOK_NORMAL, emissive: GL.HOOK_EMISSIVE, ao: GL.HOOK_AO,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'buildings_facades';
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.layers.set(0);
  mesh.matrixAutoUpdate = false; mesh.updateMatrix();

  const group = new THREE.Group(); group.name = 'buildings';
  group.add(mesh);

  // ---- facade hardware (iron, tin, signs): one more merged mesh
  let hwDraws = 0;
  if (HM.tris() > 0 && !(dbg & 8)) {
    const hmat = ctx.makeMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.0, vertexColors: true }, {
      key: 'bld-hardware-2', defines: HW.HW_DEFINES, ao: HW.HW_HOOK_AO,
      uniforms: { uSignTex: { value: signTex }, uBladeTex: { value: makeBladeTexture() } },
      vertexPars: HW.HW_VERT_PARS, vertex: HW.HW_VERT_MAIN, fragPars: HW.HW_FRAG_PARS,
      color: HW.HW_HOOK_COLOR, surface: HW.HW_HOOK_SURFACE, emissive: HW.HW_HOOK_EMISSIVE,
    });
    for (const B of HM.bufs.values()) {           // key = chunk * 2 + (casts a shadow ? 1 : 0)
      if (!B.nv) continue;
      const hgeo = new THREE.BufferGeometry();
      hgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(B.pos), 3));
      hgeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(B.nrm), 3));
      hgeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(B.col), 3));
      hgeo.setAttribute('aHw', new THREE.BufferAttribute(new Float32Array(B.hw), 4));
      hgeo.setIndex(new THREE.BufferAttribute(B.nv > 65535 ? new Uint32Array(B.idx) : new Uint16Array(B.idx), 1));
      hgeo.computeBoundingSphere(); hgeo.computeBoundingBox();
      const hm = new THREE.Mesh(hgeo, hmat);
      hm.name = 'buildings_hardware_' + B.key;
      hm.castShadow = B.key % 2 === 1; hm.receiveShadow = true;
      hm.layers.set(0);
      hm.matrixAutoUpdate = false; hm.updateMatrix();
      group.add(hm); hwDraws++;
    }
  }
  console.log(`[app] buildings hardware: ${HM.tris()} tris in ${hwDraws} draw calls, ${JSON.stringify({ ...hwStats, tris: undefined })}`);
  console.log(`[app] buildings: ${buildings.length} buildings, ${M.nv} verts, ${M.idx.length / 3} tris, ${pitchedIds.size} pitched roofs, ${Math.round(performance.now() - t0)} ms`);

  return {
    group, mesh, material,
    /** ids of buildings that carry a real pitched roof (roof dressing should skip them) */
    pitchedIds,
    /** Map id -> { roofType (0 flat, 1 gable roof, 3 false-front gable), parapetTop[] (world y per tier), ridgeY, eaveY, gableTop, walls[], P } */
    info,
    /** bay grid helper shared with the shader: bayGrid(wallWidth, info.get(id).P) -> { nb, margin, bw, ok } */
    bayGrid,
    update() {},
  };
}
