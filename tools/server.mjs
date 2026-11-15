// Tiny static server for the demo + capture endpoints (no dependencies).
// Usage: node tools/server.mjs [--port=5173]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
// FABLE_ROOT: serve the page from a frozen snapshot (out/snap/<name>) while outputs still go to the project's out/
export const STATIC_ROOT = process.env.FABLE_ROOT ? path.resolve(process.env.FABLE_ROOT) : ROOT;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4', '.glsl': 'text/plain', '.wasm': 'application/wasm', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function safeJoin(root, p) {
  const full = path.resolve(root, '.' + path.posix.normalize('/' + p));
  if (!full.startsWith(root)) return null;
  return full;
}

/**
 * @param {{port?:number, routes?: Record<string,(req,res,url)=>any>, quiet?:boolean}} opts
 */
export function startServer(opts = {}) {
  const port = opts.port ?? 5173;
  const routes = opts.routes ?? {};
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${port}`);
      if (routes[url.pathname]) return await routes[url.pathname](req, res, url);

      if (url.pathname === '/__exists') {
        const f = safeJoin(STATIC_ROOT, url.searchParams.get('p') || '');
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return res.end(JSON.stringify({ ok: !!f && fs.existsSync(f) }));
      }

      // Save a binary body under out/ (used by capture tools).
      if (url.pathname === '/__save' && req.method === 'POST') {
        const rel = url.searchParams.get('file') || '';
        const full = safeJoin(path.join(ROOT, 'out'), rel);
        if (!full) { res.writeHead(400); return res.end('bad path'); }
        fs.mkdirSync(path.dirname(full), { recursive: true });
        const chunks = [];
        for await (const c of req) chunks.push(c);
        fs.writeFileSync(full, Buffer.concat(chunks));
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, bytes: chunks.reduce((a, c) => a + c.length, 0) }));
      }

      let p = decodeURIComponent(url.pathname);
      if (p === '/') p = '/index.html';
      const full = safeJoin(STATIC_ROOT, p);
      if (!full || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        res.writeHead(404); return res.end('not found: ' + p);
      }
      const ext = path.extname(full).toLowerCase();
      const stat = fs.statSync(full);
      const headers = {
        'content-type': MIME[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
      };
      // Range support (audio/video scrubbing in the demo)
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m[1] ? parseInt(m[1]) : 0;
        const end = m[2] ? parseInt(m[2]) : stat.size - 1;
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
        return fs.createReadStream(full, { start, end }).pipe(res);
      }
      res.writeHead(200, { ...headers, 'content-length': stat.size, 'accept-ranges': 'bytes' });
      fs.createReadStream(full).pipe(res);
    } catch (e) {
      res.writeHead(500); res.end(String(e && e.stack || e));
    }
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      if (!opts.quiet) console.log(`serving ${STATIC_ROOT} at http://localhost:${port}`);
      resolve({ server, port, close: () => new Promise(r => server.close(r)) });
    });
  });
}

/** Start on the first free port at or after `port`. */
export async function startServerAuto(opts = {}) {
  let port = opts.port ?? 5173;
  for (let i = 0; i < 40; i++) {
    try { return await startServer({ ...opts, port: port + i }); }
    catch (e) { if (e.code !== 'EADDRINUSE') throw e; }
  }
  throw new Error('no free port');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv.find(a => a.startsWith('--port='));
  startServer({ port: arg ? parseInt(arg.split('=')[1]) : 5173 }).then(s => {
    console.log(`open http://localhost:${s.port}/`);
  });
}
