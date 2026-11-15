// Camera-distance instance streaming: every prop type is ONE InstancedMesh whose instance buffer is refilled with the
// instances of the tiles that should currently show it. Selection is a pure function of the camera (position, direction,
// field of view — no hysteresis), evaluated in engine.hooks.beforeSample, so rendering stays deterministic.
//
// Two kinds of groups:
//  * plain props  ({ dist })          : shown while the tile is within `dist` (in the view cone the distance is scaled
//                                       by the lens, so a telephoto keeps its far furniture), dropped beyond `cull` metres
//                                       when the tile is outside the view cone;
//  * tiered props ({ tier: 0|1|2 })   : three levels of detail of the same thing (hi / mid / far). In the view cone the
//                                       tier follows the apparent size (distance x lens factor); outside it nothing is ever
//                                       "hi" (those instances only matter for shadows) and far instances are dropped
//                                       beyond `cull` metres.
import * as THREE from 'three';

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const TAN20 = Math.tan(20 * Math.PI / 180);

export class TileLOD {
  static SUB = 10;
  constructor(rect, groundY, tile = 150, { hi = 40, mid = 220, cull = 320 } = {}) {
    this.rect = rect; this.tile = tile; this.groundY = groundY;
    this.nx = Math.ceil((rect.x1 - rect.x0) / tile); this.nz = Math.ceil((rect.z1 - rect.z0) / tile);
    this.hi = hi; this.mid = mid; this.cull = cull;
    const nt = this.nx * this.nz;
    this.tD = new Float32Array(nt);      // distance camera -> tile
    this.tE = new Float32Array(nt);      // apparent distance (lens-scaled inside the view cone)
    this.tV = new Uint8Array(nt);        // 1 = inside the view cone
    this.tT = new Int8Array(nt);         // tier 0 / 1 / 2, or 3 = dropped
    this.groups = []; this.rendered = 0;
  }
  tileOf(x, z) {
    const i = Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.rect.x0) / this.tile)));
    const j = Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.rect.z0) / this.tile)));
    return j * this.nx + i;
  }
  /**
   * items: [{x,y,z,ry,s,tint,w,rx,rz}] (Scatter items). dist: streaming radius in metres (plain props);
   * tier: 0 / 1 / 2 for the hi / mid / far level of a tiered prop.
   */
  add(name, items, geometry, material, { dist = 300, tier = -1, cast = true, receive = true, layer = 0, tris = 0, depthMaterial = null } = {}) {
    const n = items.length; if (!n) return null;
    // detail chain (plain props only): geometry.userData.lods = [{ geometry, tris, from }] (ascending apparent distance).
    // The prop is then binned into SUB x SUB sub-cells per tile; WHICH instances are drawn is still decided per tile exactly
    // as for a prop without a chain, only the level of detail follows the (lens-scaled) distance of the sub-cell.
    const chain = tier < 0 && geometry.userData && geometry.userData.lods && geometry.userData.lods.length ? geometry.userData.lods : null;
    const SUB = TileLOD.SUB, ft = this.tile / SUB, fnx = this.nx * SUB, fnz = this.nz * SUB;
    const fineOf = o => !chain ? 0 : Math.min(fnz - 1, Math.max(0, Math.floor((o.z - this.rect.z0) / ft))) * fnx + Math.min(fnx - 1, Math.max(0, Math.floor((o.x - this.rect.x0) / ft)));
    if (chain && !this.fD) this.fD = new Float32Array(fnx * fnz);
    const order = items.map((o, i) => [this.tileOf(o.x, o.z), i, fineOf(o)]).sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1]);
    const mats = new Float32Array(n * 16), inst = new Float32Array(n * 4);
    const ranges = [], rmap = new Map();
    order.forEach(([t, src, fc], k) => {
      const o = items[src];
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0, 'YXZ'); _q.setFromEuler(_e); _p.set(o.x, o.y, o.z);
      if (typeof o.s === 'number') _s.set(o.s, o.s, o.s); else _s.set(o.s[0], o.s[1], o.s[2]);
      _m4.compose(_p, _q, _s); _m4.toArray(mats, k * 16);
      inst[k * 4] = o.tint[0]; inst[k * 4 + 1] = o.tint[1]; inst[k * 4 + 2] = o.tint[2]; inst[k * 4 + 3] = o.w;
      const rk = chain ? fc : t, r = rmap.get(rk);
      if (r) r[1][1]++; else { const e = [t, [k, 1], fc]; rmap.set(rk, e); ranges.push(e); }
    });
    const make = (geo, nm, tr, lo, hi) => {
      const mesh = new THREE.InstancedMesh(geo, material, n);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const ia = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4); ia.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aInst', ia);
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.name = nm; mesh.matrixAutoUpdate = false;
      if (depthMaterial) mesh.customDepthMaterial = depthMaterial;
      if (layer) mesh.layers.set(layer);
      this.groups.push({ name: nm, mesh, mats, inst, ia, ranges, dist, tier, key: -1, key2: -1, tris: tr, n, fine: !!chain, lo, hi });
      return mesh;
    };
    const mesh = make(geometry, name, tris, 0, chain ? chain[0].from : Infinity);
    // the coarser levels ride along as children of the first mesh (the caller adds one object to the scene)
    if (chain) chain.forEach((c, i) => mesh.add(make(c.geometry, name + '_l' + (i + 1), c.tris, c.from, i + 1 < chain.length ? chain[i + 1].from : Infinity)));
    return mesh;
  }
  /** cam: a THREE.Camera (preferred: lens + view cone are taken into account) or a Vector3 position */
  update(cam) {
    let cx, cy, cz, fx = 0, fz = 0, hasDir = false, lens = 1, halfH = Math.PI;
    if (cam && cam.isCamera) {
      const e = cam.matrixWorld.elements; cx = e[12]; cy = e[13]; cz = e[14];
      const dx = -e[8], dy = -e[9], dz = -e[10], l = Math.hypot(dx, dz);
      if (cam.isPerspectiveCamera) {
        const th = Math.tan(cam.fov * Math.PI / 360);
        lens = Math.min(1.25, Math.max(0.2, th / TAN20));
        if (l > 0.5 * Math.hypot(dx, dy, dz)) { hasDir = true; fx = dx / l; fz = dz / l; halfH = Math.atan(th * (cam.aspect || 1.78)) + 0.14; }
      }
    } else { cx = cam.x; cy = cam.y; cz = cam.z; }
    const { nx, nz, tile, rect, tD, tE, tV, tT, hi, mid, cull } = this;
    const rT = tile * 0.7072, hy = cy - this.groundY;
    for (let j = 0, t = 0; j < nz; j++) for (let i = 0; i < nx; i++, t++) {
      const x0 = rect.x0 + i * tile, z0 = rect.z0 + j * tile;
      const ddx = Math.max(x0 - cx, 0, cx - (x0 + tile)), ddz = Math.max(z0 - cz, 0, cz - (z0 + tile));
      const d = Math.hypot(ddx, ddz, hy);
      let view = 1;
      if (hasDir) {
        const vx = x0 + tile * 0.5 - cx, vz = z0 + tile * 0.5 - cz, vl = Math.hypot(vx, vz);
        if (vl > rT + 12) {
          const ang = Math.acos(Math.max(-1, Math.min(1, (vx * fx + vz * fz) / vl)));
          view = ang < halfH + Math.asin(Math.min(1, rT / vl)) ? 1 : 0;
        }
      }
      const de = view ? d * lens : d;
      tD[t] = d; tE[t] = de; tV[t] = view;
      tT[t] = view ? (de < hi ? 0 : de < mid ? 1 : 2) : (d < mid ? 1 : d < cull ? 2 : 3);
    }
    const fD = this.fD;
    if (fD) {
      // apparent distance of every sub-cell (outside the view cone: infinitely far -> cheapest level, shadows only)
      const SUB = TileLOD.SUB, ft = tile / SUB, fnx = nx * SUB, fnz = nz * SUB;
      for (let j = 0, f = 0; j < fnz; j++) for (let i = 0; i < fnx; i++, f++) {
        const t = ((j / SUB) | 0) * nx + ((i / SUB) | 0);
        if (!tV[t]) { fD[f] = 1e30; continue; }
        const x0 = rect.x0 + i * ft, z0 = rect.z0 + j * ft;
        fD[f] = Math.hypot(Math.max(x0 - cx, 0, cx - (x0 + ft)), Math.max(z0 - cz, 0, cz - (z0 + ft)), hy) * lens;
      }
    }
    let rendered = 0;
    for (const g of this.groups) {
      const tier = g.tier, dist = g.dist, lo = g.lo, hi2 = g.hi;
      const show = tier >= 0 ? (r => tT[r[0]] === tier)
        : g.fine ? (r => { const t = r[0]; if (!(tE[t] < dist && (tV[t] === 1 || tD[t] < cull))) return false; const de = fD[r[2]]; return de >= lo && de < hi2; })
          : (r => { const t = r[0]; return tE[t] < dist && (tV[t] === 1 || tD[t] < cull); });
      let k1 = 7, k2 = 0;                    // two independent hashes of the visible tile set
      for (const r of g.ranges) if (show(r)) { const t = g.fine ? r[2] : r[0]; k1 = (Math.imul(k1, 31) + t + 1) | 0; k2 = (Math.imul(k2 ^ (t + 0x9e3779b9), 0x85ebca6b) + 1) | 0; }
      if (k1 !== g.key || k2 !== g.key2) {
        g.key = k1; g.key2 = k2;
        const M = g.mesh.instanceMatrix.array, I = g.ia.array; let k = 0;
        for (const r of g.ranges) {
          if (!show(r)) continue;
          const start = r[1][0], count = r[1][1];
          M.set(g.mats.subarray(start * 16, (start + count) * 16), k * 16);
          I.set(g.inst.subarray(start * 4, (start + count) * 4), k * 4);
          k += count;
        }
        g.mesh.count = k; g.mesh.instanceMatrix.needsUpdate = true; g.ia.needsUpdate = true;
      }
      rendered += g.mesh.count * g.tris;
    }
    this.rendered = rendered;
    return rendered;
  }
}
