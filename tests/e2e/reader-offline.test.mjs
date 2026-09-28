// Scenarios 1 + 2: the reader boots, the service worker caches the app (and the Firebase SDK),
// and the app starts offline, also with a signed-in user who keeps their role.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  READER, BASE, launch, watch, waitCloud, waitVerses, waitServiceWorker, cacheContents, setOffline, waitFor, sleep,
  badErrors, debugErrors, clearEmulators, uniq, setDoc,
} from './helpers.mjs';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK_FILES = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
let gstatic = false;

before(async () => {
  await clearEmulators();
  try { gstatic = (await fetch(SDK + SDK_FILES[0], { method: 'HEAD' })).ok; } catch (e) { gstatic = false; }
  if (!gstatic) console.log('# www.gstatic.com is unreachable: the Firebase SDK assertions are skipped');
});

test('1. reader boots: chapter renders, no JS errors, service worker caches the app shell and the SDK', async (t) => {
  const b = await launch();
  try {
    const page = await b.browser.newPage();
    const w = watch(page);
    await page.goto(READER, { waitUntil: 'load' });
    await waitVerses(page);
    const verses = await page.$$eval('#reader .v', (els) => els.length);
    assert.ok(verses > 10, `a chapter with verses renders (got ${verses})`);
    assert.match(await page.$eval('#reader .ch-title', (e) => e.textContent), /അധ്യായം/);
    if (gstatic) await waitCloud(page);
    await waitServiceWorker(page);
    const caches = await cacheContents(page);
    const shellName = Object.keys(caches).find((k) => /^ml-bible-v\d+$/.test(k));
    assert.ok(shellName, 'app shell cache exists: ' + Object.keys(caches).join(', '));
    const shell = caches[shellName].map((u) => u.replace(BASE, ''));
    for (const f of ['/', '/index.html', '/js/app.js', '/js/cloud.js', '/js/usage.js', '/js/data.js', '/css/style.css', '/admin.html', '/js/admin.js', '/css/admin.css']) {
      assert.ok(shell.includes(f), `shell cache contains ${f}`);
    }
    if (!gstatic) t.diagnostic('gstatic unreachable: Firebase SDK cache not checked');
    else {
      const lib = caches['ml-bible-lib'] || [];
      for (const f of SDK_FILES) assert.ok(lib.includes(SDK + f), `SDK cache contains ${f} (has: ${lib.join(', ')})`);
    }
    assert.equal(await page.$eval('#netPill', (e) => e.hidden), true, 'offline badge hidden while online');
    await sleep(500);
    debugErrors(t, w);
    assert.deepEqual(badErrors(w, false), [], 'no console errors / page errors');
  } finally { await b.close(); }
});

test('1b. the Malayalam web fonts are cached on the first visit (README: "caches … the fonts … on the first visit")', async () => {
  const b = await launch();
  try {
    const page = await b.browser.newPage();
    await page.goto(READER, { waitUntil: 'load' });
    await waitVerses(page);
    await waitServiceWorker(page);
    await sleep(1500);
    const fonts = (await cacheContents(page))['ml-bible-fonts'] || [];
    assert.ok(fonts.some((u) => u.startsWith('https://fonts.googleapis.com/css2')), 'font CSS cached after the first visit: ' + JSON.stringify(fonts));
    // the font files themselves (default reading font + portal font, Malayalam + Latin), not only the CSS
    assert.ok(fonts.some((u) => u.includes('/s/notoserifmalayalam/') && u.endsWith('.woff2')), 'Noto Serif Malayalam font file cached: ' + JSON.stringify(fonts));
    assert.ok(fonts.some((u) => u.includes('/s/notosansmalayalam/') && u.endsWith('.woff2')), 'Noto Sans Malayalam font file cached');
    assert.ok(fonts.length <= 12, 'only the needed font files are fetched ahead: ' + fonts.length);
  } finally { await b.close(); }
});

