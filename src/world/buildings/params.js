// Per-building facade design derived deterministically from the layout entry (style, seed, district, height).
// Everything the shader and the geometry builder need to agree on (bay grid, window sizes, colours) lives here.
import * as THREE from 'three';
import { mulberry32 } from '../layout.js';

export const STYLE = { brick: 0, stone: 1, concrete: 2, stucco: 3, glass: 4, deco: 5 };
export const FLAG = { archTop: 1, painted: 2, lantern: 4, french: 8, warehouse: 16, darkMortar: 32, stoneLintel: 64, surround: 128, shopSpan2: 256, shutters: 512, belt: 1024, quoins: 2048, piers: 4096, fireEsc: 8192, ac: 16384, stair: 32768 };

const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const PAL = {
  brick: ['#8a4636', '#964c3a', '#7b3d31', '#6e4a3b', '#5f4035', '#7a5646', '#a2573c', '#8f5a44', '#5c3c37', '#9a6248', '#844238', '#70483a'].map(lin),
  brickOchre: ['#b08d5c', '#a5834f', '#9c7b52', '#b39a6c'].map(lin),
  brickPaint: ['#d6d0c2', '#cdc1a3', '#9c9b96', '#a8b2b6', '#a2584c', '#c9b79a', '#b9a58c', '#8d9a8c'].map(lin),
  stone: ['#c9bfa8', '#d2c8b2', '#b8a07c', '#c0a680', '#a09d96', '#d6d0c2', '#948d80', '#b89482', '#bdb49e', '#aaa291'].map(lin),
  concrete: ['#a09c94', '#908e89', '#aeaa9f', '#999a9c', '#a89e8d', '#b5b0a6', '#86857f'].map(lin),
  stucco: ['#d9b98c', '#e0c9a0', '#d7a585', '#c98a6c', '#d4c7b0', '#b9c4b6', '#a9b8c4', '#e3d2a6', '#c7a19f', '#d0cfc7', '#cfa870', '#d8b39a', '#bfae8f', '#e2d6bd'].map(lin),
  trim: ['#b9a88a', '#cfc5ad', '#8f877a', '#d8d2c2', '#c4b79c', '#a89f8e'].map(lin),
  stuccoTrim: ['#e6e0d2', '#d9ceb4', '#c8c4ba', '#efe9dc'].map(lin),
  frame: ['#e6e2d6', '#e6e2d6', '#d6cab0', '#2c4034', '#1d1d1f', '#5a2824', '#62727e', '#4a3528', '#e9e6dd'].map(lin),
  frameDark: ['#26221f', '#1c1c1e', '#2d3338', '#3a2e22'].map(lin),
  door: ['#3d4f44', '#5a2a22', '#3b4a5a', '#4a3a2a', '#6b6b66', '#7a2f2a', '#2f3f3a', '#28303a', '#6a5a3a'].map(lin),
  decoStone: ['#d6cdb8', '#c8b48e', '#c9c7bf', '#bca784', '#d9d2c0', '#b8ab94'].map(lin),
  decoSpandrel: ['#4d3b28', '#4f7466', '#8c543a', '#26302c', '#5c2f28', '#3a4650', '#6a5530'].map(lin),
  glassTint: [
    { tint: [0.62, 0.78, 0.95], f0: 0.20 }, { tint: [0.66, 0.90, 0.84], f0: 0.15 }, { tint: [0.95, 0.78, 0.56], f0: 0.22 },
    { tint: [0.92, 0.95, 0.97], f0: 0.28 }, { tint: [0.58, 0.64, 0.72], f0: 0.10 }, { tint: [0.70, 0.84, 0.98], f0: 0.25 },
  ],
  glassPanel: ['#30343a', '#9aa0a6', '#4a3c2c', '#22262a', '#6c7278', '#d0d2d0'].map(lin),
};

