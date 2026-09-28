// app/js/usage.js — what is recorded: early events, event shape, sessions, logins, reading time, errors.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadUsage, makeCloud, lsGet, lsSet, seedEvent, settle, readApp,
  USER_A, USER_B, T0, MIN, HOUR, Q_KEY, UID_KEY, DEVICE_KEY, SESSION_KEY,
} from './lib/env.mjs';

// Cloud already knows the sign-in when usage.js loads (no 'auth' event needed)
function signedIn(opts = {}) {
  const cloud = makeCloud({ ready: true, authKnown: true, user: opts.user === undefined ? USER_A : opts.user, role: 'reader' });
  const store = opts.store || new Map();
  if (!store.has(UID_KEY)) lsSet(store, UID_KEY, cloud.user ? cloud.user.uid : '');
  return loadUsage(Object.assign({}, opts, { store, cloud }));
}
const names = (q) => q.map((e) => e.e);
const last = (env) => env.queue().at(-1);

describe('usage.js: disabled without Cloud', () => {
  for (const [label, cloud] of [['no window.Cloud', null], ['Cloud.available false', { available: false }]]) {
    test(label + ' → window.Usage is a no-op stub', async () => {
      const env = loadUsage({ cloud });
      const U = env.Usage;
      assert.equal(U.enabled, false);
      assert.doesNotThrow(() => { U.track('x', { a: 1 }); U.view('GEN', 1); });
      const p = U.flush();
      assert.ok(p && typeof p.then === 'function');
      await p;
      assert.equal(env.store.size, 0, 'nothing written to localStorage');
      assert.deepEqual(Object.keys(env.winListeners), []);
      assert.deepEqual(Object.keys(env.docListeners), []);
      assert.equal(env.fetchCalls.length, 0);
    });
  }
});

describe('usage.js: device id', () => {
  test('a 20-character id is created once and kept', () => {
    const env = loadUsage();
    assert.match(env.Usage.deviceId, /^[A-Za-z0-9]{20}$/);
    assert.equal(lsGet(env.store, DEVICE_KEY), env.Usage.deviceId);
    const env2 = loadUsage({ store: env.store });
    assert.equal(env2.Usage.deviceId, env.Usage.deviceId);
  });
  test('an invalid stored id is replaced', () => {
    const store = new Map();
    lsSet(store, DEVICE_KEY, 'short');
    const env = loadUsage({ store });
    assert.match(env.Usage.deviceId, /^[A-Za-z0-9]{20}$/);
    assert.notEqual(env.Usage.deviceId, 'short');
  });
});

describe('usage.js: events before the sign-in state is known', () => {
  test('wait in memory, then belong to the uid of the first auth event', () => {
    const env = loadUsage();
    env.Usage.track('search', { q: 'സ്നേഹം' });
    assert.equal(env.store.has(Q_KEY), false, 'not queued before authKnown');
    env.clock.jump(1000);
    env.cloud.signIn(USER_A);
    const q = env.queue();
    assert.deepEqual(names(q), ['open', 'search', 'login']);
    assert.ok(q.every((e) => e.u === USER_A.uid));
    assert.equal(q[1].q, 'സ്നേഹം');
  });
  test('a visitor (auth null) gets them with uid ""', () => {
    const env = loadUsage();
    env.cloud.ready = true; env.cloud.authKnown = true;
    env.cloud.emit('auth', null);
    const q = env.queue();
    assert.deepEqual(names(q), ['open']);
    assert.equal(q[0].u, '');
    assert.equal(lsGet(env.store, UID_KEY), '');
  });
  test('pagehide before auth releases them to the last known uid', () => {
    const store = new Map();
    lsSet(store, UID_KEY, USER_B.uid);
    const env = loadUsage({ store });
    env.Usage.track('copy', { b: 'JHN', c: 3 });
    env.fireWindow('pagehide');
    const q = env.queue();
    assert.deepEqual(names(q), ['open', 'copy']);
    assert.ok(q.every((e) => e.u === USER_B.uid));
    // the later auth doesn't re-attribute them
    env.cloud.signIn(USER_B);
    assert.ok(env.queue().every((e) => e.u === USER_B.uid));
  });
  test('pagehide before auth on a device never signed in → uid ""', () => {
    const env = loadUsage();
    env.fireWindow('pagehide');
    assert.deepEqual(env.queue().map((e) => e.u), ['']);
  });
});

