// Rooftop signs: steel scaffolds carrying large fictional words. Letters are alpha-cut quads from a canvas atlas
// (R = letter face, G = neon tubing, B = soft halo); painted sheet metal by day, neon at night (emissive x uNight).
import * as THREE from 'three';
import { lin, mul } from './kit.js';
import { M } from './materials.js';

// invented names only — no real brands
const WORDS = [
  { t: ['PORT', 'AUREL'], font: '900 108px Georgia, "Times New Roman", serif', neon: [1.0, 0.42, 0.08], face: 0xd8cfb8, style: 'open', hl: 3.2, I: 16 },
  { t: ['HOTEL AURORA'], font: '900 104px "Arial Black", Impact, sans-serif', neon: [1.0, 0.07, 0.04], face: 0xb8281c, style: 'open', hl: 3.6, I: 16, site: [375, 96] },
  { t: ['LANTERN'], font: '700 110px "Palatino Linotype", Georgia, serif', neon: [1.0, 0.74, 0.36], face: 0xe2d9c0, style: 'open', hl: 3.4, I: 18 },
  { t: ['RADIO'], font: '900 112px Impact, "Arial Black", sans-serif', neon: [1.0, 0.09, 0.04], face: 0xc23a22, style: 'open', hl: 3.8, I: 17 },
  { t: ['KINO'], font: '900 112px "Arial Black", Impact, sans-serif', neon: [0.1, 0.6, 1.0], face: 0xd7d2c4, style: 'panel', bg: 0x1c2a3a, hl: 3.4, I: 14 },
  { t: ['Café Mira'], font: 'italic 700 112px "Segoe Script", "Brush Script MT", cursive', neon: [1.0, 0.14, 0.38], face: 0xe9c9c0, style: 'panel', bg: 0x2a1b1e, hl: 2.6, I: 13, script: true },
  { t: ['BAR', 'NOVA'], font: '700 108px Bahnschrift, "Trebuchet MS", sans-serif', neon: [0.12, 1.0, 0.4], face: 0xcfd6c4, style: 'open', hl: 2.6, I: 12 },
  { t: ['TABAK'], font: '900 110px Georgia, serif', neon: [1.0, 0.45, 0.1], face: 0xe0c9a0, style: 'panel', bg: 0x3a2416, hl: 2.8, I: 11 },
  { t: ['OPAL'], font: '900 112px "Arial Black", sans-serif', neon: [0.35, 0.95, 0.9], face: 0xcfe0dc, style: 'open', hl: 3.6, I: 14 },
  { t: ['HOTEL', 'VESPER'], font: '700 104px "Palatino Linotype", Georgia, serif', neon: [0.75, 0.45, 1.0], face: 0xd9d0e0, style: 'open', hl: 2.6, I: 13 },
  { t: ['LYRA'], font: 'italic 900 112px Georgia, serif', neon: [0.95, 0.95, 1.0], face: 0xe4e2dc, style: 'open', hl: 3.4, I: 12 },
  { t: ['ESPLANADE'], font: '900 104px Impact, "Arial Black", sans-serif', neon: [1.0, 0.1, 0.05], face: 0xbf3020, style: 'open', hl: 2.6, I: 14 },
  { t: ['TEATRO'], font: '900 108px Georgia, serif', neon: [1.0, 0.68, 0.22], face: 0xe5d6a8, style: 'panel', bg: 0x30141a, hl: 3.0, I: 13 },
  { t: ['BAZAR'], font: '700 110px Bahnschrift, "Trebuchet MS", sans-serif', neon: [0.4, 1.0, 0.4], face: 0xd0d8c0, style: 'open', hl: 3.0, I: 11 },
  { t: ['Salt &', 'Tide'], font: 'italic 700 108px "Segoe Script", "Brush Script MT", cursive', neon: [0.4, 0.8, 1.0], face: 0xd0dde4, style: 'panel', bg: 0x14242c, hl: 2.2, I: 12, script: true },
  { t: ['HAFEN'], font: '900 112px "Arial Black", sans-serif', neon: [0.3, 0.5, 1.0], face: 0xc8d0e4, style: 'open', hl: 3.2, I: 13 },
  { t: ['PALAIS'], font: '700 110px "Palatino Linotype", Georgia, serif', neon: [1.0, 0.3, 0.7], face: 0xe6cfd8, style: 'open', hl: 3.2, I: 12 },
  { t: ['MARLOWE', '& SONS'], font: '700 100px Georgia, serif', neon: [1.0, 0.8, 0.5], face: 0xe6dfc8, style: 'panel', bg: 0x20281f, hl: 2.0, I: 9 },
];

