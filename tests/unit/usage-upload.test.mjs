// app/js/usage.js — batching, timers, upload document, idempotent retries, queue limits.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadUsage, makeCloud, lsGet, lsSet, seedEvent, seedEvents, settle, usageProblems, GEO,
  USER_A, USER_B, T0, MIN, DAY, Q_KEY, SEND_KEY, UID_KEY,
} from './lib/env.mjs';

function signedIn(opts = {}) {
  const user = opts.user === undefined ? USER_A : opts.user;
  const cloud = makeCloud(Object.assign({ ready: true, authKnown: true, user, role: user ? 'reader' : 'none' }, opts.cloudOpts));
  const store = opts.store || new Map();
  if (!store.has(UID_KEY)) lsSet(store, UID_KEY, user ? user.uid : '');
  return loadUsage(Object.assign({}, opts, { store, cloud }));
}
const track = (env, n, name = 'x') => { for (let i = 0; i < n; i++) env.Usage.track(name, { i }); };
const sizes = (env) => env.cloud.calls.map((c) => c.doc.events.length);

describe('usage.js: batching thresholds (free plan)', () => {
  test('nothing uploads below 100 events; the 100th uploads after 1.5 s', async () => {
    const env = signedIn();
    track(env, 98);                       // + open = 99
    await env.clock.advance(5000);
    assert.equal(env.cloud.calls.length, 0);
    track(env, 1);                        // 100
    await env.clock.advance(1400);
    assert.equal(env.cloud.calls.length, 0);
    await env.clock.advance(200);
    assert.deepEqual(sizes(env), [100]);
    assert.deepEqual(env.queue(), []);
  });
  test('uploads once the oldest event is 15 minutes old', async () => {
    const env = signedIn();
    track(env, 3);
    await env.clock.advance(14 * MIN);
    assert.equal(env.cloud.calls.length, 0);
    await env.clock.advance(MIN + 2000);
    assert.deepEqual(sizes(env), [4]);
    assert.deepEqual(env.queue(), []);
  });
  test('hidden: uploads at 25 events, not at 24', async () => {
    const env = signedIn();
    track(env, 23);                       // 24
    env.setVisibility('hidden');
    await settle();
    assert.equal(env.cloud.calls.length, 0);
    env.setVisibility('visible');
    track(env, 1);                        // 25
    env.setVisibility('hidden');
    await settle();
    assert.deepEqual(sizes(env), [25]);
  });
  test('overdue events from the last visit go up as soon as the sign-in is known', async () => {
    const store = new Map();
    lsSet(store, UID_KEY, USER_A.uid);
    lsSet(store, Q_KEY, seedEvents(USER_A.uid, 3, T0 - 20 * MIN));
    const env = loadUsage({ store });
    env.cloud.signIn(USER_A);
    await settle();
    assert.deepEqual(sizes(env), [4]);
  });
  test("'online' tracks an event and uploads what is due", async () => {
    const env = signedIn({ online: false });
    assert.equal(env.fetchCalls.length, 0, 'no geo lookup while offline');
    track(env, 2);
    await env.clock.advance(20 * MIN);
    assert.equal(env.cloud.calls.length, 0, 'nothing while offline');
    env.setOnline(true);
    await settle();
    assert.equal(env.cloud.calls.length, 1);
    assert.deepEqual(env.cloud.calls[0].doc.events.map((e) => e.e), ['open', 'x', 'x', 'online']);
    assert.equal(env.fetchCalls.length, 1, 'geo looked up when back online');
  });
  test('Usage.flush() uploads everything now', async () => {
    const env = signedIn();
    track(env, 2);
    await env.Usage.flush();
    assert.deepEqual(sizes(env), [3]);
    assert.deepEqual(env.queue(), []);
    assert.equal(env.sending(), null);
  });
  test('no upload while Cloud is not ready, the sign-in is unknown, or offline', async () => {
    for (const [label, patch] of [['not ready', { ready: false }], ['auth unknown', { authKnown: false }]]) {
      const env = signedIn({ cloudOpts: patch });
      await env.Usage.flush();
      assert.equal(env.cloud.calls.length, 0, label);
    }
    const env = signedIn();
    env.navigator.onLine = false;
    await env.Usage.flush();
    assert.equal(env.cloud.calls.length, 0, 'offline');
  });
  test("'ready' event: flush with the normal thresholds", async () => {
    const store = new Map();
    lsSet(store, Q_KEY, seedEvents(USER_A.uid, 2, T0 - 30 * MIN));
    const env = signedIn({ store, cloudOpts: { ready: false } });
    await env.Usage.flush();
    assert.equal(env.cloud.calls.length, 0);
    env.cloud.ready = true;
    env.cloud.emit('ready');
    await settle();
    assert.deepEqual(sizes(env), [3]);
  });
  test('two flushes at once share one upload', async () => {
    const env = signedIn();
    const p1 = env.Usage.flush();
    const p2 = env.Usage.flush();
    assert.equal(p1, p2);
    await p1;
    assert.equal(env.cloud.calls.length, 1);
  });
  test('Web Locks: another tab uploading → this tab skips', async () => {
    const requests = [];
    const locks = { held: false, request(name, opts, cb) { requests.push([name, opts]); return Promise.resolve(cb(this.held ? null : { name })); } };
    const env = signedIn({ locks });
    locks.held = true;
    await env.Usage.flush();
    assert.equal(env.cloud.calls.length, 0);
    locks.held = false;
    await env.Usage.flush();
    assert.equal(env.cloud.calls.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), ['mlb-usage-upload', { ifAvailable: true }]);   // cross-realm object
  });
});

