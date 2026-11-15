// Art direction for the cloud layers. All values are plain numbers so they can be keyframed.
// `DEFAULTS` holds every parameter (its time-of-day dependent values equal the 'golden' preset);
// `PRESETS` override the time-of-day dependent ones. With params.auto = 1 (default) those values are
// blended by sun elevation (see autoParams): night -9.5, afterglow -3.5, sunset 1.5, golden 10 degrees.

export const DEFAULTS = {
  enabled: 1,
  auto: 1,              // 1: time-of-day values follow the sun elevation (blend of the presets below)
  steps: 32,            // primary ray-march steps (16..40); x1.5 near the horizon
  lightSteps: 5,        // light-march steps (3..5)
  refine: 2,            // surface refinements per ray (0..2): bisect to the cloud skin when a ray enters a cloud
  lodBias: 1.25,        // > 1 samples blurrier mips of the noise (faster, softer)

  // ---- low / mid layer shape
  coverage: 0.55,       // 0..1 overall amount of cumulus / stratocumulus
  cumulus: 0.70,        // cloud type mix: 0 flat stratus sheets .. 1 tall cauliflower cumulus
  tallness: 1.6,        // how quickly towers grow with local coverage
  density: 1.6,         // extinction multiplier (opacity / contrast of the bodies)
  erosion: 0.34,        // edge erosion by the detail noise (wispiness)
  base: 1500,           // m
  top: 4200,            // m
  shapeScale: 10.5,     // km per tile of the base shape noise
  detailScale: 1.7,     // km per tile of the detail noise

  // ---- composition of the sky (fixed in the world; "toward the sun" = west)
  sunGap: 0.36,         // how much coverage is removed in the wedge around the setting sun
  gapWidth: 0.22,       // tan(half angle) of that wedge
  bars: 0.45,           // thin stratus bars near the horizon (dark lines crossing the sun)
  barSpread: 0.7,       // 0: all bars at cloud base .. 1: spread over the layer height
  banding: 1.7,         // elongation of the cloud fields across the sun azimuth (1 = none): streets / bands
  east: 0.42,           // extra coverage on the side opposite the sun (over the city)
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
  sunGain: 2.6,         // direct light multiplier (multiple scattering energy)
  ambGain: 1.0,         // sky ambient multiplier
  glow: 0.4,            // twilight-arch light on the bases
  ambBottom: 0.6,       // ambient light reaching the bases (horizon sky + ground bounce)
  pink: 0.0,            // adds the purple/pink multiply-scattered dusk light to the red direct light
  terminator: 3.0,      // exaggeration of the east-west progression of dusk across the deck
  powder: 0.0,          // dark creases on front-lit clouds
  farShadow: 0.3,       // cloud banks shading each other along a low sun
  litR: 0.92, litG: 1.0, litB: 1.30,     // tint of the direct light
  ambR: 1.0, ambG: 1.0, ambB: 1.0,       // tint of the ambient light
  twilightStretch: 2.6, // > 1 keeps the under-lighting alive longer after sunset
  lightAlt: 2.5,        // km added to the cloud altitude for the twilight light (higher = later, pinker glow)
  haze: 42,             // km: distance scale of the aerial perspective on clouds
  moonGain: 2.0,        // moonlight on the clouds once the sun's light has left the deck
  cityGlow: 1.0,        // warm glow on the bases over the city at night
};

export const PRESETS = {
  // sun 8..12 deg: clean blue, cirrus, a few warm-edged cumulus
  golden: {
    coverage: 0.55, cumulus: 0.70, density: 1.6, erosion: 0.34,
    sunGap: 0.36, bars: 0.45, east: 0.42, overhead: 0.12,
    cirrus: 0.75, cirrusGain: 1.0,
    sunGain: 2.6, ambGain: 1.0, glow: 0.4, pink: 0.0, farShadow: 0.3,
    litR: 0.92, litG: 1.0, litB: 1.30, ambR: 1.0, ambG: 1.0, ambB: 1.0,
  },
  // sun 0..3 deg: fiery banded sky
  sunset: {
    coverage: 0.60, cumulus: 0.32, density: 1.5, erosion: 0.34,
    sunGap: 0.38, bars: 0.80, east: 0.42, overhead: 0.10,
    cirrus: 0.75, cirrusGain: 1.0,
    sunGain: 2.8, ambGain: 1.25, glow: 0.6, pink: 0.6, farShadow: 0.6,
    litR: 1.0, litG: 0.96, litB: 1.0, ambR: 1.0, ambG: 1.0, ambB: 1.22,
  },
  // sun -2..-5 deg: pink / magenta undersides over violet-blue
  afterglow: {
    coverage: 0.60, cumulus: 0.34, density: 1.4, erosion: 0.34,
    sunGap: 0.36, bars: 0.75, east: 0.42, overhead: 0.10,
    cirrus: 0.70, cirrusGain: 1.0,
    sunGain: 1.15, ambGain: 1.7, glow: 1.2, pink: 0.9, farShadow: 1.4,
    litR: 1.0, litG: 0.95, litB: 1.0, ambR: 1.0, ambG: 1.0, ambB: 1.15,
  },
  night: {
    coverage: 0.55, cumulus: 0.40, density: 1.4, erosion: 0.34,
    sunGap: 0.30, bars: 0.55, east: 0.36, overhead: 0.10,
    cirrus: 0.40, cirrusGain: 1.0,
    sunGain: 1.5, ambGain: 1.0, glow: 1.0, pink: 0.9, farShadow: 1.0,
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
