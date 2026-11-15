// Street-name blades, traffic signs and illuminated ad panels: one canvas atlas, one merged mesh.
import * as THREE from 'three';

const AT = 1024;
const BLADE = { w: 256, h: 56, cols: 4, rows: 10 };
const ICON = { y: 560, s: 128 };
const AD = { y: 688, w: 240, h: 336 };
export const ICONS = { arrowR: 0, arrowL: 1, stop: 2, yield: 3, noPark: 4, speed: 5, cross: 6, bus: 7 };

function drawAtlas(names) {
  const c = document.createElement('canvas'); c.width = c.height = AT; const g = c.getContext('2d');
  g.fillStyle = '#70757a'; g.fillRect(0, 0, AT, AT);
  // blades
  names.forEach((nm, i) => {
    const x = (i % BLADE.cols) * BLADE.w, y = Math.floor(i / BLADE.cols) * BLADE.h;
    g.fillStyle = nm.ave ? '#1c3d66' : '#1d5a3d'; g.fillRect(x, y, BLADE.w, BLADE.h);
    g.strokeStyle = '#e9e6dc'; g.lineWidth = 3; g.strokeRect(x + 4.5, y + 4.5, BLADE.w - 9, BLADE.h - 9);
    g.fillStyle = '#f0ede2'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let fs = 30; g.font = `700 ${fs}px "Arial Narrow", "Segoe UI", Arial, sans-serif`;
    while (g.measureText(nm.text).width > BLADE.w - 30 && fs > 14) { fs -= 2; g.font = `700 ${fs}px "Arial Narrow", "Segoe UI", Arial, sans-serif`; }
    g.fillText(nm.text, x + BLADE.w / 2, y + BLADE.h / 2 + 1);
  });
  // traffic signs (abstract)
  const ic = (i, fn) => { g.save(); g.translate(i * ICON.s, ICON.y); g.fillStyle = '#70757a'; g.fillRect(0, 0, ICON.s, ICON.s); fn(); g.restore(); };
  const arrow = dir => () => {
    g.fillStyle = '#16181a'; g.fillRect(2, 34, 124, 60); g.strokeStyle = '#f0ede2'; g.lineWidth = 3; g.strokeRect(6, 38, 116, 52);
    g.fillStyle = '#f0ede2'; g.beginPath();
    const pts = [[22, 56], [78, 56], [78, 44], [108, 64], [78, 84], [78, 72], [22, 72]];
    pts.forEach((p, k) => { const px = dir > 0 ? p[0] : 128 - p[0]; if (k) g.lineTo(px, p[1]); else g.moveTo(px, p[1]); }); g.closePath(); g.fill();
  };
  ic(0, arrow(1)); ic(1, arrow(-1));
  ic(2, () => { g.fillStyle = '#a3261d'; g.beginPath(); for (let k = 0; k < 8; k++) { const a = (k + 0.5) * Math.PI / 4; g.lineTo(64 + 60 * Math.cos(a), 64 + 60 * Math.sin(a)); } g.closePath(); g.fill(); g.strokeStyle = '#f0ede2'; g.lineWidth = 4; g.stroke(); g.fillStyle = '#f0ede2'; g.fillRect(28, 54, 72, 20); });
  ic(3, () => { g.fillStyle = '#f0ede2'; g.beginPath(); g.moveTo(4, 12); g.lineTo(124, 12); g.lineTo(64, 120); g.closePath(); g.fill(); g.strokeStyle = '#a3261d'; g.lineWidth = 12; g.lineJoin = 'round'; g.stroke(); });
  ic(4, () => { g.fillStyle = '#1e4a8a'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill(); g.strokeStyle = '#b02a20'; g.lineWidth = 12; g.stroke(); g.beginPath(); g.moveTo(24, 24); g.lineTo(104, 104); g.stroke(); });
  ic(5, () => { g.fillStyle = '#f0ede2'; g.beginPath(); g.arc(64, 64, 58, 0, 7); g.fill(); g.strokeStyle = '#b02a20'; g.lineWidth = 12; g.stroke(); g.fillStyle = '#16181a'; g.font = '700 56px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('30', 64, 68); });
  ic(6, () => { g.fillStyle = '#1e4a8a'; g.fillRect(4, 4, 120, 120); g.fillStyle = '#f0ede2'; g.beginPath(); g.moveTo(64, 16); g.lineTo(114, 108); g.lineTo(14, 108); g.closePath(); g.fill(); g.fillStyle = '#16181a'; for (let k = 0; k < 4; k++) g.fillRect(40 + k * 13, 70, 7, 30); });
  ic(7, () => { g.fillStyle = '#1e4a8a'; g.fillRect(4, 4, 120, 120); g.fillStyle = '#f0ede2'; g.fillRect(26, 22, 76, 50); g.fillStyle = '#1e4a8a'; g.fillRect(34, 30, 60, 22); g.fillStyle = '#f0ede2'; g.font = '700 34px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BUS', 64, 98); });
  // ad posters (fictional)
  const ads = [
    { a: '#d9822b', b: '#5b1f3a', t1: 'CAFÉ', t2: 'MIRETTE', t3: 'open late on the quay' },
    { a: '#1f6f8b', b: '#0d2238', t1: 'LANTERN', t2: 'LINE', t3: 'every 6 minutes' },
    { a: '#e2b23a', b: '#b0452a', t1: 'JAZZ', t2: 'NIGHTS', t3: 'Port Aurel · Market Sq' },
    { a: '#e86f4a', b: '#2a3c6e', t1: 'HARBOR', t2: 'FERRY', t3: 'sunset crossings' },
  ];
  ads.forEach((ad, i) => {
    const x = i * AD.w, y = AD.y; const gr = g.createLinearGradient(0, y, 0, y + AD.h); gr.addColorStop(0, ad.a); gr.addColorStop(1, ad.b);
    g.fillStyle = gr; g.fillRect(x, y, AD.w, AD.h);
    g.fillStyle = 'rgba(255,240,210,0.9)'; g.beginPath(); g.arc(x + AD.w / 2, y + 120, 54, 0, 7); g.fill();
    g.fillStyle = ad.b; for (let k = 0; k < 4; k++) g.fillRect(x, y + 130 + k * 16, AD.w, 6 + k * 2);
    g.fillStyle = '#fff6e6'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 46px "Arial Narrow", Arial, sans-serif'; g.fillText(ad.t1, x + AD.w / 2, y + 218); g.fillText(ad.t2, x + AD.w / 2, y + 262);
    g.font = '400 18px Arial, sans-serif'; g.fillText(ad.t3, x + AD.w / 2, y + 304);
    g.strokeStyle = '#1a1c1e'; g.lineWidth = 6; g.strokeRect(x + 3, y + 3, AD.w - 6, AD.h - 6);
  });
  // swatches: metal grey / dark
  g.fillStyle = '#6c7176'; g.fillRect(960, 688, 64, 168); g.fillStyle = '#25282b'; g.fillRect(960, 856, 64, 168);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

const uvRect = (x, y, w, h) => [x / AT, 1 - (y + h) / AT, (x + w) / AT, 1 - y / AT];     // u0, v0 (bottom), u1, v1 (top)
const GREY = uvRect(972, 700, 40, 140), DARK = uvRect(972, 868, 40, 140);

export class SignBuilder {
  constructor(names) { this.names = names; this.pos = []; this.nrm = []; this.uv = []; this.em = []; this.idx = []; }
  bladeIndex(text) { return this.names.findIndex(n => n.text === text); }
  /** textured quad centred at (x,y,z), facing yaw ry (+Z at ry = 0) */
  quad(x, y, z, ry, w, h, r, em = 0, flipU = false) {
    const c = Math.cos(ry), s = Math.sin(ry); const base = this.pos.length / 3;
    const u0 = flipU ? r[2] : r[0], u1 = flipU ? r[0] : r[2];
    const corners = [[-w / 2, -h / 2, u0, r[1]], [w / 2, -h / 2, u1, r[1]], [w / 2, h / 2, u1, r[3]], [-w / 2, h / 2, u0, r[3]]];
    for (const q of corners) { this.pos.push(x + q[0] * c, y + q[1], z - q[0] * s); this.nrm.push(s, 0, c); this.uv.push(q[2], q[3]); this.em.push(em); }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  /** thin square pole from y0 to y1 */
  pole(x, z, y0, y1, r = 0.035, dark = false) {
    const m = dark ? DARK : GREY; const mid = [(m[0] + m[2]) / 2, (m[1] + m[3]) / 2];
    for (let k = 0; k < 4; k++) {
      const ry = k * Math.PI / 2; const c = Math.cos(ry), s = Math.sin(ry);
      this.quad(x + s * r, (y0 + y1) / 2, z + c * r, ry, r * 2, y1 - y0, [mid[0], mid[1], mid[0], mid[1]]);
    }
  }
  /** double-sided street-name blade */
  blade(x, y, z, ry, text) {
    const i = Math.max(0, this.bladeIndex(text));
    const r = uvRect((i % BLADE.cols) * BLADE.w, Math.floor(i / BLADE.cols) * BLADE.h, BLADE.w, BLADE.h);
    const c = Math.cos(ry), s = Math.sin(ry);
    this.quad(x + s * 0.012, y, z + c * 0.012, ry, 0.92, 0.2, r);
    this.quad(x - s * 0.012, y, z - c * 0.012, ry + Math.PI, 0.92, 0.2, r);
  }
  /** traffic sign: icon on the front, grey back (or another icon) */
  sign(x, y, z, ry, icon, size = 0.6, backIcon = -1, h = size) {
    const r = uvRect(icon * ICON.s, ICON.y, ICON.s, ICON.s);
    const c = Math.cos(ry), s = Math.sin(ry);
    this.quad(x + s * 0.012, y, z + c * 0.012, ry, size, h, r);
    const rb = backIcon >= 0 ? uvRect(backIcon * ICON.s, ICON.y, ICON.s, ICON.s) : [GREY[0], GREY[1], GREY[0], GREY[1]];
    this.quad(x - s * 0.012, y, z - c * 0.012, ry + Math.PI, size, h, rb);
  }
  /** illuminated poster */
  ad(x, y, z, ry, index, w = 1.18, h = 1.75) {
    const r = uvRect((index % 4) * AD.w, AD.y, AD.w, AD.h);
    this.quad(x, y, z, ry, w, h, r, 1);
  }
  build(ctx) {
    if (typeof document === 'undefined' || !this.pos.length) return null;
    const tex = drawAtlas(this.names);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aEm', new THREE.Float32BufferAttribute(this.em, 1));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const mat = ctx.makeMaterial({ map: tex, roughness: 0.5, metalness: 0.15 }, {
      key: 'streets-signs',
      vertexPars: 'attribute float aEm; varying float vEm;', vertex: 'vEm = aEm;', fragPars: 'varying float vEm;',
      emissive: 'totalEmissiveRadiance += diffuseColor.rgb * vEm * (uNight * 4.5 + 0.25);',
    });
    const m = new THREE.Mesh(g, mat); m.name = 'signs'; m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false;
    return m;
  }
  get tris() { return this.idx.length / 3; }
}
