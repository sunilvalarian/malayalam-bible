// functions/api/sources/upload.js — POST /api/sources/upload (Cloudflare Pages Function).
// Copied into a temp folder that declares "type": "module" (like where.test.mjs). Firestore,
// Google's token keys and GitHub are replaced by a fake fetch.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/env.mjs';

const PROJECT = 'malayalam-bible-app';
let dir, mod;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sources-test-'));
  fs.mkdirSync(path.join(dir, 'api', 'sources'), { recursive: true });
  fs.mkdirSync(path.join(dir, '_lib'));
  fs.copyFileSync(path.join(ROOT, 'functions', 'api', 'sources', 'upload.js'), path.join(dir, 'api', 'sources', 'upload.js'));
  fs.copyFileSync(path.join(ROOT, 'functions', '_lib', 'util.js'), path.join(dir, '_lib', 'util.js'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }');
  mod = await import(pathToFileURL(path.join(dir, 'api', 'sources', 'upload.js')).href);
});
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); });

const b64url = (x) => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
const now = () => Math.floor(Date.now() / 1000);
const claims = (over = {}) => Object.assign({
  iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub: 'uid123', email: 'ed@example.org',
  iat: now() - 10, exp: now() + 3600,
}, over);
// the Auth emulator's tokens: unsigned
const emuToken = (over) => b64url({ alg: 'none', typ: 'JWT' }) + '.' + b64url(claims(over)) + '.';
const EMU = { FIREBASE_EMULATOR_HOST_FIRESTORE: '127.0.0.1:8080' };
const CONTENT = Buffer.from('%PDF-1.4 test').toString('base64');

// fake network: Firestore documents, Google's keys, GitHub
let docs, jwks, github;
beforeEach(() => {
  docs = { 'users/uid123': { role: { stringValue: 'editor' } } };
  jwks = { keys: [] };
  github = { calls: [], taken: new Set() };
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.startsWith('https://www.googleapis.com/')) return new Response(JSON.stringify(jwks), { headers: { 'cache-control': 'max-age=60' } });
    const fsm = url.match(/\/documents\/(.+)$/);
    if (fsm) {
      if (!/^Bearer \S+/.test(init.headers && init.headers.Authorization)) return new Response('{}', { status: 401 });
      const d = docs[fsm[1]];
      return d ? new Response(JSON.stringify({ fields: d })) : new Response('{}', { status: 404 });
    }
    if (url.startsWith('https://api.github.com/')) {
      github.calls.push({ url, init, body: JSON.parse(init.body) });
      if (github.taken.has(url)) return new Response(JSON.stringify({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }), { status: 422 });
      if (github.reject) return new Response(JSON.stringify({ message: 'Repository rule violations found' }), { status: 422 });
      return new Response('{}', { status: 201 });
    }
    throw new Error('unexpected fetch ' + url);
  };
});

