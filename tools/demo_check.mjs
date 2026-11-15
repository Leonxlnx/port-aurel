// Smoke test of the interactive demo (no capture mode): loads the page, lets it refine, screenshots, plays the film briefly.
import path from 'node:path';
import { startServerAuto, ROOT } from './server.mjs';
import { launch, openPage } from './browser.mjs';
const srv = await startServerAuto({ port: 5300 + Math.floor(Math.random() * 90), quiet: true });
const browser = await launch({ width: 1280, height: 720, profile: 'lead' });
const errors = [];
try {
  const page = await openPage(browser, `http://localhost:${srv.port}/index.html`);
  page.on('pageerror', e => errors.push(String(e)));
  await page.evaluate(() => window.__app.ready);
  await new Promise(r => setTimeout(r, 25000));
  console.log('info:', await page.evaluate(() => document.getElementById('ui').innerText.replace(/\s+/g, ' ').slice(0, 300)));
  await page.screenshot({ path: path.join(ROOT, 'out', 'shots', 'demo_free.jpg'), type: 'jpeg', quality: 88 });
  await page.keyboard.press('Space');
  await new Promise(r => setTimeout(r, 30000));
  console.log('info:', await page.evaluate(() => document.getElementById('ui').innerText.replace(/\s+/g, ' ').slice(-80)));
  await page.screenshot({ path: path.join(ROOT, 'out', 'shots', 'demo_film.jpg'), type: 'jpeg', quality: 88 });
  await page.keyboard.press('Space');
} catch (e) { console.error('ERROR', e); }
console.log('page errors:', errors.length, errors.slice(0, 5).join(' | '));
await browser.close(); await srv.close(); process.exit(0);
