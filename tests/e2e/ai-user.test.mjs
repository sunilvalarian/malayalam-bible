// Scenario 7: the AI translation in the reader (Original | AI | താരതമ്യം under the chapter title) is
// switched on per user by an admin (portal → ഉപയോക്താക്കൾ → AI). It is not in the normal view: only
// ☰ → AI പരിഭാഷകൾ opens it, and its ✕ closes it again.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  READER, PORTAL, OWNER, launch, watch, waitCloud, waitVerses, waitFor, sleep,
  clearEmulators, createUser, setDoc, getDoc, uniq, badErrors, debugErrors,
} from './helpers.mjs';

const OWNER_PW = 'owner-pass-123';
let reader;
before(async () => {
  await clearEmulators();
  await createUser(OWNER, OWNER_PW, { verified: true, name: 'Sunil' });
  reader = await createUser(uniq('reader'), 'reader-pass-1', { verified: true, name: 'Rita' });
  await setDoc(`users/${reader.uid}`, { email: reader.email, name: 'Rita', role: 'reader', provider: 'password', createdAt: new Date(), lastLogin: new Date() });
});

const state = (page) => page.evaluate(() => ({
  switch: !!document.querySelector('#reader .ver-switch'),
  menu: !document.querySelector('[data-menu="aiList"]').hidden,
}));
const OFF = { switch: false, menu: false };
const ON = { switch: false, menu: true };   // allowed, but the normal view stays as it is
const AI_VIEW = { switch: true, menu: true };
const verse2 = (page) => page.$eval('#reader .v[data-v="2"]', (e) => e.textContent);