async function call({ query = 'book=MAT&chapter=5&name=page.jpg', body = CONTENT, token, env = {} } = {}) {
  const headers = { 'Content-Type': 'text/plain' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const request = new Request('https://bible.example.org/api/sources/upload?' + query, { method: 'POST', headers, body });
  const res = await mod.onRequestPost({ request, env });
  return { status: res.status, body: await res.json() };
}

function localStore() {
  const saved = new Map();
  const fn = async (p, b64, message) => { if (saved.has(p)) return null; saved.set(p, { b64, message }); return p; };
  return { saved, fn };
}

describe('functions/api/sources/upload.js', () => {
  test('safeName keeps Malayalam names, drops path and special characters', () => {
    assert.equal(mod.safeName('അധ്യായം 5.pdf'), 'അധ്യായം 5.pdf');
    assert.equal(mod.safeName('../../etc/passwd.PDF'), 'etc passwd.pdf');
    assert.equal(mod.safeName('a\\b:c*?"<>|.jpg'), 'a b c.jpg');
    assert.equal(mod.safeName('...'), 'file');
    assert.equal(mod.safeName('x'.repeat(200) + '.png'), 'x'.repeat(80) + '.png');
  });
  test('uploadPath: tools/uploads/<BOOK>/[<chapter>/]<time>-<name>', () => {
    const d = new Date(Date.UTC(2026, 9, 5, 14, 32, 10));
    assert.equal(mod.uploadPath('MAT', 5, 'page.jpg', d), 'tools/uploads/MAT/5/20261005-143210-page.jpg');
    assert.equal(mod.uploadPath('GEN', 0, 'a.pdf', d), 'tools/uploads/GEN/20261005-143210-a.pdf');
  });

  test('dev server on this computer: no token needed, file goes to LOCAL_STORE', async () => {
    const st = localStore();
    const r = await call({ query: 'book=mat&chapter=5&name=' + encodeURIComponent('അധ്യായം 5.pdf') + '&note=pages%2024-26', env: { LOCAL_STORE: st.fn, LOCAL_TRUSTED: true } });
    assert.equal(r.status, 201);
    assert.match(r.body.path, /^tools\/uploads\/MAT\/5\/\d{8}-\d{6}-അധ്യായം 5\.pdf$/);
    const s = st.saved.get(r.body.path);
    assert.equal(s.b64, CONTENT);
    assert.match(s.message, /^\[CF-Pages-Skip\] Source upload MAT 5: അധ്യായം 5\.pdf\n\nUploaded by: local\nNote: pages 24-26$/);
  });
  test('a name already taken gets -2, -3 …; after 5 tries → 409', async () => {
    const tried = [];
    const taken = (free) => async (p) => { tried.push(p); return free.test(p) ? p : null; };
    let r = await call({ env: { LOCAL_STORE: taken(/-page-3\.jpg$/), LOCAL_TRUSTED: true } });
    assert.equal(r.status, 201);
    assert.deepEqual(tried.map((p) => p.replace(/.*\d{6}-/, '')), ['page.jpg', 'page-2.jpg', 'page-3.jpg']);
    r = await call({ env: { LOCAL_STORE: taken(/^$/), LOCAL_TRUSTED: true } });
    assert.deepEqual(r, { status: 409, body: { error: 'exists' } });
  });
  test('no token from another computer → 401', async () => {
    const st = localStore();
    assert.deepEqual(await call({ env: { LOCAL_STORE: st.fn, LOCAL_TRUSTED: false } }), { status: 401, body: { error: 'sign-in-required' } });
    assert.deepEqual(await call({ env: { GITHUB_TOKEN: 't' } }), { status: 401, body: { error: 'sign-in-required' } });
    assert.equal(st.saved.size, 0);
  });
  test('checks book, chapter, file type and content', async () => {
    const env = { LOCAL_STORE: localStore().fn, LOCAL_TRUSTED: true };
    assert.equal((await call({ env, query: 'book=M/T&name=a.pdf' })).body.error, 'bad-book');
    assert.equal((await call({ env, query: 'book=MAT&chapter=0&name=a.pdf' })).body.error, 'bad-chapter');
    assert.equal((await call({ env, query: 'book=MAT&chapter=5x&name=a.pdf' })).body.error, 'bad-chapter');
    assert.deepEqual(await call({ env, query: 'book=MAT&name=run.exe' }), { status: 415, body: { error: 'bad-type' } });
    assert.equal((await call({ env, body: 'not base64!' })).body.error, 'bad-content');
    assert.equal((await call({ env, body: '' })).body.error, 'bad-content');
    assert.equal((await call({ env, body: 'abc"}' })).body.error, 'bad-content');
    assert.equal((await call({ env, body: 'ab=c' })).body.error, 'bad-content');
    assert.equal((await call({ env, body: 'a===' })).body.error, 'bad-content');
    assert.equal((await call({ env, body: 'QUJ\nDQQ=' })).body.error, 'bad-content');
    for (const ok of ['QQ==', 'QUI=', 'QUJD']) assert.equal((await call({ env, body: ok })).status, 201, ok);
  });

  test('editor (emulator token) → committed on GitHub without a redeploy', async () => {
    const r = await call({ token: emuToken(), env: Object.assign({ GITHUB_TOKEN: 'ghp_x' }, EMU), query: 'book=MAT&chapter=17&name=' + encodeURIComponent('പേജ് 24.jpg') });
    assert.equal(r.status, 201);
    assert.equal(github.calls.length, 1);
    const c = github.calls[0];
    assert.match(c.url, /^https:\/\/api\.github\.com\/repos\/sunilvalarian\/malayalam-bible\/contents\/tools\/uploads\/MAT\/17\/\d{8}-\d{6}-%E0%B4%AA/);
    assert.equal(c.init.method, 'PUT');
    assert.equal(c.init.headers.Authorization, 'Bearer ghp_x');
    assert.ok(c.init.headers['User-Agent']);
    assert.deepEqual(Object.keys(c.body), ['message', 'branch', 'content']);
    assert.equal(c.body.content, CONTENT);
    assert.equal(c.body.branch, 'main');
    assert.match(c.body.message, /^\[CF-Pages-Skip\] Source upload MAT 17: പേജ് 24\.jpg\n\nUploaded by: ed@example\.org$/);
  });
  test('GITHUB_REPO / GITHUB_BRANCH; 422 (name taken) → -2', async () => {
    const env = Object.assign({ GITHUB_TOKEN: 't', GITHUB_REPO: 'me/repo', GITHUB_BRANCH: 'uploads' }, EMU);
    github.taken = { has: (u) => !/-2\.jpg$/.test(u) };
    const r = await call({ token: emuToken(), env });
    assert.equal(r.status, 201);
    assert.match(r.body.path, /-page-2\.jpg$/);
    assert.equal(github.calls.length, 2);
    assert.match(github.calls[1].url, /^https:\/\/api\.github\.com\/repos\/me\/repo\/contents\//);
    assert.equal(github.calls[1].body.branch, 'uploads');
  });
  test('another 422 (wrong branch, a ruleset) → github-422, not "name taken"', async () => {
    github.reject = true;
    assert.deepEqual(await call({ token: emuToken(), env: Object.assign({ GITHUB_TOKEN: 't' }, EMU) }), { status: 502, body: { error: 'github-422' } });
    assert.equal(github.calls.length, 1);
  });
  test('more than 2 MB → 413 too-large', async () => {
    const env = { LOCAL_STORE: localStore().fn, LOCAL_TRUSTED: true };
    assert.deepEqual(await call({ env, body: 'A'.repeat(Math.ceil(2 * 1024 * 1024 / 3) * 4 + 4) }), { status: 413, body: { error: 'too-large' } });
  });
  test('without GITHUB_TOKEN → 503 not-configured', async () => {
    assert.deepEqual(await call({ token: emuToken(), env: EMU }), { status: 503, body: { error: 'not-configured' } });
  });
  test('reader: only while upload is open to everyone; blocked never', async () => {
    const env = Object.assign({ GITHUB_TOKEN: 't' }, EMU);
    docs['users/uid123'] = { role: { stringValue: 'reader' } };
    assert.deepEqual(await call({ token: emuToken(), env }), { status: 403, body: { error: 'permission-denied' } });
    docs['settings/permissions'] = { openUpload: { booleanValue: true } };
    assert.equal((await call({ token: emuToken(), env })).status, 201);
    docs['users/uid123'] = { role: { stringValue: 'none' } };
    assert.equal((await call({ token: emuToken(), env })).status, 403);
    delete docs['users/uid123'];
    assert.equal((await call({ token: emuToken(), env })).status, 403);
    assert.equal(github.calls.length, 1);
  });
  test('token for another project, expired, or not a JWT → 401', async () => {
    const env = Object.assign({ GITHUB_TOKEN: 't' }, EMU);
    assert.equal((await call({ token: emuToken({ aud: 'evil' }), env })).body.error, 'bad-token');
    assert.equal((await call({ token: emuToken({ iss: 'https://securetoken.google.com/evil' }), env })).body.error, 'bad-token');
    assert.equal((await call({ token: emuToken({ exp: now() - 5 }), env })).body.error, 'token-expired');
    assert.equal((await call({ token: emuToken({ sub: '' }), env })).body.error, 'bad-token');
    assert.equal((await call({ token: 'abc', env })).body.error, 'bad-token');
    assert.equal(github.calls.length, 0);
  });

  test('production: the token must be signed by one of Google\'s keys', async () => {
    const { subtle } = globalThis.crypto;
    const pair = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    jwks = { keys: [Object.assign(await subtle.exportKey('jwk', pair.publicKey), { kid: 'k1', alg: 'RS256', use: 'sig' })] };
    const sign = async (kid, c, key = pair.privateKey) => {
      const data = b64url({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + b64url(c);
      return data + '.' + Buffer.from(await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data))).toString('base64url');
    };
    const env = { GITHUB_TOKEN: 't' };
    assert.equal((await call({ token: await sign('k1', claims()), env })).status, 201);
    // unknown key, unsigned, tampered claims, someone else's key
    assert.equal((await call({ token: await sign('k2', claims()), env })).status, 401);
    assert.equal((await call({ token: emuToken(), env })).status, 401);
    const good = (await sign('k1', claims())).split('.');
    assert.equal((await call({ token: [good[0], b64url(claims({ sub: 'other' })), good[2]].join('.'), env })).status, 401);
    const other = await subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign']);
    assert.equal((await call({ token: await sign('k1', claims(), other.privateKey), env })).status, 401);
    assert.equal(github.calls.length, 1);
  });
});
