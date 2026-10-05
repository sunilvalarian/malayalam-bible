// POST /api/sources/upload?book=MAT&chapter=5&name=<file name>&note=<optional note>
//   headers: Authorization: Bearer <Firebase ID token>, Content-Type: text/plain
//   body:    the file, base64 encoded (the browser encodes it, so this function only checks it)
//   → { path } (201)  or  { error } with 4xx / 5xx
// Keeps a source document (PDF, Word, photo of a printed page …) in the repository, under
// tools/uploads/<BOOK>/[<chapter>/]<time>-<name>, for turning into text later (see CLAUDE.md).
// Same permission as uploading a chapter in the app: editors / admins, or every signed-in user
// who isn't blocked while an admin has opened upload to everyone (settings/permissions.openUpload).
//
// Configuration (Cloudflare Pages → Settings → Variables and Secrets):
//   GITHUB_TOKEN   fine-grained personal access token, only this repository, Contents: read and write
//   GITHUB_REPO    optional, default sunilvalarian/malayalam-bible
//   GITHUB_BRANCH  optional, default main
//   FIREBASE_PROJECT_ID  optional, default malayalam-bible-app
// The commits start with [CF-Pages-Skip], so they don't redeploy the site.
// tools/dev-server.mjs passes LOCAL_STORE instead: the file is written into this folder on disk.

import { json, dec, b64urlDecode } from '../../_lib/util.js';

const MAX_BYTES = 15 * 1024 * 1024;
const MAX_B64 = Math.ceil(MAX_BYTES / 3) * 4;
const EXT = /\.(pdf|docx?|odt|rtf|txt|jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i;
const ROOT_DIR = 'tools/uploads';
const ROLE_RANK = { none: 0, reader: 1, editor: 2, admin: 3 };
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

let jwksCache = null;      // { keys: Map(kid → CryptoKey), exp }

class Fail extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status || 400; }
}
const check = (cond, code, status) => { if (!cond) throw new Fail(code, status); };

// "അധ്യായം 5.pdf" stays readable; path separators, control and shell-special characters go
export function safeName(name) {
  const n = String(name || '').normalize('NFC')
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^[.\s]+/, '');
  const m = n.match(/^(.*?)(\.[A-Za-z0-9]{1,8})?$/);
  const base = m[1].trim().slice(0, 80).trim() || 'file';
  return base + (m[2] || '').toLowerCase();
}

// 2026-10-05T14:32:10.123Z → 20261005-143210
const stamp = (d) => d.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

export function uploadPath(book, chapter, name, date) {
  return [ROOT_DIR, book].concat(chapter ? [String(chapter)] : []).join('/') + '/' + stamp(date) + '-' + safeName(name);
}

