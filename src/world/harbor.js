// HARBOR module of Port Aurel: everything at the water's edge inside the city.
// Quay walls + coping + steps, railings, bollards, the seven canal bridges, the long pier, jetties, dolphins,
// moored boats (gently bobbing) and quay clutter. See src/world/harbor/*.js.
//
// Dev helper: `?only=harbor&hbrdev=1` replaces the loader's fallback ground plane (which covers the canal) by a
// ground with the canal / basin cut out, so the module can be judged in isolation.
import * as THREE from 'three';
import { Builder } from './harbor/geo.js';
import { createMaterials, createSignAtlas } from './harbor/materials.js';
import { buildQuay, railPanelGeo } from './harbor/quay.js';
import { buildBridges } from './harbor/bridges.js';
import { buildTimber } from './harbor/timber.js';
import { buildBoats } from './harbor/boats.js';
import { makeClutter, buildSigns } from './harbor/clutter.js';

export async function build(ctx) {
  const { layout: L, GROUND_Y: GY } = ctx;
  const group = new THREE.Group(); group.name = 'harbor';
  const mats = createMaterials(ctx);
  const atlas = createSignAtlas(ctx); mats.sign = atlas.material;

  const regionOf = (x, z) => {
    if (x < -100) return z < -230 ? 'bayN' : (z < 110 ? 'bayM' : (z < 200 ? 'mouth' : (z < 430 ? 'bayS1' : 'bayS2')));
    return x < 100 ? 'canalW' : (x < 300 ? 'canalM' : (x < 480 ? 'canalE' : 'basin'));
  };
  const H = { ctx, L, GY, THREE, B: new Builder(regionOf), rng: ctx.rng, mats, moor: [], lamps: [], rails: [], signs: [], stats: {} };

  buildQuay(H);
  buildBridges(H);
  makeClutter(H);
  buildTimber(H);
  const boats = buildBoats(H);
  buildSigns(H, atlas.rects);

  // ---- static merged meshes (one per material + region)
  let tris = 0, calls = 0;
  for (const b of H.B.buckets.values()) {
    if (!b.n) continue;
    const mesh = new THREE.Mesh(b.build(), mats[b.mat]);
    mesh.name = `hbr_${b.mat}_${b.region}`;
    mesh.castShadow = b.mat !== 'glass' && b.mat !== 'sign'; mesh.receiveShadow = true;
    group.add(mesh); tris += b.tris; calls++;
  }
  // ---- railings: instanced panels per region
  {
    const geo = railPanelGeo(); const by = {}; const p = new THREE.Vector3();
    for (const m of H.rails) { p.setFromMatrixPosition(m); (by[regionOf(p.x, p.z)] = by[regionOf(p.x, p.z)] || []).push(m); }
    for (const [reg, list] of Object.entries(by)) {
      const im = new THREE.InstancedMesh(geo, mats.iron, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.computeBoundingBox();
      im.castShadow = true; im.receiveShadow = true; im.name = 'hbr_rail_' + reg;
      group.add(im); tris += geo.index.count / 3 * list.length; calls++;
    }
    H.stats.railPanels = H.rails.length;
  }
  group.add(boats.group); calls += boats.group.children.length; tris += H.stats.boatTris;

  // ---- lamps -> night light map
  for (const l of H.lamps) ctx.lights.add({ x: l.x, z: l.z, y: l.y, color: l.color || [1.0, 0.62, 0.30], intensity: l.intensity ?? 1, radius: l.radius ?? 10 });
  // lit boats cast a little warm light on the water / quay around them
  for (const b of boats.fleet) if (b.lights >= 1) ctx.lights.add({ x: b.x, z: b.z, y: 1.5, color: [1.0, 0.55, 0.22], intensity: 0.35, radius: 5 });

  H.stats.triangles = Math.round(tris); H.stats.drawCalls = calls; H.stats.lamps = H.lamps.length;
  console.log(`[harbor] ${calls} draw calls, ${Math.round(tris / 1000)}k triangles, ${boats.fleet.length} boats, ${H.rails.length} railing panels, ${H.lamps.length} lamps`);

  // ---- dev ground (isolation only)
  let devPending = false;
  if (ctx.params && ctx.params.get('hbrdev')) {
    const gm = ctx.makeMaterial({ color: 0x4a4c50, roughness: 0.92 });
    const C = L.canal, BA = L.basin, X0 = L.QUAY_X, X1 = 1350, Z0 = -990, Z1 = 1110;
    for (const [x0, x1, z0, z1] of [[X0, BA.x0, Z0, C.z0], [X0, BA.x0, C.z1, Z1], [BA.x0, BA.x1, Z0, BA.z0], [BA.x0, BA.x1, BA.z1, Z1], [BA.x1, X1, Z0, Z1]]) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), gm);
      g.rotation.x = -Math.PI / 2; g.position.set((x0 + x1) / 2, GY, (z0 + z1) / 2); g.receiveShadow = true; group.add(g);
    }
    devPending = true;
  }

  const spots = [
    { pos: [300, 3.4, 153], target: [-600, 6, 153], fov: 35, note: 'canal vista due west into the sunset, bridges stacked in silhouette (elev 1.5..4); also strong at blue hour' },
    { pos: [-96, 1.1, 150.5], target: [-200, 4.2, 153.5], fov: 32, note: 'water level in the canal mouth: promenade bridge arches, balustrade and candelabra frame the setting sun (elev 2..3)' },
    { pos: [-86, 2.6, 148], target: [-96, 1.0, 141], fov: 45, note: 'canal steps with a rowing boat, quay wall, railing and the promenade bridge behind (elev 4..8)' },
    { pos: [-100, 3.6, 150], target: [668, 80, 153], fov: 40, note: 'canal looking east: three-arch stone bridge with the skyline / Lantern Tower above (elev 5..10)' },
    { pos: [-215, 2.2, -190], target: [-150, 5, -140], fov: 45, note: 'from the bay: yacht jetties, masts, dolphins and the quay wall with the old town behind (golden hour and blue hour)' },
    { pos: [-155, 4.3, -141.5], target: [-185, 1.3, -150.5], fov: 45, note: 'down the yacht jetty into the sun glitter: masts and rigging as silhouettes (elev 3..8)' },
    { pos: [-160, 4.2, 601], target: [-600, 5, 560], fov: 35, note: 'down the long pier toward the sunset: planks, lamp posts, hut at the head (elev 1..3, and night for the lamp pools)' },
    { pos: [-304, 3.9, 604], target: [-316, 3.6, 598.5], fov: 45, note: 'pier-head hut with glowing windows and sign (elev -5..-8)' },
    { pos: [174, 2.0, 151], target: [194, 1.4, 142.4], fov: 45, note: 'canal barge with lit wheelhouse, iron bridge lamps reflecting behind (elev -6..-8)' },
    { pos: [640, 6, 150], target: [520, 3, 153], fov: 50, note: 'basin looking west down the canal axis into the sun (railing shadows on the plaza)' },
    { pos: [-164, 1.6, 398], target: [-152.3, 1.3, 388.5], fov: 45, note: 'fishing boats against the timber-fendered fish dock, from the water' },
  ];

  return {
    group,
    update(t, engine) {
      if (devPending) {
        devPending = false;
        for (const o of ctx.scene.children) if (o.isMesh && o.geometry && o.geometry.type === 'PlaneGeometry' && Math.abs(o.position.y - GY) < 1e-6) o.visible = false;
      }
      boats.update(t);
    },
    spots,
    boats: boats.notable,
    /** deck height of the (humped) stone bridges; GROUND_Y elsewhere */
    deckY: H.deckY,
    lamps: H.lamps,
    stats: H.stats,
    /** every boat: { type, x, z, ry (heading; bow = (cos ry, 0, -sin ry)), s, lights (0 | 0.5 anchor light | 1 lit cabin) } */
    fleet: boats.fleet,
  };
}
