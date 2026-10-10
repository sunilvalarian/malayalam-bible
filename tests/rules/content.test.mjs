// firestore.rules → chapters/{id}, settings/{id}, changes/{id}
import { describe, it, beforeEach } from 'node:test';
import { setup, assertSucceeds, assertFails, ts, Timestamp, OWNER } from './helpers.mjs';

const t = setup();
const ITEMS = [{ v: 1, t: 'ആദിയിൽ ദൈവം ആകാശവും ഭൂമിയും സൃഷ്ടിച്ചു.' }, { v: 2, t: 'text' }];
// the chapters in app/js/data.js — same as isBundled() in firestore.rules
const isBundled = (b, c) => (b === 'GEN' && c >= 1 && c <= 50) || (b === 'EXO' && c >= 1 && c <= 3)
  || (b === 'MAT' && c >= 1 && c <= 28) || (b === 'MRK' && c >= 1 && c <= 16)
  || (b === 'LUK' && c >= 1 && c <= 24) || (b === 'ACT' && c >= 1 && c <= 28)
  || (b === 'ROM' && c >= 1 && c <= 16) || (b === '1CO' && c >= 1 && c <= 16) || (b === '2CO' && c >= 1 && c <= 13)
  || (b === 'GAL' && c >= 1 && c <= 6) || (b === 'EPH' && c >= 1 && c <= 6)
  || (b === 'PHP' && c >= 1 && c <= 4) || (b === 'COL' && c >= 1 && c <= 4)
  || (b === '1TH' && c >= 1 && c <= 5) || (b === '2TH' && c >= 1 && c <= 3)
  || (b === '1TI' && c >= 1 && c <= 6) || (b === '2TI' && c >= 1 && c <= 4)
  || (b === 'TIT' && c >= 1 && c <= 3) || (b === 'PHM' && c === 1)
  || (b === 'HEB' && c >= 1 && c <= 13) || (b === 'JAS' && c >= 1 && c <= 5)
  || (b === '1PE' && c >= 1 && c <= 5) || (b === '2PE' && c >= 1 && c <= 3)
  || (b === 'JHN' && c >= 1 && c <= 21) || (b === '1JN' && c >= 1 && c <= 5)
  || (b === '2JN' && c === 1) || (b === '3JN' && c === 1)
  || (b === 'JUD' && c === 1) || (b === 'REV' && c >= 1 && c <= 22);
// what Cloud.saveChapter() writes
const chapter = (book, c, by, over = {}) => ({
  book, chapter: c, items: ITEMS, deleted: false, bookName: null,
  hasBase: isBundled(book, c), updatedAt: ts(), updatedBy: by, ...over,
});
const ch = (db, id) => db.collection('chapters').doc(id);
const seedChapter = (id, data) => t.seed((db) => ch(db, id).set({ ...data, updatedAt: Timestamp.now() }));
const E = 'editor@example.com';
const R = 'reader@example.com';

