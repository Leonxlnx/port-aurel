#!/usr/bin/env node
// Builds tools/audio/sources.json (single source of truth for CREDITS.md) from the hand-entered
// music / Mixkit tables below plus the Freesound manifest written by fetch_freesound.cjs.
'use strict';
const fs = require('fs');
const path = require('path');
const PIX = { license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/', attributionRequired: false };
const BY4 = { license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', attributionRequired: true };
const BY3 = { license: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/', attributionRequired: true };
const MKM = { license: 'Mixkit Stock Music Free License', licenseUrl: 'https://mixkit.co/license/#musicFree', attributionRequired: false };
const MKS = { license: 'Mixkit Sound Effects Free License', licenseUrl: 'https://mixkit.co/license/#sfxFree', attributionRequired: false };

const sb = (file, title, slug, up, extra) => ({
  file, title: title + (extra || ''), author: 'Scott Buckley', source: 'scottbuckley.com.au',
  sourcePage: 'https://www.scottbuckley.com.au/library/' + slug + '/',
  downloadUrl: 'https://www.scottbuckley.com.au/library/wp-content/uploads/' + up, ...BY4,
  attribution: '"' + title + '" by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au',
  note: 'Artist asks for the credit in the post/description text (not burned into the video). 320 kbps MP3 from the artist site.',
});
const px = (file, title, user, real, slug, cdn, note) => ({
  file, title, author: real ? user + ' (' + real + ')' : user, source: 'Pixabay',
  sourcePage: 'https://pixabay.com/music/' + slug + '/',
  downloadUrl: 'https://cdn.pixabay.com/audio/' + cdn, ...PIX,
  attribution: 'Not required. Optional courtesy credit: Music by ' + user + ' from Pixabay',
  note: ('256 kbps MP3 as served by the Pixabay CDN (the file the site player uses; no login). ' + (note || '')).trim(),
});

const music = [
  sb('music/scottbuckley_twilight-echo.mp3', 'Twilight Echo', 'twilight-echo', '2020/04/sb_twilightecho.mp3'),
  px('music/pixabay_rockot_eona-emotional-ambient-pop.mp3', 'EONA - Emotional Ambient Pop', 'Rockot', '', 'beats-eona-emotional-ambient-pop-351436', '2025/05/29/audio_b92a610839.mp3',
    'Editor’s Choice, ~156k downloads when fetched; not flagged AI-generated; not registered with YouTube Content ID.'),
  px('music/pixabay_evgeny-bardyuzha_embrace.mp3', 'Embrace (Soft background beat no copyright)', 'Evgeny_Bardyuzha', '', 'electronic-embrace-soft-background-beat-no-copyright-364091', '2025/06/23/audio_e6a00ad257.mp3',
    'Editor’s Choice, ~149k downloads; not flagged AI-generated; registered with YouTube Content ID (Pixabay offers a licence certificate on the track page; not relevant for X).'),
  {
    file: 'music/fma_broke-for-free_night-owl.mp3', title: 'Night Owl', author: 'Broke For Free', source: 'Free Music Archive',
    sourcePage: 'https://freemusicarchive.org/music/Broke_For_Free/Directionless_EP/Broke_For_Free_-_Directionless_EP_-_01_Night_Owl/',
    downloadUrl: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/music/WFMU/Broke_For_Free/Directionless_EP/Broke_For_Free_-_01_-_Night_Owl.mp3', ...BY3,
    attribution: '"Night Owl" by Broke For Free (freemusicarchive.org/music/Broke_For_Free) - CC BY 3.0',
    note: 'From the Directionless EP (2011). FMA shows 1.5M plays / 3.7M downloads. 320 kbps MP3.',
  },
  {
    file: 'music/fma_tours_enthusiast.mp3', title: 'Enthusiast', author: 'Tours', source: 'Free Music Archive',
    sourcePage: 'https://freemusicarchive.org/music/Tours/Enthusiast/Tours_-_Enthusiast/',
    downloadUrl: 'https://files.freemusicarchive.org/storage-freemusicarchive-org/music/no_curator/Tours/Enthusiast/Tours_-_01_-_Enthusiast.mp3', ...BY3,
    attribution: '"Enthusiast" by Tours (freemusicarchive.org/music/Tours) - CC BY 3.0',
    note: 'FMA shows ~782K plays / 2.5M downloads. 320 kbps MP3.',
  },
  px('music/pixabay_lexin-music_inspiring-cinematic-ambient.mp3', 'Inspiring Cinematic Ambient', 'Lexin_Music', 'Aleksey Chistilin', 'beautiful-plays-inspiring-cinematic-ambient-116199', '2022/08/02/audio_884fe92c21.mp3',
    'Editor’s Choice, ~394k downloads; not flagged AI-generated; registered with YouTube Content ID.'),
  px('music/pixabay_good-b-music_cinematic-chillhop-main.mp3', 'Cinematic Chillhop Main', 'Good_B_Music', 'Zakhar Valaha', 'beats-cinematic-chillhop-main-6676', '2021/08/08/audio_dc39bde808.mp3',
    'Editor’s Choice, ~206k downloads; not flagged AI-generated; registered with YouTube Content ID.'),
  // alternates (not in the main ranking)
  sb('music/alternates/scottbuckley_twilight-echo_nolead.mp3', 'Twilight Echo', 'twilight-echo', '2020/04/sb_twilightecho_nolead.mp3', ' (no lead synth version)'),
  sb('music/alternates/scottbuckley_electric-dreams.mp3', 'Electric Dreams', 'electric-dreams', '2020/09/sb_electricdreams.mp3'),
  sb('music/alternates/scottbuckley_affirmations.mp3', 'Affirmations', 'affirmations', '2021/06/sb_affirmations.mp3'),
  sb('music/alternates/scottbuckley_resolutions.mp3', 'Resolutions', 'resolutions', '2022/01/Resolutions.mp3'),
  px('music/alternates/pixabay_top-flow_neon-reverie.mp3', 'Neon Reverie', 'Top-Flow', 'Sergio Prosvirini', 'synth-pop-neon-reverie-237942', '2024/09/04/audio_6a853de1cc.mp3',
    '~9.6k downloads; not flagged AI-generated; registered with YouTube Content ID.'),
  {
    file: 'music/alternates/mixkit_alejandro-magana_sun-in-your-eyes.mp3', title: 'Sun in Your Eyes', author: 'Alejandro Magaña (A. M.)', source: 'Mixkit',
    sourcePage: 'https://mixkit.co/free-stock-music/mood/dreamy/', downloadUrl: 'https://assets.mixkit.co/music/131/131.mp3', ...MKM,
    attribution: 'Not required. Optional: "Sun in Your Eyes" by Alejandro Magaña (A. M.) via Mixkit',
    note: 'Mixkit music item 131 (genre tag: Synthwave). Licence allows social-media video posts; forbids CDs/DVDs, TV/radio, games and music-only redistribution.',
  },
].map((m) => ({ category: m.file.includes('/alternates/') ? 'music (alternate)' : 'music', ...m }));

// Mixkit sound effects: [id, file stem, title, listing page slug, extension]
const mkRows = [
  [1208, 'water_small_waves_harbor_rocks', 'Small waves harbor rocks', 'harbor'],
  [1195, 'water_close_sea_waves_loop', 'Close sea waves loop', 'waves'],
  [2678, 'city_urban_ambience_night', 'Urban city ambience at night', 'city'],
  [2465, 'city_urban_ambient', 'Urban ambient sound', 'city'],
  [2930, 'city_traffic_background_ambience', 'City traffic background ambience', 'city'],
  [2658, 'wind_blowing_ambience', 'Wind blowing ambience', 'wind'],
  [2427, 'wind_breeze_through_trees', 'Breeze through the trees', 'wind'],
  [1200, 'wind_windy_sea_loop', 'Windy sea loop', 'wind'],
  [3019, 'tram_slow_passing', 'Slow tram passing', 'subway'],
  [3020, 'tram_double_slow_passby', 'Double tram slow pass-by', 'subway'],
  [3021, 'tram_fast_close_passing', 'Fast tram close passing', 'subway'],
  [2680, 'train_subway_interior_ambience', 'Subway interior ambience', 'city'],
  [2132, 'electric_low_humming', 'Low electricity humming', 'electricity'],
  [910, 'electric_buzz', 'Electricity buzz', 'buzz'],
  [2579, 'switch_light_switch', 'Light switch sound', 'switch'],
  [1808, 'switch_electric_switch', 'Electric switch', 'switch'],
  [2585, 'switch_on_off_light_tap', 'On or off light switch tap', 'switch'],
  [1474, 'whoosh_transition_windy_swoosh', 'Transition windy swoosh', 'transition'],
  [1168, 'whoosh_woosh_wind', 'Woosh wind', 'transition'],
  [2604, 'whoosh_deep_air_woosh', 'Deep air woosh', 'wind'],
  [163, 'whoosh_slow_sweeping_swoosh', 'Slow sweeping swoosh', 'ship'],
  [563, 'boom_drum_deep_impact', 'Drum deep impact', 'film'],
  [1143, 'boom_cinematic_whoosh_deep_impact', 'Cinematic whoosh deep impact', 'film', 'mp3'],
  [788, 'boom_big_cinematic_impact', 'Big cinematic impact', 'impact', 'mp3'],
  [645, 'riser_cinematic_synth_riser', 'Cinematic synth riser', 'riser'],
  [786, 'riser_cinematic_suspense_swell', 'Cinematic suspense swell', 'film'],
  [1438, 'camera_vintage_shutter', 'Vintage camera shutter', 'camera'],
  [1137, 'camera_old_shutter_click', 'Old camera shutter click', 'shutter'],
  [1440, 'camera_classic_click', 'Classic camera click', 'camera'],
  [1441, 'projector_vintage_film_projector_working', 'Vintage film projector working', 'projector'],
  [1444, 'projector_antique_movie_projector_spinning', 'Antique movie projector spinning', 'projector'],
];
const mk = mkRows.map(([id, name, title, slug, ext]) => {
  const e = ext || 'wav';
  return {
    category: name.split('_')[0], file: 'sfx/' + name + '_mixkit-' + id + '.' + e, title, author: 'Mixkit (contributor not named on the site)', source: 'Mixkit',
    sourcePage: 'https://mixkit.co/free-sound-effects/' + slug + '/', downloadUrl: 'https://assets.mixkit.co/active_storage/sfx/' + id + '/' + id + '.' + e, ...MKS,
    attribution: 'Not required. Optional: Sound effect from Mixkit (mixkit.co)',
    note: 'Mixkit item ' + id + ', original ' + e.toUpperCase() + ' download (download page: https://mixkit.co/free-sound-effects/download/' + id + '/).',
  };
});

const fsPath = path.join(__dirname, 'sources_sfx_freesound.json');
const freesound = fs.existsSync(fsPath) ? JSON.parse(fs.readFileSync(fsPath, 'utf8')) : [];
const all = [...music, ...mk, ...freesound];
fs.writeFileSync(path.join(__dirname, 'sources.json'), JSON.stringify(all, null, 1));
console.log('sources.json: ' + music.length + ' music, ' + mk.length + ' mixkit sfx, ' + freesound.length + ' freesound sfx');