describe('usage.js: event shape', () => {
  test('k, e, t, s, net + data; long values clipped to 200, null/"" dropped', () => {
    const env = signedIn();
    env.clock.jump(1234);
    env.Usage.track('highlight', {
      b: 'GEN', c: 0, ok: true, off: false, long: 'x'.repeat(300), nul: null, und: undefined, empty: '',
      obj: { a: 1 }, big: { s: 'y'.repeat(300) },
    });
    const ev = last(env);
    assert.match(ev.k, /^[A-Za-z0-9]{8}$/);
    assert.equal(ev.e, 'highlight');
    assert.equal(ev.t, T0 + 1234);
    assert.ok(Number.isInteger(ev.t));
    assert.match(ev.s, /^[A-Za-z0-9]{10}$/);
    assert.equal(ev.net, 1);
    assert.equal(ev.u, USER_A.uid);
    assert.equal(ev.b, 'GEN');
    assert.equal(ev.c, 0);
    assert.equal(ev.ok, true);
    assert.equal(ev.off, false);
    assert.equal(ev.long.length, 200);
    assert.equal(ev.obj, '{"a":1}');
    assert.equal(ev.big.length, 200);
    for (const k of ['nul', 'und', 'empty']) assert.equal(k in ev, false, k);
    assert.equal('pg' in ev, false, 'reader page has no pg');
  });
  test('event name clipped to 24 characters; net 0 when offline', () => {
    const env = signedIn();
    env.navigator.onLine = false;
    env.Usage.track('e'.repeat(40));
    const ev = last(env);
    assert.equal(ev.e.length, 24);
    assert.equal(ev.net, 0);
  });
  test('keys are unique', () => {
    const env = signedIn();
    for (let i = 0; i < 50; i++) env.Usage.track('x');
    const ks = env.queue().map((e) => e.k);
    assert.equal(new Set(ks).size, ks.length);
  });
  test('open event: page, hash, installed, external referrer host only', () => {
    const env = signedIn({ referrer: 'https://www.google.com/search?q=bible', hash: '#GEN.1', standalone: true });
    const open = env.queue()[0];
    assert.equal(open.e, 'open');
    assert.equal(open.page, 'reader');
    assert.equal(open.hash, '#GEN.1');
    assert.equal(open.installed, true);
    assert.equal(open.ref, 'www.google.com');
    const env2 = signedIn({ referrer: 'https://bible.example.org/admin.html' });
    assert.equal('ref' in env2.queue()[0], false, 'same-origin referrer not recorded');
    assert.equal(env2.queue()[0].installed, false);
  });
  test('admin page: page "admin" and pg:"admin" on every event', () => {
    for (const pathname of ['/admin.html', '/admin']) {
      const env = signedIn({ pathname });
      env.Usage.track('admin', { sec: 'usage' });
      const q = env.queue();
      assert.equal(q[0].page, 'admin');
      assert.ok(q.every((e) => e.pg === 'admin'), pathname);
    }
  });
  test('data cannot overwrite the reserved fields k, e, t, s, net, u, pg', () => {
    const env = signedIn();
    env.clock.jump(500);
    env.Usage.track('setting', { k: 'font', e: 'ee', t: 'tt', s: 'ss', net: 7, u: 'someone', pg: 'admin', key: 'font', val: '20' });
    const ev = last(env);
    assert.match(ev.k, /^[A-Za-z0-9]{8}$/, 'internal key kept');
    assert.equal(ev.e, 'setting');
    assert.equal(ev.t, T0 + 500);
    assert.match(ev.s, /^[A-Za-z0-9]{10}$/);
    assert.equal(ev.net, 1);
    assert.equal(ev.u, USER_A.uid);
    assert.equal('pg' in ev, false);
    assert.deepEqual([ev.key, ev.val], ['font', '20']);
  });
  test('app.js tracks settings as { key, val } and admin.js reads e.key', () => {
    assert.match(readApp('app.js'), /Usage\.track\('setting', \{ key: /);
    assert.match(readApp('admin.js'), /case 'setting':[^\n]*e\.key/);
  });
});

describe('usage.js: sessions', () => {
  test('same session while active; new one after 30 minutes idle; kept across reloads', () => {
    const env = signedIn();
    const s0 = env.queue()[0].s;
    env.clock.jump(29 * MIN);
    env.Usage.track('a');
    env.clock.jump(29 * MIN);   // 58 min after start, but only 29 min idle
    env.Usage.track('b');
    env.clock.jump(30 * MIN + 1);
    env.Usage.track('c');
    const q = env.queue();
    assert.deepEqual(q.map((e) => e.s), [s0, s0, s0, q[3].s]);
    assert.notEqual(q[3].s, s0);
    assert.equal(lsGet(env.store, SESSION_KEY).id, q[3].s);
    // reload within 30 minutes: same session
    env.clock.jump(5 * MIN);
    const env2 = signedIn({ store: env.store, clock: env.clock });
    assert.equal(env2.queue().at(-1).s, q[3].s);
  });
});

describe('usage.js: logins', () => {
  test('first sign-in on this device → login { m, first: true }', () => {
    const env = loadUsage();
    env.cloud.signIn(USER_A);
    const ev = last(env);
    assert.equal(ev.e, 'login');
    assert.equal(ev.m, 'google.com');
    assert.equal(ev.first, true);
    assert.equal(ev.u, USER_A.uid);
    assert.equal(lsGet(env.store, UID_KEY), USER_A.uid);
  });
  test('switching account → login without first', () => {
    const store = new Map();
    lsSet(store, UID_KEY, USER_A.uid);
    const env = loadUsage({ store });
    env.cloud.signIn(USER_B);
    const ev = last(env);
    assert.equal(ev.e, 'login');
    assert.equal(ev.m, 'password');
    assert.equal('first' in ev, false);
    assert.equal(ev.u, USER_B.uid);
  });
  test('restored session of the same account → no login event', () => {
    const store = new Map();
    lsSet(store, UID_KEY, USER_A.uid);
    const env = loadUsage({ store });
    env.cloud.signIn(USER_A);
    assert.deepEqual(names(env.queue()), ['open']);
  });
  test('signing in after having signed out ("") → login without first', () => {
    const store = new Map();
    lsSet(store, UID_KEY, '');
    const env = loadUsage({ store });
    env.cloud.signIn(USER_A);
    const ev = last(env);
    assert.equal(ev.e, 'login');
    assert.equal('first' in ev, false);
  });
  test('auth becomes null without the logout hook → signed-out', () => {
    const store = new Map();
    lsSet(store, UID_KEY, USER_A.uid);
    const env = loadUsage({ store });
    env.cloud.ready = true;
    env.cloud.signOutNow();
    const ev = last(env);
    assert.equal(ev.e, 'signed-out');
    assert.equal(ev.u, '', 'recorded as the visitor that is now using the device');
    assert.equal(lsGet(env.store, UID_KEY), '');
  });
  test('visitor stays visitor → no event', () => {
    const store = new Map();
    lsSet(store, UID_KEY, '');
    const env = loadUsage({ store });
    env.cloud.ready = true;
    env.cloud.signOutNow();
    assert.deepEqual(names(env.queue()), ['open']);
  });
  test('logout hook: closes reading, tracks logout, uploads everything; no signed-out afterwards', async () => {
    const env = loadUsage();
    env.cloud.signIn(USER_A);
    await settle();   // the flush started by the auth event has finished
    env.Usage.view('PSA', 23);
    env.clock.jump(40 * 1000);
    await env.cloud.logout();
    await settle();
    assert.equal(env.cloud.calls.length, 1);
    const { doc } = env.cloud.calls[0];
    assert.deepEqual(doc.events.map((e) => e.e), ['open', 'login', 'read', 'logout']);
    assert.equal(doc.events[2].sec, 40);
    assert.equal(doc.uid, USER_A.uid);
    assert.equal(env.cloud.stored.size, 1, 'accepted by the rules mirror');
    assert.deepEqual(env.queue(), []);
    assert.equal(lsGet(env.store, UID_KEY), '');
    assert.equal(env.queue().some((e) => e.e === 'signed-out'), false);
  });
  test('role event', () => {
    const env = signedIn();
    env.cloud.role = 'editor';
    env.cloud.emit('role', 'editor');
    assert.equal(last(env).e, 'role');
    assert.equal(last(env).r, 'editor');
  });
});

describe('usage.js: reading time', () => {
  const reads = (env) => env.queue().filter((e) => e.e === 'read');
  test('switching chapter records the previous one in seconds', () => {
    const env = signedIn();
    env.Usage.view('GEN', 1);
    env.clock.jump(10 * 1000);
    env.Usage.view('GEN', 1);          // same chapter again: no change
    env.clock.jump(5 * 1000);
    env.Usage.view('GEN', 2);
    const r = reads(env);
    assert.equal(r.length, 1);
    assert.equal(r[0].b, 'GEN');
    assert.equal(r[0].c, 1);
    assert.equal(r[0].sec, 15);
  });
  test('under 3 seconds is not recorded', () => {
    const env = signedIn();
    env.Usage.view('GEN', 1);
    env.clock.jump(2400);
    env.Usage.view('GEN', 2);
    assert.equal(reads(env).length, 0);
    env.clock.jump(3000);
    env.Usage.view('GEN', 3);
    assert.equal(reads(env).length, 1);
    assert.equal(reads(env)[0].sec, 3);
  });
  test('capped at 6 hours', () => {
    const env = signedIn();
    env.Usage.view('GEN', 1);
    env.clock.jump(9 * HOUR);
    env.Usage.view('GEN', 2);
    assert.equal(reads(env)[0].sec, 6 * 3600);
  });
  test('hidden pauses the timer, visible resumes it', () => {
    const env = signedIn();
    env.Usage.view('GEN', 1);
    env.clock.jump(10 * 1000);
    env.setVisibility('hidden');
    assert.deepEqual(reads(env).map((r) => r.sec), [10]);
    env.clock.jump(2 * HOUR);
    env.setVisibility('visible');
    env.clock.jump(7 * 1000);
    env.Usage.view('GEN', 2);
    assert.deepEqual(reads(env).map((r) => [r.c, r.sec]), [[1, 10], [1, 7]]);
  });
  test('page opened hidden (background tab): time counts from when it is shown', () => {
    const env = signedIn({ visibility: 'hidden' });
    env.Usage.view('GEN', 1);
    env.clock.jump(10 * MIN);
    env.setVisibility('visible');
    env.clock.jump(8 * 1000);
    env.Usage.view('GEN', 2);
    assert.deepEqual(reads(env).map((r) => r.sec), [8]);
  });
  test('pagehide records the chapter being read', () => {
    const env = signedIn();
    env.Usage.view('ROM', 8);
    env.clock.jump(20 * 1000);
    env.fireWindow('pagehide');
    assert.deepEqual(reads(env).map((r) => [r.b, r.c, r.sec]), [['ROM', 8, 20]]);
  });
  test('changing chapter while hidden records no extra read time', () => {
    const env = signedIn();
    env.Usage.view('GEN', 1);
    env.clock.jump(10 * 1000);
    env.setVisibility('hidden');          // records 10 s, keeps GEN 1 as a hidden segment
    env.clock.jump(HOUR);
    env.Usage.view('GEN', 2);             // e.g. hash change / restore while hidden
    assert.deepEqual(reads(env).map((r) => r.sec), [10]);
    env.setVisibility('visible');         // GEN 2 now counts
    env.clock.jump(4000);
    env.Usage.view('GEN', 3);
    assert.deepEqual(reads(env).map((r) => [r.c, r.sec]), [[1, 10], [2, 4]]);
  });
  test('opened hidden, chapter changed while hidden, never shown → nothing', () => {
    const env = signedIn({ visibility: 'hidden' });
    env.Usage.view('GEN', 1);
    env.clock.jump(HOUR);
    env.Usage.view('GEN', 2);
    env.fireWindow('pagehide');
    assert.deepEqual(reads(env), []);
  });
  test('sign-out while hidden records no read time', async () => {
    const env = signedIn({ visibility: 'hidden' });
    env.Usage.view('GEN', 1);
    env.clock.jump(HOUR);
    await Promise.all(env.cloud.hooks.map((fn) => fn()));
    assert.deepEqual(reads(env), []);
    assert.equal(env.cloud.calls.at(-1).doc.events.some((e) => e.e === 'read'), false);
  });
});

describe('usage.js: automatic events', () => {
  test('online / offline / install', () => {
    const env = signedIn();
    env.setOnline(false);
    env.setOnline(true);
    env.fireWindow('appinstalled');
    assert.deepEqual(names(env.queue()).slice(1), ['offline', 'online', 'install']);
    assert.equal(env.queue()[1].net, 0);
  });
  test('errors: message + file:line, at most 10 per page', () => {
    const env = signedIn();
    env.fireWindow('error', { message: 'Boom', filename: 'https://bible.example.org/js/app.js', lineno: 12 });
    env.fireWindow('error', {});   // no message: not recorded (but counted)
    env.fireWindow('unhandledrejection', { reason: { code: 'unavailable', message: 'x' } });
    env.fireWindow('unhandledrejection', { reason: 'plain' });
    for (let i = 0; i < 20; i++) env.fireWindow('error', { message: 'again ' + i });
    const errs = env.queue().filter((e) => e.e === 'error');
    assert.equal(errs.length, 9);   // 10 counted, one of them without a message
    assert.deepEqual([errs[0].msg, errs[0].at], ['Boom', 'app.js:12']);
    assert.equal(errs[1].msg, 'unavailable');
    assert.equal(errs[2].msg, 'plain');
  });
});
