#!/usr/bin/env node
// Downloads the HQ preview MP3 of freesound.org sounds (no login) after confirming on the sound page
// that the sound is CC0. Appends/updates entries in a JSON manifest used to build CREDITS.md.
// Usage: node tools/audio/fetch_freesound.cjs <outDir> <manifest.json> <category>:<outName>:<user>:<id>:<userId> ...
'use strict';
const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
(async () => {
  const [outDir, manifestPath, ...items] = process.argv.slice(2);
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
  for (const it of items) {
    const [category, outName, user, id, userId] = it.split(':');
    const page = `https://freesound.org/people/${encodeURIComponent(user)}/sounds/${id}/`;
    const res = await fetch(page, { headers: { 'user-agent': UA } });
    const h = await res.text();
    const cc0 = /creativecommons\.org\/publicdomain\/zero\/1\.0/.test(h);
    const otherLic = (h.match(/creativecommons\.org\/licenses\/[a-z-]+\/[\d.]+/) || [])[0];
    const title = dec((h.match(/<meta property="og:audio:title" content="([^"]*)"/) || h.match(/<title>([^<]*)<\/title>/) || [, '?'])[1]).replace(/^Freesound - /, '');
    if (!res.ok || !cc0 || otherLic) { console.log(`SKIP ${id} (${title}): HTTP ${res.status}, cc0=${cc0}, other=${otherLic}`); continue; }
    const url = `https://cdn.freesound.org/previews/${Math.floor(+id / 1000)}/${id}_${userId}-hq.mp3`;
    const a = await fetch(url, { headers: { 'user-agent': UA } });
    const buf = Buffer.from(await a.arrayBuffer());
    const ct = a.headers.get('content-type') || '';
    if (!a.ok || !/audio|octet/.test(ct) || buf.length < 2000) { console.log(`FAIL ${id}: HTTP ${a.status} ${ct} ${buf.length}`); continue; }
    const file = outName + `_freesound-${id}.mp3`;
    fs.writeFileSync(path.join(outDir, file), buf);
    const entry = { file: 'sfx/' + file, category, title, author: user, source: 'Freesound', sourcePage: page, downloadUrl: url,
      license: 'CC0 1.0 Universal (public domain dedication)', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', attributionRequired: false,
      attribution: `"${title}" by ${user} (freesound.org/s/${id}) - CC0`, note: 'Freesound HQ preview MP3 (original-quality file needs a login, not used)' };
    const i = manifest.findIndex((m) => m.file === entry.file); if (i >= 0) manifest[i] = entry; else manifest.push(entry);
    console.log(`OK ${file}  ${buf.length} bytes  "${title}"`);
    await new Promise((r) => setTimeout(r, 500));
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
})();
