// Offline film renderer: drives the page frame by frame on the real GPU and pipes raw frames into ffmpeg.
// One intermediate (all-intra, near-lossless) file per shot, so single shots can be re-rendered; then --assemble.
//
//   node tools/render.mjs --tag=preview --w=1280 --h=720 --spp=6            render all shots
//   node tools/render.mjs --tag=final --w=3840 --h=2160 --spp=14 --shots=3,4  only these shot ids
//   node tools/render.mjs --tag=final --assemble [--audio=assets/audio/mix.wav] [--crf=14] [--out=out/film/final.mp4]
// Options: --fps=30 --shutter=180 (degrees) --force (re-render existing shots) --pace=0 (ms pause per frame, be gentle)
//          --limit=N (only first N frames per shot, for tests) --q=only=... (world module filter)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { startServerAuto, ROOT } from './server.mjs';
import { launch, openPage } from './browser.mjs';

const opt = {}; for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) opt[m[1]] = m[2] ?? 'true'; }
const tag = opt.tag || 'preview';
const W = Number(opt.w || 1280), H = Number(opt.h || 720), SPP = Number(opt.spp || 6), FPS = Number(opt.fps || 30);
const SHUTTER = Number(opt.shutter ?? 180) / 360 / FPS;
const dir = path.join(ROOT, 'out', 'film', tag);
fs.mkdirSync(dir, { recursive: true });
const VF = 'vflip,scale=in_range=full:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int';
const COLOR = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

function assemble() {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const list = manifest.shots.map(s => `file '${path.join(dir, s.file).replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(path.join(dir, 'concat.txt'), list);
  const out = path.resolve(opt.out || path.join(ROOT, 'out', 'film', `${tag}.mp4`));
  const crf = opt.crf || '14';
  const args = ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'concat.txt')];
  if (opt.audio) args.push('-i', path.resolve(opt.audio));
  args.push('-map', '0:v:0'); if (opt.audio) args.push('-map', '1:a:0');
  args.push('-c:v', 'libx264', '-preset', opt.preset || 'slow', '-crf', crf, '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', String(manifest.fps),
    '-x264-params', 'keyint=60:min-keyint=30:aq-mode=3:deblock=-1,-1:colorprim=bt709:transfer=bt709:colormatrix=bt709', '-tune', 'grain', ...COLOR, '-movflags', '+faststart');
  if (opt.audio) args.push('-c:a', 'aac', '-b:a', '320k', '-ar', '48000', '-shortest');
  args.push(out);
  console.log('ffmpeg ' + args.join(' '));
  const r = spawnSync('ffmpeg', args, { stdio: 'inherit' });
  console.log(r.status === 0 ? `assembled -> ${out}` : 'assemble FAILED');
  process.exit(r.status || 0);
}
if (opt.assemble) assemble();

// ---------------------------------------------------------------------------------------------
let enc = null;   // { proc, shotId, frames }
function openEncoder(file) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-',
    '-vf', VF, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', opt.icrf || '7', '-g', '1', '-pix_fmt', 'yuv444p', ...COLOR, file];
  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  proc.on('error', e => console.error('ffmpeg error', e));
  return proc;
}
const routes = {
  '/__frame': async (req, res) => {
    const chunks = []; let n = 0;
    for await (const c of req) { chunks.push(c); n += c.length; }
    if (n !== W * H * 4) { res.writeHead(400); return res.end(`bad frame size ${n}`); }
    const buf = Buffer.concat(chunks, n);
    if (!enc.proc.stdin.write(buf)) await new Promise(r => enc.proc.stdin.once('drain', r));
    enc.frames++;
    res.writeHead(200); res.end('ok');
  },
};

const t0 = Date.now();
const srv = await startServerAuto({ port: 5600 + Math.floor(Math.random() * 200), quiet: true, routes });
const browser = await launch({ width: Math.min(W, 1920), height: Math.min(H, 1080), profile: opt.profile || null });
let code = 0;
try {
  const page = await openPage(browser, `http://localhost:${srv.port}/index.html?capture=1&w=${W}&h=${H}${opt.q ? '&' + opt.q : ''}`);
  await page.evaluate(() => window.__app.ready);
  const film = await page.evaluate(() => { const f = window.__app.world.film; return { fps: f.fps, shots: f.shots.map(s => ({ id: s.id, name: s.name, start: s.start, end: s.end })) }; });
  if (film.fps !== FPS) console.log(`note: film fps ${film.fps}, rendering at ${FPS}`);
  const want = opt.shots && opt.shots !== 'all' ? opt.shots.split(',') : null;
  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = { tag, w: W, h: H, fps: FPS, spp: SPP, shots: [] };
  let totalFrames = 0, doneFrames = 0;
  const plan = film.shots.map(s => {
    const f0 = Math.round(s.start * FPS), f1 = Math.round(s.end * FPS);
    const file = `shot_${String(s.id).padStart(2, '0')}.mkv`;
    manifest.shots.push({ id: s.id, name: s.name, file, frames: f1 - f0 });
    const exists = fs.existsSync(path.join(dir, file)) && fs.statSync(path.join(dir, file)).size > 1000;
    const todo = (want ? want.includes(String(s.id)) || want.includes(s.name) : true) && (opt.force || want || !exists);
    if (todo) totalFrames += Math.min(f1 - f0, Number(opt.limit || 1e9));
    return { ...s, f0, f1, file, todo };
  });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
  console.log(`render '${tag}' ${W}x${H} spp=${SPP}: ${plan.filter(p => p.todo).length} shots, ${totalFrames} frames`);
  for (const s of plan) {
    if (!s.todo) continue;
    const tmp = path.join(dir, s.file.replace('.mkv', '.part.mkv'));
    enc = { proc: openEncoder(tmp), frames: 0 };
    const ts = Date.now();
    const exposure = await page.evaluate(id => window.__app.lockExposure(id), s.id);
    const n = Math.min(s.f1 - s.f0, Number(opt.limit || 1e9));
    for (let i = 0; i < n; i++) {
      const r = await page.evaluate(async (id, local, spp, shutter, seed) => {
        const res = await window.__app.frame({ shot: id, time: local, spp, shutter, seed });
        await window.__app.sendFrame();
        return res.ms;
      }, s.id, i / FPS, SPP, SHUTTER, s.f0 + i);
      doneFrames++;
      if (i % 10 === 0 || i === n - 1) {
        const el = (Date.now() - t0) / 1000; const eta = el / doneFrames * (totalFrames - doneFrames);
        console.log(`shot ${s.id} '${s.name}' frame ${i + 1}/${n} (${r} ms) | total ${doneFrames}/${totalFrames} | elapsed ${(el / 60).toFixed(1)} min, eta ${(eta / 60).toFixed(1)} min`);
      }
      if (opt.pace && Number(opt.pace) > 0) await new Promise(r => setTimeout(r, Number(opt.pace)));
    }
    enc.proc.stdin.end();
    await new Promise(r => enc.proc.on('close', r));
    fs.renameSync(tmp, path.join(dir, s.file));
    console.log(`shot ${s.id} done: ${n} frames in ${((Date.now() - ts) / 1000).toFixed(0)} s, exposure ${exposure.toFixed(4)}`);
  }
} catch (e) { console.error('ERROR', e); code = 1; }
await browser.close();
await srv.close();
console.log(`render finished in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
process.exit(code);
