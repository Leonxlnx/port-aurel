// Deterministic plan of the fictional harbor city "Port Aurel". Pure data — no three.js objects.
// Units: metres. X = east, Z = south, Y = up. Water level y = 0, city ground y = GROUND_Y.
// The sun sets due west (-X) so it lines up with the canal and every east-west street.
//
//                 N (-Z)
//        bay            |  city grid (blocks, avenues run N-S, streets run E-W)
//   lighthouse  ~~~~~   |======== canal (z 140..166) ===== basin  [Lantern Tower]
//        bay            |
//                 S (+Z)        hills rise east of x ~ 1150
//
export const GROUND_Y = 2.4;        // street level above the water
export const WATER_Y = 0;
export const QUAY_X = -150;         // the quay wall: water is west of this line
export const SUNSET_AZIMUTH = 180;  // degrees; sun direction = (cos az, ., sin az) -> -X

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const CANAL = { z0: 140, z1: 166, x0: QUAY_X, x1: 520, quayW: 13 };   // water strip; quayW = street width on each bank
const BASIN = { x0: 520, x1: 610, z0: 112, z1: 194 };                 // small harbour basin at the canal's east end
const TRAM_AVENUE_INDEX = 2;                                          // avenue (between block columns 1 and 2) that carries the elevated tram

