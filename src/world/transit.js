// TRANSIT — the elevated tram of Port Aurel: riveted steel viaduct along layout.tram.x, bowstring span over the canal,
// three elevated stations, two 3-car trams on a looping timetable (pure function of t) and a filmable interior.
//
// Exports (also returned from build() -> ctx.modules.transit):
//   trainState(t)      -> [{ id:'A'|'B', z, y, dir (+1 south / -1 north), speed, carCenters:[zNorth, zMid, zSouth], x, v, accel, track, dwell, roll, pitch }]
//   interiorView(t, { tram='A', car=1, seatSide='east'|'west'|'aisle', lookAt='west'|'east'|'forward'|'back', height=1.25, along=0, lateral })
//                      -> { pos:[x,y,z], target:[x,y,z], dir, z, speed }   (world space, follows the car incl. sway/bob/pitch)
//   chaseView(t, { tram='A', offset:[dx,dy,dz], lookOffset:[dx,dy,dz] })  -> { pos, target }  (camera rigidly attached to the tram)
//   stations           -> [{ name, x, z, length, platformY, west:{...}, east:{...} }]
//   crossings(id, za, zb, tFrom, tTo) -> time windows in which tram id (0 = A, 1 = B) overlaps the z range
import * as THREE from 'three';
import { LAYOUT } from './layout.js';
import { Geo } from './transit/geo.js';
import { makeMaterials, makeAtlas } from './transit/materials.js';
import { buildViaduct } from './transit/viaduct.js';
import { buildStation, PL } from './transit/stations.js';
import { buildTramGeometry } from './transit/tram.js';
import { TT, DIM, trainState as _trainState, tramState, strapSwing, crossings as _crossings } from './transit/timetable.js';

export const trainState = _trainState;
export const crossings = _crossings;
export const timetable = TT;

const _e = new THREE.Euler(), _v = new THREE.Vector3();
function toWorld(st, lx, ly, lz) { _e.set(st.pitch, 0, st.roll, 'XYZ'); _v.set(lx, ly, lz).applyEuler(_e); return [st.x + _v.x, st.y + _v.y, st.z + _v.z]; }
const tramIndex = id => (id === 'B' || id === 1 ? 1 : 0);

/** camera riding inside a car (same rigid motion as the mesh) */
export function interiorView(t, { tram = 'A', car = 1, seatSide = 'east', lookAt = 'west', height = 1.25, along = 0, lateral = null } = {}) {
  const st = tramState(tramIndex(tram), t);
  const sx = seatSide === 'east' ? 1 : seatSide === 'west' ? -1 : 0;
  const lx = lateral != null ? lateral : sx * 0.74;
  const lz = (car - 1) * DIM.PITCH + along, ly = DIM.FLOOR + height;
  let tl;
  if (lookAt === 'west') tl = [lx - 10, ly + 0.25, lz];
  else if (lookAt === 'east') tl = [lx + 10, ly + 0.25, lz];
  else if (lookAt === 'back') tl = [lx * 0.25, ly - 0.3, lz - st.dir * 10];
  else tl = [lx * 0.25, ly - 0.3, lz + st.dir * 10];
  return { pos: toWorld(st, lx, ly, lz), target: toWorld(st, tl[0], tl[1], tl[2]), dir: st.dir, z: st.z, speed: st.speed };
}
/** camera rigidly attached to a tram: offsets in tram-local metres (x east, y above rail top, z south from the set's centre) */
export function chaseView(t, { tram = 'A', offset = [-9, 2.2, 30], lookOffset = [0, 1.9, 8] } = {}) {
  const st = tramState(tramIndex(tram), t);
  return { pos: toWorld(st, offset[0], offset[1], offset[2]), target: toWorld(st, lookOffset[0], lookOffset[1], lookOffset[2]), dir: st.dir, z: st.z, speed: st.speed };
}

export const stations = LAYOUT.tram.stations.map(s => {
  const side = sg => ({
    platformX: [LAYOUT.tram.x + sg * 3.32, LAYOUT.tram.x + sg * 6.72],
    bridgeZ: s.z - sg * 10, stairX: LAYOUT.tram.x + sg * 12.2, stairFootZ: s.z - sg * 10 + sg * 16.35, entranceZ: s.z - sg * 10 + sg * 19.5,
  });
  return { name: s.name, x: LAYOUT.tram.x, z: s.z, length: s.length, platformY: LAYOUT.tram.deckY + PL, canopyRidgeY: LAYOUT.tram.deckY + PL + 3.9, west: side(-1), east: side(1) };
});

