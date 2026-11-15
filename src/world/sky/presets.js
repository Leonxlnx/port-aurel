// Art direction for the cloud layers. All values are plain numbers so they can be keyframed.
// `DEFAULTS` holds every parameter (its time-of-day dependent values equal the 'golden' preset);
// `PRESETS` override the time-of-day dependent ones. With params.auto = 1 (default) those values are
// blended by sun elevation (see autoParams): night -9.5, afterglow -3.5, sunset 1.5, golden 10 degrees.

export const DEFAULTS = {
  enabled: 1,
  auto: 1,              // 1: time-of-day values follow the sun elevation (blend of the presets below)
  steps: 26,            // coarse ray-march steps that search for cloud columns (20..32); x1.7 near the horizon (max 48).
                        // Below ~24 mid-distance clouds show faint horizontal scan lines at full resolution; 30 is clean
  cloudSteps: 14,       // extra fine steps available inside the clouds (0 = coarse stepping only)
  lightSteps: 3,        // light-march samples: 2 or 3 (jittered, segments of 70 / 224 / 717 m)
  refine: 1,            // surface refinements per ray (0..2): re-march the last coarse step finely when a ray enters a cloud
  lodBias: 1.25,        // > 1 samples blurrier mips of the noise (faster, softer)

  // ---- low / mid layer shape
  coverage: 0.50,       // 0..1 overall amount of stratocumulus / cumulus
  cumulus: 0.50,        // cloud type mix: 0 flat textured sheets .. 0.4 broken stratocumulus .. 1 tall cumulus
  tallness: 1.6,        // how quickly towers grow with local coverage
  density: 1.2,         // extinction multiplier (opacity / contrast of the bodies)
  erosion: 0.56,        // edge erosion by the detail noise (wispiness)
  soft: 1.0,            // 0 hard iso-surface (old look) .. 1 soft translucent fringes and veils
  cells: 1.0,           // cellular / roll texture of the stratiform types (0 = smooth sheets)
  cellScale: 7.0,       // km per tile of the cell pattern (cells are ~1/6 of it)
  cellStretch: 2.0,     // elongation of the cells across the sun azimuth (1 = round cells, 2..3 = rolls / streets)
  curl: 500,            // m: distortion of the detail noise by the shape noise (torn, swirling edges)
  base: 1500,           // m
  top: 4200,            // m
  shapeScale: 10.5,     // km per tile of the base shape noise
  detailScale: 2.2,     // km per tile of the detail noise

  // ---- composition of the sky (fixed in the world; "toward the sun" = west)
  sunGap: 0.36,         // how much coverage is removed in the wedge around the setting sun
  gapWidth: 0.22,       // tan(half angle) of that wedge
  bars: 0.45,           // thin stratus bars near the horizon (dark lines crossing the sun)
  barSpread: 0.7,       // 0: all bars at cloud base .. 1: spread over the layer height
  banding: 1.7,         // elongation of the cloud fields across the sun azimuth (1 = none): streets / bands
  east: 0.36,           // extra coverage on the side opposite the sun (over the city)
  overhead: 0.12,       // coverage removed right above the city (keeps the zenith airy)
  horizonClear: 0.45,   // coverage removed beyond ~40..80 km so the horizon glow stays readable (bars are kept)

  // ---- cirrus
  cirrus: 0.75,         // amount
  cirrusHeight: 9000,   // m
  cirrusDir: 78,        // streak direction, degrees (0 = east-west streaks, 90 = north-south)
  cirrusSide: 0.6,      // 0 = everywhere .. 1 = concentrated on one side of the sky
  cirrusSideDir: 235,   // azimuth (deg, 0 = +X east, 90 = +Z south) of the cirrus-rich side
  cirrusGain: 1.0,      // brightness

  // ---- motion (pure function of time)
  windDir: 12,          // direction the clouds drift toward, degrees (0 = +X east, 90 = +Z south)
  windSpeed: 42,        // m/s (time-lapse speed: the film compresses an evening into a minute)
  cirrusSpeed: 75,      // m/s
  evolve: 1.0,          // rate of shape evolution (detail noise scrolls through the bodies)

  // ---- light
  sunGain: 4.4,         // direct light multiplier (multiple scattering energy)
  ambGain: 1.0,         // sky ambient multiplier
  glow: 0.3,            // light of the twilight arch on faces / undersides that see the sunset horizon
  ambBottom: 0.6,       // ambient light reaching the bases (horizon sky + ground bounce)
  pink: 0.0,            // adds the purple/pink multiply-scattered dusk light to the red direct light
  terminator: 3.0,      // exaggeration of the east-west progression of dusk across the deck
  powder: 0.2,          // thin edges of front-lit clouds stay dull, cores bright
  contrast: 0.45,       // depth of the self shadow (0 = lots of multiple-scattering fill .. 1 = hard shadows)
  silver: 1.5,          // silver / golden lining of thin edges toward the sun
  crease: 0.5,          // dark creases between the billows (detail noise drives the direct light)
  beams: 0.7,           // low sun: patches of lit / shadowed cloud (shadows of banks beyond the horizon)
  belly: 0.7,           // darkening of the bases of thick clouds (sky light blocked from above)
  archTilt: 1.0,        // 0..1: art-directed tilt of the light around sunset (underlit bars at 1.5..-1.5 deg, grey bases later; see sky.js)
  archPink: 0.85,       // 0 = arch light is orange everywhere .. 1 = pink / salmon away from the sunset azimuth
  farShadow: 0.2,       // cloud banks shading each other along a low sun
  litR: 1.0, litG: 0.98, litB: 0.98,     // tint of the direct light
  ambR: 1.0, ambG: 1.0, ambB: 1.0,       // tint of the ambient light
  twilightStretch: 1.6, // > 1 keeps the direct under-lighting alive longer after sunset
  lightAlt: 1.0,        // km added to the cloud altitude for the twilight light (higher = later, pinker glow)
  moonAt: -8.0,         // sun elevation at which the moon takes over as key light
  haze: 42,             // km: distance scale of the aerial perspective on clouds
  moonGain: 1.0,        // moonlight on the clouds once the sun's light has left the deck
  cityGlow: 1.0,        // warm glow on the bases over the city at night
};

