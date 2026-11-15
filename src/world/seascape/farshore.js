// Far western shore: eroded coastal foothills with a settled shoreline strip (coves, skerries, villages, piers, a small
// harbour town), the far port with gantry cranes, a second lighthouse, and six mountain ranges stacked in the haze.
// The land is built as anisotropic height-field strips: very fine along the coast (the direction the silhouette is seen
// in from the city), coarse in depth. Normals, sky occlusion and a westward horizon angle (sun shadow) are baked per vertex.
import * as THREE from 'three';
import { C, fbm, vnoise, hash2, smooth, lerp, clamp, gableRoof } from './util.js';

/** ridged multifractal on value noise: sharp crests carrying the fine detail, smooth valley floors. ~0..0.9, mean ~0.3 */
function rmf(x, z, oct, seed, gain = 0.5) {
  let sum = 0, amp = 0.5, w = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(2 * vnoise(x, z, seed + i * 13) - 1); n *= n;
    sum += n * amp * w; norm += amp; w = Math.min(1, 0.3 + n * 1.5);
    const xr = 0.8 * x - 0.6 * z, zr = 0.6 * x + 0.8 * z; x = xr * 2.07 + 3.7; z = zr * 2.07 + 1.9; amp *= gain;
  }
  return sum / norm;
}

/** tiny direct triangle batcher for hundreds of small buildings (flat shaded, vertex colour + aE) */
class Batch {
  constructor() { this.p = []; this.c = []; this.e = []; }
  tri(a, b, c, col, e = 0) { this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); for (let k = 0; k < 3; k++) { this.c.push(col[0], col[1], col[2]); this.e.push(e); } }
  quad(a, b, c, d, col, e = 0) { this.tri(a, b, c, col, e); this.tri(a, c, d, col, e); }
  /** box around (x,z), y0..y1, half sizes hw (local x) / hd (local z), turned by ry; optional gable roof (ridge along local z) or spire */
  box(x, y0, y1, z, hw, hd, ry, col, { roof = 0, roofCol = null, over = 0.3, spire = 0, e = 0 } = {}) {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const P = (lx, y, lz) => [x + lx * cs + lz * sn, y, z - lx * sn + lz * cs];
    const a0 = P(-hw, y0, -hd), b0 = P(hw, y0, -hd), c0 = P(hw, y0, hd), d0 = P(-hw, y0, hd);
    const a1 = P(-hw, y1, -hd), b1 = P(hw, y1, -hd), c1 = P(hw, y1, hd), d1 = P(-hw, y1, hd);
    this.quad(d0, c0, c1, d1, col, e); this.quad(b0, a0, a1, b1, col, e); this.quad(c0, b0, b1, c1, col, e); this.quad(a0, d0, d1, a1, col, e);
    if (roof > 0) {
      const o = over, ye = y1 - o * roof / hw, yr = y1 + roof, rc = roofCol || col;
      const A = P(-hw - o, ye, -hd - o), B = P(-hw - o, ye, hd + o), R0 = P(0, yr, -hd - o), R1 = P(0, yr, hd + o), Cc = P(hw + o, ye, -hd - o), D = P(hw + o, ye, hd + o);
      this.tri(A, B, R1, rc); this.tri(A, R1, R0, rc); this.tri(Cc, R0, R1, rc); this.tri(Cc, R1, D, rc);
      this.tri(d1, c1, P(0, yr, hd), col); this.tri(b1, a1, P(0, yr, -hd), col);
    } else if (spire > 0) {
      const t = P(0, y1 + spire, 0), rc = roofCol || col, s = 1.12;
      const a = P(-hw * s, y1, -hd * s), b = P(hw * s, y1, -hd * s), c = P(hw * s, y1, hd * s), d = P(-hw * s, y1, hd * s);
      this.tri(d, c, t, rc); this.tri(b, a, t, rc); this.tri(c, b, t, rc); this.tri(a, d, t, rc);
    } else this.quad(a1, d1, c1, b1, col, e);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.p), 3)); g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.c), 3));
    g.setAttribute('aE', new THREE.BufferAttribute(new Float32Array(this.e), 1)); g.computeVertexNormals(); return g;
  }
}

