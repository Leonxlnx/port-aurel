#!/usr/bin/env node
// Prints the ranked 60 s windows of analysis JSONs with a 2 s/char energy strip for each window.
// Usage: node tools/audio/window_report.cjs [topN=3] <analysis.json...>
'use strict';
const fs = require('fs');
let args = process.argv.slice(2), top = 3; if (/^\d+$/.test(args[0])) top = +args.shift();
const mm = (t) => Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60).toFixed(1);
for (const f of args) {
  const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (!j.windows) continue;
  console.log('\n== ' + j.file + '  bpm ' + j.bpm + ' (alt ' + j.bpmAlternatives.join('/') + ')  bar=' + j.beatsPerBar + ' beats  downbeat conf ' + j.downbeatConfidence + '  votes ' + JSON.stringify(j.downbeatEvidence.sectionStartVotes) + '  ' + j.loudness.integratedLUFS + ' LUFS');
  console.log('   events: ' + j.events.map((e) => mm(e.time) + (e.beatTime != null ? '@' + e.beatTime : '') + ' ' + e.type + ' ' + e.stepDb).join(' | '));
  const strip = (a, ref, s) => { let o = ''; for (let t = 0; t < 60; t += 2) { const i = Math.round((s + t) / 0.25); let m = 0, c = 0; for (let k = i; k < i + 8 && k < a.length; k++) { m += a[k]; c++; } o += c ? String(Math.max(0, Math.min(9, Math.round(9 + (m / c - ref) / 2)))) : ' '; } return o; };
  for (const w of j.windows.slice(0, top)) {
    console.log('   WINDOW ' + mm(w.start) + ' -> ' + mm(w.end) + '  (start ' + w.start + ' s)  score ' + w.score + '  parts ' + JSON.stringify(w.parts));
    console.log('      +0s       +20s      +40s      +60s');
    console.log('      ' + strip(j.rms025, j.levels.rmsP90, w.start) + '  rms');
    console.log('      ' + strip(j.low025, j.levels.lowP75, w.start) + '  low <150 Hz');
    console.log('      ' + strip(j.high025, j.levels.highP75, w.start) + '  high >4 kHz');
    console.log('      ' + w.notes);
  }
}
