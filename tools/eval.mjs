// Debug helper: node tools/eval.mjs --world=test --w=640 --h=360 --spec='{"elev":30}' --js="expr or async body returning a value"
import { startServerAuto } from './server.mjs';
import { launch, openPage } from './browser.mjs';
const opt = {}; for (const a of process.argv.slice(2)) { const m = /^--([^=]+)=([\s\S]*)$/.exec(a); if (m) opt[m[1]] = m[2]; }
const W = Number(opt.w || 640), H = Number(opt.h || 360);
const srv = await startServerAuto({ port: 5400 + Math.floor(Math.random() * 200), quiet: true });
const browser = await launch({ width: W, height: H, profile: opt.profile || null });
try {
  const page = await openPage(browser, `http://localhost:${srv.port}/index.html?capture=1&w=${W}&h=${H}&world=${opt.world || 'city'}`);
  await page.evaluate(() => window.__app.ready);
  const spec = opt.spec ? JSON.parse(opt.spec) : {};
  const res = await page.evaluate(async (spec, js) => {
    const r = await window.__app.still({ spp: 2, ...spec });
    const app = window.__app, engine = app.engine, THREE = app.THREE, G = app.G;
    const fn = new Function('app', 'engine', 'THREE', 'G', 'r', `return (async () => { ${js.includes('return') ? js : 'return ' + js} })()`);
    return await fn(app, engine, THREE, G, r);
  }, spec, opt.js || 'r');
  console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1));
} catch (e) { console.error('ERROR', e); }
await browser.close(); await srv.close(); process.exit(0);
