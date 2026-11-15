// Debug helper (buildings module): measure facade shader compile time and surface ANGLE/D3D compiler messages.
// node tools/bld_compile.mjs [blddbg-mask]
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { startServerAuto } from './server.mjs';
const mask = process.argv[2] || '0';
const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));
const srv = await startServerAuto({ port: 5600 + Math.floor(Math.random() * 200), quiet: true });
const browser = await puppeteer.launch({
  executablePath: exe, headless: true, protocolTimeout: 0, dumpio: true,
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--enable-logging=stderr', '--v=0', '--force-device-scale-factor=1', '--mute-audio', '--no-first-run', '--window-size=640,360'],
  defaultViewport: { width: 640, height: 360, deviceScaleFactor: 1 },
});
const page = await browser.newPage(); page.setDefaultTimeout(0);
page.on('console', m => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warn' || t.startsWith('[app]')) console.log('[page] ' + t.slice(0, 600)); });
await page.goto(`http://localhost:${srv.port}/index.html?capture=1&w=320&h=180&world=city&only=buildings&blddbg=${mask}`, { waitUntil: 'load', timeout: 0 });
await page.evaluate(() => window.__app.ready);
const r = await page.evaluate(async () => {
  const t0 = performance.now();
  const res = await window.__app.still({ spp: 1, cam: { pos: [430, 4.2, 95], target: [520, 120, 60], fov: 35 }, elev: 9 });
  const t1 = performance.now();
  const res2 = await window.__app.still({ spp: 4, w: 1280, h: 720, cam: { pos: [126.5, 4.1, 115.7], target: [152, 13, 115.7], fov: 55 }, elev: 9 });
  const res3 = await window.__app.still({ spp: 8, w: 1280, h: 720, cam: { pos: [126.5, 4.1, 115.7], target: [152, 13, 115.7], fov: 55 }, elev: 9 });
  return { first: Math.round(t1 - t0), ms4: res2.ms, ms8: res3.ms, perSample: (res3.ms - res2.ms) / 4 };
});
console.log('RESULT mask', mask, JSON.stringify(r));
await browser.close(); await srv.close(); process.exit(0);
