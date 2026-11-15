// Freeze the current page sources so long renders are not affected by ongoing edits.
//   node tools/snapshot.mjs v1   ->  out/snap/v1/{index.html,src}  (+ junction to node_modules)
//   FABLE_ROOT=out/snap/v1 node tools/render.mjs ...
import fs from 'node:fs'; import path from 'node:path'; import { execSync } from 'node:child_process';
import { ROOT } from './server.mjs';
const name = process.argv[2] || 'snap'; const dst = path.join(ROOT, 'out', 'snap', name);
fs.rmSync(path.join(dst, 'src'), { recursive: true, force: true });
fs.mkdirSync(dst, { recursive: true });
fs.cpSync(path.join(ROOT, 'src'), path.join(dst, 'src'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(dst, 'index.html'));
const nm = path.join(dst, 'node_modules');
if (!fs.existsSync(nm)) fs.symlinkSync(path.join(ROOT, 'node_modules'), nm, 'junction');
console.log('snapshot ->', dst);
