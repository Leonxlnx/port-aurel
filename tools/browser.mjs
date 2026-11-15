// Shared headless-Chrome launcher (system Chrome, real GPU through ANGLE/D3D11).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean);

/** profile: name of a persistent Chrome profile under out/.chrome/ (keeps the GPU shader cache between runs). */
export async function launch({ width = 1280, height = 720, headless = true, profile = process.env.CHROME_PROFILE || null } = {}) {
  const executablePath = CANDIDATES.find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('Chrome not found; set CHROME_PATH');
  const userDataDir = profile ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'out', '.chrome', profile) : undefined;
  if (userDataDir) fs.mkdirSync(userDataDir, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath, userDataDir,
    headless,
    protocolTimeout: 0,
    args: [
      '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl',
      '--disable-gpu-vsync', '--disable-frame-rate-limit',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--force-device-scale-factor=1', '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
      '--force-color-profile=srgb',
      `--window-size=${width},${height}`,
    ],
    defaultViewport: { width, height, deviceScaleFactor: 1 },
  });
  return browser;
}

/** Open a page and pipe its console + errors to stdout. */
export async function openPage(browser, url, { log = true } = {}) {
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  if (log) {
    page.on('console', msg => {
      const t = msg.type();
      const text = msg.text();
      if (t === 'error' || t === 'warning' || t === 'warn') console.log(`[page:${t}] ${text}`);
      else if (text.startsWith('[app]')) console.log(text);
    });
    page.on('pageerror', err => console.log('[page:exception] ' + (err && err.stack || err)));
    page.on('requestfailed', r => console.log('[page:reqfail] ' + r.url()));
  }
  await page.goto(url, { waitUntil: 'load', timeout: 0 });
  return page;
}
