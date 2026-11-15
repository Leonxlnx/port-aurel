// Wave model of Port Aurel's water: a small set of trochoidal (Gerstner) components for real geometry plus
// "band" textures that carry thousands of fine waves for the normals.
//
// Band texture trick: one tile holds the complex slope field G(x) = sum_k i*k*a_k*exp(i k.x) of a ~1.3 octave band
// of plane waves (random phases, directional spread around +u). Because every plane wave keeps its own direction,
// rotating the complex phase, slope(x,t) = Re[G(x) * exp(-i w t)], makes each wave travel along its own k with the
// band's mean frequency. A slow scroll at the group velocity moves the wave groups. Nothing loops visibly, nothing
// just "slides", and the texture mip chain gives exact band-limited filtering (the variance lost per mip is
// measured here and fed into the roughness of the reflection lobe in the shader).

const G_ACC = 9.81;
const TAU = Math.PI * 2;
export const BAND_N = 256;            // texels per tile
export const BAND_K = [5, 12.5];      // lattice wavenumber range of the band (waves per tile)
export const BAND_K0 = Math.sqrt(BAND_K[0] * BAND_K[1]);

// direction the wind sea travels: from the west-south-west toward the east-north-east (X = east, Z = south)
export const WIND_ANGLE = -22.5 * Math.PI / 180;
export const WIND = [Math.cos(WIND_ANGLE), Math.sin(WIND_ANGLE)];

/** Geometric wave components (light evening breeze, Hs ~ 0.2 m in the open bay). */
export function gerstnerSet(rng) {
  //            wavelength m, amplitude m, direction offset (deg) from the wind, wave-group family (see groupField)
  // Neighbouring wavelengths cross at 40..70 degrees (short-crested, no parallel stripes); the long swell keeps
  // close to the fetch direction, the short chop spreads widely.
  const spec = [
    [31.0, 0.045, 12, 0.5], [20.3, 0.040, -27, -1], [12.4, 0.034, 31, 1], [7.9, 0.029, -41, -1],
    [5.2, 0.023, 17, 1], [3.3, 0.0165, 57, -1], [2.2, 0.0115, -52, 1], [1.43, 0.0078, -6, -1],
  ];
  return spec.map(([lambda, amp, off, grp]) => {
    const a = WIND_ANGLE + off * Math.PI / 180;
    const k = TAU / lambda;
    return { dx: Math.cos(a), dz: Math.sin(a), k, amp, omega: Math.sqrt(G_ACC * k), phase: rng() * TAU, lambda, grp };
  });
}

/**
 * Normal-detail layers. Each entry samples one band texture at tile size L (metres).
 * varBay / varCanal: total slope variance contributed in the open bay / in the sheltered canal (in a gust).
 * gustBay / gustCanal: fraction of that variance left between gusts (cat's paws modulate the fine ripples).
 * wall: strength of the copy reflected off the nearest wall (interference pattern).
 */
export function layerSet() {
  const deg = Math.PI / 180;
  const L = [
    // L,     tex, angle off, varBay,  varCanal, gustBay, gustCanal, wall
    // (fine layers: strong contrast between cat's paws and the lulls between them; the lulls are as calm as the
    //  whole surface used to be between gusts, the cat's paws are clearly rougher)
    [40.0,    0,   -14,       0.00080, 0.000006, 1.00,    1.0,       0.0],
    [52.7,    1,    27,       0.00060, 0.000004, 1.00,    1.0,       0.0],
    [16.0,    0,    34,       0.00130, 0.000030, 0.90,    0.8,       0.6],
    [20.9,    1,   -42,       0.00100, 0.000020, 0.90,    0.8,       0.0],
    [6.4,     1,    30,       0.00420, 0.000380, 0.57,    0.50,      0.7],
    [2.56,    0,    47,       0.00580, 0.000700, 0.39,    0.30,      0.7],
    [1.02,    1,    -2,       0.00580, 0.000600, 0.28,    0.15,      0.5],
    [0.41,    0,    20,       0.00500, 0.000300, 0.23,    0.08,      0.0],
    [0.164,   1,   -38,       0.00300, 0.000100, 0.21,    0.05,      0.0],
  ];
  return L.map(([tile, tex, off, varBay, varCanal, gustBay, gustCanal, wall], i) => {
    const a = WIND_ANGLE + off * deg;
    const k0 = TAU * BAND_K0 / tile;
    const omega = Math.sqrt(G_ACC * k0 + 7.4e-5 * k0 * k0 * k0);       // gravity-capillary dispersion
    const vg = 0.5 * omega / k0;                                        // group velocity (deep water)
    return { tile, tex, cos: Math.cos(a), sin: Math.sin(a), omegaHalf: omega - k0 * vg, vg, varBay, varCanal, gustBay, gustCanal, wall, offset: (i * 0.3819) % 1 };
  });
}