export function deriveParams(b) {
  const R = mulberry32((b.seed ^ 0x51ed270b) >>> 0);
  const rr = (a, c) => a + (c - a) * R();
  const pick = a => a[Math.floor(R() * a.length) % a.length];
  const chance = p => R() < p;
  const st = b.style, H = b.h, d = b.district, fH = b.floorH, gH = b.groundH;
  const quay = d === 'quay', old = d === 'old', central = d === 'core' || d === 'mid';
  const P = {
    style: STYLE[st], seed01: (b.seed % 9973) / 9973, floorH: fH, groundH: gH, H,
    winType: 0, winW: 1.2, winH: 1.8, sill: 0.9, depth: 0.2, arch: 0, glassOld: 1, groundType: 2,
    colA: [0.3, 0.2, 0.15], colB: [0.5, 0.48, 0.42], colC: [0.1, 0.1, 0.1], frameCol: [0.8, 0.78, 0.72],
    usage: 0, flags: 0, f0: 0.065, fdiv: [1, 2], litBias: 1, frameW: 0.028,
    bayW: 3.2, margin: 0.8, shopSpan: 1,
    corniceP: 0.3, corniceH: 0.5, corniceSteps: 1, stringP: 0.15, parapetH: 0.6, finW: 0, finD: 0, finTop: 0,
    roofType: 0, gableShape: 0, awnProb: 0.3, balcony: 0,
  };
  let warehouse = false;

  if (b.landmark === 'lantern') {
    Object.assign(P, {
      colA: lin('#dbd0b6'), colB: lin('#e4dac2'), colC: lin('#4a3a26'), frameCol: lin('#2a2420'),
      bayW: 3.07, margin: 2.35, winType: 3, winW: 1.55, sill: 1.0, winH: 2.3, depth: 0.42, fdiv: [2, 3], frameW: 0.03,
      groundType: 1, usage: 1, glassOld: 0.5, f0: 0.075, arch: 0.75, flags: FLAG.lantern | FLAG.archTop, litBias: 1.2,
      corniceP: 0.35, corniceH: 0.7, corniceSteps: 2, stringP: 0.3, parapetH: 1.0, finW: 0.62, finD: 0.5, finTop: 2.4, awnProb: 0,
    });
    return P;
  }

  if (st === 'brick') {
    warehouse = (quay && chance(0.6)) || (old && chance(0.3)) || (!quay && !old && H < 45 && chance(0.12));
    P.colB = pick(PAL.trim);
    P.colC = pick(PAL.door);
    if (warehouse) {
      P.colA = chance(0.2) ? pick(PAL.brickOchre) : pick(PAL.brick);
      P.bayW = rr(3.3, 4.3); P.margin = rr(0.7, 1.2);
      P.winW = rr(1.25, 1.7); P.winH = Math.min(rr(1.7, 2.1), fH - 1.25); P.sill = rr(0.75, 0.95);
      P.depth = rr(0.22, 0.3); P.arch = rr(0.16, 0.3);
      P.fdiv = chance(0.6) ? [3, 4] : [2, 3]; P.frameW = 0.02;
      P.frameCol = pick([PAL.frame[3], PAL.frame[4], PAL.frame[0], PAL.frame[5], PAL.frame[6], PAL.frame[0]]);
      P.flags |= FLAG.warehouse;
      P.groundType = b.shop && chance(0.5) ? 0 : 3;
      P.usage = chance(0.2) ? 1 : 0;
      P.corniceP = chance(0.5) ? rr(0.15, 0.3) : 0; P.corniceH = 0.35; P.stringP = chance(0.5) ? 0.12 : 0;
    } else {
      const painted = chance(old || quay ? 0.24 : 0.1);
      P.colA = painted ? pick(PAL.brickPaint) : (chance(0.15) ? pick(PAL.brickOchre) : pick(PAL.brick));
      if (painted) P.flags |= FLAG.painted;
      P.bayW = rr(2.6, 3.6); P.margin = rr(0.5, 1.1);
      P.winType = chance(0.28) ? 1 : 0;
      P.winW = P.winType ? rr(0.9, 1.08) : rr(1.15, 1.5); P.winH = Math.min(rr(1.8, 2.15), fH - 1.2); P.sill = rr(0.75, 0.9);
      P.depth = rr(0.14, 0.22);
      if (chance(0.25)) P.arch = rr(0.1, 0.16); else if (chance(0.2)) { P.arch = P.winW * 0.46; P.flags |= FLAG.archTop; }
      P.fdiv = chance(0.7) ? [1, 2] : [2, 2]; P.frameW = 0.034;
      P.frameCol = pick(PAL.frame);
      if (chance(0.6)) P.flags |= FLAG.stoneLintel;
      if (chance(0.3)) P.flags |= FLAG.quoins;
      if (painted && chance(0.4)) P.flags |= FLAG.shutters;
      P.groundType = b.shop ? 0 : (H > 55 ? 1 : 2);
      P.usage = central && H > 40 && chance(0.5) ? 1 : 0;
      P.corniceP = rr(0.2, 0.45); P.corniceH = rr(0.4, 0.6); P.corniceSteps = chance(0.5) ? 2 : 1; P.stringP = rr(0.1, 0.18);
    }
    if (chance(0.18)) P.flags |= FLAG.darkMortar;
  } else if (st === 'stone') {
    P.colA = pick(PAL.stone); P.colB = mul(P.colA, rr(1.02, 1.12)); P.colC = pick(PAL.door);
    P.bayW = rr(3.0, 4.1); P.margin = rr(0.8, 1.6);
    P.winType = pick([0, 0, 0, 1, 2]);
    P.winW = P.winType === 1 ? rr(0.9, 1.08) : rr(1.15, 1.5);
    P.winH = Math.min(rr(1.9, 2.35), fH - 1.15); P.sill = rr(0.72, 0.88); P.depth = rr(0.22, 0.32);
    if (P.winType === 2) { P.winW = P.bayW * rr(0.56, 0.66); P.fdiv = [3, 2]; }
    else { P.fdiv = chance(0.55) ? [1, 2] : [2, 2]; if (chance(0.3)) { P.arch = P.winW * 0.48; P.flags |= FLAG.archTop; } }
    P.frameCol = pick([PAL.frameDark[0], PAL.frameDark[1], PAL.frame[0], PAL.frame[3], PAL.frame[7], PAL.frame[2]]);
    P.groundType = b.shop ? 0 : (H > 50 ? 1 : 2);
    P.usage = (central && H > 45 && chance(0.6)) ? 1 : 0;
    P.corniceP = rr(0.4, 0.7); P.corniceH = rr(0.55, 0.8); P.corniceSteps = 2; P.stringP = rr(0.14, 0.24); P.parapetH = rr(0.6, 1.0);
    if (chance(0.4)) P.flags |= FLAG.belt;
  } else if (st === 'concrete') {
    P.colA = pick(PAL.concrete); P.colB = mul(P.colA, 0.86); P.colC = pick(PAL.door);
    const ribbon = chance(0.6);
    if (ribbon) {
      P.bayW = rr(3.6, 4.5); P.margin = rr(0.4, 0.9); P.winType = 4; P.winW = P.bayW;
      P.winH = Math.min(rr(1.35, 1.75), fH - 1.4); P.sill = rr(0.9, 1.05); P.depth = rr(0.1, 0.18);
      P.fdiv = [Math.max(2, Math.round(P.bayW / 1.25)), 1]; P.frameW = 0.025;
    } else {
      P.bayW = rr(3.0, 4.0); P.margin = rr(0.6, 1.2); P.winType = 0; P.winW = P.bayW * rr(0.55, 0.7);
      P.winH = Math.min(rr(1.4, 1.8), fH - 1.35); P.sill = 0.9; P.depth = rr(0.25, 0.4);
      P.fdiv = chance(0.5) ? [2, 1] : [3, 1]; P.frameW = 0.03;
    }
    P.frameCol = pick([PAL.frameDark[0], PAL.frameDark[2], lin('#8d9196'), PAL.frame[0]]);
    P.usage = chance(0.65) ? 1 : 0; P.glassOld = 0.3; P.f0 = 0.075;
    P.groundType = b.shop ? 0 : (H > 50 ? 1 : 2);
    P.corniceP = 0.1; P.corniceH = 0.3; P.stringP = chance(0.4) ? 0.1 : 0; P.parapetH = rr(0.4, 0.8);
  } else if (st === 'stucco') {
    P.colA = pick(PAL.stucco); P.colB = chance(0.75) ? pick(PAL.stuccoTrim) : mix(P.colA, [0.85, 0.83, 0.78], 0.6); P.colC = pick(PAL.door);
    P.bayW = rr(2.5, 3.2); P.margin = rr(0.5, 1.0);
    if (chance(0.3)) { P.flags |= FLAG.french; P.winW = rr(1.0, 1.25); P.winH = Math.min(2.3, fH - 0.75); P.sill = 0.12; P.fdiv = [2, 3]; P.balcony = rr(0.25, 0.6); }
    else {
      P.winType = chance(0.2) ? 1 : 0; P.winW = P.winType ? rr(0.85, 1.0) : rr(1.1, 1.45);
      P.winH = Math.min(rr(1.7, 2.1), fH - 1.2); P.sill = rr(0.75, 0.9); P.fdiv = chance(0.5) ? [2, 2] : [2, 1];
      if (chance(0.15)) { P.arch = P.winW * 0.46; P.flags |= FLAG.archTop; } else if (chance(0.1)) P.arch = rr(0.1, 0.15);
    }
    P.depth = rr(0.14, 0.22);
    P.frameCol = pick([PAL.frame[0], PAL.frame[0], PAL.frame[3], PAL.frame[7], PAL.frame[6], PAL.frame[5], PAL.frame[8]]);
    if (chance(0.7)) P.flags |= FLAG.surround;
    if (chance(quay || old ? 0.5 : 0.25)) P.flags |= FLAG.shutters;
    if (chance(0.45)) P.flags |= FLAG.belt;
    if (chance(0.4)) P.flags |= FLAG.quoins;
    P.groundType = b.shop ? 0 : 2; P.usage = chance(0.1) ? 1 : 0;
    P.corniceP = rr(0.25, 0.5); P.corniceH = rr(0.35, 0.55); P.corniceSteps = chance(0.6) ? 2 : 1; P.stringP = rr(0.1, 0.18);
  } else if (st === 'glass') {
    const gt = pick(PAL.glassTint);
    P.colC = gt.tint; P.f0 = gt.f0 * rr(0.85, 1.1); P.colA = pick(PAL.glassPanel); P.frameCol = chance(0.6) ? PAL.glassPanel[0] : pick(PAL.glassPanel); P.colB = P.frameCol;
    const mods = chance(0.6) ? 2 : 3;
    P.bayW = mods * rr(1.4, 1.65); P.margin = rr(0.15, 0.45);
    P.winType = 5; P.winW = P.bayW; P.sill = rr(0.85, 1.3); P.winH = fH - P.sill; P.depth = 0.05;
    P.fdiv = [mods, 1]; P.frameW = rr(0.025, 0.04);
    P.usage = 1; P.glassOld = 0; P.groundType = b.shop && chance(0.4) ? 0 : 1;
    P.corniceP = 0; P.stringP = 0; P.parapetH = rr(0.4, 0.9); P.awnProb = 0.05;
  } else { // deco
    P.colA = pick(PAL.decoStone); P.colB = mul(P.colA, 1.06); P.colC = pick(PAL.decoSpandrel);
    P.bayW = rr(2.9, 3.6); P.margin = rr(1.2, 2.0);
    P.winType = 3; P.winW = P.bayW * rr(0.42, 0.5); P.sill = rr(0.9, 1.05);
    P.winH = Math.min(fH - P.sill - 0.42, rr(1.9, 2.2)); P.depth = rr(0.28, 0.4);
    P.fdiv = chance(0.5) ? [2, 2] : [1, 3]; P.frameCol = pick(PAL.frameDark); P.frameW = 0.028;
    P.usage = chance(0.65) ? 1 : 0; P.glassOld = 0.6; P.groundType = b.shop ? 0 : 1;
    P.corniceP = rr(0.2, 0.35); P.corniceH = rr(0.5, 0.8); P.corniceSteps = 2; P.stringP = rr(0.15, 0.25); P.parapetH = rr(0.7, 1.1);
    P.finW = rr(0.5, 0.7); P.finD = rr(0.28, 0.42); P.finTop = rr(0.4, 1.3);
  }

  // tall masonry towers: spandrel strips give the shaft a vertical grain
  if ((st === 'stone' || st === 'brick' || st === 'concrete') && H > 55 && P.winType <= 2 && chance(0.7)) P.flags |= FLAG.piers;
  // paired windows need room for two openings and a pier
  if (P.winType === 1) P.bayW = Math.max(P.bayW, 2 * P.winW + 1.25);
  if (P.winType === 0 || P.winType === 2) P.bayW = Math.max(P.bayW, P.winW + 0.9);
  P.winH = Math.max(1.1, P.winH);
  P.shopSpan = chance(0.55) ? 2 : 1; if (P.shopSpan === 2) P.flags |= FLAG.shopSpan2;
  if (quay || old) P.awnProb = 0.45;

  // roofs: real gable roofs only where the layout promises an empty ('plain') roof; false-front gables elsewhere
  const lowrise = H < 46 && b.tiers.length === 1 && (st === 'brick' || st === 'stone' || st === 'stucco');
  if (lowrise && b.roof === 'plain' && (quay || old || chance(0.35))) P.roofType = chance(0.85) ? 1 : 0;
  if (P.roofType === 0 && lowrise && (quay || old) && H < 40 && chance(quay ? 0.55 : 0.25)) { P.roofType = 3; P.gableShape = Math.floor(R() * 3); }
  P.parapetH = Math.max(0.4, P.parapetH);

  // facade hardware and habits (decided last so the random sequence above is untouched)
  const h0 = b.tiers[0].y1, east = d === 'east';
  if (st === 'brick' && h0 > 11 && h0 < 50 && chance(quay ? 0.8 : (old ? 0.34 : (east ? 0.08 : 0.1)))) P.flags |= FLAG.fireEsc;
  if (P.usage === 0 && P.winType === 0 && !warehouse && !(P.flags & FLAG.french) && st !== 'glass' && chance(quay || old ? 0.5 : 0.6)) P.flags |= FLAG.ac;
  if (P.usage === 0 && P.winType <= 1 && !warehouse && h0 > 14 && chance(0.6)) P.flags |= FLAG.stair;   // a lit stairwell bay at night
  return P;
}