export const PRESETS = {
  // sun 8..12 deg: blue sky, cirrus, broken textured stratocumulus / small cumulus with warm sun-side faces
  golden: {
    coverage: 0.50, cumulus: 0.50, density: 1.2, erosion: 0.56,
    sunGap: 0.36, bars: 0.45, east: 0.36, overhead: 0.12,
    cirrus: 0.75, cirrusGain: 1.0,
    sunGain: 4.4, ambGain: 1.0, glow: 0.3, pink: 0.0, farShadow: 0.2,
    litR: 1.0, litG: 0.98, litB: 0.98, ambR: 1.0, ambG: 1.0, ambB: 1.0,
  },
  // sun 0..3 deg: fiery bars and linings near the sun against violet bodies
  sunset: {
    coverage: 0.60, cumulus: 0.30, density: 1.15, erosion: 0.56,
    sunGap: 0.38, bars: 0.80, east: 0.42, overhead: 0.10,
    cirrus: 0.75, cirrusGain: 1.0,
    sunGain: 4.6, ambGain: 1.0, glow: 0.7, pink: 0.5, farShadow: 0.3,
    litR: 1.0, litG: 0.86, litB: 0.72, ambR: 0.96, ambG: 1.0, ambB: 1.16,
  },
  // sun -2..-5 deg: lavender-grey bodies, pink / salmon faces and undersides toward the sunset
  afterglow: {
    coverage: 0.60, cumulus: 0.30, density: 1.1, erosion: 0.56,
    sunGap: 0.36, bars: 0.75, east: 0.42, overhead: 0.10,
    cirrus: 0.70, cirrusGain: 1.0,
    sunGain: 2.6, ambGain: 0.95, glow: 1.3, pink: 0.9, farShadow: 0.8,
    litR: 1.0, litG: 0.95, litB: 1.0, ambR: 0.96, ambG: 1.0, ambB: 1.14,
  },
  night: {
    coverage: 0.55, cumulus: 0.32, density: 1.1, erosion: 0.56,
    sunGap: 0.30, bars: 0.55, east: 0.36, overhead: 0.10,
    cirrus: 0.40, cirrusGain: 1.0,
    sunGain: 1.5, ambGain: 0.85, glow: 0.8, pink: 0.9, farShadow: 1.0,
    litR: 1.0, litG: 0.9, litB: 1.0, ambR: 1.0, ambG: 1.0, ambB: 1.0,
  },
};

// sun elevation (deg) at which each preset is "pure"
export const PRESET_ELEV = [['night', -9.5], ['afterglow', -3.5], ['sunset', 1.5], ['golden', 10]];

/** Blend of the presets for a sun elevation in degrees. */
export function autoParams(elev) {
  const K = PRESET_ELEV;
  if (elev <= K[0][1]) return { ...PRESETS[K[0][0]] };
  for (let i = 1; i < K.length; i++) {
    if (elev <= K[i][1]) {
      let u = (elev - K[i - 1][1]) / (K[i][1] - K[i - 1][1]); u = u * u * (3 - 2 * u);
      const a = PRESETS[K[i - 1][0]], b = PRESETS[K[i][0]], out = {};
      for (const k in a) out[k] = a[k] + (b[k] - a[k]) * u;
      return out;
    }
  }
  return { ...PRESETS[K[K.length - 1][0]] };
}
