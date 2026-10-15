// Scenario 7: the AI translation in the reader (Original | AI | താരതമ്യം under the chapter title) is
// switched on per user by an admin (portal → ഉപയോക്താക്കൾ → AI); the user can hide it in Aa.
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
  aaRow: !document.getElementById('verRow').hidden,
  aaHide: !document.getElementById('optAiView').closest('label').hidden,
  menu: !document.querySelector('[data-menu="aiList"]').hidden,
}));
const OFF = { switch: false, aaRow: false, aaHide: false, menu: false };
const ON = { switch: true, aaRow: true, aaHide: true, menu: true };
const verse2 = (page) => page.$eval('#reader .v[data-v="2"]', (e) => e.textContent);

test('7. AI translation in the reader, per user: an admin switches it on, the user can hide it', async (t) => {
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

    // live, without a reload: the switch under the title, Aa → പാഠം and the hide box, ☰ → AI പരിഭാഷകൾ
    await waitFor(page, () => !!document.querySelector('#reader .ver-switch'), { timeout: 20000 });
    assert.deepEqual(await state(page), ON);

    // AI: the AI translation in place of the text, with the note below
    await page.click('#reader .ver-switch [data-ver="ai"]');
    await waitFor(page, () => document.querySelector('#reader .ver-switch [data-ver="ai"]').getAttribute('aria-pressed') === 'true');
    assert.notEqual(await verse2(page), original2, 'verse 2 is the AI translation');
    assert.ok(await page.$('#reader .ai-note'), 'AI note below the text');

    // താരതമ്യം: the original, with the AI translation under each verse, changed words marked
    await page.click('#reader .ver-switch [data-ver="cmp"]');
    await waitFor(page, () => !!document.querySelector('#reader .ai-line'));
    assert.ok((await verse2(page)).startsWith(original2.trim().slice(0, 20)), 'the original stays on top');
    assert.ok(await page.$('#reader .v[data-v="2"] .ai-line ins'), 'changed words are marked');

    // the user hides it in Aa: back to the original, no switch
    await page.click('#btnSettings');
    await waitFor(page, () => document.getElementById('dlgSettings').open);
    await page.click('#optAiView');
    await waitFor(page, () => !document.querySelector('#reader .ver-switch'));
    assert.equal(await page.$('#reader .ai-line'), null);
    assert.equal(await verse2(page), original2);
    await page.click('#optAiView');
    await waitFor(page, () => !!document.querySelector('#reader .ver-switch'));
    await page.keyboard.press('Escape');

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
