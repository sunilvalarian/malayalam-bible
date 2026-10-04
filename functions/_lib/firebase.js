// Firebase access for the Pages Functions (passkeys, AI translation): service-account OAuth token,
// Firestore REST, Firebase custom tokens, ID-token checks. Configuration (Cloudflare Pages → Settings
// → Variables and Secrets):
//   FIREBASE_SERVICE_ACCOUNT  the service-account key JSON (Firebase console → Project settings →
//                             Service accounts → Generate new private key). Plain or base64.
//   PASSKEY_SECRET            optional HMAC key for the stateless challenge tokens
//   FIREBASE_PROJECT_ID       optional; defaults to the service account's project_id
// Local testing with the Firebase emulators instead:
//   FIREBASE_EMULATOR_HOST_FIRESTORE=127.0.0.1:8080  FIREBASE_PROJECT_ID=demo-bible

import { enc, dec, b64url, b64decode, b64urlDecode, pemToDer, hmacKey, hmacSign } from './util.js';

const CUSTOM_TOKEN_AUD = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

let cfgCache = null;       // { raw, cfg }
let tokenCache = null;     // { email, value, exp }
let keyCache = null;       // { id, key }

// → { emulator, projectId, base, sa? } or null when passkeys are not configured
export function getConfig(env) {
  env = env || {};
  const emu = env.FIREBASE_EMULATOR_HOST_FIRESTORE;
  if (emu && env.FIREBASE_PROJECT_ID && LOCAL_HOST.test(emu)) {
    const projectId = env.FIREBASE_PROJECT_ID;
    return { emulator: true, projectId, base: `http://${emu}/v1/projects/${projectId}/databases/(default)/documents` };
  }
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const key = raw + '|' + (env.FIREBASE_PROJECT_ID || '');
  if (cfgCache && cfgCache.raw === key) return cfgCache.cfg;
  let sa;
  try {
    const text = String(raw).trim();
    sa = JSON.parse(text.startsWith('{') ? text : dec.decode(b64decode(text)));
  } catch (e) {
    console.error('FIREBASE_SERVICE_ACCOUNT is not valid JSON');
    return null;
  }
  if (!sa || !sa.client_email || !sa.private_key) return null;
  const projectId = env.FIREBASE_PROJECT_ID || sa.project_id;
  if (!projectId) return null;
  const cfg = { emulator: false, projectId, sa, base: `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents` };
  cfgCache = { raw: key, cfg };
  return cfg;
}

// HMAC key for the challenge tokens
export async function challengeKey(cfg, env) {
  if (env && env.PASSKEY_SECRET) return hmacKey(env.PASSKEY_SECRET);
  if (cfg.emulator) return hmacKey('passkey-emulator:' + cfg.projectId);
  const k = await hmacKey(cfg.sa.private_key);
  return hmacKey(await hmacSign(k, 'passkey-challenge:' + (cfg.sa.private_key_id || cfg.sa.client_email)));
}

async function signingKey(sa) {
  const id = sa.private_key_id || sa.client_email;
  if (keyCache && keyCache.id === id) return keyCache.key;
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  keyCache = { id, key };
  return key;
}

export async function signJwt(sa, payload) {
  const header = { alg: 'RS256', typ: 'JWT' };
  if (sa.private_key_id) header.kid = sa.private_key_id;
  const data = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', await signingKey(sa), enc.encode(data));
  return data + '.' + b64url(sig);
}

// Google OAuth access token for Firestore, cached until shortly before it expires
async function accessToken(cfg) {
  if (cfg.emulator) return 'owner';            // the emulator treats "Bearer owner" as an admin
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.email === cfg.sa.client_email && tokenCache.exp - 60 > now) return tokenCache.value;
  const assertion = await signJwt(cfg.sa, {
    iss: cfg.sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(assertion),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('oauth token: ' + res.status + ' ' + (j.error || ''));
  tokenCache = { email: cfg.sa.client_email, value: j.access_token, exp: now + (j.expires_in || 3600) };
  return j.access_token;
}

// ---- Firestore REST ----
export function decodeValue(v) {
  if (!v || typeof v !== 'object') return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields || {});
  return undefined;
}
export function decodeFields(fields) {
  const o = {};
  for (const [k, v] of Object.entries(fields || {})) o[k] = decodeValue(v);
  return o;
}
const docUrl = (cfg, path) => cfg.base + '/' + path.split('/').map(encodeURIComponent).join('/');

async function fsFetch(cfg, url, init) {
  const headers = Object.assign({ Authorization: 'Bearer ' + (await accessToken(cfg)) }, (init && init.headers) || {});
  return fetch(url, Object.assign({}, init, { headers }));
}

// → plain object, or null if the document doesn't exist
export async function fsGet(cfg, path) {
  const res = await fsFetch(cfg, docUrl(cfg, path));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('firestore get ' + path + ': ' + res.status);
  const d = await res.json();
  return decodeFields(d.fields);
}

