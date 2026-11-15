// Camera-centred water mesh: nested regular grids (geometry clipmap, CDLOD-style morph in the vertex shader)
// plus a flat skirt that reaches far beyond the horizon.
//  * level L has cells of size s0 * 2^L and is snapped to even multiples of its cell size, so every vertex sits on
//    a fixed world-space lattice: no swimming or popping when the camera moves.
//  * near its outer edge a level morphs its odd vertices onto the next coarser lattice (in the shader), which is
//    exactly the lattice of the surrounding level -> watertight without stitching strips.
//  * the hole of level L (where level L-1 sits) can be at 4 offsets; one index buffer per offset.
import * as THREE from 'three';

export class WaterClipmap {
  /**
   * @param {object} o  M: cells per side (multiple of 4), levels, cell0: finest cell size (m)
   */
  constructor({ M = 160, levels = 7, cell0 = 0.125, material, skirtMaterial }) {
    this.M = M; this.levels = levels; this.cell0 = cell0;
    this.q = 8 / (M - 8);                          // worst-case grid spacing / distance
    this.morph = [M / 4 + 3, M / 2 - 3];           // in cells of the level (chebyshev distance to the camera)
    this.group = new THREE.Group(); this.group.name = 'waterSurface';
    const n = M + 1, h = M / 2;
    const pos = new Float32Array(n * n * 3);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = (j * n + i) * 3; pos[k] = i - h; pos[k + 1] = 0; pos[k + 2] = j - h; }
    const posAttr = new THREE.BufferAttribute(pos, 3);
    const makeGeo = (hole) => {
      const idx = [];
      for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
        const ci = i - h, cj = j - h;
        if (hole && ci >= -M / 4 + hole[0] && ci < M / 4 + hole[0] && cj >= -M / 4 + hole[1] && cj < M / 4 + hole[1]) continue;
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        if ((i + j) & 1) idx.push(a, c, b, b, c, d); else idx.push(a, c, d, a, d, b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', posAttr);
      g.setIndex(new THREE.BufferAttribute(new Uint16Array(idx), 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), M);
      return g;
    };
    this.fullGeo = makeGeo(null);
    this.holeGeo = [makeGeo([0, 0]), makeGeo([1, 0]), makeGeo([0, 1]), makeGeo([1, 1])];
    this.meshes = [];
    for (let L = 0; L < levels; L++) {
      const m = new THREE.Mesh(L === 0 ? this.fullGeo : this.holeGeo[0], material);
      m.frustumCulled = false; m.layers.set(1); m.castShadow = false; m.receiveShadow = true; m.name = 'waterL' + L;
      m.matrixAutoUpdate = true;
      this.meshes.push(m); this.group.add(m);
    }
    // ---- skirt: square rings growing geometrically from the edge of the last level (unit half-extent = 1)
    {
      const per = M / 2;                       // segments per side: the fully morphed lattice of the last level
      const ring0 = [];
      for (let i = 0; i < per; i++) ring0.push([-1 + 2 * i / per, -1]);
      for (let i = 0; i < per; i++) ring0.push([1, -1 + 2 * i / per]);
      for (let i = 0; i < per; i++) ring0.push([1 - 2 * i / per, 1]);
      for (let i = 0; i < per; i++) ring0.push([-1, 1 - 2 * i / per]);
      // the first ring starts slightly inside the last level (both are flat there and shade identically from world
      // position), so float rounding can never open a hairline gap between them
      const rings = [0.985]; let r = 1;
      while (r < 1200) { r *= r < 3 ? 1.12 : 1.3; rings.push(r); }
      const nv = ring0.length; const sp = new Float32Array(rings.length * nv * 3);
      rings.forEach((rr, k) => ring0.forEach(([x, z], i) => { const o = (k * nv + i) * 3; sp[o] = x * rr; sp[o + 1] = 0; sp[o + 2] = z * rr; }));
      const idx = [];
      for (let k = 0; k < rings.length - 1; k++) for (let i = 0; i < nv; i++) {
        const a = k * nv + i, b = k * nv + (i + 1) % nv, c = a + nv, d = b + nv;
        // ring0 runs +x along the -z edge first; (b-a) x (c-a) points up
        idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(sp, 3));
      g.setIndex(new THREE.BufferAttribute(nv * rings.length > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2000);
      this.skirt = new THREE.Mesh(g, skirtMaterial);
      this.skirt.frustumCulled = false; this.skirt.layers.set(1); this.skirt.castShadow = false; this.skirt.receiveShadow = true; this.skirt.name = 'waterSkirt';
      this.group.add(this.skirt);
    }
    this.triangles = (this.fullGeo.index.count + (levels - 1) * this.holeGeo[0].index.count + this.skirt.geometry.index.count) / 3;
    this._s0 = -1;
  }

  /** Snap all levels around the camera. cx, cy, cz: camera world position (water at y = 0). */
  place(cx, cy, cz) {
    const { M, levels, cell0, q } = this;
    const k = Math.max(0, Math.min(9, Math.floor(Math.log2(Math.max(Math.abs(cy), 1e-3) * q / cell0))));
    const s0 = cell0 * Math.pow(2, k);
    let px = 0, pz = 0;
    for (let L = 0; L < levels; L++) {
      const s = s0 * Math.pow(2, L);
      const ox = Math.floor(cx / (2 * s)) * 2 * s, oz = Math.floor(cz / (2 * s)) * 2 * s;
      const m = this.meshes[L];
      m.position.set(ox, 0, oz); m.scale.set(s, 1, s);
      if (L > 0) {
        const ax = Math.round((px - ox) / s), az = Math.round((pz - oz) / s);
        m.geometry = this.holeGeo[(ax ? 1 : 0) + (az ? 2 : 0)];
      }
      px = ox; pz = oz;
    }
    const sl = s0 * Math.pow(2, levels - 1);
    this.skirt.position.set(px, 0, pz);
    const e = M / 2 * sl; this.skirt.scale.set(e, 1, e);
    this._s0 = s0;
    return s0;
  }
}