const FACING = {
  w: { r: [0, 0, 1], n: [-1, 0, 0] }, e: { r: [0, 0, -1], n: [1, 0, 0] },
  s: { r: [1, 0, 0], n: [0, 0, 1] }, n: { r: [-1, 0, 0], n: [0, 0, -1] },
};

/** choose buildings for the signs + what must stay clear on their roofs */
export function planSigns(ctx, rng, skip = () => false) {
  const L = ctx.layout; const B = L.buildings;
  const cands = [];
  for (const b of B) {
    if (b.kind !== 'building' || b.district === 'east' || skip(b)) continue;
    if (b.h < 15 || b.h > 100) continue;
    const t = b.tiers[b.tiers.length - 1];
    const x0 = b.x0 + t.inset, x1 = b.x1 - t.inset, z0 = b.z0 + t.inset, z1 = b.z1 - t.inset;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (cx > 640 || cz < -330 || cz > 520) continue;
    // exposure toward the west: nothing taller close by in front
    let block = 0;
    for (const o of B) {
      if (o === b || o.x1 > b.x0 + 1 || b.x0 - o.x1 > 110) continue;
      const ov = Math.min(o.z1, b.z1) - Math.max(o.z0, b.z0);
      if (ov > 0.3 * (b.z1 - b.z0)) block = Math.max(block, o.h - (b.x0 - o.x1) * 0.12);
    }
    const dCanal = Math.abs(cz - 153);
    const exposed = b.h + 3 - block;
    if (exposed < 4 || z1 - z0 < 12 || x1 - x0 < 9) continue;
    let score = Math.min(exposed, 30) * 0.6 - dCanal * 0.05 + (b.h > 20 && b.h < 70 ? 6 : 0) + rng() * 10;
    if (dCanal < 60) score += 8;
    if (cx < 240) score += 5;
    cands.push({ b, score, x0, x1, z0, z1, cx, cz, dCanal });
  }
  cands.sort((a, b) => b.score - a.score);
  // hand-placed hero sites (the building containing the point), e.g. the big sign under the Lantern Tower as seen from the old town
  const forced = new Map();
  WORDS.forEach((w, i) => {
    if (!w.site) return;
    const b = B.find(q => q.kind === 'building' && w.site[0] >= q.x0 && w.site[0] <= q.x1 && w.site[1] >= q.z0 && w.site[1] <= q.z1);
    if (!b || skip(b)) return;
    const t = b.tiers[b.tiers.length - 1];
    const x0 = b.x0 + t.inset, x1 = b.x1 - t.inset, z0 = b.z0 + t.inset, z1 = b.z1 - t.inset;
    forced.set(i, { b, score: 99, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, dCanal: Math.abs((z0 + z1) / 2 - 153) });
  });
  const chosen = [...forced.values()];
  for (const c of cands) {
    if (chosen.length >= WORDS.length) break;
    if (chosen.some(q => q.b === c.b || Math.hypot(q.cx - c.cx, q.cz - c.cz) < 85)) continue;
    chosen.push(c);
  }
  // match words to roofs: long words want wide roofs; the first (hero) names want to be near the canal
  const plan = { signs: [], reserve: new Map() };
  const left = chosen.filter(c => ![...forced.values()].includes(c));
  WORDS.forEach((w, i) => {
    if (!left.length && !forced.has(i)) return;
    const chars = Math.max(...w.t.map(t => t.length));
    const estW = chars * w.hl * 0.9 + 1.5;
    let best = 0, bestV = -1e9;
    left.forEach((c, k) => {
      const avail = c.z1 - c.z0 - 2;
      const v = Math.min(1, avail / estW) * 10 - Math.max(0, avail - estW * 1.6) * 0.15 + (i < 6 && c.dCanal < 90 ? 6 : 0) + (i < 3 && c.cx < 260 ? 3 : 0);
      if (v > bestV) { bestV = v; best = k; }
    });
    const c = forced.has(i) ? forced.get(i) : left.splice(best, 1)[0]; const b = c.b;
    const y = ctx.GROUND_Y + b.tiers[b.tiers.length - 1].y1;
    const visH = (w.t.length - 1) * 1.38 * w.hl + w.hl;
    const depth = Math.min(c.x1 - c.x0 - 3, visH * 0.6 + 3.0);
    plan.signs.push({ word: i, id: b.id, facing: 'w', x0: c.x0, x1: c.x1, z0: c.z0, z1: c.z1, y, depth, h: b.h });
    plan.reserve.set(b.id, [{ x: c.x0 + depth / 2, z: c.cz, w: depth, d: c.z1 - c.z0 }]);
  });
  return plan;
}