// plain JS value → Firestore REST value (integers stay integers; Date → timestamp)
export function encodeValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  return { mapValue: { fields: encodeFields(v) } };
}
export function encodeFields(o) {
  const f = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) f[k] = encodeValue(v);
  return f;
}

// a field path from map keys: parts.p1, chapters.`1SA_3` (keys that aren't plain names are quoted)
export const fieldPath = (...keys) => keys.map((k) => (/^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : '`' + k.replace(/[`\\]/g, '\\$&') + '`')).join('.');
const splitPath = (fp) => (fp.match(/`(?:[^`\\]|\\.)*`|[^.]+/g) || []).map((s) => (s[0] === '`' ? s.slice(1, -1).replace(/\\(.)/g, '$1') : s));

// update the given fields of a document (keys are field paths, see fieldPath); a value of undefined
// removes that field. mustExist = false creates the document if it isn't there yet.
export async function fsUpdate(cfg, path, fields, { mustExist = true } = {}) {
  const qs = Object.keys(fields).map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(k)).join('&');
  // a dotted key is a field path in the mask, but the body holds it as nested maps
  const body = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    const segs = splitPath(k);
    let o = body;
    for (const s of segs.slice(0, -1)) {
      o[s] = o[s] || { mapValue: { fields: {} } };
      o = o[s].mapValue.fields;
    }
    o[segs[segs.length - 1]] = v;
  }
  const res = await fsFetch(cfg, docUrl(cfg, path) + '?' + qs + (mustExist ? '&currentDocument.exists=true' : ''), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: body }),
  });
  if (!res.ok) throw new Error('firestore update ' + path + ': ' + res.status);
}

// create or replace a whole document
export async function fsSet(cfg, path, fields) {
  const res = await fsFetch(cfg, docUrl(cfg, path), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error('firestore set ' + path + ': ' + res.status);
}

// create a document; false if it already exists
export async function fsCreate(cfg, collection, id, fields) {
  const res = await fsFetch(cfg, docUrl(cfg, collection) + '?documentId=' + encodeURIComponent(id), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error('firestore create ' + collection + ': ' + res.status);
  return true;
}

// ---- Firebase Auth ID tokens (the page sends auth.currentUser.getIdToken()) ----
const ID_TOKEN_KEYS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
let idKeysCache = null;    // { keys: Map<kid, CryptoKey>, exp }

async function idTokenKey(kid) {
  const now = Date.now();
  if (!idKeysCache || idKeysCache.exp < now || !idKeysCache.keys.has(kid)) {
    const res = await fetch(ID_TOKEN_KEYS);
    if (!res.ok) throw new Error('id token keys: ' + res.status);
    const j = await res.json();
    const keys = new Map();
    for (const k of j.keys || []) {
      keys.set(k.kid, await crypto.subtle.importKey('jwk', k, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    }
    const maxAge = +((res.headers.get('cache-control') || '').match(/max-age=(\d+)/) || [])[1] || 3600;
    idKeysCache = { keys, exp: now + maxAge * 1000 };
  }
  return idKeysCache.keys.get(kid) || null;
}

// → { uid, email, verified } for a valid, unexpired ID token of this project; null otherwise
export async function verifyIdToken(cfg, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, claims;
  try {
    header = JSON.parse(dec.decode(b64urlDecode(parts[0])));
    claims = JSON.parse(dec.decode(b64urlDecode(parts[1])));
  } catch (e) { return null; }
  if (cfg.emulator) {
    // the Auth emulator signs nothing (alg "none"); only accepted against a local emulator
    if (header.alg !== 'none') return null;
  } else {
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
    const key = await idTokenKey(header.kid);
    if (!key) return null;
    let ok = false;
    try { ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), enc.encode(parts[0] + '.' + parts[1])); } catch (e) { ok = false; }
    if (!ok) return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== cfg.projectId || claims.iss !== 'https://securetoken.google.com/' + cfg.projectId) return null;
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) return null;
  if (!(claims.exp > now) || !(claims.iat <= now + 300)) return null;
  return { uid: claims.sub, email: String(claims.email || '').toLowerCase(), verified: claims.email_verified === true };
}

// ---- Firebase Auth custom token (signed in with auth.signInWithCustomToken on the page) ----
export async function customToken(cfg, uid) {
  const now = Math.floor(Date.now() / 1000);
  if (cfg.emulator) {
    // the Auth emulator accepts unsigned custom tokens
    const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
      iss: 'firebase-auth-emulator@example.com', sub: 'firebase-auth-emulator@example.com',
      aud: CUSTOM_TOKEN_AUD, iat: now, exp: now + 3600, uid,
    }));
    return header + '.' + payload + '.';
  }
  return signJwt(cfg.sa, { iss: cfg.sa.client_email, sub: cfg.sa.client_email, aud: CUSTOM_TOKEN_AUD, iat: now, exp: now + 3600, uid });
}
