// functions/api/translate.js — POST /api/translate (AI translation, Cloudflare Pages Function), and
// the ID-token check in functions/_lib/firebase.js.
// The function files are copied into a temp folder that declares "type": "module" (as in
// where.test.mjs), with the repository root's node_modules linked in for the Claude SDK
// (`npm install` in the repository root). Firestore REST and the Claude API are faked through fetch.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './lib/env.mjs';

const SDK = path.join(ROOT, 'node_modules', '@anthropic-ai', 'sdk');
const haveSdk = fs.existsSync(SDK);
const PROJECT = 'demo-bible';
const ENV = { ANTHROPIC_API_KEY: 'sk-test', FIREBASE_EMULATOR_HOST_FIRESTORE: '127.0.0.1:8080', FIREBASE_PROJECT_ID: PROJECT };
const FS_BASE = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/`;

let dir, translate, firebase;
before(async () => {
  if (!haveSdk) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-test-'));
  for (const d of ['api', '_lib']) fs.mkdirSync(path.join(dir, d));
  fs.copyFileSync(path.join(ROOT, 'functions', 'api', 'translate.js'), path.join(dir, 'api', 'translate.js'));
  for (const f of ['util.js', 'firebase.js']) fs.copyFileSync(path.join(ROOT, 'functions', '_lib', f), path.join(dir, '_lib', f));
  fs.writeFileSync(path.join(dir, 'package.json'), '{ "type": "module" }');
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
  translate = await import(pathToFileURL(path.join(dir, 'api', 'translate.js')).href);
  firebase = await import(pathToFileURL(path.join(dir, '_lib', 'firebase.js')).href);
});
after(() => { if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

// ---- fake Firestore (REST, emulator paths) ----
const decode = (v) => {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  throw new Error('unknown value ' + JSON.stringify(v));
};
const encode = (v) => {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
};

let docs, claudeCalls, claudeReply, fetchLog;
const realFetch = globalThis.fetch;

// Claude's answer for the verses asked for (the prompt lists them after "Translate …:")
const verseAnswer = (prompt) => {
  const want = (prompt.match(/: ([\d, ]+)\./) || [])[1].split(',').map((s) => +s.trim());
  return { verses: want.map((v) => ({ v, heading: v === 1 ? 'സൃഷ്ടി' : '', text: `AI വാക്യം ${v}` })) };
};
const message = (obj, extra = {}) => Object.assign({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: JSON.stringify(obj) }],
  stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
}, extra);

function fakeFetch(url, init = {}) {
  url = String(url);
  const method = (init.method || 'GET').toUpperCase();
  fetchLog.push({ url, method });
  const reply = (status, body) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  if (url.startsWith('https://api.anthropic.com/')) {
    const body = JSON.parse(init.body);
    const headers = new Headers(init.headers);
    claudeCalls.push({ body, headers });
    const r = claudeReply(body.messages[0].content, body);
    return reply(r.status || 200, r.body || r);
  }
  if (url.startsWith(FS_BASE)) {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname.slice(new URL(FS_BASE).pathname.length));
    if (method === 'GET') return docs.has(p) ? reply(200, { fields: docs.get(p) }) : reply(404, {});
    if (method === 'PATCH') {
      const mask = u.searchParams.getAll('updateMask.fieldPaths');
      const fields = JSON.parse(init.body).fields;
      if (!mask.length) { docs.set(p, fields); return reply(200, {}); }
      if (u.searchParams.get('currentDocument.exists') === 'true' && !docs.has(p)) return reply(404, {});
      const cur = decode({ mapValue: { fields: docs.get(p) || {} } });
      const body = decode({ mapValue: { fields } });
      // Firestore semantics: a masked path missing from the body is removed
      for (const fp of mask) {
        const segs = fp.match(/`[^`]*`|[^.]+/g).map((s) => s.replace(/`/g, ''));
        let src = body, dst = cur;
        for (const s of segs.slice(0, -1)) { src = src && src[s]; dst = dst[s] = dst[s] || {}; }
        const last = segs[segs.length - 1];
        if (src && last in src) dst[last] = src[last]; else delete dst[last];
      }
      docs.set(p, encode(cur).mapValue.fields);
      return reply(200, {});
    }
  }
  return Promise.reject(new Error('unexpected fetch ' + method + ' ' + url));
}

const emulatorToken = (uid, email = uid + '@example.com') => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return b({ alg: 'none', typ: 'JWT' }) + '.' + b({ iss: 'https://securetoken.google.com/' + PROJECT, aud: PROJECT, sub: uid, email, email_verified: true, iat: now, exp: now + 3600 }) + '.';
};
const setUser = (uid, role) => docs.set('users/' + uid, encode({ email: uid + '@example.com', role }).mapValue.fields);
const stored = (id) => (docs.has('aiTranslations/' + id) ? decode({ mapValue: { fields: docs.get('aiTranslations/' + id) } }) : null);
const index = () => (docs.has('aiIndex/chapters') ? decode({ mapValue: { fields: docs.get('aiIndex/chapters') } }).chapters || {} : null);

const VERSES = Array.from({ length: 30 }, (_, i) => i + 1);
async function call(body, { token = emulatorToken('ed1'), env = ENV } = {}) {
  const request = new Request('https://bible.example.org/api/translate', {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
    body: JSON.stringify(Object.assign({ book: 'GEN', chapter: 1, verses: VERSES, names: { ml: 'ഉത്പത്തി', en: 'Genesis' }, part: 0 }, body)),
  });
  const res = await translate.onRequestPost({ request, env });
  return { status: res.status, body: await res.json() };
}

describe('functions/api/translate.js', { skip: !haveSdk && 'run `npm install` in the repository root (Claude SDK)' }, () => {
  beforeEach(() => {
    docs = new Map();
    claudeCalls = [];
    fetchLog = [];
    claudeReply = (prompt) => message(verseAnswer(prompt));
    globalThis.fetch = fakeFetch;
    setUser('ed1', 'editor');
    setUser('rd1', 'reader');
    setUser('ad1', 'admin');
  });
  after(() => { globalThis.fetch = realFetch; });

  test('not configured without ANTHROPIC_API_KEY → 503', async () => {
    const { status, body } = await call({}, { env: Object.assign({}, ENV, { ANTHROPIC_API_KEY: '' }) });
    assert.equal(status, 503);
    assert.equal(body.error, 'translate-not-configured');
    assert.equal(claudeCalls.length, 0);
  });

  test('needs a valid ID token of an editor / admin', async () => {
    assert.equal((await call({}, { token: '' })).status, 401);
    assert.equal((await call({}, { token: 'not.a.token' })).status, 401);
    const wrongProject = emulatorToken('ed1').split('.');
    wrongProject[1] = Buffer.from(JSON.stringify({ iss: 'https://securetoken.google.com/other', aud: 'other', sub: 'ed1', iat: 1, exp: 9e9 })).toString('base64url');
    assert.equal((await call({}, { token: wrongProject.join('.') })).status, 401);
    const r = await call({}, { token: emulatorToken('rd1') });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'not-allowed');
    assert.equal((await call({}, { token: emulatorToken('nobody') })).status, 403);
    assert.equal(claudeCalls.length, 0);
    assert.equal((await call({}, { token: emulatorToken('ad1') })).status, 200);
  });

  test('validates the request', async () => {
    for (const bad of [
      { book: 'gen' }, { book: 'GENESIS' }, { chapter: 0 }, { chapter: 1.5 }, { verses: [] }, { verses: [2, 1] },
      { verses: [1, 1] }, { verses: [0, 1] }, { part: 3 }, { part: -1 }, { names: {} },
    ]) {
      const r = await call(bad);
      assert.equal(r.status, 400, JSON.stringify(bad));
    }
    assert.equal(claudeCalls.length, 0);
  });

  test('translates a chapter in parts and stores it in aiTranslations/GEN_1', async () => {
    const r0 = await call({ part: 0 });
    assert.equal(r0.status, 200);
    assert.equal(r0.body.nParts, 3);
    assert.equal(r0.body.done, false);
    assert.match(r0.body.runId, /^[0-9a-f]{16}$/);
    // verse 1: heading, then the verse starting a paragraph
    assert.deepEqual(r0.body.items.slice(0, 3), [{ h: 'സൃഷ്ടി' }, { v: 1, t: 'AI വാക്യം 1', p: 1 }, { v: 2, t: 'AI വാക്യം 2' }]);
    assert.equal(r0.body.items.filter((x) => x.v).length, 12);

    // the Claude request: model, effort, structured output, server-side fallback
    const c0 = claudeCalls[0];
    assert.equal(c0.body.model, 'claude-opus-5-5');
    assert.equal(c0.body.output_config.effort, 'medium');
    assert.equal(c0.body.output_config.format.type, 'json_schema');
    assert.equal(c0.body.fallbacks, 'default');
    assert.match(c0.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
    assert.equal(c0.headers.get('x-api-key'), 'sk-test');
    assert.ok(!('thinking' in c0.body) && !('temperature' in c0.body));
    assert.match(c0.body.messages[0].content, /Genesis \(ഉത്പത്തി\), chapter 1/);
    assert.match(c0.body.messages[0].content, /Translate verses 1–12: 1, 2, 3/);

    let doc = stored('GEN_1');
    assert.equal(doc.runId, r0.body.runId);
    assert.equal(doc.nParts, 3);
    assert.equal(doc.verses, 30);
    assert.equal(doc.done, false);
    assert.equal(doc.createdBy, 'ed1@example.com');
    assert.deepEqual(doc.parts.p0, r0.body.items);
    assert.deepEqual(index(), {});                      // not finished: not in the list

    const r1 = await call({ part: 1, runId: r0.body.runId });
    assert.equal(r1.status, 200);
    assert.deepEqual(r1.body.items.map((x) => x.v), [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    // continuity: the last verses of the part before are in the prompt
    assert.match(claudeCalls[1].body.messages[0].content, /10 AI വാക്യം 10\n11 AI വാക്യം 11\n12 AI വാക്യം 12/);
    const r2 = await call({ part: 2, runId: r0.body.runId });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.done, true);

    doc = stored('GEN_1');
    assert.equal(doc.done, true);
    assert.deepEqual(Object.keys(doc.parts).sort(), ['p0', 'p1', 'p2']);
    assert.deepEqual([...doc.parts.p0, ...doc.parts.p1, ...doc.parts.p2].filter((x) => x.v).map((x) => x.v), VERSES);
    assert.equal(doc.createdBy, 'ed1@example.com');     // later parts don't touch the rest
    // finished: listed in aiIndex/chapters
    const ix = index();
    assert.deepEqual(Object.keys(ix), ['GEN_1']);
    assert.equal(ix.GEN_1.book, 'GEN');
    assert.equal(ix.GEN_1.chapter, 1);
    assert.equal(ix.GEN_1.verses, 30);
    assert.equal(ix.GEN_1.model, 'claude-opus-5-5');
  });

  test('the list of finished chapters: kept per chapter, out while a chapter is made again', async () => {
    await call({ verses: [1, 2] });
    await call({ book: '1SA', chapter: 3, names: { ml: '1 സാമുവൽ', en: '1 Samuel' }, verses: [1, 2, 3] });   // key needs quoting
    assert.deepEqual(Object.keys(index()).sort(), ['1SA_3', 'GEN_1']);
    assert.equal(index()['1SA_3'].verses, 3);
    // GEN 1 made again in 3 parts: out of the list until the last part, the other chapter stays
    const r0 = await call({ force: true });
    assert.deepEqual(Object.keys(index()), ['1SA_3']);
    await call({ part: 1, runId: r0.body.runId });
    assert.deepEqual(Object.keys(index()), ['1SA_3']);
    await call({ part: 2, runId: r0.body.runId });
    assert.deepEqual(Object.keys(index()).sort(), ['1SA_3', 'GEN_1']);
    assert.equal(index().GEN_1.verses, 30);
  });

  test('a finished translation is replaced only with force', async () => {
    const r0 = await call({ verses: [1, 2, 3] });
    assert.equal(r0.body.done, true);
    const again = await call({ verses: [1, 2, 3] });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'exists');
    assert.equal(claudeCalls.length, 1);
    const forced = await call({ verses: [1, 2, 3], force: true });
    assert.equal(forced.status, 200);
    assert.notEqual(forced.body.runId, r0.body.runId);
    assert.equal(stored('GEN_1').runId, forced.body.runId);
  });

  test('later parts must belong to the current run and come in order', async () => {
    const r0 = await call({});
    assert.equal((await call({ part: 1, runId: 'ffffffffffffffff' })).body.error, 'superseded');
    assert.equal((await call({ part: 2, runId: r0.body.runId })).body.error, 'out-of-order');
    // another editor restarted the chapter while Claude worked on part 1: part 1 is not stored
    claudeReply = (prompt) => {
      const d = stored('GEN_1');
      docs.set('aiTranslations/GEN_1', encode(Object.assign(d, { runId: 'aaaaaaaaaaaaaaaa' })).mapValue.fields);
      return message(verseAnswer(prompt));
    };
    const r1 = await call({ part: 1, runId: r0.body.runId });
    assert.equal(r1.status, 409);
    assert.equal(r1.body.error, 'superseded');
    assert.equal(stored('GEN_1').parts.p1, undefined);
  });

  test('a missing verse, a refusal or cut-off output is an error, nothing stored', async () => {
    claudeReply = () => message({ verses: [{ v: 1, heading: '', text: 'x' }] });
    assert.deepEqual(await call({ verses: [1, 2] }), { status: 502, body: { error: 'bad-output' } });
    claudeReply = () => message({ verses: [] }, { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: null } });
    assert.deepEqual(await call({ verses: [1, 2] }), { status: 422, body: { error: 'refused' } });
    claudeReply = (p) => message(verseAnswer(p), { stop_reason: 'max_tokens' });
    assert.deepEqual(await call({ verses: [1, 2] }), { status: 502, body: { error: 'too-long' } });
    claudeReply = () => message('not json');
    assert.equal((await call({ verses: [1, 2] })).body.error, 'bad-output');
    assert.equal(stored('GEN_1'), null);
  });

  test('after a fallback only the text after the switch point is used', async () => {
    claudeReply = (p) => message(null, {
      model: 'claude-opus-4-8',
      content: [{ type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-4-8' } }, { type: 'text', text: JSON.stringify(verseAnswer(p)) }],
    });
    const r = await call({ verses: [1, 2] });
    assert.equal(r.status, 200);
    assert.equal(r.body.model, 'claude-opus-4-8');
    assert.equal(stored('GEN_1').model, 'claude-opus-4-8');
  });

  test('API errors: bad key → not configured, rate limit / overload → busy', async () => {
    claudeReply = () => ({ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } });
    assert.deepEqual(await call({}), { status: 503, body: { error: 'translate-not-configured' } });
    claudeReply = () => ({ status: 429, body: { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } } });
    assert.deepEqual(await call({}), { status: 429, body: { error: 'busy' } });
    claudeReply = () => ({ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } } });
    assert.deepEqual(await call({}), { status: 503, body: { error: 'busy' } });
    assert.equal(stored('GEN_1'), null);
  });
});

describe('functions/_lib/firebase.js verifyIdToken (production keys)', { skip: !haveSdk && 'run `npm install` in the repository root' }, () => {
  const cfg = { emulator: false, projectId: 'prod-bible' };
  let keyPair, kid = 'key-1', otherPair;
  before(async () => {
    const alg = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
    keyPair = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
    otherPair = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
    const jwk = Object.assign(await crypto.subtle.exportKey('jwk', keyPair.publicKey), { kid, alg: 'RS256', use: 'sig' });
    globalThis.fetch = async (url) => {
      assert.match(String(url), /securetoken@system\.gserviceaccount\.com/);
      return new Response(JSON.stringify({ keys: [jwk] }), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=20000' } });
    };
  });
  after(() => { globalThis.fetch = realFetch; });

  const sign = async (claims, { header = { alg: 'RS256', kid, typ: 'JWT' }, key = keyPair.privateKey } = {}) => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = b(header) + '.' + b(claims);
    const sig = Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data))).toString('base64url');
    return data + '.' + sig;
  };
  const now = () => Math.floor(Date.now() / 1000);
  const good = () => ({ iss: 'https://securetoken.google.com/prod-bible', aud: 'prod-bible', sub: 'u1', email: 'A@Example.com', email_verified: true, iat: now() - 10, exp: now() + 3000 });

  test('a valid token → uid, lower-case e-mail, verified', async () => {
    assert.deepEqual(await firebase.verifyIdToken(cfg, await sign(good())), { uid: 'u1', email: 'a@example.com', verified: true });
  });
  test('rejects: other project, expired, no subject, wrong key, unknown kid, alg none', async () => {
    assert.equal(await firebase.verifyIdToken(cfg, await sign(Object.assign(good(), { aud: 'other' }))), null);
    assert.equal(await firebase.verifyIdToken(cfg, await sign(Object.assign(good(), { iss: 'https://securetoken.google.com/other' }))), null);
    assert.equal(await firebase.verifyIdToken(cfg, await sign(Object.assign(good(), { exp: now() - 1 }))), null);
    assert.equal(await firebase.verifyIdToken(cfg, await sign(Object.assign(good(), { sub: '' }))), null);
    assert.equal(await firebase.verifyIdToken(cfg, await sign(good(), { key: otherPair.privateKey })), null);
    assert.equal(await firebase.verifyIdToken(cfg, await sign(good(), { header: { alg: 'RS256', kid: 'nope' } })), null);
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    assert.equal(await firebase.verifyIdToken(cfg, b({ alg: 'none' }) + '.' + b(good()) + '.'), null);
    assert.equal(await firebase.verifyIdToken(cfg, 'garbage'), null);
  });
});
