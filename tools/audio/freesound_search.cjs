#!/usr/bin/env node
// Lists CC0 sounds from freesound.org search result pages (no login, no API key).
// Usage: node tools/audio/freesound_search.cjs "query one" "query two" ...
// Prints: id | user | title | duration | downloads | rating | HQ preview URL
'use strict';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const attr = (s, n) => { const m = s.match(new RegExp('data-' + n + '="([^"]*)"')); return m ? m[1] : ''; };
(async () => {
  for (const q of process.argv.slice(2)) {
    const url = 'https://freesound.org/search/?q=' + encodeURIComponent(q).replace(/%20/g, '+') +
      '&f=' + encodeURIComponent('license:"Creative Commons 0"') + '&s=' + encodeURIComponent('Downloads (most first)');
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    const h = await res.text();
    console.log(`## ${q}  [HTTP ${res.status}] ${(h.match(/(\d+) sounds/) || ['?'])[0]}`);
    const parts = h.split('class="bw-search__result"').slice(1);
    for (const p of parts.slice(0, 12)) {
      const id = attr(p, 'sound-id'), user = attr(p, 'username'), title = attr(p, 'title'), dur = (+attr(p, 'duration')).toFixed(1);
      const dls = attr(p, 'num-downloads'), mp3 = attr(p, 'mp3').replace('-lq.mp3', '-hq.mp3');
      const rating = (p.match(/Average rating of ([\d.]+)/) || [])[1] || '-';
      console.log([id, user, title, dur + 's', 'dl' + dls, 'r' + rating, mp3].join(' | '));
    }
    await new Promise((r) => setTimeout(r, 700));
  }
})();