test('7. AI translation in the reader, per user: an admin switches it on, only ☰ → AI പരിഭാഷകൾ shows it', async (t) => {
  const rb = await launch();
  const ab = await launch();   // a second browser profile: the admin's sign-in mustn't replace the reader's
  try {
    const page = await rb.browser.newPage();
    const w = watch(page);
    await page.goto(READER + '#/GEN/1', { waitUntil: 'load' });
    await waitVerses(page);
    await waitCloud(page);
    await page.evaluate((e, p) => window.Cloud.signIn(e, p), reader.email, reader.password);
    await waitFor(page, () => window.Cloud.user && window.Cloud.role === 'reader', { timeout: 20000 });
    await sleep(1500);
    assert.deepEqual(await state(page), OFF, 'nothing before an admin switches it on');
    assert.equal(await page.evaluate(() => !!window.AI_BIBLE), false, 'ai-data.js not even loaded');
    const original2 = await verse2(page);

    // the admin switches it on in the portal
    const admin = await ab.browser.newPage();
    const aw = watch(admin);
    await admin.goto(PORTAL, { waitUntil: 'load' });
    await waitCloud(admin);
    await admin.evaluate((e, p) => window.Cloud.signIn(e, p), OWNER, OWNER_PW);
    await waitFor(admin, () => !document.getElementById('admShell').hidden && window.Cloud.role === 'admin', { timeout: 20000 });
    await admin.evaluate(() => { location.hash = '#users'; });
    const box = `#userTable .u-ai[data-uid="${reader.uid}"]`;
    await admin.waitForSelector(box, { visible: true, timeout: 20000 });
    assert.equal(await admin.$eval(box, (b) => b.checked), false);
    await admin.click(box);
    for (let i = 0; i < 50 && (await getDoc(`users/${reader.uid}`)).ai !== true; i++) await sleep(200);
    assert.equal((await getDoc(`users/${reader.uid}`)).ai, true, 'users/{uid}.ai saved');

    // live, without a reload: ☰ → AI പരിഭാഷകൾ appears, the chapter itself stays the normal view
    await waitFor(page, () => !document.querySelector('[data-menu="aiList"]').hidden, { timeout: 20000 });
    await sleep(1000);
    assert.deepEqual(await state(page), ON);
    assert.equal(await page.$('#dlgSettings #verRow'), null, 'nothing about AI in Aa');

    // ☰ → AI പരിഭാഷകൾ → Genesis 1: the AI translation in place of the text, with the note below
    await page.click('#btnMenu');
    await waitFor(page, () => document.getElementById('dlgMenu').open);
    await sleep(500);   // the drawer slides in
    await page.click('#dlgMenu [data-menu="aiList"]');
    await waitFor(page, () => !!document.querySelector('#aiListBody [data-ai-go="GEN/1"]'), { timeout: 20000 });
    await page.click('#aiListBody [data-ai-go="GEN/1"]');
    await waitFor(page, () => !!document.querySelector('#reader .ver-switch [data-ver="ai"][aria-pressed="true"]'));
    assert.deepEqual(await state(page), AI_VIEW);
    assert.notEqual(await verse2(page), original2, 'verse 2 is the AI translation');
    assert.ok(await page.$('#reader .ai-note'), 'AI note below the text');

    // താരതമ്യം: the original, with the AI translation under each verse, changed words marked
    await page.click('#reader .ver-switch [data-ver="cmp"]');
    await waitFor(page, () => !!document.querySelector('#reader .ai-line'));
    assert.ok((await verse2(page)).startsWith(original2.trim().slice(0, 20)), 'the original stays on top');
    assert.ok(await page.$('#reader .v[data-v="2"] .ai-line ins'), 'changed words are marked');

    // with a verse selected, the switch still changes the view every time
    await page.click('#reader .v[data-v="3"]');
    await waitFor(page, () => !document.getElementById('actionbar').hidden);
    await page.click('#reader .ver-switch [data-ver="ai"]');
    await waitFor(page, () => document.querySelector('#reader .ver-switch [data-ver="ai"]').getAttribute('aria-pressed') === 'true');
    await page.click('#reader .ver-switch [data-ver="orig"]');
    await waitFor(page, () => document.querySelector('#reader .ver-switch [data-ver="orig"]').getAttribute('aria-pressed') === 'true');
    assert.equal(await verse2(page), original2, 'Original after AI');

    // ✕: back to the normal view, no switch, also after a reload
    await page.click('#reader .ver-switch [data-ver="cmp"]');
    await waitFor(page, () => !!document.querySelector('#reader .ai-line'));
    await page.click('#reader .ver-switch [data-ver="off"]');
    await waitFor(page, () => !document.querySelector('#reader .ver-switch'));
    assert.equal(await page.$('#reader .ai-line'), null);
    assert.equal(await verse2(page), original2);
    await page.reload({ waitUntil: 'load' });
    await waitVerses(page);
    await waitFor(page, () => window.Cloud.user && !document.querySelector('[data-menu="aiList"]').hidden, { timeout: 20000 });
    await sleep(1000);
    assert.deepEqual(await state(page), ON, 'a reload starts in the normal view');
    assert.equal(await verse2(page), original2);

    // into the AI view again, for the admin's switch-off below
    await page.click('#btnMenu');
    await waitFor(page, () => document.getElementById('dlgMenu').open);
    await sleep(500);
    await page.click('#dlgMenu [data-menu="aiList"]');
    await waitFor(page, () => !!document.querySelector('#aiListBody [data-ai-go="GEN/1"]'), { timeout: 20000 });
    await page.click('#aiListBody [data-ai-go="GEN/1"]');
    await waitFor(page, () => !!document.querySelector('#reader .ver-switch'));

    // the admin switches it off again
    await admin.click(box);
    await waitFor(page, () => !document.querySelector('#reader .ver-switch'), { timeout: 20000 });
    assert.deepEqual(await state(page), OFF);
    assert.equal(await verse2(page), original2);

    // a user can't switch it on for themselves (firestore.rules)
    const self = await page.evaluate((uid) => window.Cloud.setAi(uid, true).then(() => 'ok', (e) => e.code || String(e)), reader.uid);
    assert.match(self, /permission-denied/);

    debugErrors(t, w);
    assert.deepEqual(badErrors(w), [], 'no unexpected errors (reader)');
    assert.deepEqual(badErrors(aw), [], 'no unexpected errors (portal)');
  } finally {
    await rb.close();
    await ab.close();
  }
});