describe('chapters: editors', () => {
  beforeEach(() => t.seedUsers());

  it('anyone reads chapters', async () => {
    await seedChapter('GEN_3', chapter('GEN', 3, E));
    await assertSucceeds(ch(t.anon(), 'GEN_3').get());
    await assertSucceeds(t.anon().collection('chapters').get());
  });
  it('an editor saves a bundled chapter edit and a new uploaded chapter', async () => {
    await assertSucceeds(ch(t.as.editor(), 'GEN_3').set(chapter('GEN', 3, E)));
    await assertSucceeds(ch(t.as.editor(), 'EXO_10').set(chapter('EXO', 10, E, { bookName: 'പുറപ്പാട്' })));
    await assertSucceeds(ch(t.as.editor(), 'GEN_3').set(chapter('GEN', 3, E, { items: [{ v: 1, t: 'changed' }] })));
  });
  it('an editor saves edits to the bundled Exodus and New Testament chapters', async () => {
    await assertSucceeds(ch(t.as.editor(), 'EXO_1').set(chapter('EXO', 1, E)));
    await assertSucceeds(ch(t.as.editor(), 'MAT_17').set(chapter('MAT', 17, E)));
    await assertSucceeds(ch(t.as.editor(), 'MRK_16').set(chapter('MRK', 16, E)));
    await assertSucceeds(ch(t.as.editor(), 'LUK_24').set(chapter('LUK', 24, E)));
    await assertSucceeds(ch(t.as.editor(), 'ACT_28').set(chapter('ACT', 28, E)));
    await assertSucceeds(ch(t.as.editor(), '2CO_13').set(chapter('2CO', 13, E)));
    await assertSucceeds(ch(t.as.editor(), 'GAL_6').set(chapter('GAL', 6, E)));
    await assertSucceeds(ch(t.as.editor(), 'COL_4').set(chapter('COL', 4, E)));
    await assertSucceeds(ch(t.as.editor(), 'HEB_13').set(chapter('HEB', 13, E)));
    await assertSucceeds(ch(t.as.editor(), '2PE_3').set(chapter('2PE', 3, E)));
    await assertSucceeds(ch(t.as.editor(), 'JHN_21').set(chapter('JHN', 21, E)));
    await assertSucceeds(ch(t.as.editor(), '3JN_1').set(chapter('3JN', 1, E)));
    await assertSucceeds(ch(t.as.editor(), 'REV_22').set(chapter('REV', 22, E)));
    await assertFails(ch(t.as.editor(), 'REV_23').set(chapter('REV', 23, E, { hasBase: true })));  // no such chapter
    await assertFails(ch(t.as.editor(), 'LEV_1').set(chapter('LEV', 1, E, { hasBase: true })));   // not bundled
  });
  it('the required fields are checked', async () => {
    const db = t.as.editor();
    await assertFails(ch(db, 'GEN_4').set(chapter('GEN', 3, E)));                          // id mismatch
    await assertFails(ch(db, 'EXO_10').set(chapter('EXO', 10, E, { hasBase: true })));        // fake "bundled"
    await assertFails(ch(db, 'GEN_3').set(chapter('GEN', 3, E, { hasBase: false })));
    await assertFails(ch(db, 'GEN_3').set(chapter('GEN', 3, 'someone@example.com')));
    await assertFails(ch(db, 'GEN_3').set(chapter('GEN', 3, E, { updatedAt: Timestamp.now() })));
    await assertFails(ch(db, 'GEN_3').set(chapter('GEN', 3, E, { items: [] })));
    await assertFails(ch(db, 'GEN_3').set(chapter('GEN', 3, E, { extra: 1 })));
    await assertFails(ch(db, 'GEN_3').set(chapter('GEN', 3, E, { chapter: '3' })));
    await assertFails(ch(db, 'GEN_0').set(chapter('GEN', 0, E)));
    await assertFails(ch(db, 'EXO_10').set(chapter('EXO', 10, E, { bookName: 'x'.repeat(61) })));
    const noItems = chapter('GEN', 3, E); delete noItems.items;
    await assertFails(ch(db, 'GEN_3').set(noItems));
  });
  it('hiding a chapter (deleted: true) is admin-only', async () => {
    await assertFails(ch(t.as.editor(), 'GEN_3').set(chapter('GEN', 3, E, { items: [], deleted: true })));
    await assertSucceeds(ch(t.as.admin(), 'GEN_3').set(chapter('GEN', 3, 'admin@example.com', { items: [], deleted: true })));
    await assertFails(ch(t.as.editor(), 'GEN_3').set(chapter('GEN', 3, E, { items: [], deleted: true })));
  });
  it('delete: editors only "restore original" (hasBase), admins anything', async () => {
    await seedChapter('GEN_3', chapter('GEN', 3, E));
    await seedChapter('EXO_10', chapter('EXO', 10, E));
    await assertFails(ch(t.as.reader(), 'GEN_3').delete());
    await assertFails(ch(t.as.editor(), 'EXO_10').delete());
    await assertSucceeds(ch(t.as.editor(), 'GEN_3').delete());
    await assertSucceeds(ch(t.as.admin(), 'EXO_10').delete());
  });
  it('readers, blocked users and visitors can\'t write (nothing open)', async () => {
    await assertFails(ch(t.as.reader(), 'GEN_3').set(chapter('GEN', 3, R)));
    await assertFails(ch(t.as.blocked(), 'GEN_3').set(chapter('GEN', 3, 'blocked@example.com')));
    await assertFails(ch(t.anon(), 'GEN_3').set(chapter('GEN', 3, R)));
    // signed in, but no profile yet
    await assertFails(ch(t.user('nobody', 'nobody@example.com'), 'GEN_3').set(chapter('GEN', 3, 'nobody@example.com')));
  });
});