export async function build(ctx) {
  const group = new THREE.Group(); group.name = 'transit';
  const tr = LAYOUT.tram;
  const A = makeAtlas(tr.stations, ctx.rng('transit-atlas'));
  const M = makeMaterials(ctx, A.tex);

  // ---- fixed structure -------------------------------------------------------------------------
  const S = { steel: new Geo(), timber: new Geo(), stone: new Geo(), roof: new Geo(), corr: new Geo(), paint: new Geo(), lamp: new Geo(), print: new Geo() };
  const via = buildViaduct(ctx, S, ctx.rng('transit-deck'));
  tr.stations.forEach((st, i) => buildStation(ctx, S, A, st, i, via.bents));
  let tris = 0, calls = 0;
  for (const k in S) {
    if (!S[k].count) continue;
    const mesh = new THREE.Mesh(S[k].build(), M[k]); mesh.name = 'trn_' + k;
    mesh.castShadow = k !== 'lamp' && k !== 'print'; mesh.receiveShadow = true;
    group.add(mesh); tris += S[k].tris; calls++;
  }
  for (const it of via.instanced) {
    if (!it.matrices.length) continue;
    const im = new THREE.InstancedMesh(it.geo, M[it.mat], it.matrices.length);
    it.matrices.forEach((m, i) => im.setMatrixAt(i, m)); im.instanceMatrix.needsUpdate = true;
    im.castShadow = !it.noShadow; im.receiveShadow = true; im.computeBoundingSphere(); im.computeBoundingBox();
    group.add(im); tris += it.geo.attributes.position.count / 3 * it.matrices.length; calls++;
  }

  // ---- trams -----------------------------------------------------------------------------------
  const TG = buildTramGeometry(A);
  const matPaint = M.makeTramPaint(0x57171b, 0xdccfa6), matSolid = M.makeTramSolid(), matGlass = M.makeGlass();
  const trams = [];
  const hash = i => { const x = Math.sin(i * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x); };
  for (let i = 0; i < 2; i++) {
    const g = new THREE.Group(); g.name = 'tram' + 'AB'[i];
    const uDir = { value: 1 }, uSpark = { value: 0 };
    const add = (geo, mat, cast, layer = 0) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; if (layer) m.layers.set(layer); g.add(m); calls++; tris += geo.attributes.position.count / 3; return m; };
    add(TG.paint, matPaint, true); add(TG.solid, matSolid, true);
    const gl = add(TG.glass, matGlass, false, 1); gl.renderOrder = 5;
    add(TG.lamp, M.makeLamp(uDir, uSpark), false); add(TG.print, M.makePrint(uDir, true), false);
    // hand straps: detailed geometry in the middle car (the filmed interior), a light version elsewhere
    const straps = [TG.strapGeoLo, TG.strapGeo].map((geo, lod) => {
      const n = TG.straps.filter(p => p[4] === lod).length;
      const im = new THREE.InstancedMesh(geo, matSolid, n);
      im.castShadow = false; im.receiveShadow = true; im.frustumCulled = false; g.add(im); calls++; tris += geo.attributes.position.count / 3 * n;
      return im;
    });
    group.add(g); trams.push({ g, uDir, uSpark, straps });
  }
  const _m = new THREE.Matrix4(), _eu = new THREE.Euler();
  function update(t) {
    for (let i = 0; i < 2; i++) {
      const st = tramState(i, t), T = trams[i];
      T.g.position.set(st.x, st.y, st.z); T.g.rotation.set(st.pitch, 0, st.roll, 'XYZ'); T.g.updateMatrixWorld(true);
      T.uDir.value = st.dir; T.uSpark.value = Math.min(1, st.speed / 4);
      const th = -strapSwing(st.tau), sp = Math.min(1, st.speed / 5);
      const cnt = [0, 0];
      for (let k = 0; k < TG.straps.length; k++) {
        const p = TG.straps[k], h = hash(k + i * 400), h2 = hash(k * 3.7 + 11 + i * 90);
        const a = th * (0.9 + 0.2 * h) + sp * 0.03 * Math.sin(5.6 * (0.92 + 0.16 * h) * t + h2 * 6.283);
        const b = sp * 0.022 * Math.sin(4.7 * (0.9 + 0.2 * h2) * t + h * 6.283) + st.roll * 2.0;
        _m.makeRotationFromEuler(_eu.set(a, 0, b, 'XYZ')); _m.setPosition(p[0], p[1], p[2]);
        T.straps[p[4]].setMatrixAt(cnt[p[4]]++, _m);
      }
      T.straps[0].instanceMatrix.needsUpdate = true; T.straps[1].instanceMatrix.needsUpdate = true;
    }
  }
  update(0);
  console.log(`[transit] ${calls} draw calls, ${Math.round(tris / 1000)}k triangles, ${via.bents.length} bents, cycle ${TT.T.toFixed(1)} s`);
  return { group, update, trainState, interiorView, chaseView, stations, crossings, timetable: TT, stats: { calls, tris } };
}