/** distant land: vertex colour = land-use masks (r forest, g cultivated, b rock), aH = (tan of the horizon to the west, sky occlusion) */
function farLandMaterial(ctx) {
  return ctx.makeMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, metalness: 0 }, {
    defines: { NO_CITY_LIGHTS: 1, NO_CITY_AO: 1 },
    vertexPars: 'attribute vec2 aH; varying vec2 vH;', vertex: 'vH = aH;', fragPars: 'varying vec2 vH;',
    color: /* glsl */`
      vec3 p_ = vWPos; vec3 mk_ = diffuseColor.rgb; float slope_ = 1.0 - vWNormal.y; float wetl_ = 0.0;
      vec3 forC_ = vec3(0.026, 0.038, 0.021), grassC_ = vec3(0.105, 0.098, 0.05), rockC_ = vec3(0.2, 0.185, 0.165); vec3 c_;
      if (uAux > 0.5) {
        c_ = mix(mix(grassC_, vec3(0.14, 0.125, 0.065), mk_.g), forC_, smoothstep(0.35, 0.65, mk_.r));
        c_ = mix(c_, rockC_ * 0.9, max(mk_.b, smoothstep(0.3, 0.5, slope_)));
      } else {
        float pxl_ = max(length(dFdx(p_)), 0.25 * length(dFdy(p_)));                 // metres per pixel (lateral; depth footprint discounted)
        float f2_ = 1.0 - smoothstep(6.0, 24.0, pxl_), f3_ = 1.0 - smoothstep(1.2, 4.5, pxl_);
        float n0_ = fbm2(p_.xz * 0.0009 + 11.0);
        float n1_ = mix(n0_, fbm2(p_.xz * 0.0041 + 3.0), 1.0 - smoothstep(50.0, 200.0, pxl_));
        float n2_ = mix(0.47, fbm2(p_.xz * 0.033 + 7.0), f2_);
        float n3_ = mix(0.5, vnoise(p_.xz * 0.19 + n2_ * 3.0), f3_);
        float fe_ = smoothstep(0.43, 0.57, mk_.r + (n2_ - 0.47) * 0.55 + (n1_ - 0.47) * 0.4);            // ragged forest edge, clearings
        vec3 for_ = mix(forC_, vec3(0.045, 0.056, 0.024), smoothstep(0.34, 0.6, n1_)) * (0.72 + 0.56 * n3_) * (0.82 + 0.36 * n2_);
        // cultivated land: patchwork of fields with hedges
        vec2 fq_ = mat2(0.82, -0.57, 0.57, 0.82) * (p_.xz + (n1_ - 0.47) * 110.0) / vec2(95.0, 150.0);
        vec2 fi_ = floor(fq_), ff_ = fract(fq_); float fh_ = hash12(fi_ + 3.0);
        vec3 fld_ = fh_ < 0.3 ? vec3(0.2, 0.165, 0.075) : (fh_ < 0.58 ? vec3(0.075, 0.1, 0.04) : (fh_ < 0.82 ? vec3(0.095, 0.072, 0.05) : vec3(0.24, 0.215, 0.13)));
        float ffade_ = 1.0 - smoothstep(10.0, 40.0, pxl_);
        float hed_ = min(min(ff_.x, 1.0 - ff_.x) * 95.0, min(ff_.y, 1.0 - ff_.y) * 150.0);
        fld_ = mix(vec3(0.13, 0.12, 0.065), fld_, ffade_);
        fld_ = mix(fld_, forC_ * 1.2, (1.0 - smoothstep(2.0, 5.0 + 1.5 * pxl_, hed_)) * ffade_ * 0.85);
        vec3 gr_ = grassC_ * (0.75 + 0.5 * n2_) * mix(vec3(0.85, 0.95, 0.9), vec3(1.3, 1.12, 0.8), n1_);
        c_ = mix(gr_, fld_ * (0.85 + 0.3 * n2_), smoothstep(0.4, 0.6, mk_.g + (n2_ - 0.47) * 0.3));
        c_ = mix(c_, for_, fe_);
        // rock: crags, steep faces, strata
        float strata_ = 0.76 + 0.24 * step(0.5, fract(p_.y * 0.045 + n1_ * 3.0 + n2_ * 0.6));
        vec3 rock_ = rockC_ * (0.62 + 0.8 * n2_) * strata_ * mix(vec3(0.92, 0.95, 1.0), vec3(1.14, 1.0, 0.84), n1_);
        float rkm_ = max(smoothstep(0.38, 0.62, mk_.b + (n2_ - 0.47) * 0.5 + (n1_ - 0.47) * 0.25), smoothstep(0.22, 0.42, slope_ + (n2_ - 0.47) * 0.15));
        c_ = mix(c_, rock_, rkm_);
        // shoreline: pale beach in some stretches, rock in others, dark wet line at the water
        float sy_ = p_.y + (n2_ - 0.47) * 1.6;
        c_ = mix(c_, mix(vec3(0.27, 0.24, 0.19), rock_ * 0.9, smoothstep(0.4, 0.55, n1_)), smoothstep(3.3, 1.7, sy_));
        wetl_ = smoothstep(0.95, 0.35, sy_);
        c_ = mix(c_, c_ * 0.3, wetl_);
      }
      diffuseColor.rgb = c_;`,
    surface: 'roughnessFactor = mix(0.95, 0.4, wetl_);',
    ao: /* glsl */`{
      float hl_ = max(length(uSunDir.xz), 1e-3);
      float west_ = smoothstep(0.7, 0.95, -uSunDir.x / hl_) * smoothstep(-2.0, -0.5, uSunElev);
      float lit_ = mix(1.0, smoothstep(vH.x - 0.012, vH.x + 0.022, uSunDir.y / hl_), west_);         // terrain shadow of the low western sun
      reflectedLight.directDiffuse *= lit_; reflectedLight.directSpecular *= lit_;
      reflectedLight.indirectDiffuse *= vH.y; }`,
    final: /* glsl */`{
      vec3 vd_ = vWPos - uCamPos; float dist_ = length(vd_); vd_ /= dist_;
      float xo_ = 5.0e-5 * max(dist_ - 3000.0, 0.0) * (uFogA.x / 0.00012);                            // valley haze pooled between the ranges, following the shot's haze setting
      vec3 fd_ = normalize(vec3(vd_.x, 0.035 + 0.5 * max(vd_.y, 0.0), vd_.z));
      outgoingLight = mix(skyLUT(uSkyLUT, fd_) * uFogTint * uFogB.y, outgoingLight, exp(-xo_)); }`,
  });
}