describe('usage.js: timers (no polling)', () => {
  test('one timer, due when the oldest event is 15 min old (+1 s); none while hidden', async () => {
    const env = signedIn();
    let due = env.dueTimers();
    assert.equal(due.length, 1);
    assert.equal(due[0].at, T0 + 15 * MIN + 1000);
    env.clock.jump(1000);
    track(env, 5);
    assert.equal(env.dueTimers().length, 1, 'more events: still one timer');
    env.setVisibility('hidden');
    assert.equal(env.clock.pending().length, 0, 'cleared when hidden');
    track(env, 2);
    assert.equal(env.clock.pending().length, 0, 'none scheduled while hidden');
    env.setVisibility('visible');
    due = env.dueTimers();
    assert.equal(due.length, 1);
    assert.equal(due[0].at, T0 + 15 * MIN + 1000);
  });
  test('at least 5 s when the oldest event is due very soon; nothing left after the upload', async () => {
    const store = new Map();
    lsSet(store, Q_KEY, seedEvents(USER_A.uid, 2, T0 - 15 * MIN + 2000));   // due in 3 s (+1 s)
    const env = signedIn({ store });
    const due = env.dueTimers();
    assert.equal(due.length, 1);
    assert.equal(due[0].ms, 5000);
    await env.clock.advance(5000);
    assert.deepEqual(sizes(env), [3]);
    assert.equal(env.clock.pending((t) => t.ms !== 20000).length, 0, 'only the finished upload timeout remains');
  });
  test('already overdue (an upload failed): retry after 5 minutes, not in a tight loop', async () => {
    const env = signedIn();
    env.cloud.mode = 'unavailable';
    await env.clock.advance(15 * MIN + 1000);        // due → fails
    assert.equal(env.cloud.calls.length, 1);
    let due = env.dueTimers();
    assert.equal(due.length, 1);
    assert.equal(due[0].ms, 5 * MIN);
    await env.clock.advance(5 * MIN);                // fails again → again in 5 min
    assert.equal(env.cloud.calls.length, 2);
    assert.equal(env.dueTimers()[0].ms, 5 * MIN);
    env.cloud.mode = 'ok';
    await env.clock.advance(5 * MIN);
    assert.equal(env.cloud.calls.length, 3);
    assert.equal(env.cloud.calls[2].id, env.cloud.calls[0].id, 'same batch id each time');
    assert.deepEqual(env.queue(), []);
    assert.equal(env.clock.pending((t) => t.ms !== 20000).length, 0);
  });
  test('no timer while offline, refused, or before Cloud is ready / the sign-in is known', async () => {
    for (const [label, patch] of [['not ready', { ready: false }], ['auth unknown', { authKnown: false }]]) {
      const env = signedIn({ cloudOpts: patch });
      env.Usage.track('x');
      assert.equal(env.clock.pending().length, 0, label);
    }
    const env = signedIn({ online: false });
    env.Usage.track('x');
    assert.equal(env.clock.pending().length, 0, 'offline');
    const env2 = signedIn({ cloudOpts: { mode: 'denied' } });
    await env2.Usage.flush();                        // refused
    env2.Usage.track('x');
    env2.setVisibility('hidden');
    env2.setVisibility('visible');
    assert.equal(env2.dueTimers().length, 0, 'refused');
  });
  test("'ready' after the auth event: a timer is armed by the next event", async () => {
    const env = loadUsage();
    env.cloud.authKnown = true; env.cloud.user = USER_A;
    env.cloud.emit('auth', USER_A);                  // ready still false
    await settle();
    assert.equal(env.dueTimers().length, 0);
    env.cloud.ready = true;
    env.cloud.emit('ready');
    await settle();
    env.Usage.track('x');
    assert.equal(env.dueTimers().length, 1);
  });
  test('no timer for events of another account', () => {
    const store = new Map();
    lsSet(store, Q_KEY, seedEvents(USER_B.uid, 2, T0 - 20 * MIN));
    const env = signedIn({ store, visibility: 'hidden' });
    env.setVisibility('visible');
    assert.equal(env.dueTimers()[0].at, T0 + 15 * MIN + 1000, 'timed by this account\'s own oldest event');
  });
  test('offline: the due timer fires once and is not re-armed; online uploads', async () => {
    const env = signedIn();
    env.navigator.onLine = false;
    await env.clock.advance(16 * MIN);
    const fired = env.clock.fired;
    await env.clock.advance(60 * MIN);
    assert.equal(env.clock.fired - fired, 0, 'no timer while offline');
    assert.equal(env.clock.pending().length, 0);
    env.setOnline(true);
    await settle();
    assert.equal(env.cloud.calls.length, 1);
  });
});

