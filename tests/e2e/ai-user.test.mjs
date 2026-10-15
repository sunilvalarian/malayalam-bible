// Scenario 7: the AI translation above the chapter editor is switched on per user by an admin
// (portal → ഉപയോക്താക്കൾ → AI). The editor's Aa setting and the panel follow live.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  READER, PORTAL, OWNER, launch, watch, waitCloud, waitVerses, waitFor, sleep,
  clearEmulators, createUser, setDoc, getDoc, uniq, badErrors, debugErrors,
} from './helpers.mjs';

const OWNER_PW = 'owner-pass-123';
let editor;
before(async () => {
  await clearEmulators();
  await createUser(OWNER, OWNER_PW, { verified: true, name: 'Sunil' });
  editor = await createUser(uniq('editor'), 'editor-pass-1', { verified: true, name: 'Eddie' });
  await setDoc(`users/${editor.uid}`, { email: editor.email, name: 'Eddie', role: 'editor', provider: 'password', createdAt: new Date(), lastLogin: new Date() });
});

const aiShown = (page) => page.evaluate(() => ({
  setting: !document.getElementById('optAiDiff').closest('label').hidden,
  panel: !document.getElementById('edAi').hidden,
}));

test('7. AI translation per user: off until an admin switches it on in the portal, then live in the editor', async (t) => {
  const eb = await launch();
  const ab = await launch();   // a second browser profile: the admin's sign-in mustn't replace the editor's
  try {
    const page = await eb.browser.newPage();
    const w = watch(page);
    await page.goto(READER + '#/GEN/1', { waitUntil: 'load' });
    await waitVerses(page);
    await waitCloud(page);
    await page.evaluate((e, p) => window.Cloud.signIn(e, p), editor.email, editor.password);
    await waitFor(page, () => window.Cloud.user && window.Cloud.role === 'editor', { timeout: 20000 });
    await sleep(800);

    // off by default: no Aa setting, no panel in the editor
    await page.keyboard.press('e');
    await waitFor(page, () => document.getElementById('dlgEditor').open);
    await sleep(1500);
    assert.deepEqual(await aiShown(page), { setting: false, panel: false }, 'nothing before an admin switches it on');
    assert.equal(await page.evaluate(() => !!window.AI_BIBLE), false, 'ai-data.js not even loaded');

    // the admin switches it on in the portal
    const admin = await ab.browser.newPage();
    const aw = watch(admin);
    await admin.goto(PORTAL, { waitUntil: 'load' });
    await waitCloud(admin);
    await admin.evaluate((e, p) => window.Cloud.signIn(e, p), OWNER, OWNER_PW);
    await waitFor(admin, () => !document.getElementById('admShell').hidden && window.Cloud.role === 'admin', { timeout: 20000 });
    await admin.evaluate(() => { location.hash = '#users'; });
    const box = `#userTable .u-ai[data-uid="${editor.uid}"]`;
    await admin.waitForSelector(box, { visible: true, timeout: 20000 });
    assert.equal(await admin.$eval(box, (b) => b.checked), false);
    await admin.click(box);
    for (let i = 0; i < 50 && (await getDoc(`users/${editor.uid}`)).ai !== true; i++) await sleep(200);
    assert.equal((await getDoc(`users/${editor.uid}`)).ai, true, 'users/{uid}.ai saved');

    // the editor's open chapter editor shows the panel without a reload, and the Aa setting appears
    await waitFor(page, () => !document.getElementById('edAi').hidden, { timeout: 20000 });
    assert.deepEqual(await aiShown(page), { setting: true, panel: true });
    assert.match(await page.$eval('#edAiSum', (e) => e.textContent), /AI പരിഭാഷ: \d+ വാക്യത്തിൽ മാറ്റം/);

    // and off again
    await admin.click(box);
    await waitFor(page, () => document.getElementById('edAi').hidden, { timeout: 20000 });
    assert.deepEqual(await aiShown(page), { setting: false, panel: false });

    // a user can't switch it on for themselves (firestore.rules)
    const self = await page.evaluate((uid) => window.Cloud.setAi(uid, true).then(() => 'ok', (e) => e.code || String(e)), editor.uid);
    assert.match(self, /permission-denied/);

    debugErrors(t, w);
    assert.deepEqual(badErrors(w), [], 'no unexpected errors (editor)');
    assert.deepEqual(badErrors(aw), [], 'no unexpected errors (portal)');
  } finally {
    await eb.close();
    await ab.close();
  }
});