export function buildLayout(seed = 20261114) {
  const R = mulberry32(seed);
  const rr = (a, b) => a + (b - a) * R();
  const pick = arr => arr[Math.floor(R() * arr.length)];

  // ---- grid lines ------------------------------------------------------------------------------
  // block columns (west -> east). The promenade (quay boulevard) lies between QUAY_X and the first column.
  const PROMENADE_W = 30;
  const colW = [54, 68, 74, 80, 84, 84, 80, 74, 70, 66, 66, 66, 66];
  const aveW = colW.map((_, i) => i === TRAM_AVENUE_INDEX - 1 ? 30 : (i % 3 === 2 ? 24 : 20));   // avenue east of column i
  const cols = []; let x = QUAY_X + PROMENADE_W;
  for (let i = 0; i < colW.length; i++) { cols.push({ i, x0: x, x1: x + colW[i] }); x += colW[i] + aveW[i]; }
  const CITY_X1 = x - aveW[aveW.length - 1];

  // block rows: north of the canal (going north, z decreasing) and south of it
  const northD = [62, 70, 74, 78, 74, 70, 66, 64, 62, 60, 60];
  const southD = [62, 70, 74, 70, 66, 64, 62, 60, 60];
  const stW = i => (i % 3 === 1 ? 20 : 16);
  const rows = [];
  let z = CANAL.z0 - CANAL.quayW;
  for (let i = 0; i < northD.length; i++) { rows.push({ j: -(i + 1), z0: z - northD[i], z1: z, side: 'N' }); z -= northD[i] + stW(i); }
  const CITY_Z0 = z + stW(northD.length - 1);
  z = CANAL.z1 + CANAL.quayW;
  for (let i = 0; i < southD.length; i++) { rows.push({ j: i + 1, z0: z, z1: z + southD[i], side: 'S' }); z += southD[i] + stW(i); }
  const CITY_Z1 = z - stW(southD.length - 1);
  rows.sort((a, b) => a.z0 - b.z0);

  // ---- landmarks -------------------------------------------------------------------------------
  const lantern = { name: 'lantern', x: 668, z: 153, w: 46, d: 46, h: 236 };       // on the canal axis, east of the basin
  const core = { x: 600, z: 120 };                                                  // skyline centre
  const plaza = { x0: BASIN.x1 + 8, x1: lantern.x - lantern.w / 2 - 6, z0: BASIN.z0, z1: BASIN.z1 }; // paved strip between basin and tower

  // ---- height field for the skyline ------------------------------------------------------------
  function skylineHeight(px, pz) {
    const d = Math.hypot((px - core.x) / 1.15, pz - core.z);
    const coreH = 150 * Math.exp(-(d * d) / (2 * 210 * 210));
    const second = 70 * Math.exp(-(((px - 380) ** 2) + ((pz + 330) ** 2)) / (2 * 120 * 120));   // secondary cluster to the north-west
    const quayFade = Math.min(1, Math.max(0, (px - (QUAY_X + 30)) / 260));                      // low along the water
    return 14 + (coreH + second) * (0.25 + 0.75 * quayFade);
  }

  // ---- blocks -> lots -> buildings -------------------------------------------------------------
  const blocks = []; const buildings = []; let bid = 0;
  const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
  const reserved = [
    { ...BASIN, x0: BASIN.x0 - 14, x1: BASIN.x1 + 6, z0: BASIN.z0 - 14, z1: BASIN.z1 + 14, kind: 'basin' },
    { x0: plaza.x0, x1: lantern.x + lantern.w / 2 + 16, z0: BASIN.z0 - 14, z1: BASIN.z1 + 14, kind: 'plaza' },
  ];
  const parkBlocks = new Set(['8:-3', '3:2']);          // col:row ids turned into small parks
  const squareBlocks = new Set(['1:-1']);               // an open market square by the tram station

  function districtOf(c, px) {
    if (c.i === 0) return 'quay';
    if (c.i <= 2) return 'old';
    const d = Math.hypot(px - core.x, 0);
    if (c.i >= 10) return 'east';
    return c.i >= 3 && c.i <= 8 ? 'core' : 'mid';
  }

  for (const c of cols) for (const r of rows) {
    const blk = { id: `${c.i}:${r.j}`, col: c.i, row: r.j, x0: c.x0, x1: c.x1, z0: r.z0, z1: r.z1, district: 'core', kind: 'built', lots: [] };
    const cx = (blk.x0 + blk.x1) / 2, cz = (blk.z0 + blk.z1) / 2;
    blk.district = districtOf(c, cx);
    const res = reserved.find(q => overlaps(blk, q));
    if (res) {
      // clip the block against the reserved rectangle (keep the larger remaining part), or drop it
      const parts = [
        { x0: blk.x0, x1: Math.min(blk.x1, res.x0), z0: blk.z0, z1: blk.z1 },
        { x0: Math.max(blk.x0, res.x1), x1: blk.x1, z0: blk.z0, z1: blk.z1 },
        { x0: blk.x0, x1: blk.x1, z0: blk.z0, z1: Math.min(blk.z1, res.z0) },
        { x0: blk.x0, x1: blk.x1, z0: Math.max(blk.z0, res.z1), z1: blk.z1 },
      ].filter(p => p.x1 - p.x0 > 22 && p.z1 - p.z0 > 22).sort((a, b) => (b.x1 - b.x0) * (b.z1 - b.z0) - (a.x1 - a.x0) * (a.z1 - a.z0));
      if (!parts.length) { blk.kind = res.kind; blocks.push(blk); continue; }
      Object.assign(blk, parts[0]);
    }
    if (parkBlocks.has(blk.id)) { blk.kind = 'park'; blocks.push(blk); continue; }
    if (squareBlocks.has(blk.id)) { blk.kind = 'square'; blocks.push(blk); continue; }

    // subdivide into lots
    const bw = blk.x1 - blk.x0, bd = blk.z1 - blk.z0;
    const tall = skylineHeight(cx, cz) > 75;
    let nx = tall ? (R() < 0.55 ? 1 : 2) : (bw > 60 ? pick([2, 2, 3]) : pick([1, 2, 2]));
    let nz = tall ? (R() < 0.5 ? 1 : 2) : pick([2, 2, 3]);
    if (blk.district === 'quay') { nx = 1; nz = pick([3, 3, 4]); }
    if (blk.district === 'old') { nx = pick([2, 2, 3]); nz = pick([2, 3, 3]); }
    const cutsX = [blk.x0]; for (let i = 1; i < nx; i++) cutsX.push(blk.x0 + bw * (i / nx) + rr(-5, 5)); cutsX.push(blk.x1);
    const cutsZ = [blk.z0]; for (let i = 1; i < nz; i++) cutsZ.push(blk.z0 + bd * (i / nz) + rr(-5, 5)); cutsZ.push(blk.z1);
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      const lot = { x0: cutsX[ix], x1: cutsX[ix + 1], z0: cutsZ[iz], z1: cutsZ[iz + 1] };
      const lx = (lot.x0 + lot.x1) / 2, lz = (lot.z0 + lot.z1) / 2;
      const base = skylineHeight(lx, lz);
      let h = base * rr(0.55, 1.35);
      const district = blk.district;
      if (district === 'quay') h = rr(13, 27);
      if (district === 'old') h = Math.min(h, rr(20, 46));
      if (district === 'east') h = Math.min(h, rr(14, 34));
      if (h > 80 && R() < 0.3) h *= rr(1.1, 1.45);
      h = Math.max(11, h);
      // style
      let style;
      if (district === 'quay') style = pick(['brick', 'brick', 'brick', 'stucco', 'stone']);
      else if (district === 'old') style = pick(['brick', 'brick', 'stone', 'stucco', 'brick']);
      else if (h > 95) style = pick(['stone', 'stone', 'glass', 'glass', 'concrete', 'deco']);
      else if (h > 50) style = pick(['stone', 'brick', 'glass', 'concrete', 'deco', 'stone']);
      else style = pick(['brick', 'stone', 'stucco', 'concrete', 'brick']);
      const floorH = style === 'glass' ? rr(3.6, 4.0) : rr(3.1, 3.7);
      const groundH = rr(4.6, 6.0);
      const floors = Math.max(2, Math.round((h - groundH) / floorH) + 1);
      h = groundH + (floors - 1) * floorH + rr(0.8, 1.6);      // parapet
      // small random frontage setback so the street wall is not perfectly flat
      const inset = district === 'quay' || district === 'old' ? rr(0, 0.6) : rr(0, 2.2);
      const b = {
        id: bid++, kind: 'building', district, block: blk.id, style, seed: Math.floor(R() * 1e9),
        x0: lot.x0 + (ix === 0 ? inset : 0), x1: lot.x1 - (ix === nx - 1 ? inset : 0),
        z0: lot.z0 + (iz === 0 ? inset : 0), z1: lot.z1 - (iz === nz - 1 ? inset : 0),
        h, floors, floorH, groundH,
        // which sides face a street (others are party walls): w = -X, e = +X, n = -Z, s = +Z
        open: { w: ix === 0, e: ix === nx - 1, n: iz === 0, s: iz === nz - 1 },
        tiers: [],
      };
      // setbacks for towers: tiers are stacked boxes [y0,y1] with a footprint inset from the lot
      const tiers = []; const W = b.x1 - b.x0, D = b.z1 - b.z0;
      if (h > 62 && style !== 'glass') {
        const n = h > 130 ? 4 : (h > 90 ? 3 : 2);
        let y = 0, ins = 0;
        const cut = [0.42, 0.68, 0.86, 1].slice(4 - n).map((v, i, a) => (i === a.length - 1 ? 1 : v));
        for (let t = 0; t < n; t++) {
          const y1 = h * (n === 2 ? [0.62, 1][t] : n === 3 ? [0.48, 0.78, 1][t] : [0.4, 0.64, 0.84, 1][t]);
          tiers.push({ y0: y, y1, inset: ins }); y = y1; ins += Math.min(W, D) * rr(0.07, 0.13);
        }
      } else if (h > 62) {
        tiers.push({ y0: 0, y1: h * rr(0.14, 0.24), inset: 0 }); tiers.push({ y0: tiers[0].y1, y1: h, inset: Math.min(W, D) * rr(0.05, 0.12) });
      } else tiers.push({ y0: 0, y1: h, inset: 0 });
      b.tiers = tiers;
      b.roof = h < 60 && R() < 0.55 ? 'tank' : (R() < 0.5 ? 'mech' : 'plain');
      b.shop = district !== 'east' ? R() < 0.75 : R() < 0.3;
      buildings.push(b); blk.lots.push(b.id);
    }
    blocks.push(blk);
  }

  // the Lantern Tower (hero landmark): slender stepped tower with a glowing glass lantern crown
  buildings.push({
    id: bid++, kind: 'landmark', landmark: 'lantern', district: 'core', block: 'lantern', style: 'deco', seed: 4242,
    x0: lantern.x - lantern.w / 2, x1: lantern.x + lantern.w / 2, z0: lantern.z - lantern.d / 2, z1: lantern.z + lantern.d / 2,
    h: lantern.h, floors: 58, floorH: 3.8, groundH: 9, open: { w: true, e: true, n: true, s: true },
    tiers: [{ y0: 0, y1: 62, inset: 0 }, { y0: 62, y1: 128, inset: 5 }, { y0: 128, y1: 182, inset: 9.5 }, { y0: 182, y1: 212, inset: 13.5 }],
    crown: { y0: 212, y1: 236, radius: 7.5 },    // octagonal glass lantern + spire above y 236 up to ~268
    roof: 'crown', shop: false,
  });

  // ---- streets ---------------------------------------------------------------------------------
  const streets = [];
  // promenade along the quay
  streets.push({ id: 'promenade', kind: 'promenade', dir: 'NS', x0: QUAY_X, x1: QUAY_X + PROMENADE_W, z0: CITY_Z0 - 40, z1: CITY_Z1 + 40, width: PROMENADE_W });
  for (let i = 0; i < cols.length - 1; i++) {
    streets.push({ id: `ave${i + 1}`, kind: i === TRAM_AVENUE_INDEX - 1 ? 'tramAvenue' : 'avenue', dir: 'NS', x0: cols[i].x1, x1: cols[i + 1].x0, z0: CITY_Z0 - 20, z1: CITY_Z1 + 20, width: cols[i + 1].x0 - cols[i].x1 });
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i], b = rows[i + 1];
    if (a.side === 'N' && b.side === 'S') continue;       // the canal gap is handled below
    streets.push({ id: `st${i + 1}`, kind: 'street', dir: 'EW', x0: QUAY_X + PROMENADE_W, x1: CITY_X1 + 20, z0: a.z1, z1: b.z0, width: b.z0 - a.z1 });
  }
  streets.push({ id: 'canalN', kind: 'canalQuay', dir: 'EW', x0: QUAY_X + PROMENADE_W, x1: CITY_X1 + 20, z0: CANAL.z0 - CANAL.quayW, z1: CANAL.z0, width: CANAL.quayW });
  streets.push({ id: 'canalS', kind: 'canalQuay', dir: 'EW', x0: QUAY_X + PROMENADE_W, x1: CITY_X1 + 20, z0: CANAL.z1, z1: CANAL.z1 + CANAL.quayW, width: CANAL.quayW });

  // bridges over the canal: the promenade + every avenue west of the basin
  const bridges = [{ id: 'br_promenade', x0: QUAY_X + 4, x1: QUAY_X + PROMENADE_W, z0: CANAL.z0, z1: CANAL.z1, kind: 'stone' }];
  streets.filter(s => s.kind === 'avenue' || s.kind === 'tramAvenue').forEach(s => {
    if (s.x1 < BASIN.x0 - 6) bridges.push({ id: 'br_' + s.id, x0: s.x0 + 2, x1: s.x1 - 2, z0: CANAL.z0, z1: CANAL.z1, kind: s.kind === 'tramAvenue' ? 'iron' : (bridges.length % 2 ? 'stone' : 'iron') });
  });

  // ---- elevated tram ---------------------------------------------------------------------------
  const tramAve = streets.find(s => s.kind === 'tramAvenue');
  const tramX = (tramAve.x0 + tramAve.x1) / 2;
  const tram = {
    x: tramX, deckY: GROUND_Y + 7.2, width: 8.4,                // deck height above street, twin track
    z0: CITY_Z0 - 60, z1: CITY_Z1 + 60,                         // straight N-S viaduct along the tram avenue
    canalSpan: { z0: CANAL.z0 - 6, z1: CANAL.z1 + 6 },          // steel truss span over the canal
    stations: [{ name: 'Canal', z: CANAL.z0 - CANAL.quayW - 42, length: 46 }, { name: 'North Market', z: -330, length: 46 }, { name: 'South Docks', z: 470, length: 46 }],
  };

  // ---- harbour ---------------------------------------------------------------------------------
  const harbor = {
    quay: { x: QUAY_X, z0: CITY_Z0 - 60, z1: CITY_Z1 + 60, wallTopY: GROUND_Y },
    lighthouse: { x: -1180, z: 153, islandRadius: 46, towerH: 38 },             // on the canal / sunset axis
    breakwater: { x0: -1140, z0: 190, x1: -820, z1: 520, width: 14 },            // rubble mound with tetrapods
    pier: { x0: QUAY_X - 170, x1: QUAY_X, z0: 596, z1: 606, deckY: GROUND_Y - 0.2 },   // wooden pier into the bay
    jetties: [{ x0: QUAY_X - 46, x1: QUAY_X, z0: -212, z1: -207 }, { x0: QUAY_X - 46, x1: QUAY_X, z0: -152, z1: -147 }, { x0: QUAY_X - 38, x1: QUAY_X, z0: 300, z1: 304.5 }],
    ferryRoute: [[-760, 430], [-420, 250], [-230, 20], [-420, -260], [-900, -420]],     // xz polyline the ferry follows
    farShore: { x: -3600, hills: true },                                         // low land + cranes on the western horizon (left/right of the sun)
  };

  const hills = { x0: CITY_X1 + 60, rise: 0.11, maxH: 130 };    // terrain rises east of the city: y = min(maxH, (x - x0) * rise) for x > x0

  return {
    seed, GROUND_Y, WATER_Y, QUAY_X, SUNSET_AZIMUTH,
    bounds: { x0: QUAY_X, x1: CITY_X1, z0: CITY_Z0, z1: CITY_Z1 },
    cols, rows, blocks, buildings, streets, bridges,
    canal: CANAL, basin: BASIN, plaza, lantern, core, tram, harbor, hills,
    promenadeW: PROMENADE_W,
    skylineHeight,
    /** true if (x,z) is open water (bay, canal or basin) */
    isWater(px, pz) {
      if (px < QUAY_X) return true;
      if (pz > CANAL.z0 && pz < CANAL.z1 && px < CANAL.x1 + 1) return true;
      if (px > BASIN.x0 && px < BASIN.x1 && pz > BASIN.z0 && pz < BASIN.z1) return true;
      return false;
    },
  };
}

export const LAYOUT = buildLayout();