function firebaseConfig(env) {
  const projectId = env.FIREBASE_PROJECT_ID || 'malayalam-bible-app';
  const emu = env.FIREBASE_EMULATOR_HOST_FIRESTORE;
  if (emu && LOCAL_HOST.test(emu)) return { emulator: true, projectId, base: `http://${emu}/v1/projects/${projectId}/databases/(default)/documents` };
  return { emulator: false, projectId, base: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents` };
}

// Google's current keys for Firebase ID tokens, cached as long as Google says
async function signingKeys() {
  if (jwksCache && jwksCache.exp > Date.now()) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  check(res.ok, 'auth-keys-unavailable', 503);
  const j = await res.json();
  const keys = new Map();
  for (const k of j.keys || []) {
    keys.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  const age = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  jwksCache = { keys, exp: Date.now() + (age ? +age[1] : 3600) * 1000 };
  return keys;
}

// a Firebase ID token → its claims (the emulator's tokens are unsigned)
async function verifyIdToken(token, cfg) {
  const parts = token.split('.');
  check(parts.length === 3, 'bad-token', 401);
  let header, claims;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    claims = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  } catch (e) { throw new Fail('bad-token', 401); }
  if (!cfg.emulator) {
    check(header.alg === 'RS256', 'bad-token', 401);
    let key = (await signingKeys()).get(header.kid);
    if (!key) { jwksCache = null; key = (await signingKeys()).get(header.kid); }   // keys were rotated
    check(key, 'bad-token', 401);
    let ok = false;
    try { ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])); } catch (e) { /* bad signature */ }
    check(ok, 'bad-token', 401);
  }
  const now = Math.floor(Date.now() / 1000);
  check(claims.aud === cfg.projectId && claims.iss === 'https://securetoken.google.com/' + cfg.projectId, 'bad-token', 401);
  check(typeof claims.sub === 'string' && claims.sub && claims.sub.length <= 128, 'bad-token', 401);
  check(typeof claims.exp === 'number' && claims.exp > now, 'token-expired', 401);
  check(typeof claims.iat === 'number' && claims.iat <= now + 300, 'bad-token', 401);
  return claims;
}

// read a document as the user (the security rules apply): plain fields, or null
async function readAsUser(cfg, token, path) {
  const res = await fetch(cfg.base + '/' + path, { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 404) return null;
  check(res.ok, res.status === 401 || res.status === 403 ? 'bad-token' : 'firestore-' + res.status, res.status === 401 || res.status === 403 ? 401 : 502);
  const d = await res.json();
  const out = {};
  for (const [k, v] of Object.entries(d.fields || {})) out[k] = v.stringValue !== undefined ? v.stringValue : v.booleanValue;
  return out;
}

// the signed-in user's e-mail, if they may upload (same rule as the app's can('upload'))
async function authorize(request, env) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    // the local dev server on this computer: the app's local owner (no Firebase) has no token
    check(env.LOCAL_STORE && env.LOCAL_TRUSTED, 'sign-in-required', 401);
    return 'local';
  }
  const cfg = firebaseConfig(env);
  const claims = await verifyIdToken(token, cfg);
  const [profile, settings] = await Promise.all([readAsUser(cfg, token, 'users/' + claims.sub), readAsUser(cfg, token, 'settings/permissions')]);
  const role = (profile && profile.role) || 'none';
  const allowed = ROLE_RANK[role] >= ROLE_RANK.editor || (ROLE_RANK[role] >= ROLE_RANK.reader && !!settings && settings.openUpload === true);
  check(allowed, 'permission-denied', 403);
  return String(claims.email || claims.sub);
}

async function saveToGitHub(env, path, b64, message) {
  check(env.GITHUB_TOKEN, 'not-configured', 503);
  const repo = env.GITHUB_REPO || 'sunilvalarian/malayalam-bible';
  const url = `https://api.github.com/repos/${repo}/contents/` + path.split('/').map(encodeURIComponent).join('/');
  // the base64 text goes in as it is (checked by the caller): no second copy through JSON.stringify
  const body = JSON.stringify({ message, branch: env.GITHUB_BRANCH || 'main' }).slice(0, -1) + ',"content":"' + b64 + '"}';
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'malayalam-bible-uploads', 'Content-Type': 'application/json',
      },
      body,
    });
    if (res.ok) return path;
    if (res.status === 422) return null;           // a file with this name is already there
    // 409: another upload moved the branch at the same moment — try again
    if (res.status === 409 && attempt < 2) { await new Promise((r) => setTimeout(r, 400 * (attempt + 1))); continue; }
    console.error('github', res.status, (await res.text().catch(() => '')).slice(0, 300));
    throw new Fail('github-' + res.status, 502);
  }
}

export async function onRequestPost({ request, env }) {
  env = env || {};
  try {
    const url = new URL(request.url);
    const q = (k) => (url.searchParams.get(k) || '').trim();
    const book = q('book').toUpperCase();
    const chapter = q('chapter');
    const name = safeName(q('name'));
    const note = q('note').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').slice(0, 500);
    check(/^[A-Z0-9]{2,16}$/.test(book), 'bad-book');
    check(!chapter || (/^\d{1,3}$/.test(chapter) && +chapter >= 1 && +chapter <= 150), 'bad-chapter');
    check(EXT.test(name), 'bad-type', 415);
    check(+(request.headers.get('content-length') || 0) <= MAX_B64, 'too-large', 413);

    const who = await authorize(request, env);

    // one pass over the text (the free plan allows a function ~10 ms of CPU): the app sends no line breaks
    const b64 = await request.text();
    check(b64.length <= MAX_B64, 'too-large', 413);
    check(b64.length > 0 && b64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(b64), 'bad-content');

    const message = `[CF-Pages-Skip] Source upload ${book}${chapter ? ' ' + +chapter : ''}: ${name}\n\nUploaded by: ${who}` + (note ? `\nNote: ${note}` : '');
    const date = new Date();
    // phone cameras call every photo image.jpg: a name that is taken gets -2, -3 …
    for (let n = 1; n <= 5; n++) {
      const path = uploadPath(book, chapter ? +chapter : 0, n === 1 ? name : name.replace(/(\.[a-z0-9]+)?$/, '-' + n + '$1'), date);
      // LOCAL_STORE / saveToGitHub → the saved path, or null when that name is taken
      const saved = typeof env.LOCAL_STORE === 'function'
        ? await env.LOCAL_STORE(path, b64, message)
        : await saveToGitHub(env, path, b64, message);
      if (saved) return json({ path: saved }, 201);
    }
    throw new Fail('exists', 409);
  } catch (e) {
    if (e instanceof Fail) return json({ error: e.code }, e.status);
    console.error(e);
    return json({ error: 'server-error' }, 500);
  }
}