describe('usage.js: the uploaded document', () => {
  test('satisfies firestore.rules usageOk (signed in)', async () => {
    const env = signedIn();
    await settle();   // geo lookup done
    env.Usage.track('search', { q: 'ദൈവം', n: 12 });
    env.clock.jump(2000);
    env.Usage.track('copy', { b: 'JHN', c: 3, v: '16' });
    await env.Usage.flush();
    assert.equal(env.cloud.calls.length, 1);
    const { id, doc } = env.cloud.calls[0];
    assert.deepEqual(usageProblems(id, doc, USER_A), []);
    assert.equal(env.cloud.stored.size, 1);
    assert.deepEqual(Object.keys(doc).sort(), ['dev', 'device', 'email', 'events', 'from', 'geo', 'n', 'name', 'to', 'uid', 'v']);
    assert.equal('at' in doc, false, 'at is added by Cloud.saveUsage');
    assert.equal(doc.device, env.Usage.deviceId);
    assert.deepEqual([doc.uid, doc.email, doc.name], [USER_A.uid, USER_A.email, USER_A.name]);
    assert.equal(doc.n, 3);
    assert.deepEqual([doc.from, doc.to], [T0, T0 + 2000]);
    for (const ev of doc.events) {
      assert.equal('k' in ev, false);
      assert.equal('u' in ev, false);
      assert.ok(ev.e && Number.isInteger(ev.t) && ev.s && (ev.net === 1 || ev.net === 0));
    }
    assert.equal(doc.events[1].q, 'ദൈവം');
    assert.ok(Object.keys(doc.dev).length <= 20);
    assert.deepEqual(doc.geo, GEO);
  });
  test('visitor: uid, email and name null', async () => {
    const env = signedIn({ user: null });
    await env.Usage.flush();
    const { id, doc } = env.cloud.calls[0];
    assert.deepEqual([doc.uid, doc.email, doc.name], [null, null, null]);
    assert.deepEqual(usageProblems(id, doc, null), []);
    assert.equal(env.cloud.stored.size, 1);
  });
  test('no place known → geo null; long name clipped to 100; missing name → null', async () => {
    const env = signedIn({ user: Object.assign({}, USER_A, { name: 'n'.repeat(150) }), fetch: () => Promise.reject(new TypeError('offline')) });
    await env.Usage.flush();
    const { doc } = env.cloud.calls[0];
    assert.equal(doc.geo, null);
    assert.equal(doc.name.length, 100);
    const env2 = signedIn({ user: Object.assign({}, USER_A, { name: '' }) });
    await env2.Usage.flush();
    assert.equal(env2.cloud.calls[0].doc.name, null);
  });
  test('batches of at most 200; several batches in one flush', async () => {
    const store = new Map();
    lsSet(store, Q_KEY, seedEvents(USER_A.uid, 450, T0 - 2 * 3600 * 1000));
    const env = signedIn({ store });
    await env.Usage.flush();
    assert.deepEqual(sizes(env), [200, 200, 51]);
    assert.equal(new Set(env.cloud.calls.map((c) => c.id)).size, 3);
    for (const { id, doc } of env.cloud.calls) assert.deepEqual(usageProblems(id, doc, USER_A), []);
    assert.deepEqual(env.queue(), []);
    assert.equal(env.sending(), null);
  });
  test('one flush uploads a full queue (1500 events = 8 batches)', async () => {
    const store = new Map();
    lsSet(store, Q_KEY, seedEvents(USER_A.uid, 1700, T0 - 5 * 3600 * 1000));
    const env = signedIn({ store });                 // + open, capped to 1500
    assert.equal(env.queue().length, 1500);
    await env.Usage.flush();
    assert.deepEqual(sizes(env), [200, 200, 200, 200, 200, 200, 200, 100]);
    assert.deepEqual(env.queue(), []);
  });
  test('from/to are the min/max event time, whatever the queue order', async () => {
    const store = new Map();
    lsSet(store, Q_KEY, [seedEvent(USER_A.uid, T0 - 1000), seedEvent(USER_A.uid, T0 - 9000), seedEvent(USER_A.uid, T0 - 5000)]);
    const env = signedIn({ store });
    await env.Usage.flush();
    const { id, doc } = env.cloud.calls[0];
    assert.deepEqual([doc.from, doc.to], [T0 - 9000, T0]);
    assert.deepEqual(usageProblems(id, doc, USER_A), []);
  });
  test('from/to stay ordered when a second tab queued newer events before this tab knew the sign-in', async () => {
    const store = new Map();
    lsSet(store, UID_KEY, USER_A.uid);
    const env = loadUsage({ store });          // 'open' at T0 waits for the sign-in
    env.clock.jump(1000);
    lsSet(store, Q_KEY, [seedEvent(USER_A.uid, T0 + 1000)]);   // the other tab
    env.fireWindow('storage', { key: Q_KEY });
    env.clock.jump(1000);
    env.cloud.signIn(USER_A);
    await settle();
    await env.Usage.flush();
    const { id, doc } = env.cloud.calls[0];
    assert.deepEqual(usageProblems(id, doc, USER_A), []);
  });
});

