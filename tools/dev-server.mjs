// Local stand-in for Cloudflare Pages: serves app/ at http://localhost:<port>/ (like the
// published site) and runs the Pages Functions in functions/ (passkey API, AI translation).
// Node 20+. /api/translate needs `npm install` in the repository root (the Claude SDK) and
// ANTHROPIC_API_KEY; the other functions use no npm packages.
//
//   node tools/dev-server.mjs [port]                    (default port 8788)
//
// Passkey API environment (same names as the Cloudflare Pages variables):
//   with the Firebase emulators (firebase emulators:start --only auth,firestore --project demo-bible):
//     FIREBASE_EMULATOR_HOST_FIRESTORE=127.0.0.1:8080 FIREBASE_PROJECT_ID=demo-bible node tools/dev-server.mjs
//     then open http://localhost:8788/?emulator  and  http://localhost:8788/admin.html?emulator
//   against a real project: FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}' PASSKEY_SECRET=...
// Use "localhost", not 127.0.0.1: browsers refuse passkeys on an IP address.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'app');
const port = +(process.argv[2] || process.env.PORT || 8788);

// functions/*.js use ES module syntax without a package.json "type": load them as modules
register('data:text/javascript,' + encodeURIComponent(`
  export async function load(url, context, next) {
    if (url.startsWith('file:') && /[\\\\/]functions[\\\\/].*\\.js$/.test(decodeURIComponent(url))) {
      const r = await next(url, { ...context, format: 'module' });
      return { ...r, format: 'module' };
    }
    return next(url, context);
  }`));

const ROUTES = {
  '/api/passkey/challenge': 'functions/api/passkey/challenge.js',
  '/api/passkey/verify': 'functions/api/passkey/verify.js',
  '/api/where': 'functions/api/where.js',
  '/api/translate': 'functions/api/translate.js',
};
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
};

async function runFunction(file, req, body) {
  const mod = await import(pathToFileURL(path.join(ROOT, file)).href);
  const method = req.method.toUpperCase();
  const name = 'onRequest' + method[0] + method.slice(1).toLowerCase();
  const handler = mod[name] || mod.onRequest;
  if (!handler) return new Response('Method Not Allowed', { status: 405 });
  const url = `http://${req.headers.host || 'localhost:' + port}${req.url}`;
  // the client address, like Cloudflare's CF-Connecting-IP (for /api/where)
  const headers = Object.assign({}, req.headers, { 'x-real-ip': req.socket.remoteAddress || '' });
  const request = new Request(url, { method, headers, body: ['GET', 'HEAD'].includes(method) ? undefined : body });
  return handler({ request, env: process.env, params: {}, waitUntil() {}, next() {} });
}

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (ROUTES[pathname]) {
      const r = await runFunction(ROUTES[pathname], req, body);
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      console.log(req.method, pathname, r.status);
      return;
    }
    let p = pathname;
    if (p.endsWith('/')) p += 'index.html';
    else if (!path.extname(p)) p += '.html';          // Pages "pretty URLs": /admin → admin.html
    const file = path.join(APP, p);
    if (!file.startsWith(APP + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch (e) {
    if (e.code === 'ENOENT') { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('server error');
  }
}).listen(port, () => {
  const mode = process.env.FIREBASE_EMULATOR_HOST_FIRESTORE ? 'Firebase emulator ' + process.env.FIREBASE_EMULATOR_HOST_FIRESTORE
    : process.env.FIREBASE_SERVICE_ACCOUNT ? 'service account' : 'not configured (503)';
  console.log(`Serving app/ on http://localhost:${port}/  — passkey API: ${mode}`);
});