function makeAtlas(THREE_) {
  if (typeof document === 'undefined') return null;
  const S = 2048; const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
  const rowH = 168, pad = 26; let x = 0, y = 0;
  const lines = [];
  WORDS.forEach((w, wi) => w.t.forEach((text, li) => {
    g.font = w.font;
    const tw = Math.ceil(g.measureText(text).width);
    const cw = tw + pad * 2;
    if (x + cw > S) { x = 0; y += rowH; }
    const bx = x + pad, by = y + rowH - 44;
    // per-letter boundaries (fractions of the cell width)
    const cuts = [0];
    for (let k = 1; k < text.length; k++) cuts.push((pad + g.measureText(text.slice(0, k)).width) / cw);
    cuts.push(1);
    g.globalCompositeOperation = 'lighter';
    g.filter = 'blur(11px)'; g.fillStyle = '#0000ff'; g.fillText(text, bx, by); g.fillText(text, bx, by);
    g.filter = 'none';
    g.fillStyle = '#ff0000'; g.strokeStyle = '#ff0000'; g.lineWidth = 7; g.fillText(text, bx, by); g.strokeText(text, bx, by);
    g.strokeStyle = '#00ff00'; g.lineWidth = 4.5; g.strokeText(text, bx, by);
    lines.push({ wi, li, text, u0: x / S, u1: (x + cw) / S, v1: 1 - y / S, v0: 1 - (y + rowH) / S, aspect: cw / rowH, cuts });
    x += cw;
  }));
  const tex = new THREE_.CanvasTexture(cv);
  tex.colorSpace = THREE_.NoColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
  tex.minFilter = THREE_.LinearMipmapLinearFilter; tex.magFilter = THREE_.LinearFilter;
  return { tex, lines };
}

function makeSignMaterial(ctx, tex) {
  return ctx.makeMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide }, {
    key: 'roofsign',
    uniforms: { uSignAtlas: { value: tex } },
    vertexPars: 'attribute vec3 aNeon; attribute vec3 aFace; attribute vec4 aFx; varying vec3 vNeon; varying vec3 vFace; varying vec4 vFx; varying vec2 vUv2;',
    vertex: 'vNeon = aNeon; vFace = aFace; vFx = aFx; vUv2 = uv;',
    fragPars: 'uniform sampler2D uSignAtlas; varying vec3 vNeon; varying vec3 vFace; varying vec4 vFx; varying vec2 vUv2; vec3 gSign;',
    color: /* glsl */`
    {
      vec4 tx = texture2D(uSignAtlas, vUv2);
      gSign = tx.rgb;
      float mode = vFx.z;
      if (mode < 0.5 || mode > 1.5) { if (tx.r < 0.5) discard; }
      vec3 c;
      if (mode > 1.5) c = vec3(0.035, 0.033, 0.03);
      else if (mode < 0.5) c = mix(vFace, vec3(0.55, 0.52, 0.5), tx.g * 0.32);
      else {
        vec3 paint = mix(vNeon / max(max(vNeon.r, vNeon.g), max(vNeon.b, 0.001)), vec3(0.85, 0.8, 0.7), 0.45) * 0.75;
        float wear = 0.75 + 0.5 * fbm2(vWPos.zy * 0.8 + vWPos.x);
        c = mix(vFace * wear, paint, smoothstep(0.4, 0.6, tx.r));
        c = mix(c, vec3(0.55), tx.g * 0.28);
      }
      c *= 0.85 + 0.3 * vnoise(vWPos.zy * 1.7 + vWPos.x * 1.7);
      diffuseColor.rgb = c;
    }`,
    emissive: /* glsl */`
    {
      float mode = vFx.z; float seed = vFx.x;
      float fl = 1.0;
      if (vFx.y > 0.0) {
        float n = vnoise(vec2(uTime * 9.0, seed * 37.0)); float n2 = vnoise(vec2(uTime * 1.9 + seed * 5.0, seed * 11.0));
        fl = 1.0 - vFx.y * smoothstep(0.52, 0.58, n) * smoothstep(0.3, 0.45, n2);
      }
      fl *= 0.965 + 0.035 * sin(uTime * 31.0 + seed * 20.0);
      float e = mode > 1.5 ? 0.0 : (gSign.g * 1.0 + gSign.r * 0.13 + (mode > 0.5 ? gSign.b * 0.05 : 0.0));
      totalEmissiveRadiance += vNeon * vFx.w * e * fl * uNight;
    }`,
  });
}