describe('usage.js: idempotent retries', () => {
  const mineRec = (env, uid = USER_A.uid) => (env.sending() || {})[uid] || null;
  test('failed upload keeps the batch and resends it with the same id and events', async () => {
    const env = signedIn();
    track(env, 2);
    env.cloud.mode = 'unavailable';
    await env.Usage.flush();
    assert.equal(env.cloud.calls.length, 1);
    assert.equal(env.queue().length, 3);
    assert.deepEqual(Object.keys(env.sending()), [USER_A.uid], 'SEND_KEY is a map per account');
    const s = mineRec(env);
    assert.equal(s.id, env.cloud.calls[0].id);
    assert.equal(s.tries, 1);
    assert.deepEqual(s.keys, env.queue().map((e) => e.k));
    track(env, 1);                                     // a newer event is not added to that batch
    env.cloud.mode = 'ok';
    await env.Usage.flush();
    assert.equal(env.cloud.calls[1].id, env.cloud.calls[0].id);
    assert.deepEqual(env.cloud.calls[1].doc.events, env.cloud.calls[0].doc.events);
    assert.deepEqual(sizes(env), [3, 3, 1]);
    assert.deepEqual(env.queue(), []);
    assert.equal(env.sending(), null);
  });
  test('after a reload the batch is resent with the same id', async () => {
    const env = signedIn();
    track(env, 2);
    env.cloud.mode = 'unavailable';
    await env.Usage.flush();
    const first = env.cloud.calls[0];
    const env2 = signedIn({ store: env.store, clock: env.clock });   // reload: + a new 'open'
    await env2.Usage.flush();
    assert.equal(env2.cloud.calls[0].id, first.id);
    assert.deepEqual(env2.cloud.calls[0].doc.events, first.doc.events);
    assert.deepEqual(env2.cloud.calls.map((c) => c.doc.events.length), [3, 1]);
    assert.notEqual(env2.cloud.calls[1].id, first.id);
    assert.deepEqual(env2.queue(), []);
  });
  test('timeout (20 s) counts as a failure to retry', async () => {
    const env = signedIn();
    env.cloud.mode = 'hang';
    const p = env.Usage.flush();
    await env.clock.advance(20000);
    await p;
    assert.equal(env.queue().length, 1);
    assert.equal(mineRec(env).tries, 1);
    assert.ok(env.warnings.some((w) => String(w[1]) === 'timeout'));
    env.cloud.mode = 'ok';
    await env.Usage.flush();
    assert.equal(env.cloud.calls[1].id, env.cloud.calls[0].id);
    assert.deepEqual(env.queue(), []);
  });
  test('stored but the answer was lost → the retry is refused (create-only) and counts as stored', async () => {
    const env = signedIn();
    track(env, 1);
    env.cloud.mode = 'lost';
    await env.Usage.flush();
    assert.equal(env.cloud.stored.size, 1);
    assert.equal(env.queue().length, 2);
    env.cloud.mode = 'ok';
    await env.Usage.flush();                       // permission-denied on try 2
    assert.equal(env.cloud.calls.length, 2);
    assert.deepEqual(env.queue(), []);
    assert.equal(env.sending(), null);
    assert.equal(env.cloud.stored.size, 1, 'stored once');
    track(env, 1);                                 // uploads are not paused
    await env.Usage.flush();
    assert.equal(env.cloud.stored.size, 2);
  });
  test('permission-denied on the first try: events kept, id forgotten, uploads paused for this page', async () => {
    const env = signedIn();
    track(env, 2);
    env.cloud.mode = 'denied';
    await env.Usage.flush();
    assert.equal(env.queue().length, 3);
    assert.equal(env.sending(), null, 'the SEND_KEY record of this account is removed');
    assert.ok(env.warnings.some((w) => w[0] === 'usage batch refused'));
    env.cloud.mode = 'ok';
    track(env, 200);
    await env.Usage.flush();
    await env.clock.advance(20 * MIN);
    assert.equal(env.cloud.calls.length, 1, 'no more uploads from this page');
    // next page load: a new batch (new id, first try again) with the same events
    const env2 = signedIn({ store: env.store, clock: env.clock });
    await env2.Usage.flush();
    assert.notEqual(env2.cloud.calls[0].id, env.cloud.calls[0].id);
    assert.deepEqual(env2.cloud.calls[0].doc.events.slice(0, 3), env.cloud.calls[0].doc.events);
    assert.deepEqual(env2.queue(), []);
    assert.equal(env2.cloud.stored.size, env2.cloud.calls.length);
  });
  test('refused again on the next page load → still kept (never counted as stored)', async () => {
    const env = signedIn();
    track(env, 1);
    env.cloud.mode = 'denied';
    await env.Usage.flush();
    const env2 = signedIn({ store: env.store, clock: env.clock, cloudOpts: { mode: 'denied' } });
    await env2.Usage.flush();
    assert.equal(env2.cloud.calls.length, 1);
    assert.notEqual(env2.cloud.calls[0].id, env.cloud.calls[0].id);
    assert.deepEqual(env2.queue().map((e) => e.e), ['open', 'x', 'open']);
    assert.equal(env2.sending(), null);
  });
  test('a resent batch is not changed by later events (data "k" is ignored)', async () => {
    const env = signedIn();
    env.Usage.track('setting', { k: 'theme', key: 'theme', val: 'dark' });
    env.cloud.mode = 'unavailable';
    await env.Usage.flush();                     // [open, setting] fails
    env.Usage.track('setting', { k: 'theme', key: 'theme', val: 'sepia' });
    env.cloud.mode = 'ok';
    await env.Usage.flush();
    assert.equal(env.cloud.calls[1].id, env.cloud.calls[0].id);
    assert.deepEqual(env.cloud.calls[1].doc.events, env.cloud.calls[0].doc.events);
    assert.deepEqual(env.cloud.calls[2].doc.events.map((e) => [e.key, e.val]), [['theme', 'sepia']]);
  });
  test('invalid-argument on the first try: the batch is dropped', async () => {
    const env = signedIn();
    track(env, 1);
    env.cloud.mode = 'invalid';
    await env.Usage.flush();
    assert.deepEqual(env.queue(), []);
    assert.equal(env.sending(), null);
  });
  test('SEND_KEY per account: another account uploading keeps the pending batch of the first', async () => {
    const env = signedIn();
    track(env, 1);
    env.cloud.mode = 'unavailable';
    await env.Usage.flush();                         // A's batch pending
    const idA = env.cloud.calls[0].id;
    const envB = signedIn({ store: env.store, clock: env.clock, user: USER_B });
    await envB.Usage.flush();                        // B uploads its own
    assert.equal(envB.cloud.calls[0].doc.uid, USER_B.uid);
    assert.deepEqual(Object.keys(envB.sending()), [USER_A.uid]);
    const envA = signedIn({ store: env.store, clock: env.clock });
    await envA.Usage.flush();
    assert.equal(envA.cloud.calls[0].id, idA, 'A resends with the same id');
    assert.deepEqual(envA.cloud.calls[0].doc.events, env.cloud.calls[0].doc.events);
    assert.equal(envA.sending(), null);
  });
  test('visitor batches are keyed by ""', async () => {
    const env = signedIn({ user: null });
    env.cloud.mode = 'unavailable';
    await env.Usage.flush();
    assert.deepEqual(Object.keys(env.sending()), ['']);
  });
  test('a legacy single-record SEND_KEY is ignored and replaced', async () => {
    const store = new Map();
    const q = seedEvents(USER_A.uid, 2, T0 - MIN);
    lsSet(store, Q_KEY, q);
    lsSet(store, SEND_KEY, { id: 'LEGACYLEGACYLEGACY00', uid: USER_A.uid, keys: q.map((e) => e.k), tries: 1 });
    const env = signedIn({ store, cloudOpts: { mode: 'unavailable' } });
    await env.Usage.flush();
    assert.notEqual(env.cloud.calls[0].id, 'LEGACYLEGACYLEGACY00');
    const s = env.sending();
    assert.deepEqual(Object.keys(s), [USER_A.uid]);
    assert.equal(s[USER_A.uid].tries, 1);
  });
});

