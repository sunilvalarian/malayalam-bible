// Scenarios 5 + 6: the administrator portal — usage page (tiles, people, timeline, filters, CSV,
// person card, cached batches), dashboard card, users → usage link — and the portal offline.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  READER, PORTAL, OWNER, launch, watch, waitCloud, waitFor, sleep, setOffline, waitServiceWorker,
  clearEmulators, createUser, setDoc, seedUsage, rid, uniq, allowDownloads, waitFile, badErrors, debugErrors,
} from './helpers.mjs';

const OWNER_PW = 'owner-pass-123';
let owner, userX, seeded;

before(async () => {
  await clearEmulators();
  owner = await createUser(OWNER, OWNER_PW, { verified: true, name: 'Sunil' });
  userX = await createUser(uniq('xavier'), 'xavier-pass-1', { verified: true, name: 'Xavier Test' });
  await setDoc(`users/${userX.uid}`, { email: userX.email, name: 'Xavier Test', role: 'reader', provider: 'password', createdAt: new Date(), lastLogin: new Date() });
  const now = Date.now();
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const t0 = Math.max(now - 10 * 60 * 1000, +midnight + 1000);
  const past = now - 3 * 24 * 3600 * 1000;
  seeded = {
    a: await seedUsage({ at: t0 + 10000, device: rid(20), events: [
      { e: 'open', t: t0, page: 'reader' },
      { e: 'read', t: t0 + 1000, b: 'GEN', c: 1, sec: 120 },
      { e: 'search', t: t0 + 2000, q: 'ദൈവം', n: 5, scope: 'all' },
      { e: 'copy', t: t0 + 3000, b: 'GEN', c: 1, v: '1' },
    ] }),
    x: await seedUsage({ at: t0 + 20000, device: rid(20), uid: userX.uid, email: userX.email, name: 'Xavier Test', os: 'Windows', model: '', events: [
      { e: 'open', t: t0 + 4000, page: 'reader' },
      { e: 'read', t: t0 + 5000, b: 'GEN', c: 2, sec: 60 },
      { e: 'search', t: t0 + 6000, q: 'സ്നേഹംzz', n: 0, scope: 'all' },
      { e: 'offline', t: t0 + 7000, net: 0 },
    ] }),
    c: await seedUsage({ at: past + 5000, device: rid(20), city: 'Thrissur', events: [
      { e: 'open', t: past, page: 'reader' },
      { e: 'read', t: past + 1000, b: 'GEN', c: 5, sec: 30 },
    ] }),
  };
});

async function signInPortal(page) {
  await page.goto(PORTAL, { waitUntil: 'load' });
  await waitCloud(page);
  await page.evaluate((e, p) => window.Cloud.signIn(e, p), OWNER, OWNER_PW);
  await waitFor(page, () => !document.getElementById('admShell').hidden && window.Cloud.role === 'admin', { timeout: 20000 });
}
// rows of the table that follows the <h2> with this title (people table etc.)
const tableRows = (page, title) => page.evaluate((t) => {
  const h = [...document.querySelectorAll('#useOut h2')].find((x) => x.textContent.trim() === t);
  const tbl = h && h.nextElementSibling && h.nextElementSibling.matches('table') ? h.nextElementSibling : null;
  return tbl ? tbl.querySelectorAll('tbody tr').length : -1;
}, title);
const PEOPLE = 'ആളുകളും ഉപകരണങ്ങളും';
const timelineRows = (page) => page.$$eval('#useOut .adm-timeline tbody tr', (r) => r.length).catch(() => 0);
const timelineTypes = (page) => page.$$eval('#useOut .adm-timeline tbody tr td:nth-child(2)', (r) => r.map((x) => x.textContent.trim()));
const usageLoaded = (page) => waitFor(page, () => document.querySelector('#useOut .adm-stats') && !document.querySelector('#useOut .spin'), { timeout: 20000 });
const tile = (page, label) => page.evaluate((l) => {
  const s = [...document.querySelectorAll('#useOut .adm-stat, #secBody .adm-stat')].find((x) => x.querySelector('span') && x.querySelector('span').textContent.trim() === l);
  return s ? s.querySelector('strong').textContent.trim() : null;
}, label);