export function buildSigns(ctx, K, group, plan, rng) {
  const atlas = makeAtlas(ctx.THREE);
  const P = [], N = [], U = [], NE = [], FA = [], FX = [];
  const info = [];
  const quad = (o, r, n, x0, x1, y0, y1, off, uv, neon, face, fx) => {
    // corners in sign space: x along r, y up, off along n
    const c = (x, y) => [o[0] + r[0] * x + n[0] * off, o[1] + y, o[2] + r[2] * x + n[2] * off];
    const a = c(x0, y0), b = c(x1, y0), cc = c(x1, y1), d = c(x0, y1);
    const vs = [a, b, cc, a, cc, d], uvs = [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]];
    for (let i = 0; i < 6; i++) { P.push(...vs[i]); N.push(...n); U.push(...uvs[i]); NE.push(...neon); FA.push(...face); FX.push(...fx); }
  };
  const iron = lin(0x3c3a38);
  for (const s of plan.signs) {
    const w = WORDS[s.word]; const F = FACING[s.facing];
    const lines = atlas ? atlas.lines.filter(l => l.wi === s.word) : w.t.map(t => ({ text: t, aspect: t.length * 0.62 + 0.4, u0: 0, u1: 1, v0: 0, v1: 1, cuts: [0, 1] }));
    const avail = (s.facing === 'w' || s.facing === 'e' ? s.z1 - s.z0 : s.x1 - s.x0) - 2.0;
    // cap height so the widest line fits the roof (atlas cell = 168 px, caps ~78 px, baseline 44 px above the cell bottom)
    const cellK = 168 / 78;
    let hl = w.hl * (s.h > 60 ? 1.2 : 1);
    const widest = Math.max(...lines.map(l => l.aspect));
    hl = Math.min(hl, avail / (widest * cellK));
    const cellH = hl * cellK;
    const pitch = 1.38 * hl;
    const visH = (lines.length - 1) * pitch + hl;
    const Wd = widest * cellH;
    const legH = (w.style === 'panel' ? 1.6 : 1.9) + rng() * 1.2;
    const desc = w.script ? 0.36 * hl : 0;
    const totalH = visH + 0.25 + desc;
    const along = s.facing === 'w' || s.facing === 'e';
    const edge = s.facing === 'w' ? s.x0 : s.facing === 'e' ? s.x1 : s.facing === 's' ? s.z1 : s.z0;
    const mid = along ? (s.z0 + s.z1) / 2 : (s.x0 + s.x1) / 2;
    // sign plane sits 1.0 m inside the roof edge
    const o = along ? [edge - F.n[0] * 1.0, s.y, mid] : [mid, s.y, edge - F.n[2] * 1.0];
    const neon = w.neon, face = lin(w.face);
    const seed = rng() * 10;
    const flickLetter = rng() < 0.45 ? Math.floor(rng() * 8) : -1;
    let li = 0, letterIdx = 0;
    for (const ln of lines) {
      const lw = ln.aspect * cellH;
      const baseY = legH + 0.15 + desc + (lines.length - 1 - li) * pitch;
      const yBot = baseY - (44 / 168) * cellH, yTop = yBot + cellH;
      const nC = ln.cuts.length - 1;
      for (let k = 0; k < nC; k++) {
        const xa = -lw / 2 + ln.cuts[k] * lw, xb = -lw / 2 + ln.cuts[k + 1] * lw;
        const uv = [ln.u0 + (ln.u1 - ln.u0) * ln.cuts[k], ln.v0, ln.u0 + (ln.u1 - ln.u0) * ln.cuts[k + 1], ln.v1];
        const fl = letterIdx === flickLetter ? 1.0 : (rng() < 0.12 ? 0.35 : 0.0);
        const fx = [seed + letterIdx * 0.37, fl, w.style === 'panel' ? 1 : 0, w.I];
        if (w.style === 'panel') quad(o, F.r, F.n, xa, xb, Math.max(yBot, legH - 0.2), Math.min(yTop, legH + totalH + 0.2), 0.07, [uv[0], uv[1] + (uv[3] - uv[1]) * (Math.max(yBot, legH - 0.2) - yBot) / cellH, uv[2], uv[1] + (uv[3] - uv[1]) * (Math.min(yTop, legH + totalH + 0.2) - yBot) / cellH], neon, lin(w.bg), fx);
        else {
          quad(o, F.r, F.n, xa, xb, yBot, yTop, 0.0, uv, neon, face, fx);
          quad(o, F.r, F.n, xa, xb, yBot, yTop, -0.09, uv, neon, face, [fx[0], 0, 2, 0]);
          quad(o, F.r, F.n, xa, xb, yBot, yTop, -0.18, uv, neon, face, [fx[0], 0, 2, 0]);
        }
        letterIdx++;
      }
      li++;
    }
    // ---- scaffold
    const top = legH + totalH, bot = legH;
    const Pt = (x, y, off) => [o[0] + F.r[0] * x + F.n[0] * off, o[1] + y, o[2] + F.r[2] * x + F.n[2] * off];
    const back = w.style === 'panel' ? -0.12 : -0.34;
    if (w.style === 'panel') {
      // painted board + frame
      const cx = o[0] + F.n[0] * -0.02, cz = o[2] + F.n[2] * -0.02;
      K.box(cx, s.y + bot - 0.25, cz, along ? 0.14 : Wd + 0.3, top - bot + 0.5, along ? Wd + 0.3 : 0.14, lin(w.bg), M.PAINT, true);
      for (const yy of [bot - 0.3, top + 0.3]) K.beam(Pt(-Wd / 2 - 0.2, yy, 0.02), Pt(Wd / 2 + 0.2, yy, 0.02), 0.2, 0.12, iron, M.IRON, false);
      for (const xx of [-Wd / 2 - 0.18, Wd / 2 + 0.18]) K.beam(Pt(xx, bot - 0.3, 0.02), Pt(xx, top + 0.3, 0.02), 0.12, 0.2, iron, M.IRON, false);
    }
    const nV = Math.max(3, Math.ceil(Wd / 2.9) + 1);
    const braceD = Math.max(1.2, Math.min(s.depth - 1.6, totalH * 0.6 + 1.2));
    for (let i = 0; i < nV; i++) {
      const x = -Wd / 2 + (Wd * i) / (nV - 1);
      K.beam(Pt(x, 0, back), Pt(x, top + 0.15, back), 0.13, 0.13, iron, M.IRON, true);
      K.beam(Pt(x, top * 0.86, back), Pt(x, 0, back - braceD), 0.1, 0.1, iron, M.IRON, true);
      K.beam(Pt(x, legH * 0.5, back), Pt(x, legH * 0.5, back - braceD * (1 - legH * 0.5 / (top * 0.86))), 0.07, 0.07, iron, M.IRON, false);
      if (i < nV - 1) {
        const x2 = -Wd / 2 + (Wd * (i + 1)) / (nV - 1);
        K.beam(Pt(x, 0.1, back), Pt(x2, bot - 0.15, back), 0.06, 0.06, iron, M.IRON, false);
        K.beam(Pt(x2, 0.1, back), Pt(x, bot - 0.15, back), 0.06, 0.06, iron, M.IRON, false);
      }
    }
    const rails = w.style === 'panel' ? [bot - 0.1, top] : [bot - 0.1, (bot + top) / 2, top];
    for (const yy of rails) K.beam(Pt(-Wd / 2 - 0.2, yy, back + 0.05), Pt(Wd / 2 + 0.2, yy, back + 0.05), 0.1, 0.1, iron, M.IRON, false);
    if (lines.length > 1 && w.style !== "panel") K.beam(Pt(-Wd / 2, legH + 0.05 + pitch, back + 0.05), Pt(Wd / 2, legH + 0.05 + pitch, back + 0.05), 0.1, 0.1, iron, M.IRON, false);
    // walkway behind the letters
    K.beam(Pt(-Wd / 2, legH - 0.25, back - 0.45), Pt(Wd / 2, legH - 0.25, back - 0.45), 0.7, 0.05, lin(0x555555), M.GALV, false);
    // neon spill on the roof behind / below the sign
    const pc = Pt(0, 0.1, -2.6);
    K.sprites.pool(pc[0], pc[1], pc[2], [F.r[0] * (Wd / 2 + 2.5), 0, F.r[2] * (Wd / 2 + 2.5)], [F.n[0] * 4.5, 0, F.n[2] * 4.5], mul(neon, 0.012 * w.I));
    info.push({ id: s.id, text: w.t.join(' '), x: o[0], y: s.y + legH + totalH / 2, z: o[2], width: Wd, height: totalH, facing: s.facing, normal: F.n, roofY: s.y });
  }
  if (!P.length || !atlas) return info;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(U), 2));
  g.setAttribute('aNeon', new THREE.BufferAttribute(new Float32Array(NE), 3));
  g.setAttribute('aFace', new THREE.BufferAttribute(new Float32Array(FA), 3));
  g.setAttribute('aFx', new THREE.BufferAttribute(new Float32Array(FX), 4));
  g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, makeSignMaterial(ctx, atlas.tex));
  mesh.layers.set(1); mesh.castShadow = false; mesh.receiveShadow = true; mesh.name = 'roof_signs';
  group.add(mesh);
  return info;
}