describe('usage.js: overlapping flushes', () => {
  // Web Locks answer asynchronously, so a flush stays "running" for a while
  const asyncLocks = () => ({ request: (name, opts, cb) => new Promise((r) => setImmediate(r)).then(() => cb({ name })) });
  test('flush(1) while a flush(100) runs: chained, so everything goes up', async () => {
    const env = signedIn({ locks: asyncLocks() });
    track(env, 2);
    env.cloud.emit('ready');                         // flush(100): would upload nothing
    await env.Usage.flush();
    assert.deepEqual(sizes(env), [3]);
    assert.deepEqual(env.queue(), []);
  });
  test('sign-out right after the auth flush started still uploads the logout', async () => {
    const env = loadUsage({ locks: asyncLocks() });
    env.cloud.signIn(USER_A);                        // starts flush(100)
    await env.cloud.logout();                        // flush(1) chained after it
    await settle();
    assert.equal(env.cloud.calls.length, 1);
    assert.deepEqual(env.cloud.calls[0].doc.events.map((e) => e.e), ['open', 'login', 'logout']);
    assert.deepEqual(env.queue(), []);
  });
  test('a lower threshold is not chained twice for the same min', async () => {
    const env = signedIn({ locks: asyncLocks() });
    const p1 = env.Usage.flush();
    const p2 = env.Usage.flush();
    assert.equal(p1, p2);
    await p1;
    assert.equal(env.cloud.calls.length, 1);
  });
});