describe('chapters: open to everyone (settings/permissions)', () => {
  beforeEach(async () => {
    await t.seedUsers();
    await seedChapter('EXO_10', chapter('EXO', 10, E));
    await seedChapter('GEN_5', chapter('GEN', 5, 'admin@example.com', { items: [], deleted: true }));
  });

  it('openUpload: a reader creates or overwrites any chapter', async () => {
    await t.setSettings({ openUpload: true });
    await assertSucceeds(ch(t.as.reader(), 'LEV_2').set(chapter('LEV', 2, R)));
    await assertSucceeds(ch(t.as.reader(), 'GEN_3').set(chapter('GEN', 3, R)));
    await assertSucceeds(ch(t.as.reader(), 'EXO_10').set(chapter('EXO', 10, R)));
  });
  it('openEdit: a reader edits existing visible chapters and bundled ones, but adds no new book', async () => {
    await t.setSettings({ openEdit: true });
    await assertSucceeds(ch(t.as.reader(), 'GEN_3').set(chapter('GEN', 3, R)));      // override of a bundled chapter
    await assertSucceeds(ch(t.as.reader(), 'EXO_10').set(chapter('EXO', 10, R)));      // existing uploaded chapter
    await assertFails(ch(t.as.reader(), 'LEV_2').set(chapter('LEV', 2, R)));         // new, not bundled
  });
  it('a hidden chapter stays hidden for readers, also with both switches on', async () => {
    await t.setSettings({ openEdit: true, openUpload: true });
    await assertFails(ch(t.as.reader(), 'GEN_5').set(chapter('GEN', 5, R)));
    await assertSucceeds(ch(t.as.editor(), 'GEN_5').set(chapter('GEN', 5, E)));      // editors may un-hide
  });
  it('readers never hide or delete, and must sign their own e-mail', async () => {
    await t.setSettings({ openEdit: true, openUpload: true });
    await assertFails(ch(t.as.reader(), 'EXO_10').set(chapter('EXO', 10, R, { items: [], deleted: true })));
    await assertFails(ch(t.as.reader(), 'EXO_10').delete());
    await assertFails(ch(t.as.reader(), 'EXO_10').set(chapter('EXO', 10, E)));
  });
  it('blocked users and visitors stay read-only', async () => {
    await t.setSettings({ openEdit: true, openUpload: true });
    await assertFails(ch(t.as.blocked(), 'GEN_3').set(chapter('GEN', 3, 'blocked@example.com')));
    await assertFails(ch(t.anon(), 'GEN_3').set(chapter('GEN', 3, R)));
  });
  it('switched off again: readers are refused', async () => {
    await t.setSettings({ openEdit: false, openUpload: false });
    await assertFails(ch(t.as.reader(), 'GEN_3').set(chapter('GEN', 3, R)));
    await assertFails(ch(t.as.reader(), 'EXO_10').set(chapter('EXO', 10, R)));
  });
});

