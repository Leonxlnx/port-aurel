# Port Aurel — a film-look harbor city in three.js

A small procedural city by the sea, built entirely in code (three.js r187, WebGL2) and photographed like analog film:
golden hour, sunset down the canal, blue hour, city lights. No people, no real places — everything is invented.

The 60-second film is rendered offline from the same page that runs live in the browser.

## Watch

"Last Light" — 60 seconds, 20 shots, golden hour to blue hour.

- `out/film/final.mp4` — master: 3840×2160, 30 fps, H.264 (CRF 18) + AAC, music and sound effects mixed in
- `out/film/final_x.mp4` — the same film in 4K at about 52 Mbit/s, small enough to upload to X
- `out/film/final_1080p.mp4` — 1920×1080 version
- `out/stills/` — ten 4K stills from the film

## Run the live demo

```bash
npm install
```

```bash
npm start
```

Then open http://localhost:5173/ in Chrome or Edge.

- Drag to look, `W A S D` to fly, `Q`/`E` down/up, `Shift` faster, mouse wheel for the lens.
- The sun slider moves through the day; the shot menu jumps to every camera of the film; the "▶ film" button (or Space) plays the cut with sound (a rough real-time preview of the rendered film).
- When the camera rests, the picture refines itself (soft shadows, depth of field, grain) like a long exposure.

The first start compiles a few hundred shader variants and can take a few minutes on an integrated GPU.

## Render the film yourself

```bash
node tools/render.mjs --tag=final --w=3840 --h=2160 --spp=16
```

```bash
node tools/audio/mix.mjs
```

```bash
node tools/encode.mjs --tag=final --name=final
```

Each shot is written as its own near-lossless intermediate (`out/film/final/shot_NN.mkv`), so a render can be
interrupted and resumed, and single shots can be redone with `--shots=7,12 --force`.
On an integrated GPU the full 4K render takes roughly three to five hours.
Stills: `node tools/shot.mjs --shot=11 --time=1.5 --w=3840 --h=2160 --spp=32 --out=sun.jpg`.

## How it works

- `src/engine/` — the camera and the film stock: physically based sky (Rayleigh/Mie/ozone), cascaded sun shadows,
  ambient occlusion, aerial perspective with sun shafts, and an accumulation renderer that averages many jittered
  samples per frame (anti-aliasing, motion blur, thin-lens depth of field, soft sun shadows), then bloom, halation,
  a film tone curve, split toning and grain.
- `src/world/` — the city: layout, facades, rooftops (water tanks, signs, the lantern tower), streets (trees, cars,
  lamps), harbor and bridges, the sea (lighthouse, ferry, far shore), water with a planar mirror, the elevated tram,
  clouds, gulls.
- `src/film/film.js` — the 20 shots of the film "Last Light", cut on the bar grid of the music, with per-shot exposure, grade and sky.
- `tools/` — headless capture (system Chrome via puppeteer-core, real GPU), contact sheets, the film renderer and the
  audio mixer. See `ARCHITECTURE.md` for conventions.

Everything is a pure function of time, so every frame can be rendered again and comes out identical.

## Sound

All music and sound effects are downloaded recordings from free libraries — nothing is synthesized.

- Music: "EONA – Emotional Ambient Pop" by Rockot (Pixabay Content License, no attribution required;
  courtesy credit: *Music by Rockot from Pixabay*).
- Sound effects: Mixkit, Freesound (CC0) and Pixabay recordings.

Sources, licenses and download URLs for every file are listed in `assets/audio/CREDITS.md`; the cue sheet is
`assets/audio/cues.json`.
