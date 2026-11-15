#!/usr/bin/env node
// One-line-per-band digit sparkline of the energy curves in analysis JSONs (0 = >=18 dB below reference, 9 = at reference).
// Usage: node tools/audio/sparkline.cjs [blockSeconds=4] <analysis.json...>
'use strict';
const fs = require('fs');
let args = process.argv.slice(2), blk = 4; if (/^[\d.]+$/.test(args[0])) blk = +args.shift();
const B = Math.round(blk / 0.25);
for (const f of args) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!j.rms025) continue;
  const row = (a, ref) => { let s = ''; for (let i = 0; i < a.length; i += B) { let m = 0, c = 0; for (let k = i; k < Math.min(a.length, i + B); k++) { m += a[k]; c++; } const v = m / c - ref; s += String(Math.max(0, Math.min(9, Math.round(9 + v / 2)))); } return s; };
  let ruler = ''; for (let i = 0; i * blk < j.duration; i++) ruler += (i * blk) % 60 === 0 ? String((i * blk) / 60 % 10) : ((i * blk) % 30 === 0 ? '+' : '.');
  console.log(`${f.split(/[\/]/).pop()}  bpm ${j.bpm} bar=${j.beatsPerBar}  (${blk}s/char, digit = 2 dB steps below ref)`);
  console.log('  min  ' + ruler); console.log('  rms  ' + row(j.rms025, j.levels.rmsP90)); console.log('  low  ' + row(j.low025, j.levels.lowP75)); console.log('  high ' + row(j.high025, j.levels.highP75));
}
