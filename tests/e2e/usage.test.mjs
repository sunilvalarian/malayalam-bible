// Scenario 3: the usage log end to end — events are queued in localStorage (online and offline),
// uploaded as usage/{batchId} batches (visitor, then signed-in user), and signing out uploads 'logout'.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  READER, launch, watch, waitCloud, waitVerses, waitFor, sleep, setOffline, queue, flushAll,
  clearEmulators, listUsageDocs, uniq, badErrors, debugErrors, tap,
} from './helpers.mjs';

before(clearEmulators);

const goTo = async (page, b, c) => {
  await page.evaluate((h) => { location.hash = h; }, `#/${b}/${c}`);
  await waitFor(page, (n) => document.querySelector('#reader .ch-num') && document.querySelector('#reader .ch-num').textContent === String(n), {}, c);
};
const eventsOf = (docs) => docs.flatMap((d) => d.events.map((e) => Object.assign({ batch: d.id }, e)));

test('3. usage log: visitor events online + offline are queued, uploaded, then a signed-in batch and logout', async (t) => {
  const b = await launch();
  try {
    const page = await b.browser.newPage();
    const w = watch(page);
    await page.goto(READER + '#/GEN/1', { waitUntil: 'load' });
    await waitVerses(page);
    await waitCloud(page);
    assert.equal(await page.evaluate(() => window.Usage.enabled), true, 'usage log is on in cloud mode');
    const deviceId = await page.evaluate(() => window.Usage.deviceId);
    assert.match(deviceId, /^[A-Za-z0-9]{16,32}$/);

    // copy a verse
    await tap(page, '#reader .v[data-v="1"]');
    await waitFor(page, () => !document.getElementById('actionbar').hidden);
    await tap(page, '#actionbar [data-act="copy"]');
    // read chapter 2 for > 3 s
    await goTo(page, 'GEN', 2);
    await sleep(3400);
    await goTo(page, 'GEN', 3);
    // search (the settled search is logged after 1.5 s)
    await tap(page, '#btnSearch');
    await waitFor(page, () => document.getElementById('dlgSearch').open);
    await page.evaluate(() => {
      const i = document.getElementById('searchInput');
      i.value = 'ദൈവം';
      i.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(page, () => JSON.parse(localStorage.getItem('mlb.usageQueue') || '[]').some((e) => e.e === 'search'), { timeout: 8000 });
    await page.keyboard.press('Escape');

    let q = await queue(page);
    const kinds = new Set(q.map((e) => e.e));
    for (const k of ['open', 'copy', 'read', 'search']) assert.ok(kinds.has(k), `queued a '${k}' event (have ${[...kinds]})`);
    assert.ok(q.every((e) => e.net === 1), 'every event recorded online has net:1');
    const read2 = q.find((e) => e.e === 'read' && e.b === 'GEN' && e.c === 2);
    assert.ok(read2 && read2.sec >= 3, 'GEN 2 read for >= 3 s: ' + JSON.stringify(read2));
    const search = q.find((e) => e.e === 'search');
    assert.equal(search.q, 'ദൈവം');
    assert.ok(search.n > 0, 'search found verses');
    assert.ok(q.every((e) => e.u === ''), 'visitor events belong to no account');
    assert.equal(await page.evaluate(() => localStorage.getItem('mlb.usageSending')), null, 'nothing uploaded yet (batched for the free plan)');

    // offline: events are still recorded, with net:0
    await setOffline(page, true);
    await waitFor(page, () => JSON.parse(localStorage.getItem('mlb.usageQueue') || '[]').some((e) => e.e === 'offline'), { timeout: 5000 });
    await sleep(3300);
    await goTo(page, 'GEN', 4);
    q = await queue(page);
    const off = q.filter((e) => e.net === 0);
    assert.ok(off.some((e) => e.e === 'offline'), "an 'offline' event with net:0");
    assert.ok(off.some((e) => e.e === 'read' && e.c === 3), 'GEN 3 read offline, net:0');
    // flush does nothing offline
    await page.evaluate(() => window.Usage.flush());
    assert.equal((await listUsageDocs()).length, 0, 'nothing reaches Firestore while offline');

    // back online: everything goes up as visitor batches
    await setOffline(page, false);
    await waitFor(page, () => JSON.parse(localStorage.getItem('mlb.usageQueue') || '[]').some((e) => e.e === 'online'), { timeout: 5000 });
    await flushAll(page);
    let docs = (await listUsageDocs()).filter((d) => d.device === deviceId);
    assert.ok(docs.length >= 1, 'a usage batch was stored');
    for (const d of docs) {
      assert.equal(d.uid, null, 'visitor batch: uid null');
      assert.equal(d.email, null, 'visitor batch: email null');
      assert.equal(d.v, 1);
      assert.equal(d.n, d.events.length);
      assert.ok(d.at instanceof Date && Math.abs(Date.now() - d.at) < 120000, 'at is a server timestamp');
      assert.equal(d.dev.os, 'Windows');
      assert.equal(d.dev.browser, 'Chrome');
      assert.ok(d.dev.screen && d.dev.lang && d.dev.tz && d.dev.app, 'device info: ' + JSON.stringify(d.dev));
    }
    let ev = eventsOf(docs);
    for (const k of ['open', 'copy', 'read', 'search', 'offline', 'online']) assert.ok(ev.some((e) => e.e === k), `uploaded a '${k}' event`);
    assert.ok(ev.some((e) => e.e === 'read' && e.c === 3 && e.net === 0), 'the offline read was uploaded with net:0');
    assert.ok(ev.every((e) => !('k' in e) && !('u' in e)), 'internal keys are stripped');
    const geo = docs.map((d) => d.geo).find(Boolean);
    assert.ok(!geo || typeof geo.ip === 'string', 'geo from /api/where (local: IP only)');

    // sign up: later batches carry the account
    const email = uniq('usage-user');
    const uid = await page.evaluate(async (em) => (await window.Cloud.signUp('Usage Tester', em, 'secret-pass-1')).uid, email);
    await waitFor(page, (u) => window.Cloud.user && window.Cloud.user.uid === u, {}, uid);
    await goTo(page, 'GEN', 5);
    await sleep(3200);
    await goTo(page, 'GEN', 6);
    q = await queue(page);
    assert.ok(q.some((e) => e.u === uid && e.e === 'login'), "a 'login' event for the new account");
    await flushAll(page);
    docs = (await listUsageDocs()).filter((d) => d.uid === uid);
    assert.ok(docs.length >= 1, 'a batch with the account was stored');
    assert.ok(docs.every((d) => d.email === email.toLowerCase() && d.device === deviceId), 'batch carries uid, e-mail and the same device');
    ev = eventsOf(docs);
    assert.ok(ev.some((e) => e.e === 'login'), 'login uploaded');
    assert.ok(ev.some((e) => e.e === 'read' && e.c === 5), 'reading while signed in uploaded');

    // signing out uploads what is left, with a 'logout' event
    await page.evaluate(() => window.Cloud.signOut());
    await waitFor(page, () => !window.Cloud.user, { timeout: 10000 });
    docs = (await listUsageDocs()).filter((d) => d.uid === uid);
    assert.ok(eventsOf(docs).some((e) => e.e === 'logout'), "'logout' uploaded by signOut()");
    q = await queue(page);
    assert.equal(q.filter((e) => e.u === uid).length, 0, "nothing of the account's is left in the queue");

    debugErrors(t, w);
    assert.deepEqual(badErrors(w, true), [], 'no unexpected console / page errors');
  } finally { await b.close(); }
});

test('3b. usage batching (free plan): nothing below the thresholds, 100 events go up by themselves, 25 when hidden', async (t) => {
  await clearEmulators();
  const b = await launch();
  try {
    const page = await b.browser.newPage();
    const w = watch(page);
    await page.goto(READER + '#/GEN/1', { waitUntil: 'load' });
    await waitVerses(page);
    await waitCloud(page);
    const deviceId = await page.evaluate(() => window.Usage.deviceId);
    const mine = async () => (await listUsageDocs()).filter((d) => d.device === deviceId);
    const track = (n, tag) => page.evaluate((k, g) => { for (let i = 0; i < k; i++) window.Usage.track('menu', { a: g + i }); }, n, tag);

    await track(20, 'a');
    await sleep(3000);
    assert.equal((await mine()).length, 0, 'about 20 events: nothing uploaded yet');

    await track(100 - (await queue(page)).length, 'b');
    const end = Date.now() + 15000;
    let docs = [];
    while (Date.now() < end && !(docs = await mine()).length) await sleep(300);
    assert.equal(docs.length, 1, '100 events: one batch uploaded without Usage.flush()');
    assert.ok(docs[0].n >= 100, 'with all waiting events (' + docs[0].n + ')');
    assert.equal((await queue(page)).length, 0, 'queue emptied');

    // 30 events, then the tab is hidden (another tab comes to the front): >= 25 go up
    await track(30, 'c');
    await sleep(2000);
    assert.equal((await mine()).length, 1, '30 events while visible: still waiting');
    const other = await b.browser.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    const hidden = await page.evaluate(() => document.visibilityState);
    if (hidden !== 'hidden') { t.skip('this headless browser does not hide background tabs'); return; }
    const end2 = Date.now() + 15000;
    while (Date.now() < end2 && (docs = await mine()).length < 2) await sleep(300);
    assert.equal(docs.length, 2, 'hidden with >= 25 events: a second batch went up');
    debugErrors(t, w);
    assert.deepEqual(badErrors(w, false), [], 'no unexpected console / page errors');
  } finally { await b.close(); }
});
