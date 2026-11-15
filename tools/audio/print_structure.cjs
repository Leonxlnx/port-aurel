#!/usr/bin/env node
// Prints a compact text view of the energy structure stored in an analysis JSON.
// Usage: node tools/audio/print_structure.cjs <analysis.json> [blockSeconds=4] [fromSec] [toSec]
'use strict';
const fs = require('fs');
const [file, blk = '4', from = '0', to = '1e9'] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
const B = Math.round(+blk / 0.25), mean = (a, i, k) => { let s = 0, c = 0; for (let q = i; q < Math.min(a.length, k); q++) { s += a[q]; c++; } return s / c; };
const bar = (v, lo, hi) => { const n = Math.max(0, Math.min(20, Math.round((v - lo) / (hi - lo) * 20))); return '#'.repeat(n).padEnd(20); };
const mm = (t) => Math.floor(t / 60) + ':' + String((t % 60).toFixed(0)).padStart(2, '0');
console.log(`${j.file}  dur ${j.duration}s  bpm ${j.bpm}  bar=${j.beatsPerBar} beats  P90 ${j.levels.rmsP90} dBFS`);
console.log(' time   rms(rel P90)          low<150(rel P75)      high>4k(rel P75)');
for (let i = Math.round(+from / 0.25); i < Math.min(j.rms025.length, Math.round(+to / 0.25)); i += B) {
  const r = mean(j.rms025, i, i + B) - j.levels.rmsP90, l = mean(j.low025, i, i + B) - j.levels.lowP75, h = mean(j.high025, i, i + B) - j.levels.highP75;
  console.log(`${mm(i * 0.25).padStart(5)} ${r.toFixed(1).padStart(6)} ${bar(r, -20, 2)} ${l.toFixed(1).padStart(6)} ${bar(l, -20, 2)} ${h.toFixed(1).padStart(6)} ${bar(h, -20, 2)}`);
}
