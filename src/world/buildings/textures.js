// Small generated textures for the facade shader: a tiling multi-channel noise and a sign-lettering atlas.
import * as THREE from 'three';

/** 256² RGBA tiling fbm noise (4 independent channels), mip-mapped. */
export function makeNoiseTexture(rng) {
  const N = 256;
  const data = new Uint8Array(N * N * 4);
  const chans = [
    { f0: 4, oct: 5, gain: 0.55 },
    { f0: 5, oct: 5, gain: 0.55 },
    { f0: 8, oct: 4, gain: 0.62 },
    { f0: 3, oct: 4, gain: 0.5 },
  ];
  const tmp = new Float32Array(N * N);
  chans.forEach((ch, c) => {
    tmp.fill(0);
    let amp = 1, norm = 0;
    for (let o = 0; o < ch.oct; o++) {
      const f = ch.f0 << o;
      const lat = new Float32Array(f * f);
      for (let i = 0; i < lat.length; i++) lat[i] = rng();
      for (let y = 0; y < N; y++) {
        const fy = (y / N) * f; const y0 = Math.floor(fy); let ty = fy - y0; ty = ty * ty * (3 - 2 * ty);
        const ya = (y0 % f) * f, yb = ((y0 + 1) % f) * f;
        for (let x = 0; x < N; x++) {
          const fx = (x / N) * f; const x0 = Math.floor(fx); let tx = fx - x0; tx = tx * tx * (3 - 2 * tx);
          const xa = x0 % f, xb = (x0 + 1) % f;
          const v = (lat[ya + xa] * (1 - tx) + lat[ya + xb] * tx) * (1 - ty) + (lat[yb + xa] * (1 - tx) + lat[yb + xb] * tx) * ty;
          tmp[y * N + x] += v * amp;
        }
      }
      norm += amp; amp *= ch.gain;
    }
    // normalise to mean 0.5 and stretch the contrast so the channel uses the 0..1 range
    let mean = 0; for (let i = 0; i < tmp.length; i++) { tmp[i] /= norm; mean += tmp[i]; } mean /= tmp.length;
    let sd = 0; for (let i = 0; i < tmp.length; i++) sd += (tmp[i] - mean) ** 2; sd = Math.sqrt(sd / tmp.length);
    for (let i = 0; i < tmp.length; i++) data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((0.5 + (tmp[i] - mean) / (sd * 5.2)) * 255)));
  });
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}

export const SIGN_COLS = 4, SIGN_ROWS = 8;

/** Lettering atlas: 4 x 8 cells of fictional shop names, white on black (coverage in R). */
export function makeSignTexture() {
  const CW = 256, CH = 64;
  const cv = document.createElement('canvas'); cv.width = CW * SIGN_COLS; cv.height = CH * SIGN_ROWS;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  const words = [
    'AUREL', 'MARLO & SONS', 'TABAC', 'KAFE NORD', 'BOULANGERIE', 'BOOKS', 'PHARMACIE', 'HOTEL LANTERNE',
    'OPTIK', 'FLEURS', 'MERCERIE', 'TAILOR', 'RADIO · LAMPS', 'OYSTER BAR', 'CHANDLER', 'ROPE & SAIL',
    'TEA ROOM', 'PRINTS', 'CLOCKS', 'BAR AUREL', 'LAUNDRY', 'DELI', 'CINE ROXANE', 'BRASSERIE',
    'TOBACCO', 'MAPS & CHARTS', 'BAKERY', 'FISH', 'HABERDASHER', 'CAFE', 'VINS', 'GROCER',
  ];
  const fonts = [
    'bold 44px Georgia, "Times New Roman", serif',
    '900 40px "Arial Black", Arial, sans-serif',
    'italic bold 44px Georgia, serif',
    '44px Impact, "Arial Narrow", sans-serif',
    'bold 40px "Trebuchet MS", Verdana, sans-serif',
    'bold 42px "Courier New", monospace',
    '46px "Segoe Script", "Brush Script MT", cursive',
    '600 42px "Palatino Linotype", "Book Antiqua", serif',
  ];
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  words.forEach((w, i) => {
    const cx = (i % SIGN_COLS) * CW + CW / 2, cy = Math.floor(i / SIGN_COLS) * CH + CH / 2;
    g.font = fonts[(i * 5 + 3) % fonts.length];
    const mw = g.measureText(w).width;
    g.save(); g.translate(cx, cy + 2);
    const s = Math.min(1.15, (CW - 22) / mw); g.scale(s, Math.min(1.15, Math.max(s, 0.8)));
    g.fillText(w, 0, 0); g.restore();
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}

/** Blade-sign atlas: 8 cells (64 x 256) of short fictional words set as stacked capitals, white on black (coverage in R). */
export function makeBladeTexture() {
  const CW = 64, CH = 256, N = 8;
  const cv = document.createElement('canvas'); cv.width = CW * N; cv.height = CH;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  const words = ['HOTEL', 'BAR', 'CAFE', 'CINE', 'JAZZ', 'DELI', 'TABAC', 'VINS'];
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#fff';
  words.forEach((w, i) => {
    const n = w.length, cell = Math.min(56, (CH - 24) / n);
    g.font = `bold ${Math.round(cell * 0.92)}px "Arial Narrow", "Trebuchet MS", Arial, sans-serif`;
    const y0 = CH / 2 - cell * (n - 1) / 2;
    for (let k = 0; k < n; k++) {
      const mw = g.measureText(w[k]).width; const sx = Math.min(1, (CW - 16) / mw);
      g.save(); g.translate(i * CW + CW / 2, y0 + k * cell + 2); g.scale(sx, 1); g.fillText(w[k], 0, 0); g.restore();
    }
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}