test('2a. offline start: the reader loads from the service worker, shows the offline badge, Firebase SDK from cache', async (t) => {
  const b = await launch();
  try {
    const page = await b.browser.newPage();
    const w = watch(page);
    await page.goto(READER + '#/GEN/3', { waitUntil: 'load' });
    await waitVerses(page);
    await waitServiceWorker(page);
    if (gstatic) await waitCloud(page);
    assert.deepEqual(badErrors(w, false), [], 'no errors while online');

    await setOffline(page, true);
    await page.reload({ waitUntil: 'load' });
    await setOffline(page, true);   // a restarted service worker is emulated offline too
    await waitVerses(page);
    assert.equal(await page.evaluate(() => navigator.onLine), false, 'navigator.onLine is false');
    // the network really is off (the service worker never caches /api/)
    assert.equal(await page.evaluate(() => fetch('/api/where', { cache: 'no-store' }).then(() => 'reached', () => 'failed')), 'failed', 'network is off');
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page is controlled by the service worker');
    assert.match(await page.$eval('#reader .ch-title', (e) => e.textContent), /3/, 'the chapter from the address opened');
    assert.equal(await page.$eval('#netPill', (e) => e.hidden), false, '#netPill visible offline');
    if (gstatic) {
      await waitFor(page, () => window.Cloud && window.Cloud.ready === true, { timeout: 20000 });
      assert.equal(await page.evaluate(() => typeof window.firebase), 'object', 'firebase SDK loaded offline (from the SW cache)');
    } else t.diagnostic('gstatic unreachable: Cloud.ready offline not checked');
    await sleep(1500);
    debugErrors(t, w);
    assert.deepEqual(badErrors(w, true), [], 'no uncaught errors offline');

    // back online: the badge goes away
    await setOffline(page, false);
    await waitFor(page, () => document.getElementById('netPill').hidden === true, { timeout: 5000 });
  } finally { await b.close(); }
});

test('2b. offline start with a signed-in user: stays signed in and keeps the role', async (t) => {
  const b = await launch();
  try {
    const page = await b.browser.newPage();
    const w = watch(page);
    await page.goto(READER, { waitUntil: 'load' });
    await waitCloud(page);
    await waitServiceWorker(page);
    const email = uniq('offline-user');
    const uid = await page.evaluate(async (em) => (await window.Cloud.signUp('Offline Tester', em, 'secret-pass-1')).uid, email);
    await waitFor(page, (u) => window.Cloud.user && window.Cloud.user.uid === u && window.Cloud.role === 'reader', {}, uid);
    // an admin makes them an editor: the live profile listener applies it (and it is remembered)
    await setDoc(`users/${uid}?updateMask.fieldPaths=role`, { role: 'editor' });
    await waitFor(page, () => window.Cloud.role === 'editor', { timeout: 15000 });
    await sleep(500);

    await setOffline(page, true);
    await page.reload({ waitUntil: 'load' });
    await setOffline(page, true);
    await waitVerses(page);
    await waitFor(page, () => window.Cloud && window.Cloud.ready && window.Cloud.authKnown, { timeout: 25000 });
    const st = await page.evaluate(() => ({ uid: window.Cloud.user && window.Cloud.user.uid, email: window.Cloud.user && window.Cloud.user.email, role: window.Cloud.role, online: navigator.onLine }));
    assert.equal(st.online, false);
    assert.equal(st.uid, uid, 'still signed in offline');
    assert.equal(st.email, email.toLowerCase());
    assert.equal(st.role, 'editor', 'keeps the role this device last saw');
    // the account card in the drawer shows the user (not the login button)
    const acct = await page.$eval('#accountCard', (e) => e.textContent);
    assert.ok(acct.includes(email.toLowerCase()) || acct.includes('Offline Tester'), 'account card shows the user: ' + acct.slice(0, 120));
    await sleep(1000);
    debugErrors(t, w);
    assert.deepEqual(badErrors(w, true), [], 'no unexpected errors');
  } finally { await b.close(); }
});
