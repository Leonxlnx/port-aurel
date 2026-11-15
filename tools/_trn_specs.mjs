// generates tools/trn_specs.json for a capture round (transit look-dev)
import fs from 'node:fs';
import { interiorView, chaseView, trainState } from '../src/world/transit.js';
const round = process.argv[2] || '1';
const iv = (t, o) => { const v = interiorView(t, o); return { pos: v.pos, target: v.target }; };
const cv = (t, o) => { const v = chaseView(t, o); return { pos: v.pos, target: v.target }; };
const R = {
  7: [
    { out: 'trn_r7_shed.jpg', cam: { pos: [78, 15, 1002], target: [37, 13, 942], fov: 40 }, elev: 8, t: 100 },
    { out: 'trn_r7_signal.jpg', cam: { pos: [34.6, 11.5, 15], target: [32.7, 13.3, 28], fov: 40 }, elev: 6, t: 100 },
    { out: 'trn_r7_gangway.jpg', cam: { ...iv(14, { seatSide: 'aisle', lookAt: 'forward', along: 3.2, height: 1.5 }), fov: 55 }, elev: 6, t: 14 },
    { out: 'trn_r7_patches.jpg', cam: { ...iv(21.6, { seatSide: 'west', lookAt: 'east', height: 1.3, along: -0.6 }), fov: 62 }, elev: 6, t: 21.6, set: { shadowDistance: 180 } },
    { out: 'trn_r7_straps.jpg', cam: { ...iv(12, { seatSide: 'aisle', lookAt: 'forward', along: -1.0, height: 1.72, lateral: 0.3 }), fov: 45 }, elev: 4, t: 12, set: { shadowDistance: 900 } },
    { out: 'trn_r7_station_e.jpg', cam: { pos: [63, 14, 118], target: [42, 12.5, 88], fov: 40 }, elev: 7, t: 55 },
  ],
  6: [
    { out: 'trn_r6_intW_night.jpg', cam: { ...iv(41, { tram: 'B' }), fov: 52 }, elev: -9, t: 41 },
    { out: 'trn_r6_chase_night.jpg', cam: { ...cv(41, { tram: 'B', offset: [-7.5, 0.6, -12], lookOffset: [0, 1.5, 2] }), fov: 45 }, elev: -9, t: 41 },
    { out: 'trn_r6_under.jpg', cam: { pos: [30, 4, -60], target: [40, 9, -200], fov: 35 }, elev: 12, t: 84 },
    { out: 'trn_r6_station.jpg', cam: { pos: [10, 5, 60], target: [45, 11, 85], fov: 40 }, elev: 8, t: 53 },
    { out: 'trn_r6_tram34.jpg', cam: { pos: [22, 14, 246], target: [35.5, 11.8, 222], fov: 35 }, elev: 10, t: 20 },
    { out: 'trn_r6_hero_1080.jpg', w: 1920, h: 1080, spp: 8, cam: { ...iv(14.6, {}), fov: 52 }, elev: 3, t: 14.6 },
  ],
  5: [
    { out: 'trn_r5_entrance.jpg', cam: { pos: [25.9, 4.0, 64.5], target: [24.6, 5.6, 80], fov: 42 }, elev: -5, t: 52 },
    { out: 'trn_r5_truss34.jpg', cam: { pos: [78, 21, 108], target: [37, 13, 153], fov: 35 }, elev: 6, t: 14 },
    { out: 'trn_r5_int_night.jpg', cam: { ...iv(30, { lookAt: 'forward' }), fov: 52 }, elev: -9, t: 30 },
    { out: 'trn_r5_nose.jpg', cam: { ...cv(20, { offset: [-5.5, 1.6, 27.5], lookOffset: [0, 1.9, 19] }), fov: 40 }, elev: 8, t: 20 },
    { out: 'trn_r5_under_night.jpg', cam: { pos: [36.3, 3.9, -52], target: [37.6, 7.6, -200], fov: 42 }, elev: -8, t: 83 },
    { out: 'trn_r5_truss_blue.jpg', cam: { pos: [118, 3.3, 147], target: [37, 12.5, 153], fov: 40 }, elev: -4, t: 40 },
  ],
  4: [
    { out: 'trn_r4_int_floor.jpg', cam: { ...iv(14, { seatSide: 'aisle', lookAt: 'forward', height: 1.55, along: -2.6 }), fov: 60 }, elev: 12, t: 14 },
    { out: 'trn_r4_int_floor_sd.jpg', cam: { ...iv(14, { seatSide: 'aisle', lookAt: 'forward', height: 1.55, along: -2.6 }), fov: 60 }, elev: 12, t: 14, set: { shadowDistance: 180 } },
    { out: 'trn_r4_intW_canal.jpg', cam: { ...iv(14.6, {}), fov: 52 }, elev: 3, t: 14.6, set: { shadowDistance: 900 } },
    { out: 'trn_r4_rear.jpg', cam: { ...cv(39, { tram: 'B', offset: [-4.6, 2.1, 32], lookOffset: [0, 1.8, 19] }), fov: 40 }, elev: 4, t: 39 },
    { out: 'trn_r4_station_blue.jpg', cam: { pos: [10, 5, 60], target: [45, 11, 85], fov: 40 }, elev: -6, t: 0 },
    { out: 'trn_r4_shed.jpg', cam: { pos: [70, 12, 860], target: [37, 13.5, 925], fov: 40 }, elev: 8, t: 100 },
    { out: 'trn_r4_side.jpg', cam: { ...cv(20, { offset: [-6.5, 1.5, 5], lookOffset: [0, 1.7, -3] }), fov: 42 }, elev: 8, t: 20 },
    { out: 'trn_r4_intW_night.jpg', cam: { ...iv(30, {}), fov: 52 }, elev: -9, t: 30 },
  ],
  3: [
    { out: 'trn_r3_axis.jpg', cam: { pos: [36.3, 3.9, -52], target: [37.6, 7.6, -200], fov: 42 }, elev: 10, t: 83 },
    { out: 'trn_r3_columns_sun.jpg', cam: { pos: [46.8, 4.0, -74], target: [20, 6.8, -122], fov: 35 }, elev: 6, t: 82.5 },
    { out: 'trn_r3_track_truss.jpg', cam: { pos: [37, 11.35, 197], target: [37, 11.6, 150], fov: 40 }, elev: 4, t: 39 },
    { out: 'trn_r3_platform_night.jpg', cam: { pos: [31.6, 12.6, 64.5], target: [33.2, 12.3, 100], fov: 38 }, elev: -8, t: 0 },
    { out: 'trn_r3_intW_city.jpg', cam: { ...iv(22.3, {}), fov: 52 }, elev: 5, t: 22.3 },
    { out: 'trn_r3_int_floor.jpg', cam: { ...iv(14, { seatSide: 'aisle', lookAt: 'forward', height: 1.55, along: -2.6 }), fov: 60 }, elev: 12, t: 14 },
    { out: 'trn_r3_shed.jpg', cam: { pos: [62, 13.5, 876], target: [37, 13, 930], fov: 40 }, elev: 8, t: 100 },
    { out: 'trn_r3_truss_hero.jpg', cam: { pos: [260, 3.4, 153], target: [-600, 8, 153], fov: 30 }, elev: 2, t: 14 },
  ],
  2: [
    { out: 'trn_r2_under.jpg', cam: { pos: [30, 4, -60], target: [40, 9, -200], fov: 35 }, elev: 12, t: 20 },
    { out: 'trn_r2_platform.jpg', cam: { pos: [31.6, 12.6, 64.5], target: [33.2, 12.3, 100], fov: 38 }, elev: 8, t: 0 },
    { out: 'trn_r2_station_blue.jpg', cam: { pos: [10, 5, 60], target: [45, 11, 85], fov: 40 }, elev: -6, t: 0 },
    { out: 'trn_r2_tram_night.jpg', cam: { pos: [22, 14, 246], target: [35.5, 11.8, 222], fov: 35 }, elev: -9, t: 20 },
    { out: 'trn_r2_truss_quay.jpg', cam: { pos: [118, 3.3, 147], target: [37, 12.5, 153], fov: 40 }, elev: 2, t: 14 },
    { out: 'trn_r2_int_e12.jpg', cam: { ...iv(14, { seatSide: 'west', lookAt: 'forward', along: -2 }), fov: 55 }, elev: 12, t: 14 },
    { out: 'trn_r2_nose.jpg', cam: { ...cv(20, { offset: [-5.5, 1.6, 27.5], lookOffset: [0, 1.9, 19] }), fov: 40 }, elev: 10, t: 20 },
    { out: 'trn_r2_int_night.jpg', cam: { ...iv(30, { lookAt: 'forward' }), fov: 52 }, elev: -9, t: 30 },
  ],
};
fs.writeFileSync(new URL('./trn_specs.json', import.meta.url), JSON.stringify(R[round], null, 1));
console.log(R[round].length, 'specs', JSON.stringify(trainState(14).map(s => [s.id, +s.z.toFixed(1)])));