describe('usage.js: other accounts and the queue', () => {
  test('events of another account stay (not uploaded now), dropped after 30 days', async () => {
    const store = new Map();
    const recent = seedEvents(USER_B.uid, 3, T0 - 3600 * 1000);
    const old = seedEvents(USER_B.uid, 2, T0 - 31 * DAY);
    lsSet(store, Q_KEY, [...old, ...recent]);
    const env = signedIn({ store });
    await env.Usage.flush();
    assert.equal(env.cloud.calls.length, 1);
    assert.equal(env.cloud.calls[0].doc.uid, USER_A.uid);
    assert.deepEqual(env.cloud.calls[0].doc.events.map((e) => e.e), ['open']);
    assert.deepEqual(env.queue().map((e) => e.k), recent.map((e) => e.k));
    // B signs in on this device later: its events go up under B
    const env2 = signedIn({ store, clock: env.clock, user: USER_B });
    await env2.Usage.flush();
    assert.equal(env2.cloud.calls[0].doc.uid, USER_B.uid);
    assert.equal(env2.cloud.calls[0].doc.n, 4);
    assert.deepEqual(env2.queue(), []);
  });
  test('old events of another account are dropped even when nothing of this account waits', async () => {
    const store = new Map();
    lsSet(store, Q_KEY, seedEvents(USER_B.uid, 2, T0 - 31 * DAY));
    const env = signedIn({ store });
    await env.Usage.flush();          // uploads 'open' and cleans the rest
    assert.deepEqual(env.queue(), []);
  });
  test('queue capped at 1500, oldest dropped', () => {
    const store = new Map();
    const seeds = seedEvents(USER_A.uid, 1499, T0 - 3600 * 1000, 1);
    lsSet(store, Q_KEY, seeds);
    const env = signedIn({ store, cloudOpts: { ready: false } });   // + open = 1500
    assert.equal(env.queue().length, 1500);
    env.Usage.track('a');
    env.Usage.track('b');
    const q = env.queue();
    assert.equal(q.length, 1500);
    assert.equal(q[0].k, seeds[2].k);
    assert.deepEqual(q.slice(-3).map((e) => e.e), ['open', 'a', 'b']);
  });
  test('storage full → keeps the newest half', () => {
    const store = new Map();
    const seeds = seedEvents(USER_A.uid, 1000, T0 - 3600 * 1000, 1);
    lsSet(store, Q_KEY, seeds);
    const quota = (k, v) => k !== Q_KEY || JSON.parse(v).length <= 600;
    const env = signedIn({ store, quota, cloudOpts: { ready: false } });   // 1001 → 501
    const q = env.queue();
    assert.equal(q.length, 501);
    assert.equal(q[0].k, seeds[500].k);
    assert.equal(q.at(-1).e, 'open');
  });
  test("the in-memory queue is re-read after another tab's 'storage' event", () => {
    const env = signedIn({ cloudOpts: { ready: false } });
    const other = seedEvent(USER_A.uid, T0 + 10);
    lsSet(env.store, Q_KEY, [...env.queue(), other]);     // written by another tab
    env.fireWindow('storage', { key: Q_KEY });
    env.Usage.track('mine');
    assert.deepEqual(env.queue().map((e) => e.e), ['open', 'seed', 'mine']);
    // localStorage.clear() in another tab: key null
    lsSet(env.store, Q_KEY, [other]);
    env.fireWindow('storage', { key: null });
    env.Usage.track('again');
    assert.deepEqual(env.queue().map((e) => e.e), ['seed', 'again']);
  });
  test('without a storage event the cached queue is used (other keys do not invalidate it)', () => {
    const env = signedIn({ cloudOpts: { ready: false } });
    lsSet(env.store, Q_KEY, [...env.queue(), seedEvent(USER_A.uid, T0 + 10)]);
    env.fireWindow('storage', { key: 'mlb.somethingElse' });
    env.Usage.track('mine');
    assert.deepEqual(env.queue().map((e) => e.e), ['open', 'mine']);
  });
});