test('5. portal: dashboard card, usage page (tiles, people, timeline, filters, cache, CSV, person), users → usage', async (t) => {
  const b = await launch();
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'mlb-e2e-dl-'));
  try {
    await allowDownloads(b.browser, dl);
    const page = await b.browser.newPage();
    const w = watch(page);
    await signInPortal(page);

    // dashboard (default section): today's app use = the visitor + Xavier
    await waitFor(page, () => [...document.querySelectorAll('#secBody .adm-stat')].some((s) => /ഇന്ന് ആപ്പ് ഉപയോഗിച്ചവർ/.test(s.textContent) && /\d/.test(s.querySelector('strong').textContent)), { timeout: 20000 });
    const today = await page.evaluate(() => [...document.querySelectorAll('#secBody .adm-stat')].find((s) => /ഇന്ന് ആപ്പ് ഉപയോഗിച്ചവർ/.test(s.textContent)).querySelector('strong').textContent.trim());
    assert.equal(today, '2', "dashboard 'ഇന്ന് ആപ്പ് ഉപയോഗിച്ചവർ' counts today's people");

    // count the usage queries from here on
    await page.evaluate(() => {
      const C = window.Cloud;
      const orig = C.listUsage.bind(C);
      window.__listUsage = [];
      C.listUsage = (o) => { window.__listUsage.push(Object.assign({}, o, { cursor: !!(o && o.cursor) })); return orig(o); };
    });
    const calls = () => page.evaluate(() => window.__listUsage.length);

    await page.evaluate(() => { location.hash = '#usage'; });
    await usageLoaded(page);
    assert.equal(await page.$$eval('#useOut > .adm-stats .adm-stat', (s) => s.length), 6, 'six stat tiles');
    assert.equal(await tile(page, 'ആളുകൾ'), '3', '3 people in 7 days');
    assert.equal(await tile(page, 'വായിച്ച അധ്യായങ്ങൾ'), '3');
    assert.equal(await tile(page, 'തിരയലുകൾ'), '2');
    assert.equal(await tile(page, 'ഓഫ്‌ലൈൻ ആയി ചെയ്തത്'), '1');
    assert.equal(await tableRows(page, PEOPLE), 3, 'people table: 3 rows');
    assert.equal(await timelineRows(page), 10, 'timeline: all 10 events');
    assert.equal(await calls(), 1, 'one usage query for the 7-day period');
    const offRows = await page.$$eval('#useOut .adm-timeline tbody tr', (rs) => [...rs].filter((r) => r.querySelector('td .adm-pill.warn')).map((r) => r.children[1].textContent.trim()));
    assert.deepEqual(offRows, ['ഓഫ്‌ലൈൻ ആയി'], 'the event done offline is marked in the timeline');

    // filters
    await page.select('#useWho', 'visitors');
    await waitFor(page, () => document.querySelectorAll('#useOut .adm-timeline tbody tr').length === 6);
    assert.equal(await tableRows(page, PEOPLE), 2, 'visitors: 2 people');
    await page.select('#useWho', 'signed');
    await waitFor(page, () => document.querySelectorAll('#useOut .adm-timeline tbody tr').length === 4);
    assert.equal(await tableRows(page, PEOPLE), 1, 'signed in: 1 person');
    await page.select('#useWho', '');
    await page.select('#useType', 'search');
    await waitFor(page, () => document.querySelectorAll('#useOut .adm-timeline tbody tr').length === 2);
    assert.deepEqual(await timelineTypes(page), ['തിരഞ്ഞു', 'തിരഞ്ഞു'], 'type filter: only searches');
    await page.select('#useType', '');
    await page.evaluate(() => { const i = document.getElementById('useText'); i.value = 'സ്നേഹംzz'; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await waitFor(page, () => document.querySelectorAll('#useOut .adm-timeline tbody tr').length === 1, { timeout: 5000 });
    assert.match(await page.$eval('#useOut .adm-timeline tbody tr', (r) => r.textContent), /Xavier Test/, 'text filter finds Xavier’s search');
    await page.evaluate(() => { const i = document.getElementById('useText'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });
    await waitFor(page, () => document.querySelectorAll('#useOut .adm-timeline tbody tr').length === 10, { timeout: 5000 });

    // period 7 → 1 day: the loaded batches are reused, no new query
    await page.select('#usePeriod', '1');
    await usageLoaded(page);
    await waitFor(page, () => document.querySelectorAll('#useOut .adm-timeline tbody tr').length === 8);
    assert.equal(await tableRows(page, PEOPLE), 2, 'today: 2 people');
    assert.equal(await calls(), 1, 'switching 7 → 1 day issues no new usage query');
    await page.select('#usePeriod', '7');
    await usageLoaded(page);
    await waitFor(page, () => document.querySelectorAll('#useOut .adm-timeline tbody tr').length === 10);
    assert.equal(await calls(), 1, 'back to 7 days: still cached');
    await page.select('#usePeriod', '30');
    await usageLoaded(page);
    await waitFor(page, () => document.querySelectorAll('#useOut .adm-timeline tbody tr').length === 10);
    assert.equal(await calls(), 2, 'a longer period (30 days) is loaded from Firestore');

    // CSV of what is shown
    await page.click('#useCsv');
    const file = await waitFile(dl, /^usage-\d{4}-\d{2}-\d{2}\.csv$/);
    await sleep(300);
    const csv = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const lines = csv.split(/\r\n/);
    assert.equal(lines[0], 'time,event,detail,book,chapter,verses,seconds,online,email,name,uid,device,session,os,browser,model,installed,city,region,country,ip,isp', 'CSV header row');
    assert.equal(lines.length, 11, 'header + 10 events');
    assert.ok(lines.some((l) => l.includes(userX.email) && l.includes(',search,')), 'CSV has Xavier’s search');

    // click a person → person card
    await page.click(`#useOut button[data-who="u:${userX.uid}"]`);
    await waitFor(page, () => !!document.querySelector('#useOut .adm-person'));
    const card = await page.$eval('#useOut .adm-person', (e) => e.textContent);
    assert.ok(card.includes(userX.email) && card.includes('Xavier Test'), 'person card shows the person');
    assert.equal(await timelineRows(page), 4, 'only their events');
    assert.equal(await tableRows(page, PEOPLE), -1, 'no people table on a person page');

    // users → ഉപയോഗം link → that person
    await page.evaluate(() => { location.hash = '#users'; });
    const sel = `a[href="#usage/u:${encodeURIComponent(userX.uid)}"]`;
    await page.waitForSelector(sel, { timeout: 15000 });
    assert.match(await page.$eval(sel, (a) => a.textContent), /ഉപയോഗം/);
    await page.click(sel);
    await waitFor(page, (u) => location.hash === '#usage/u:' + u, {}, userX.uid);
    await usageLoaded(page);
    await waitFor(page, () => !!document.querySelector('#useOut .adm-person'));
    assert.ok((await page.$eval('#useOut .adm-person', (e) => e.textContent)).includes(userX.email), 'the users link opens that person');
    assert.equal(await page.$eval('#useWho', (s) => s.value), `u:${userX.uid}`);
    assert.equal(await timelineRows(page), 4);

    debugErrors(t, w);
    assert.deepEqual(badErrors(w, false), [], 'no console / page errors');
  } finally {
    await b.close();
    fs.rmSync(dl, { recursive: true, force: true });
  }
});

// the portal offline after a visit online; `viaReader` = the reader was opened first on this device
async function portalOffline(t, viaReader) {
  const b = await launch();
  try {
    const page = await b.browser.newPage();
    const w = watch(page);
    if (viaReader) {
      await page.goto(READER, { waitUntil: 'load' });
      await waitServiceWorker(page);
    }
    await signInPortal(page);
    await page.evaluate(() => { location.hash = '#usage'; });
    await usageLoaded(page);
    const online = { people: await tableRows(page, PEOPLE), timeline: await timelineRows(page) };
    assert.equal(online.people, 3);
    const reg = await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!(r && r.active)));
    if (!viaReader) await sleep(2000);   // time for a service worker to register, if the portal registered one

    await setOffline(page, true);
    await waitFor(page, () => !document.getElementById('admOffline').hidden, { timeout: 5000 });

    try { await page.reload({ waitUntil: 'load', timeout: 15000 }); } catch (e) { /* checked below */ }
    await setOffline(page, true);
    const isPortal = await page.evaluate(() => !!document.getElementById('admShell')).catch(() => false);
    assert.ok(isPortal, `the portal page loads offline (a service worker was registered: ${reg}; got ${page.url()})`);
    await waitFor(page, () => !document.getElementById('admShell').hidden, { timeout: 30000 });
    const st = await page.evaluate(() => ({ role: window.Cloud.role, email: window.Cloud.user && window.Cloud.user.email, onLine: navigator.onLine }));
    assert.equal(st.onLine, false);
    assert.equal(st.email, OWNER);
    assert.equal(st.role, 'admin', 'portal opens as admin offline (cached role)');
    assert.equal(await page.$eval('#admOffline', (e) => e.hidden), false, 'offline banner visible');
    await waitFor(page, () => document.querySelector('#useOut') && !document.querySelector('#useOut .spin'), { timeout: 30000 });
    const shown = await page.evaluate(() => ({ stats: !!document.querySelector('#useOut .adm-stats'), text: document.getElementById('useOut').textContent.slice(0, 200) }));
    assert.ok(shown.stats, 'usage page shows the cached copy: ' + shown.text);
    assert.equal(await tableRows(page, PEOPLE), online.people, 'cached people table');
    assert.equal(await timelineRows(page), online.timeline, 'cached timeline');

    // connection back: the banner goes and the page is loaded again
    await setOffline(page, false);
    await waitFor(page, () => document.getElementById('admOffline').hidden, { timeout: 5000 });
    await usageLoaded(page);
    assert.equal(await tableRows(page, PEOPLE), online.people);

    debugErrors(t, w);
    assert.deepEqual(badErrors(w, true), [], 'no unexpected errors');
  } finally { await b.close(); }
}

test('6a. portal offline (reader visited first): banner, reload offline opens as admin with cached usage', (t) => portalOffline(t, true));

test('6b. portal offline when only the portal was ever opened on this device', (t) => portalOffline(t, false));