// ---- tiny radix-2 FFT ---------------------------------------------------------------------------
function fft(re, im, n, inverse, off = 0, stride = 1) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a]; re[a] = re[b]; re[b] = t; t = im[a]; im[a] = im[b]; im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = TAU / len * (inverse ? 1 : -1);
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = off + (i + j) * stride, b = off + (i + j + len / 2) * stride;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}
function ifft2(re, im, n) {
  for (let y = 0; y < n; y++) fft(re, im, n, true, y * n, 1);
  for (let x = 0; x < n; x++) fft(re, im, n, true, x, n);
}

/**
 * Bake one band tile. Returns { levels: [Float32Array RGBA ...] (mip chain), retained: Float32Array (variance kept per mip) }.
 * RGBA = (Re Gu, Im Gu, Re Gv, Im Gv), normalised so that the time-averaged total slope variance of mip 0 is 1.
 */
export function bakeBand(rng, { spread = 0.5, n = BAND_N } = {}) {
  const gur = new Float64Array(n * n), gui = new Float64Array(n * n), gvr = new Float64Array(n * n), gvi = new Float64Array(n * n);
  const gauss = () => { const u = Math.max(rng(), 1e-9), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); };
  const [k0, k1] = BAND_K;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lim = Math.ceil(k1 + 2);
  for (let m = -lim; m <= lim; m++) for (let q = -lim; q <= lim; q++) {
    const kk = Math.hypot(m, q);
    if (kk < k0 - 1 || kk > k1 + 1.5) continue;
    const th = Math.atan2(q, m);
    const wr = sm(k0 - 0.8, k0 + 0.8, kk) * (1 - sm(k1 - 1.2, k1 + 1.2, kk));
    const wd = Math.exp(-0.5 * (th / spread) * (th / spread));
    // slope variance flat per octave: per-mode slope std ~ 1/k -> height std ~ 1/k^2
    const std = Math.sqrt(wr * wd) / (kk * kk);
    if (std < 1e-7) continue;
    const ar = gauss() * std, ai = gauss() * std;        // complex height coefficient
    const idx = ((q + n) % n) * n + ((m + n) % n);
    // G = i * k * a
    gur[idx] = -m * ai; gui[idx] = m * ar;
    gvr[idx] = -q * ai; gvi[idx] = q * ar;
  }
  ifft2(gur, gui, n); ifft2(gvr, gvi, n);
  let v = 0;
  for (let i = 0; i < n * n; i++) v += gur[i] * gur[i] + gui[i] * gui[i] + gvr[i] * gvr[i] + gvi[i] * gvi[i];
  const norm = 1 / Math.sqrt(0.5 * v / (n * n));
  let cur = new Float32Array(n * n * 4);
  for (let i = 0; i < n * n; i++) { cur[i * 4] = gur[i] * norm; cur[i * 4 + 1] = gui[i] * norm; cur[i * 4 + 2] = gvr[i] * norm; cur[i * 4 + 3] = gvi[i] * norm; }
  const levels = [cur]; const retained = [1];
  for (let s = n >> 1; s >= 1; s >>= 1) {
    const nxt = new Float32Array(s * s * 4); const p = s * 2; let acc = 0;
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) for (let c = 0; c < 4; c++) {
      const a = cur[((2 * y) * p + 2 * x) * 4 + c] + cur[((2 * y) * p + 2 * x + 1) * 4 + c] + cur[((2 * y + 1) * p + 2 * x) * 4 + c] + cur[((2 * y + 1) * p + 2 * x + 1) * 4 + c];
      const val = a * 0.25; nxt[(y * s + x) * 4 + c] = val; acc += val * val;
    }
    levels.push(nxt); retained.push(0.5 * acc / (s * s)); cur = nxt;
  }
  return { levels, retained: Float32Array.from(retained) };
}
