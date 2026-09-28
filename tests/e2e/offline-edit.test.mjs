// Scenario 4: an editor edits a verse offline; the write (and its activity-log entry) waits in
// Firestore's offline queue, survives a reload while still offline, and goes up once online.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  READER, launch, watch, waitCloud, waitVerses, waitServiceWorker, waitFor, sleep, setOffline,
  clearEmulators, createUser, setDoc, getDoc, listDocs, uniq, badErrors, debugErrors, tap,
} from './helpers.mjs';

let editor;
before(async () => {
  await clearEmulators();
  editor = await createUser(uniq('editor'), 'editor-pass-1', { verified: true, name: 'Eddie' });
  await setDoc(`users/${editor.uid}`, { email: editor.email, name: 'Eddie', role: 'editor', provider: 'password', createdAt: new Date(), lastLogin: new Date() });
});

const NEW_TEXT = 'ആദിയിൽ ദൈവം ആകാശവും ഭൂമിയും സൃഷ്ടിച്ചു (ഓഫ്‌ലൈൻ തിരുത്ത്).';

test('4. offline verse edit by an editor is queued and synced when back online', async (t) => {
  const b = await launch();
  try {
    const page = await b.browser.newPage();
    const w = watch(page);
    await page.goto(READER + '#/GEN/1', { waitUntil: 'load' });
    await waitVerses(page);
    await waitCloud(page);
    await waitServiceWorker(page);
    await page.evaluate((e, p) => window.Cloud.signIn(e, p), editor.email, editor.password);
    await waitFor(page, () => window.Cloud.user && window.Cloud.role === 'editor', { timeout: 20000 });
    await sleep(500);

    await setOffline(page, true);
    await tap(page, '#reader .v[data-v="1"]');
    await waitFor(page, () => !document.getElementById('actionbar').hidden && !document.querySelector('#actionbar [data-act="edit"]').disabled);
    await tap(page, '#actionbar [data-act="edit"]');
    await waitFor(page, () => document.getElementById('dlgVerseEdit').open);
    await page.evaluate((t) => { document.getElementById('verseEditText').value = t; }, NEW_TEXT);
    await tap(page, '#dlgVerseEdit button[value="save"]');
    await waitFor(page, (t) => document.querySelector('#reader .v[data-v="1"]').textContent.includes(t), {}, NEW_TEXT);
    await sleep(1000);
    assert.equal(await getDoc('chapters/GEN_1'), null, 'nothing reached Firestore while offline');

    // reload while still offline: the edit is still shown, and still waiting
    await page.reload({ waitUntil: 'load' });
    await setOffline(page, true);
    await waitVerses(page);
    await waitFor(page, () => window.Cloud && window.Cloud.ready && window.Cloud.authKnown, { timeout: 25000 });
    assert.ok((await page.$eval('#reader .v[data-v="1"]', (e) => e.textContent)).includes(NEW_TEXT), 'edit kept across an offline reload');
    assert.equal(await page.evaluate(() => window.Cloud.role), 'editor');

    // online again: Firestore sends the queued write and the log entry
    await setOffline(page, false);
    const end = Date.now() + 20000;
    let ch = null;
    while (Date.now() < end && !(ch = await getDoc('chapters/GEN_1'))) await sleep(300);
    assert.ok(ch, 'the chapter edit reached Firestore once online');
    assert.equal(ch.updatedBy, editor.email);
    assert.equal(ch.hasBase, true);
    assert.ok(ch.items.some((it) => it.v === 1 && it.t === NEW_TEXT), 'with the new verse text');
    let log = [];
    while (Date.now() < end + 10000 && !(log = (await listDocs('changes')).filter((c) => c.action === 'edit-verse')).length) await sleep(300);
    assert.equal(log.length, 1, "one 'edit-verse' activity-log entry");
    assert.equal(log[0].by, editor.email);

    debugErrors(t, w);
    assert.deepEqual(badErrors(w, true), [], 'no unexpected errors');
  } finally { await b.close(); }
});