export function buildFarShore(ctx, S) {
  const group = new THREE.Group(); group.name = 'farshore';
  const AXIS = ctx.layout.harbor.lighthouse.z;                 // sunset axis (z = 153): keep the horizon open here
  const SX = ctx.layout.harbor.farShore.x;                     // -3600
  const port = { x: SX + 20, z0: 760, z1: 2350, y: 3.2 };     // straight quay line of the far port (south-west)

  const coastX = z => SX + 40 - 300 * fbm(z * 0.0011, 1.3, 3, 21) - 170 * fbm(z * 0.0043, 2.9, 2, 23);
  const gapK = z => smooth(340, 800, Math.abs(z - AXIS));      // 0 = open sea on the sunset axis
  // the first version of this terrain: next to the open axis the land keeps that outline, and it pins the second lighthouse
  const h0 = (x, z) => {
    const d = coastX(z) - x; let h;
    if (d < 0) h = Math.max(-6, d * 0.1);
    else {
      const m = fbm(x * 0.0015, z * 0.0015, 4, 33);
      h = Math.min(1, d * 0.03) * (5 + 115 * smooth(0, 1100, d) * Math.pow(m, 1.4) * 1.5 + 30 * fbm(x * 0.006, z * 0.006, 3, 35) * smooth(0, 300, d));
      h += 22 * Math.max(0, fbm(z * 0.004, 5.5, 2, 37) - 0.45) * smooth(0, 60, d) * (1 - smooth(60, 400, d)) * 4;
    }
    const gap = gapK(z); return h * gap - (1 - gap) * 9;
  };
  /** the surface the first version actually rendered: h0 sampled on its 50 m grid (x >= -5350), bilinear in between */
  const h0mesh = (x, z) => {
    const u = (x + 5350) / 50, v = (z + 5400) / 50, i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j; if (i < 0 || i > 62 || j < 0 || j > 215) return -9;
    const N = (a, b) => { const k = b * 64 + a; let h = h0cache[k]; if (h !== h) h = h0cache[k] = h0(-5350 + a * 50, -5400 + b * 50); return h; };
    return lerp(lerp(N(i, j), N(i + 1, j), fu), lerp(N(i, j + 1), N(i + 1, j + 1), fu), fv);
  };
  const h0cache = new Float32Array(64 * 217).fill(NaN);
  const L2 = (() => {
    let z = AXIS - 1150, x = coastX(z) - 45, y = h0(x, z);
    for (let zz = AXIS - 900; zz > AXIS - 1700; zz -= 50) { const xx = coastX(zz) - 45, h = h0(xx, zz); if (h > y) { y = h; x = xx; z = zz; } }
    return { x, y, z };
  })();

  // ---- natural terrain of the foothills ---------------------------------------------------------------------------------------
  const T = { h: 0, d: 0, val: 1, crag: 0, cl: 0 };            // scratch: last evaluation of land()
  function land(x, z, cx) {
    const d0 = cx - x;
    const cove = (fbm(x * 0.0075, z * 0.0075, 3, 25) - 0.5) * 170 * smooth(-160, -20, d0) * (1 - smooth(70, 280, d0));   // coves, spits, skerries
    const d = d0 + cove; T.d = d; T.val = 1; T.crag = 0; T.cl = 0;
    if (d < 0) return (T.h = Math.max(-6, d * 0.1));
    const wx = x + 300 * (fbm(x * 0.0009 + 5, z * 0.0009, 2, 51) - 0.5), wz = z + 300 * (fbm(x * 0.0009, z * 0.0009 + 9, 2, 52) - 0.5);
    const m = rmf(wx * 0.0012, wz * 0.0012, 6, 33, 0.52);                                    // massifs with spurs and gullies
    const adz = Math.abs(z - AXIS);
    const big = Math.max(smooth(0.3, 0.7, fbm(x * 0.00042, z * 0.00042 + 2, 2, 31)),   // high country vs low country along the coast
      0.8 * smooth(600, 1000, adz) * (1 - smooth(1900, 2700, adz)));                   // the headlands framing the open axis stay prominent
    const val = smooth(0.0, 0.11, Math.abs(fbm(z * 0.00075 + x * 0.00022, x * 0.0003, 2, 39) - 0.5));   // 0 on valley floors running inland
    const env = smooth(30, 1100, d);
    const crag = smooth(0.52, 0.75, fbm(x * 0.0017 + 4, z * 0.0017, 2, 43));
    let h = (26 + 215 * big) * Math.pow(m, 1.25) * (0.22 + 0.78 * env) * (0.12 + 0.88 * val) * 1.45;
    h += 26 * (fbm(x * 0.006, z * 0.006, 3, 35) - 0.35) * smooth(0, 260, d) * (0.3 + 0.7 * val) + 9 * env;
    if (crag > 0) {                                                                    // cliff bands and sharp knobs on some massifs
      const s = 17, k = h / s, f = k - Math.floor(k);
      h = lerp(h, (Math.floor(k) + smooth(0.5, 0.95, f)) * s, crag * 0.75) + crag * 15 * rmf(x * 0.011, z * 0.011, 2, 47) * env;
    }
    const cl = Math.min(1, Math.max(0, fbm(z * 0.004, 5.5, 2, 37) - 0.45) * 4);        // sea cliffs on some headlands
    h += 22 * cl * smooth(0, 50, d) * (1 - smooth(60, 380, d));
    h = 2.2 * smooth(0, 14, d) + Math.max(0, h + 5) * smooth(6, lerp(72, 24, cl), d);  // beach, then the coastal terrace
    T.val = val; T.crag = crag; T.cl = cl;
    return (T.h = h);
  }
  function farH(x, z, cx = coastX(z)) {
    let h = land(x, z, cx);
    const gap = gapK(z), end = smooth(5400, 4900, Math.abs(z));
    h = h * gap - (1 - gap) * 9; h = h * end - (1 - end) * 6;
    const adz = Math.abs(z - AXIS);
    if (adz < 800) h = lerp(h0mesh(x, z), h, smooth(650, 800, adz));                               // beside the sunset axis the land keeps its first outline
    const pz = smooth(port.z0 - 90, port.z0, z) * (1 - smooth(port.z1, port.z1 + 90, z));
    if (pz > 0) h = lerp(h, x > port.x - 45 ? -6 : port.y - 0.5, pz * smooth(-4150, -3950, x));
    const dl = Math.hypot(x - L2.x, z - L2.z); if (dl < 120) h = lerp(h, L2.y, smooth(120, 40, dl));
    return h;
  }
  // foothill grid: 6 m columns along the coast, rows at fixed distances inland from the macro coast line
  const FH = (() => {
    const DZ = 6, nc = 1801, D = [-95, -60, -30, -8, 14, 40, 70, 105, 150, 205, 270, 345, 430, 525, 630, 745, 870, 1010, 1160, 1330, 1520, 1740], nr = D.length;
    const zs = new Float32Array(nc), cxs = new Float32Array(nc), xs = new Float32Array(nc * nr), hs = new Float32Array(nc * nr), VAL = new Float32Array(nc * nr), CRG = new Float32Array(nc * nr), SH = new Float32Array(nc);
    for (let c = 0; c < nc; c++) {
      const z = -5400 + c * DZ, cx = coastX(z); zs[c] = z; cxs[c] = cx; SH[c] = cx;
      for (let r = 0; r < nr; r++) { const i = c * nr + r, x = cx - D[r]; xs[i] = x; hs[i] = farH(x, z, cx); VAL[i] = T.val; CRG[i] = Math.max(T.crag, T.cl); }
      for (let r = 0; r < nr - 1; r++) {                                               // waterline of the mainland (skips skerries narrower than a row)
        const i = c * nr + r; if (hs[i] < 0.6 || hs[i + 1] < 0.6) continue;
        SH[c] = r === 0 ? xs[i] : lerp(xs[i - 1], xs[i], clamp((0.6 - hs[i - 1]) / (hs[i] - hs[i - 1]), 0, 1)); break;
      }
    }
    return { DZ, nc, nr, D, zs, cxs, xs, hs, VAL, CRG, SH };
  })();
  const colH = (c, x) => {                                                               // height of the rendered surface in column c at x
    const d = FH.cxs[c] - x, D = FH.D; if (d <= D[0]) return -6;
    let r = 1; while (r < FH.nr - 1 && D[r] < d) r++;
    return lerp(FH.hs[c * FH.nr + r - 1], FH.hs[c * FH.nr + r], clamp((d - D[r - 1]) / (D[r] - D[r - 1]), 0, 1));
  };
  /** height of the rendered foothill surface (props and lights stand on this, not on the analytic terrain) */
  const groundH = (x, z) => { const u = clamp((z + 5400) / FH.DZ, 0, FH.nc - 1.001), c = Math.floor(u); return lerp(colH(c, x), colH(c + 1, x), u - c); };
  /** x of the mainland waterline at z */
  const shoreX = z => FH.SH[clamp(Math.round((z + 5400) / FH.DZ), 0, FH.nc - 1)];

  // ---- settlements: sites on low ground at coves and valley mouths ---------------------------------------------------------------
  const RS = ctx.rng('seascape.shore');
  const sites = [];
  {
    const cand = [];
    for (let z = -5000; z <= 5000; z += 30) {
      if (Math.abs(z - AXIS) < 900 || (z > port.z0 - 280 && z < port.z1 + 280) || Math.abs(z - L2.z) < 220) continue;
      const cx = coastX(z); let flat = 0;
      for (const d of [30, 70, 120, 180]) { const h = groundH(cx - d, z); if (h > 2.2 && h < 24) flat++; }
      land(cx - 260, z, cx);
      cand.push({ z, score: flat + 2.5 * (1 - T.val) + 1.2 * RS() });
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand) { if (sites.length >= 13) break; if (sites.every(s => Math.abs(s.z - c.z) > 540)) sites.push({ z: c.z }); }
    // the best site within easy view of the city becomes the harbour town
    const ti = Math.max(0, sites.findIndex(s => Math.abs(s.z - AXIS) < 2600));
    sites.forEach((s, i) => {
      s.kind = i === ti ? 'town' : (i % 3 === (ti + 1) % 3 ? 'hamlet' : 'village');
      s.n = s.kind === 'town' ? 120 : s.kind === 'village' ? 34 + Math.floor(RS() * 30) : 8 + Math.floor(RS() * 9);
      s.sig = s.kind === 'town' ? 230 : s.kind === 'village' ? 125 : 60;
      s.x = shoreX(s.z);
    });
  }
  const siteK = (x, z) => { let k = 0; for (const s of sites) { const d = Math.hypot((x - s.x) * 1.5, z - s.z); k = Math.max(k, smooth(s.sig * 1.5, s.sig * 0.6, d)); } return k; };

  // ---- land mesh: strips of anisotropic height field ------------------------------------------------------------------------------
  const POS = [], NRM = [], MSK = [], AH = [], IDX = []; let vbase = 0;
  const BIN = 120, B0 = -26000, NB = Math.ceil(52000 / BIN); const crests = [];
  const out = [0, 0, 0, 0];
  /** b: { nc, nr, zs[nc] (increasing), xs[nc*nr] (decreasing with the row), hs[nc*nr], aoS, finish(i, c, r, slope, out) -> forest, field, rock, lift } */
  function emit(b) {
    const { nc, nr, zs, xs, hs } = b;
    const cr = { x: new Float32Array(NB), h: new Float32Array(NB).fill(-1e9) };
    const ys = new Float32Array(nc * nr);
    for (let c = 0; c < nc; c++) {
      const cm = Math.max(0, c - 2), cp = Math.min(nc - 1, c + 2), c5m = Math.max(0, c - 5), c5p = Math.min(nc - 1, c + 5), c20m = Math.max(0, c - 20), c20p = Math.min(nc - 1, c + 20);
      const z = zs[c], bin = clamp(Math.floor((z - B0) / BIN), 0, NB - 1);
      for (let r = 0; r < nr; r++) {
        const i = c * nr + r, x = xs[i], h = hs[i];
        const rm = Math.max(0, r - 1), rp = r === 0 ? 1 : r;
        const hx = (hs[c * nr + rp] - hs[c * nr + rm]) / (xs[c * nr + rp] - xs[c * nr + rm]);
        const hz = ((hs[cp * nr + r] - hs[cm * nr + r]) - hx * (xs[cp * nr + r] - xs[cm * nr + r])) / (zs[cp] - zs[cm]);
        const il = 1 / Math.hypot(hx, 1, hz);
        let ht = 0;                                                                // tan of the horizon elevation toward the west
        for (let r2 = r + 1; r2 < nr; r2++) { const t = (hs[c * nr + r2] - h) / (x - xs[c * nr + r2]); if (t > ht) ht = t; }
        for (const f of crests) if (f.h[bin] > h && f.x[bin] < x - 1) { const t = (f.h[bin] - h) / (x - f.x[bin]); if (t > ht) ht = t; }
        const ao = clamp(1 + (h - 0.5 * (hs[c5m * nr + r] + hs[c5p * nr + r])) / b.aoS, 0.6, 1.1) * clamp(1 + (h - 0.5 * (hs[c20m * nr + r] + hs[c20p * nr + r])) / (b.aoS * 4), 0.7, 1.08);
        b.finish(i, c, r, 1 - il, out);
        const y = h + out[3]; ys[i] = y;
        POS.push(x, y, z); NRM.push(-hx * il, il, -hz * il); MSK.push(out[0], out[1], out[2]); AH.push(ht, ao);
        if (h > cr.h[bin]) { cr.h[bin] = h; cr.x[bin] = x; }
      }
    }
    for (let c = 0; c < nc - 1; c++) for (let r = 0; r < nr - 1; r++) {
      const i = c * nr + r; if (Math.max(ys[i], ys[i + 1], ys[i + nr], ys[i + nr + 1]) < -4) continue;
      const a = vbase + i, bb = a + 1, cc = a + nr, d = cc + 1; IDX.push(a, bb, d, a, d, cc);
    }
    vbase += nc * nr; crests.push(cr);
  }

  // mountain ranges, farthest first (so nearer land knows its western horizon). They taper to the sea toward the open axis.
  const layers = [
    { xb: -20000, zi: 4000, zo: 23000, full: 8500, H: 1900, seed: 9, tree: 0.55, alp: 1 },
    { xb: -14800, zi: 2900, zo: 16500, full: 6000, H: 1250, seed: 7, tree: 0.68, alp: 0.8 },
    { xb: -12400, zi: 2400, zo: 14000, full: 5000, H: 990, seed: 15, tree: 0.8, alp: 0.6 },
    { xb: -10200, zi: 1900, zo: 11500, full: 4000, H: 760, seed: 5, tree: 0.95, alp: 0.45 },
    { xb: -8300, zi: 1450, zo: 9500, full: 3300, H: 540, seed: 13, tree: 1.2, alp: 0.25 },
    { xb: -6600, zi: 1000, zo: 7500, full: 2600, H: 380, seed: 3, tree: 1.3, alp: 0.1 },
  ];
  const US = [0, 0.2, 0.44, 0.68, 0.87, 1, 1.16];
  const xcOf = (Ly, dzv, sd) => Ly.xb + 0.36 * Math.max(0, dzv - 2800) + (fbm(dzv / 1500, 9.1, 2, sd + 2) - 0.5) * Ly.H * 1.6;   // the ranges wrap around the bay
  const mtnH = (Ly, sd, x, z, dzv, u) => {
    const taper = smooth(Ly.zi, Ly.full, dzv) * (1 - 0.5 * smooth(Ly.zo * 0.7, Ly.zo, dzv));
    const s = Ly.H * 3.1; let zq = z + s * 0.4 * (fbm(z / s * 0.9, sd * 1.7, 2, sd + 1) - 0.5);
    zq += s * 0.3 * (rmf((x + sd * 977) / s, zq / s, 2, sd * 3 + 100) - 0.3);                      // crests lean one way: asymmetric slopes
    const xn = (x + sd * 977) / s, zn = zq / s;
    const Bm = fbm(xn * 0.9 + 7, zn * 0.9, 2, sd * 5 + 200);                                       // rounded massifs
    const M = rmf(xn * 1.6, zn * 1.6, 3, sd * 3 + 100, 0.55);                                      // spurs, summits and saddles
    let R = 0.4 * Bm + 0.42 * M + 0.075 * (fbm(xn * 14, zn * 14, 3, sd + 77) - 0.5) * (0.5 + Bm);   // + fine irregularity
    R = Math.pow(Math.max(R, 0), 1 + 0.2 * Ly.alp) * (1 + 0.15 * Ly.alp);
    const cg = smooth(0.54, 0.72, fbm(xn * 1.7 + 3, zn * 1.7, 2, sd + 9)); if (cg > 0) R += cg * 0.12 * rmf(xn * 5, zn * 5, 2, sd + 61);   // a few sharper crags
    R *= 1 + 0.5 * (1 - taper) * (rmf(xn * 6.2 + 9, zn * 6.2, 2, sd + 33) - 0.3);                 // the long ramps toward the open axis break into spurs and headlands
    const E = u <= 1 ? lerp(1 - Math.pow(1 - u, 1.6), Math.pow(u, 1.3), Ly.alp) : 1 - (u - 1) * 2.4;
    return Ly.H * taper * E * (0.36 + 1.15 * R) - 3 * (1 - smooth(0, 0.08, taper));
  };
  for (const Ly of layers) for (const side of [-1, 1]) {
    const sd = Ly.seed + (side > 0 ? 40 : 0), dz = [];
    for (let v = Ly.zi; v < Ly.zo; v += Math.max(8, 0.0014 * Math.hypot(Ly.xb, v)) * (1 + 1.5 * smooth(0.75, 1.4, v / -Ly.xb))) dz.push(v);
    if (side < 0) dz.reverse();
    const nc = dz.length, nr = US.length, zs = new Float32Array(nc), xs = new Float32Array(nc * nr), hs = new Float32Array(nc * nr), W = Ly.H * 2.4;
    for (let c = 0; c < nc; c++) {
      const dzv = dz[c], z = AXIS + side * dzv, xc = xcOf(Ly, dzv, sd); zs[c] = z;
      for (let r = 0; r < nr; r++) { const x = xc + (1 - US[r]) * W; xs[c * nr + r] = x; hs[c * nr + r] = r === 0 ? -3 : mtnH(Ly, sd, x, z, dzv, US[r]); }
    }
    const lift = Math.min(9, 0.001 * -Ly.xb);
    emit({ nc, nr, zs, xs, hs, aoS: Ly.H * 0.03, finish(i, c, r, slope, o) {
      const x = xs[i], z = zs[c], rel = hs[i] / Ly.H, n = fbm(x / (Ly.H * 0.9), z / (Ly.H * 0.9), 3, sd + 7);
      const forest = smooth(Ly.tree + 0.13, Ly.tree - 0.13, rel + (n - 0.5) * 0.4) * (0.5 + 0.5 * smooth(0.3, 0.5, n + 0.25 * (1 - Ly.alp)));
      o[0] = forest; o[1] = 0; o[2] = Math.max(0.85 * smooth(Ly.tree - 0.05, Ly.tree + 0.3, rel + (n - 0.5) * 0.3), smooth(0.3, 0.5, slope));
      o[3] = r > 0 ? lift * (forest > 0.5 ? 1 : 0.5) * (0.2 + 0.8 * hash2(c, r, sd)) * (0.45 + 1.1 * vnoise(c * 0.23, r * 3.1, sd)) : 0;
    } });
  }
  // foothills + shoreline strip
  {
    const { nc, nr, zs, xs, hs, VAL, CRG } = FH;
    emit({ nc, nr, zs, xs, hs, aoS: 14, finish(i, c, r, slope, o) {
      const x = xs[i], z = zs[c], h = hs[i], fn = fbm(x * 0.003, z * 0.003, 3, 41);
      const inPort = z > port.z0 - 60 && z < port.z1 + 60 && x > -4050;
      let forest = smooth(0.34, 0.5, fn * 0.75 + 0.22 * VAL[i] + 0.9 * slope - 0.08) * (1 - 0.9 * siteK(x, z));
      if (h < 2.8 || inPort) forest = 0;
      o[0] = forest; o[1] = inPort ? 0 : smooth(0.24, 0.1, slope) * smooth(3, 7, h) * smooth(230, 120, h);
      o[2] = Math.max(CRG[i] * smooth(0.05, 0.2, slope), smooth(0.25, 0.45, slope));
      o[3] = 0;
      if (forest > 0.5) o[3] = forest * (1.5 + 6 * hash2(c, r, 7)) * (0.5 + vnoise(c * 0.21, r * 3.1, 5));   // tree crowns roughen every skyline
      else if (h > 3 && !inPort && hash2(c, r >> 2, 9) < 0.035) { o[3] = 4.5 + 4 * hash2(c, r, 8); o[0] = 1; }   // hedgerow / lone trees
      if (Math.abs(z - AXIS) < 700) o[3] = 0;
    } });
  }
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POS), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(NRM), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MSK), 3)); g.setAttribute('aH', new THREE.BufferAttribute(new Float32Array(AH), 2));
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(IDX), 1)); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, farLandMaterial(ctx)); m.name = 'farLand'; m.receiveShadow = false; m.frustumCulled = false; group.add(m);
    S.stats.farLandTris = IDX.length / 3;
  }

  // ---- port: quay, gantry cranes, tanks, sheds, container stacks -------------------------------------------------------------------
  const P = S.farProps; const R = ctx.rng('seascape.port');
  const conc = C(0x8a8780), blue = C(0x3a5873), rust = C(0x8a4630), white = C(0xd9d5c8), cream = C(0xc9bd9a), dark = C(0x2b2d30), yellow = C(0xc79a2e);
  const qx = port.x, py = port.y;
  P.box(60, py + 4, port.z1 - port.z0, qx - 28, (py - 4) / 2, (port.z0 + port.z1) / 2, conc);          // quay apron edge
  P.box(410, 3, port.z1 - port.z0 + 40, qx - 240, py - 1.53, (port.z0 + port.z1) / 2, C(0x6f6c66));      // yard slab
  const cranes = [];
  for (let i = 0; i < 6; i++) {
    const z = port.z0 + 90 + i * 122 + (R() - 0.5) * 30; const col = [blue, blue, rust, blue, yellow, rust][i]; const up = i === 1 || i === 4;
    const K = 1.5, xs = qx - 8, xl = qx - 8 - 30 * K, hz = 12 * K;          // sea-side / land-side legs
    const yP = py + 46 * K, yA = py + 76 * K;
    for (const zz of [z - hz, z + hz]) {
      P.beam([xs, py, zz], [xs, yP, zz], 3.6, col); P.beam([xl, py, zz], [xl, yP, zz], 3.6, col);
      P.beam([xs, py + 17 * K, zz], [xl, py + 17 * K, zz], 2.6, col); P.beam([xs, py + 17 * K, zz], [xl, yP, zz], 1.9, col);
      P.beam([xs, yP, zz], [xs - 5, yA, z], 2.6, col);                     // A-frame
      P.beam([xl + 12, yP, zz], [xs - 5, yA, z], 2.2, col);
    }
    for (const xx of [xs, xl]) { P.beam([xx, py + 16 * K, z - hz], [xx, py + 16 * K, z + hz], 2.8, col); P.beam([xx, yP, z - hz], [xx, yP, z + hz], 3.4, col); }
    P.beam([xl - 30 * K, yP + 3, z], [xs + 2, yP + 3, z], 4.6, col, 5.4);                        // fixed girder with back reach
    const tip = up ? [xs + 18, yP + 3 + 56 * K, z] : [xs + 60 * K, yP + 3, z];
    P.beam([xs + 2, yP + 3, z], tip, 4.0, col, 4.8);                                             // boom (raised on idle cranes)
    P.beam([xs - 5, yA, z], up ? [xs + 12, yP + 40 * K, z] : [xs + 38 * K, yP + 5, z], 1.3, col); P.beam([xs - 5, yA, z], [xl - 27 * K, yP + 5, z], 1.3, col);
    P.box(17, 9, 12, xl - 6, yP + 10, z, white); P.box(6, 4.5, 5, up ? xs - 10 : xs + 30, yP - 3, z, white);
    cranes.push({ x: xs, z, top: yA, tipX: tip[0], tipY: tip[1] });
    S.sprites.add(xs - 5, yA + 2, z, [1.0, 0.1, 0.05], 260, 0.7);
    S.sprites.add(xs + 4, yP - 3, z, [1.0, 0.68, 0.34], 420, 0.9); S.sprites.add(xl, py + 44, z + 8, [1.0, 0.7, 0.38], 240, 0.9);
    if (!up) S.sprites.add(xs + 40, yP, z, [1.0, 0.74, 0.42], 300, 0.9);
  }
  for (let i = 0; i < 18; i++) {                              // tank farm (southern half of the port)
    const r = 12 + R() * 11, h = 12 + R() * 8; const x = qx - 60 - (i % 3) * 62 - R() * 14, z = port.z0 + 900 + Math.floor(i / 3) * 110 + R() * 20;
    if (i % 4 === 0) S.sprites.add(x + r + 4, py + h + 6, z, [1.0, 0.85, 0.65], 300, 0.8);
    const c = [white, white, cream, rust, white][Math.floor(R() * 5)];
    P.cyl(r, r, h, x, py, z, c, { seg: 20 }); P.cyl(0.3, r, r * 0.12, x, py + h, z, c, { seg: 20 });
  }
  for (let i = 0; i < 4; i++) {                               // transit sheds
    const z = port.z0 + 420 + i * 100, x = qx - 120 - (i % 2) * 20; const w = 46, d = 84, h = 13;
    P.box(w, h, d, x, py + h / 2, z, [cream, rust, white, C(0x5f7a70)][i]); gableRoof(P, w, d, 6, x, py + h, z, 0, dark, cream, 1);
  }
  const cc = [C(0x9a3a2a), C(0x2f5a80), C(0x3b6b4a), C(0xb8862b), C(0x8a8a86), C(0x6a2a2a)];
  for (let i = 0; i < 46; i++) {                              // container stacks
    const x = qx - 62 - Math.floor(R() * 3) * 16, z = port.z0 + 30 + R() * 800;
    P.box(12.2 * (1 + Math.floor(R() * 2)), 2.6 * (1 + Math.floor(R() * 4)), 2.45 * (1 + Math.floor(R() * 4)), x, py + 1.3 * 3, z, cc[Math.floor(R() * cc.length)], { ry: Math.PI / 2 });
  }
  for (let i = 0; i < 9; i++) {                               // yard light masts
    const x = qx - 95 - (i % 2) * 120, z = port.z0 + 40 + i * 92;
    P.beam([x, py, z], [x, py + 32, z], 0.9, dark); P.box(5, 1.2, 1.2, x, py + 32.6, z, dark);
    S.sprites.add(x, py + 33, z, [1.0, 0.82, 0.6], 520, 0.9);
  }
  // a freighter alongside (static, built from the coaster hull enlarged)
  if (S.coasterGeometry) {
    const ship = new THREE.Mesh(S.coasterGeometry, S.vesselMat); ship.position.set(qx + 14, 0.8, port.z0 + 260); ship.rotation.y = Math.PI / 2; ship.scale.set(2.3, 1.9, 2.2); ship.name = 'portFreighter'; group.add(ship);
    S.sprites.add(qx + 14, 38, port.z0 + 260 + 52, [1, 0.9, 0.75], 160, 0.6);
  }

  // ---- second lighthouse on the headland north of the open axis --------------------------------------------------------------------
  const lx = L2.x, ly = L2.y, lz = L2.z;
  P.cyl(2.3, 3.4, 21, lx, ly - 1, lz, white, { seg: 14 }); P.cyl(3.0, 3.0, 0.4, lx, ly + 20, lz, dark, { seg: 14 });
  P.cyl(1.8, 1.8, 2.8, lx, ly + 20.4, lz, [1.0, 0.9, 0.7], { seg: 12, e: 12 }); P.cyl(0.1, 2.2, 1.8, lx, ly + 23.2, lz, dark, { seg: 12 });
  P.box(9, 4, 6, lx - 9, ly + 1.5, lz + 3, white); gableRoof(P, 9, 6, 2.2, lx - 9, ly + 3.5, lz + 3, Math.PI / 2, rust, white, 0.4);
  S.sprites.add(lx, ly + 21.8, lz, [1.0, 0.9, 0.7], 2600, 1.1, [9, 0.012, 0.3, 3]);

  // ---- shoreline strip: villages, a harbour town, piers, boats; lights for the night -------------------------------------------------
  const B = new Batch(); let nLights = 0, nHouses = 0, nBoats = 0;
  const WARM = [1.0, 0.62, 0.29], SODIUM = [1.0, 0.55, 0.2], PALE = [1.0, 0.82, 0.58], COOL = [0.82, 0.9, 1.0];
  const light = (x, y, z, col, I, size = 0.8, blink) => { if (S.sprites.add(x, y, z, col, I, size, blink) >= 0) nLights++; };
  const gauss = () => (RS() + RS() + RS() + RS() - 2) * 1.22;
  const walls = [[0.62, 0.59, 0.53], [0.62, 0.59, 0.53], [0.6, 0.56, 0.47], [0.56, 0.48, 0.34], [0.5, 0.36, 0.18], [0.52, 0.33, 0.26], [0.36, 0.35, 0.33], [0.42, 0.46, 0.48]];
  const roofs = [[0.3, 0.115, 0.065], [0.3, 0.115, 0.065], [0.2, 0.085, 0.055], [0.085, 0.09, 0.1], [0.3, 0.27, 0.22]];
  const pickS = a => a[Math.floor(RS() * a.length)];
  const coastAng = z => Math.atan2(coastX(z + 25) - coastX(z - 25), 50);            // ry of a ridge running along the coast
  const stone = [0.3, 0.29, 0.27], timber = [0.1, 0.085, 0.07], boatCols = [[0.7, 0.68, 0.63], [0.7, 0.68, 0.63], [0.16, 0.25, 0.36], [0.45, 0.12, 0.08], [0.1, 0.1, 0.11]];
  const boats = (x0, x1, z, side, n) => {
    for (let i = 0; i < n; i++) {
      const x = lerp(x0, x1, RS()), zz = z + side * (9 + RS() * 46); if (groundH(x, zz) > -1.5) continue;
      const len = 3.5 + RS() * 2.6, ry = RS() * 6.28, col = pickS(boatCols);
      B.box(x, -0.3, 1.0 + RS() * 0.5, zz, 1.25 + RS() * 0.5, len, ry, col);
      B.box(x, 1.0, 2.4, zz, 0.9, len * 0.3, ry, [0.6, 0.58, 0.54]);
      if (RS() < 0.6) B.box(x, 1.0, 9 + RS() * 6, zz, 0.11, 0.11, ry, [0.55, 0.53, 0.5]);
      nBoats++;
    }
  };
  const occ = new Set();
  for (const s of sites) {
    const town = s.kind === 'town', n = s.n, sig = s.sig; let made = 0;
    for (let k = 0; k < n * 5 && made < n; k++) {
      const gz = gauss(), z = s.z + gz * sig, d = 16 + Math.abs(gauss()) * sig * 0.42 + RS() * 30, x = shoreX(z) - d;
      const h = groundH(x, z); if (h < 2.5 || h > 60 || Math.abs(groundH(x - 9, z) - groundH(x + 9, z)) > 7) continue;
      const key = Math.round(x / 12) + ',' + Math.round(z / 12); if (occ.has(key)) continue; occ.add(key);
      const core = Math.exp(-gz * gz) * (town ? 1 : 0.4), big = RS() < 0.05;
      const hw = big ? 6 + RS() * 3 : 3 + RS() * 1.6, hd = big ? 11 + RS() * 8 : 4 + RS() * 2.8, wall = big ? 5 + RS() * 3 : 3.2 + RS() * 2.4 + core * RS() * 5.5;
      const ry = coastAng(z) + (RS() < 0.3 ? Math.PI / 2 : 0) + (RS() - 0.5) * 0.5;
      B.box(x, h - 1.5, h + wall, z, hw, hd, ry, pickS(walls).map(v => v * (0.85 + 0.3 * RS())), { roof: hw * (0.5 + 0.35 * RS()), roofCol: big && RS() < 0.5 ? [0.12, 0.12, 0.125] : pickS(roofs) });
      made++; nHouses++;
      if (RS() < 0.55) { const r = RS(); light(x + Math.max(hw, hd) + 0.8, h + 1.6 + RS() * (wall - 1.5), z + (RS() - 0.5) * hd, r < 0.75 ? WARM : PALE, 60 + 320 * r * r, 0.8); }
    }
    // church with a spire (villages and the town), on the first rise behind the houses
    if (s.kind !== 'hamlet') for (let k = 0; k < 20; k++) {
      const z = s.z + (RS() - 0.5) * sig * 0.8, x = shoreX(z) - 50 - RS() * 70, h = groundH(x, z); if (h < 3 || h > 40) continue;
      const ry = coastAng(z) + Math.PI / 2, wc = [0.6, 0.57, 0.5], rc = town ? [0.085, 0.09, 0.1] : [0.26, 0.1, 0.06];
      B.box(x, h - 1.5, h + 8.5, z, 4.6, 11, ry, wc, { roof: 4.2, roofCol: rc });
      const tx = x + Math.sin(ry) * 13, tz = z + Math.cos(ry) * 13;
      B.box(tx, h - 1.5, h + (town ? 24 : 18), tz, 2.7, 2.7, ry, wc, { spire: town ? 17 : 11, roofCol: rc });
      light(tx + 3.6, h + 5, tz, PALE, 140, 0.8);
      break;
    }
    // street lamps along the village street and the waterfront
    for (let z = s.z - sig * 1.5; z < s.z + sig * 1.5; z += 34 + RS() * 10) {
      const sx = shoreX(z);
      for (const [d, I] of [[38 + RS() * 10, 210], [town ? 105 : 1e9, 170]]) { if (d > 1e8) continue; const x = sx - d, h = groundH(x, z); if (h > 2.3 && h < 45 && RS() < 0.85) light(x, h + 7.5, z, SODIUM, I, 0.8); }
    }
    // pier / mole, boats in its lee, harbour lights
    if (s.kind !== 'hamlet' || RS() < 0.5) {
      const z = s.z + (RS() - 0.5) * sig * 0.6, sx = shoreX(z), L = town ? 120 : 45 + RS() * 45, col = town || RS() < 0.5 ? stone : timber, side = RS() < 0.5 ? -1 : 1;
      B.box(sx + L / 2 - 8, -3, town ? 2.6 : 1.9, z, L / 2 + 8, town ? 3.6 : 2.1, 0, col);
      if (town) {
        B.box(sx + L - 3.6, -3, 2.6, z + side * 38, 3.6, 38, 0, col);                              // mole arm
        B.box(sx + L - 3.6, 2.6, 7.5, z + side * 73, 1.1, 1.1, 0, [0.6, 0.58, 0.54]);
        light(sx + L - 3.6, 8.3, z + side * 73, [0.2, 1.0, 0.45], 520, 0.6, [4, 0.3, RS(), 1]);
        B.box(sx + 46, -3, 2.2, z + side * 150, 54, 2.6, 0, col);                                   // second pier closing the basin
        light(sx + 99, 4.5, z + side * 150, [1.0, 0.1, 0.05], 480, 0.6, [4, 0.3, RS(), 1]);
        boats(sx + 12, sx + L - 16, z + side * 25, side, 26);
        // quay with small harbour cranes
        const cy = 2.6;
        B.box(sx - 4, -3, cy, z + side * 75, 9, 80, 0, [0.33, 0.32, 0.3]);
        for (let k = 0; k < 3; k++) {
          const cz = z + side * (30 + k * 42 + RS() * 10), cx = sx + 1, cc2 = [[0.2, 0.3, 0.26], [0.42, 0.2, 0.13], [0.3, 0.31, 0.33]][k], a = (RS() - 0.5) * 2.6;
          for (const [ox, oz] of [[-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, 3.5]]) P.beam([cx + ox, cy, cz + oz], [cx + ox * 0.7, cy + 9, cz + oz * 0.7], 0.9, cc2);
          B.box(cx, cy + 9, cy + 10.2, cz, 3.6, 3.6, 0, cc2); B.box(cx, cy + 10.2, cy + 22, cz, 1.3, 1.3, a, cc2); B.box(cx - Math.cos(a) * 1.5, cy + 12, cy + 16.5, cz + Math.sin(a) * 1.5, 3, 2.2, a, [0.55, 0.53, 0.48]);
          const tip = [cx + Math.cos(a) * 21, cy + 36 + RS() * 6, cz - Math.sin(a) * 21], apex = [cx - Math.cos(a) * 2.5, cy + 28, cz + Math.sin(a) * 2.5];
          P.beam([cx, cy + 17, cz], tip, 1.1, cc2); P.beam([cx, cy + 22, cz], apex, 0.7, cc2); P.beam(apex, tip, 0.3, cc2);
          light(apex[0], apex[1] + 1, apex[2], [1.0, 0.1, 0.05], 200, 0.6);
          light(cx + 3, cy + 15, cz, PALE, 260, 0.8);
        }
        for (let zz = z + side * 5; Math.abs(zz - z) < 150; zz += side * 27) light(sx - 2, cy + 8, zz, PALE, 200, 0.8);
      } else {
        boats(sx + 8, sx + L - 4, z, side, 3 + Math.floor(RS() * 7));
        if (RS() < 0.6) light(sx + L - 1, 4.2, z, RS() < 0.5 ? [1.0, 0.1, 0.05] : [0.2, 1.0, 0.45], 360, 0.6, [3 + Math.floor(RS() * 3), 0.25, RS(), 1]);
        else light(sx + L - 1, 5, z, PALE, 160, 0.8);
      }
    }
    // road up the valley behind the settlement: thinning lamps, a few farms and hamlets
    if (s.kind !== 'hamlet') {
      let x = s.x - 130, z = s.z, run = 0; const maxRun = town ? 1500 : 900 + RS() * 500;
      while (run < maxRun) {
        let best = z, bh = 1e9; for (const o of [-30, 0, 30]) { const h = groundH(x - 42, z + o) + Math.abs(o) * 0.12; if (h < bh) { bh = h; best = z + o; } }
        x -= 42; z = best; run += 45; const h = groundH(x, z); if (h > 130 || h < 2.2) break;
        if (RS() < 0.72 * Math.exp(-run / 520) + 0.07) light(x, h + 7.5, z, SODIUM, 180, 0.8);
        if (RS() < 0.07) { const m = 3 + Math.floor(RS() * 6); for (let k = 0; k < m; k++) { const hx = x + gauss() * 40, hz = z + gauss() * 40, hh = groundH(hx, hz); if (hh < 2.5) continue;
          B.box(hx, hh - 1.5, hh + 3.6 + RS() * 2, hz, 3.4 + RS(), 4.5 + RS() * 2, RS() * 3.14, pickS(walls), { roof: 2.2, roofCol: pickS(roofs) }); nHouses++;
          if (RS() < 0.7) light(hx + 4.6, hh + 2.2, hz, RS() < 0.8 ? WARM : PALE, 60 + 240 * RS() * RS(), 0.8); } }
      }
    }
  }
  // coast road between neighbouring settlements: lit only near the villages, dark gaps in between
  for (let z = -4900; z < 4900; z += 44 + RS() * 14) {
    if (Math.abs(z - AXIS) < 880 || (z > port.z0 - 120 && z < port.z1 + 120)) continue;
    let dn = 1e9; for (const s of sites) dn = Math.min(dn, Math.abs(z - s.z) - s.sig * 1.5);
    if (dn < 0 || RS() > 0.85 * Math.exp(-dn / 300) + 0.035) continue;
    const x = shoreX(z) - 55 - RS() * 25, h = groundH(x, z); if (h > 2.4 && h < 70) light(x, h + 7.5, z, SODIUM, 170, 0.8);
  }
  // lonely farms on the cultivated slopes
  for (let i = 0; i < 520; i++) {
    const z = -5000 + RS() * 10000, d = 150 + RS() * 1400, r1 = RS(), r2 = RS(), r3 = RS();
    if (Math.abs(z - AXIS) < 900 || (z > port.z0 - 150 && z < port.z1 + 150)) continue;
    const x = coastX(z) - d; farH(x, z); const h = groundH(x, z); if (h < 4 || h > 170 || T.val > 0.75 - 0.4 * r1) continue;
    if (Math.abs(groundH(x - 12, z) - h) > 5) continue;
    const ry = r2 * 3.14;
    B.box(x, h - 1.5, h + 4 + r3 * 2, z, 3.6 + r2 * 1.5, 5.5 + r3 * 4, ry, pickS(walls), { roof: 2.6, roofCol: pickS(roofs) }); nHouses++;
    if (r1 < 0.5) B.box(x + Math.cos(ry) * 14, h - 1.5, h + 4.5, z - Math.sin(ry) * 14, 4.5, 8 + r1 * 8, ry + 1.57, [0.33, 0.25, 0.18], { roof: 2.8, roofCol: [0.16, 0.15, 0.15] });
    if (r3 < 0.6) light(x + 5.5, h + 2.5, z, r2 < 0.8 ? WARM : COOL, 70 + 600 * r3 * r3, 0.8);
  }
  // beacons on the most exposed headlands, a danger mark, a radio mast on the highest foothill
  {
    const heads = [];
    for (let z = -4800; z <= 4800; z += 40) { if (Math.abs(z - AXIS) < 900 || (z > port.z0 - 300 && z < port.z1 + 300) || Math.abs(z - L2.z) < 500) continue; heads.push({ z, x: shoreX(z) }); }
    heads.sort((a, b) => b.x - a.x); const chosen = [];
    for (const hd of heads) { if (chosen.length >= 4) break; if (chosen.every(c => Math.abs(c.z - hd.z) > 900) && sites.every(s => Math.abs(s.z - hd.z) > 250)) chosen.push(hd); }
    chosen.forEach((hd, i) => {
      const x = hd.x - 8, h = Math.max(1.5, groundH(x, hd.z));
      B.box(x, h - 1, h + 8, hd.z, 1.2, 1.2, 0.4, i % 2 ? [0.62, 0.6, 0.55] : [0.5, 0.12, 0.08]); B.box(x, h + 8, h + 9.6, hd.z, 0.8, 0.8, 0.4, [0.1, 0.1, 0.1]);
      light(x, h + 9, hd.z, i === 3 ? [1.0, 0.1, 0.05] : [1.0, 0.92, 0.78], 700, 0.6, [5 + i * 1.5, 0.12, RS(), 1]);
    });
    let top = { x: 0, z: 0, y: -1 };
    for (let z = -3600; z <= 3900; z += 60) { if (Math.abs(z - AXIS) < 1300) continue; const cx = coastX(z); for (let d = 300; d <= 1500; d += 60) { const y = groundH(cx - d, z); if (y > top.y) top = { x: cx - d, z, y }; } }
    for (let k = 0; k < 5; k++) B.box(top.x, top.y + k * 9 - (k ? 0 : 2), top.y + k * 9 + 9, top.z, 0.9 - k * 0.12, 0.9 - k * 0.12, 0.3, k % 2 ? [0.62, 0.6, 0.56] : [0.5, 0.1, 0.07]);
    B.box(top.x + 6, top.y - 1, top.y + 3, top.z + 2, 3, 2.4, 0, [0.5, 0.48, 0.44]);
    light(top.x, top.y + 46, top.z, [1.0, 0.06, 0.03], 800, 0.5, [2.4, 0.5, 0.3, 1]); light(top.x, top.y + 23, top.z, [1.0, 0.06, 0.03], 380, 0.45);
  }
  // a handful of dim lights high on the first range (a mountain road and a hut), so the hills are not empty at night
  {
    const Ly = layers[layers.length - 1];
    for (const side of [-1, 1]) {
      const sd = Ly.seed + (side > 0 ? 40 : 0); let dzv = 3000 + RS() * 1500;
      for (let k = 0; k < 9; k++) {
        dzv += 60 + RS() * 150; const u = US[k < 5 ? 1 : 2]; if (RS() < 0.35) continue;
        const z = AXIS + side * dzv, x = xcOf(Ly, dzv, sd) + (1 - u) * Ly.H * 2.4;
        light(x + 6, mtnH(Ly, sd, x, z, dzv, u) + 14, z, k === 8 ? PALE : SODIUM, 150 + 150 * RS(), 0.8);
      }
    }
  }
  if (B.p.length) P.raw(B.build());
  S.stats.shore = { town: sites.filter(q => q.kind === 'town').map(q => [Math.round(q.x), q.z])[0], sites: sites.length, houses: nHouses, boats: nBoats, lights: nLights };

  return { group, farH, port: { ...port, cranes }, lighthouse2: { x: lx, y: ly + 21.8, z: lz } };

}