describe('settings', () => {
  beforeEach(() => t.seedUsers());
  const s = (by, over = {}) => ({ openUpload: true, openEdit: false, updatedBy: by, updatedAt: ts(), ...over });

  it('everyone reads settings', async () => {
    await t.setSettings({ openEdit: true });
    await assertSucceeds(t.anon().collection('settings').doc('permissions').get());
  });
  it('admins write settings/permissions (as Cloud.saveSettings)', async () => {
    await assertSucceeds(t.as.admin().collection('settings').doc('permissions').set(s('admin@example.com')));
    await assertSucceeds(t.as.owner().collection('settings').doc('permissions').set(s(OWNER, { openUpload: false })));
  });
  it('non-admins, other ids and bad fields are refused; nobody deletes', async () => {
    await assertFails(t.as.editor().collection('settings').doc('permissions').set(s(E)));
    await assertFails(t.as.reader().collection('settings').doc('permissions').set(s(R)));
    const a = t.as.admin().collection('settings');
    await assertFails(a.doc('other').set(s('admin@example.com')));
    await assertFails(a.doc('permissions').set(s('owner@example.com')));
    await assertFails(a.doc('permissions').set(s('admin@example.com', { openEdit: 'yes' })));
    await assertFails(a.doc('permissions').set(s('admin@example.com', { updatedAt: Timestamp.now() })));
    await assertFails(a.doc('permissions').set(s('admin@example.com', { extra: 1 })));
    await assertFails(a.doc('permissions').set({ openUpload: true, updatedBy: 'admin@example.com', updatedAt: ts() }));
    await t.setSettings({ openEdit: true });
    await assertFails(a.doc('permissions').delete());
  });
});

describe('changes (activity log)', () => {
  beforeEach(() => t.seedUsers());
  const log = (action, by, over = {}) => ({ action, book: 'GEN', chapter: 3, by, at: ts(), ...over });
  const add = (db, doc) => db.collection('changes').add(doc);

  it('editors log any action', async () => {
    await assertSucceeds(add(t.as.editor(), log('edit', E)));
    await assertSucceeds(add(t.as.editor(), log('revert', E)));
    await assertSucceeds(add(t.as.admin(), log('reset-all', 'admin@example.com', { book: '-', chapter: 0 })));
  });
  it('fields are checked', async () => {
    await assertFails(add(t.as.editor(), log('edit', R)));
    await assertFails(add(t.as.editor(), log('edit', E, { at: Timestamp.now() })));
    await assertFails(add(t.as.editor(), log('edit', E, { detail: 'x'.repeat(201) })));
    await assertFails(add(t.as.editor(), log('edit', E, { detail: 5 })));
    await assertFails(add(t.as.editor(), log('edit', E, { extra: 1 })));
    await assertSucceeds(add(t.as.editor(), log('edit', E, { detail: 'x'.repeat(200) })));
  });
  it('readers log only edit / edit-verse / upload, only while something is open', async () => {
    await assertFails(add(t.as.reader(), log('edit', R)));
    await t.setSettings({ openEdit: true });
    await assertSucceeds(add(t.as.reader(), log('edit', R)));
    await assertSucceeds(add(t.as.reader(), log('edit-verse', R)));
    await assertSucceeds(add(t.as.reader(), log('upload', R)));
    await assertFails(add(t.as.reader(), log('revert', R)));
    await assertFails(add(t.as.reader(), log('settings', R)));
    await assertFails(add(t.as.blocked(), log('edit', 'blocked@example.com')));
    await assertFails(add(t.anon(), log('edit', R)));
  });
  it('read: admins only; nobody updates or deletes', async () => {
    let id;
    await t.seed(async (db) => { id = (await db.collection('changes').add({ action: 'edit', book: 'GEN', chapter: 1, by: E, at: Timestamp.now() })).id; });
    await assertSucceeds(t.as.admin().collection('changes').orderBy('at', 'desc').limit(51).get());
    await assertSucceeds(t.as.owner().collection('changes').where('by', '==', E).get());
    await assertFails(t.as.editor().collection('changes').get());
    await assertFails(t.as.reader().collection('changes').doc(id).get());
    await assertFails(t.as.admin().collection('changes').doc(id).update({ detail: 'x' }));
    await assertFails(t.as.admin().collection('changes').doc(id).delete());
  });
});
