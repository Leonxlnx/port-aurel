// SEASCAPE + FAR LANDSCAPE: lighthouse islet, breakwater, buoys, vessels, far western shore + mountains,
// eastern hills with houses, city outskirts. Everything out in the bay and everything far away.
import * as THREE from 'three';
import { Geo, Sprites, paintMaterial, rockMaterial, terrainMaterial, rockGeometry } from './seascape/util.js';
import { buildLighthouse } from './seascape/lighthouse.js';
import { buildBreakwater, buildBuoys } from './seascape/breakwater.js';
import { buildVessels, coasterGeometry } from './seascape/vessels.js';
import { buildFarShore } from './seascape/farshore.js';
import { buildHills } from './seascape/hills.js';

export async function build(ctx) {
  const group = new THREE.Group(); group.name = 'seascape';
  const S = {
    paintMat: paintMaterial(ctx, { grime: 0.5, wet: 1 }),
    vesselMat: paintMaterial(ctx, { grime: 0.1, wet: 0.8, roughness: 0.5 }),
    rockMat: rockMaterial(ctx, { kind: 'rock', color: 0x8f867a }),
    isletMat: rockMaterial(ctx, { kind: 'rock', color: 0x978c7e, grass: 1 }),
    terrainMat: terrainMaterial(ctx, { rock: 1 }),
    mountainMat: terrainMaterial(ctx, { rock: 0.25 }),
    props: new Geo(), farProps: new Geo(),
    sprites: new Sprites(ctx, 4096), dyn: new Sprites(ctx, 64),
    boulders: [], stats: {},
    clear: [[-860, 4, 470]],                 // camera spots that must stay free of armour units
  };
  S.coasterGeometry = coasterGeometry(ctx.rng('seascape.coaster'));

  const lighthouse = buildLighthouse(ctx, S); group.add(lighthouse.group);
  const breakwater = buildBreakwater(ctx, S); group.add(breakwater.group);
  const buoys = buildBuoys(ctx, S); group.add(buoys.group);
  const ves = buildVessels(ctx, S); group.add(ves.group);
  const far = buildFarShore(ctx, S); group.add(far.group);
  const hills = buildHills(ctx, S); group.add(hills.group);

  // shared static prop meshes
  const props = new THREE.Mesh(S.props.build(), S.paintMat); props.castShadow = props.receiveShadow = true; props.name = 'bayProps'; group.add(props);
  const farProps = new THREE.Mesh(S.farProps.build(), paintMaterial(ctx, { grime: 0.35, wet: 0 })); farProps.name = 'farProps'; farProps.frustumCulled = false; group.add(farProps);

  // boulders (islet shore, breakwater lee side, revetments)
  {
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    const R = ctx.rng('seascape.boulders');
    for (const [list, geo, name] of [[S.boulders.filter(b => !b.big), rockGeometry(0, 3), 'boulders'], [S.boulders.filter(b => b.big), rockGeometry(1, 5), 'bouldersBig']]) {
      const im = new THREE.InstancedMesh(geo, S.rockMat, list.length);
      list.forEach((b, i) => {
        e.set(R() * 6.28, R() * 6.28, R() * 6.28); q.setFromEuler(e); p.set(b.x, b.y, b.z); s.set(b.s * (0.8 + 0.5 * R()), b.s * (0.75 + 0.4 * R()), b.s * (0.8 + 0.5 * R()));
        M.compose(p, q, s); im.setMatrixAt(i, M); const v = 0.75 + 0.5 * R(); col.setRGB(v, v * (0.96 + 0.06 * R()), v * (0.9 + 0.1 * R())); im.setColorAt(i, col);
      });
      im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = im.receiveShadow = true; im.name = name; group.add(im);
    }
  }
  group.add(S.sprites.build()); group.add(S.dyn.build());

  // stats
  let tris = 0, calls = 0;
  group.traverse(o => { if (o.isMesh) { calls++; const g = o.geometry; const n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += n * (o.isInstancedMesh ? o.count : (g.isInstancedBufferGeometry ? g.instanceCount : 1)); } });
  console.log(`[app] seascape: ${calls} draw calls, ${Math.round(tris / 1000)}k triangles, ${S.sprites.n}+${S.dyn.n} light sprites, ${JSON.stringify(S.stats)}, boulders ${S.boulders.length}`);

  const L = lighthouse.info;
  const spots = [
    { pos: [-140, 5, 153], target: [L.x, 22, L.z], fov: 6, note: 'canal mouth telephoto: lighthouse silhouette on the sunset axis (sun elev 0.5..2 sits behind shaft / lantern)' },
    { pos: [-152, 6, 200], target: [-1200, 10, 150], fov: 35, note: 'quay: wide sunset over the bay, islet + breakwater, ferry crosses the glitter path at t~40 s' },
    { pos: [-860, 4, 470], target: [-900, 2, 430], fov: 40, note: 'on the breakwater head among the tetrapods, looking back along the mound toward the islet' },
    { pos: [-700, 12, 500], target: [500, 70, 100], fov: 32, note: 'from the bay: city skyline with the lit hillside, mast and chapel behind (golden hour and blue hour)' },
    { pos: [-1060, 9, 96], target: [L.x, 26, L.z], fov: 24, note: 'close on the islet from the north-east: tower, cottage with lit window, landing stage; beams at night' },
    { pos: [-150, 20, 400], target: [-3000, 20, 2500], fov: 20, note: 'far port to the south-west: gantry cranes, tanks and layered ridges in haze' },
    { pos: [-300, 8, 150], target: [-420, 5, 250], fov: 30, note: 'ferry passing close at t = 20 s (golden hour)' },
  ];

  return {
    group,
    update(t) { buoys.update(t); ves.update(t); S.dyn.commit(); },
    /** [{name, kind, x, y, z, heading:[hx,hz] (direction of travel), bow:[hx,hz] (ferry only), speed, length, beam, draft, height}] at time t */
    vessels: ves.vessels,
    ferryState: ves.ferryState,
    spots,
    lighthouse: L,
    breakwaterTip: breakwater.tip,
    buoys: buoys.list,
    farShore: { port: far.port, lighthouse2: far.lighthouse2, height: far.farH },
    /** terrain height east of the quay / outside the street grid (hills, outskirts, capes) */
    terrainHeight: hills.landH, coastX: hills.coastX,
    summit: hills.summit, chapel: hills.chapel, observatory: hills.observatory,
    isletHeight: lighthouse.isletH,
  };
}