/** Bay grid of a wall of width W (shared by geometry and shader). */
export function bayGrid(W, P) {
  const need = P.winType === 1 ? 2 * P.winW + 0.7 : (P.winType >= 3 ? 1.2 : P.winW + 0.35);   // openings must fit inside a bay
  let margin = Math.min(P.margin, W * 0.18);
  let nb = Math.max(1, Math.round((W - 2 * margin) / P.bayW));
  while (nb > 1 && (W - 2 * margin) / nb < need) nb--;
  if ((W - 2 * margin) / nb < need) margin = Math.max(0.05, (W - need * nb) / 2);
  const bw = (W - 2 * margin) / nb;
  return { nb, margin, bw, ok: bw >= need - 1e-3 };
}

/** Pack the parameters into 8 RGBA float texels. */
export function packParams(P, out, o) {
  out.set([P.seed01, P.style, P.floorH, P.groundH,
    P.winType, P.winW, P.winH, P.sill,
    P.depth, P.arch, P.glassOld, P.groundType,
    P.colA[0], P.colA[1], P.colA[2], P.usage,
    P.colB[0], P.colB[1], P.colB[2], P.H,
    P.colC[0], P.colC[1], P.colC[2], P.flags,
    P.frameCol[0], P.frameCol[1], P.frameCol[2], P.f0,
    P.fdiv[0], P.fdiv[1], P.litBias, P.frameW], o);
}
