// firestore.rules → accessCodes/{code} and the batched redeem write (README "Access codes")
import { describe, it, beforeEach } from 'node:test';
import { setup, assertSucceeds, assertFails, ts, Timestamp, OWNER, HOUR, DAY, inMs } from './helpers.mjs';

const t = setup();
const CODE = 'K7QM4XPA';
const codes = (db) => db.collection('accessCodes');
const newCode = (by, over = {}) => ({
  role: 'editor', note: 'for Abel', createdBy: by, createdAt: ts(), expiresAt: inMs(24 * HOUR),
  used: false, usedBy: null, usedAt: null, revoked: false, ...over,
});
const seedCode = (id, over = {}) => t.seed((db) => codes(db).doc(id).set({
  role: 'editor', note: '', createdBy: OWNER, createdAt: Timestamp.now(), expiresAt: inMs(24 * HOUR),
  used: false, usedBy: null, usedAt: null, revoked: false, ...over,
}));
// what Cloud.redeemCode() commits
function redeem(db, uid, code, role, { profile = true, mark = true, usedBy = uid, extra = {} } = {}) {
  const b = db.batch();
  if (profile) b.update(db.collection('users').doc(uid), { role, redeemedCode: code, ...extra });
  if (mark) b.update(codes(db).doc(code), { used: true, usedBy, usedAt: ts() });
  return b.commit();
}
const roleOf = async (uid) => {
  let r;
  await t.seed(async (db) => { r = (await db.collection('users').doc(uid).get()).data().role; });
  return r;
};

describe('accessCodes: create / read / revoke', () => {
  beforeEach(() => t.seedUsers());

  it('an admin creates a code', async () => {
    await assertSucceeds(codes(t.as.admin()).doc(CODE).set(newCode('admin@example.com')));
    await assertSucceeds(codes(t.as.owner()).doc('ABCDEFGHJKMNPQRS').set(newCode(OWNER, { role: 'admin', expiresAt: inMs(30 * DAY) })));
  });
  it('non-admins can\'t create codes', async () => {
    await assertFails(codes(t.as.editor()).doc(CODE).set(newCode('editor@example.com')));
    await assertFails(codes(t.as.reader()).doc(CODE).set(newCode('reader@example.com')));
    await assertFails(codes(t.anon()).doc(CODE).set(newCode('x@example.com')));
  });
  it('bad codes are refused', async () => {
    const c = codes(t.as.admin());
    const by = 'admin@example.com';
    await assertFails(c.doc('K7QM4XP').set(newCode(by)));                // 7 chars
    await assertFails(c.doc('K7QM4XPO').set(newCode(by)));               // look-alike O
    await assertFails(c.doc('k7qm4xpa').set(newCode(by)));               // lower case
    await assertFails(c.doc('K7QM-4XPA').set(newCode(by)));              // dash
    await assertFails(c.doc(CODE).set(newCode(by, { role: 'reader' })));
    await assertFails(c.doc(CODE).set(newCode(by, { role: 'none' })));
    await assertFails(c.doc(CODE).set(newCode('owner@example.com')));
    await assertFails(c.doc(CODE).set(newCode(by, { createdAt: Timestamp.now() })));
    await assertFails(c.doc(CODE).set(newCode(by, { expiresAt: inMs(-HOUR) })));
    await assertFails(c.doc(CODE).set(newCode(by, { expiresAt: inMs(32 * DAY) })));
    await assertFails(c.doc(CODE).set(newCode(by, { used: true })));
    await assertFails(c.doc(CODE).set(newCode(by, { usedBy: 'reader1' })));
    await assertFails(c.doc(CODE).set(newCode(by, { revoked: true })));
    await assertFails(c.doc(CODE).set(newCode(by, { note: 'x'.repeat(101) })));
    await assertFails(c.doc(CODE).set(newCode(by, { extra: 1 })));
    const missing = newCode(by); delete missing.usedAt;
    await assertFails(c.doc(CODE).set(missing));
  });
  it('an existing code can\'t be overwritten by create', async () => {
    await seedCode(CODE);
    await assertFails(codes(t.as.admin()).doc(CODE).set(newCode('admin@example.com')));
  });
  it('get: any signed-in user; list: admins only', async () => {
    await seedCode(CODE);
    await assertSucceeds(codes(t.as.reader()).doc(CODE).get());
    await assertSucceeds(codes(t.as.blocked()).doc(CODE).get());
    await assertFails(codes(t.anon()).doc(CODE).get());
    await assertFails(codes(t.as.reader()).get());
    await assertFails(codes(t.as.editor()).get());
    await assertSucceeds(codes(t.as.admin()).get());
  });
  it('revoke: admin sets revoked → true, nothing else', async () => {
    await seedCode(CODE);
    await assertFails(codes(t.as.editor()).doc(CODE).update({ revoked: true }));
    await assertFails(codes(t.as.admin()).doc(CODE).update({ revoked: true, note: 'x' }));
    await assertFails(codes(t.as.admin()).doc(CODE).update({ expiresAt: inMs(10 * DAY) }));
    await assertSucceeds(codes(t.as.admin()).doc(CODE).update({ revoked: true }));
    await assertFails(codes(t.as.admin()).doc(CODE).update({ revoked: false }));
  });
  it('an admin can\'t reset a used code', async () => {
    await seedCode(CODE, { used: true, usedBy: 'reader1', usedAt: Timestamp.now() });
    await assertFails(codes(t.as.admin()).doc(CODE).update({ used: false, usedBy: null, usedAt: null }));
  });
  it('nobody deletes a code', async () => {
    await seedCode(CODE);
    await assertFails(codes(t.as.owner()).doc(CODE).delete());
    await assertFails(codes(t.as.admin()).doc(CODE).delete());
  });
});

describe('accessCodes: redeeming (one batched write)', () => {
  beforeEach(() => t.seedUsers());

  it('a reader redeems an editor code, e-mail not verified', async () => {
    await seedCode(CODE);
    await assertSucceeds(redeem(t.user('reader1', 'reader@example.com', false), 'reader1', CODE, 'editor'));
    if ((await roleOf('reader1')) !== 'editor') throw new Error('role not applied');
    // then logs it like Cloud.redeemCode (now an editor)
    await assertSucceeds(t.as.reader().collection('changes').add({ action: 'redeem', book: '-', chapter: 0, by: 'reader@example.com', at: ts(), detail: 'editor · …4XPA' }));
  });
  it('an editor redeems an admin code', async () => {
    await seedCode(CODE, { role: 'admin' });
    await assertSucceeds(redeem(t.as.editor(), 'editor1', CODE, 'admin'));
  });
  it('a code used once can\'t be used again (same or another user)', async () => {
    await seedCode(CODE);
    await assertSucceeds(redeem(t.as.reader(), 'reader1', CODE, 'editor'));
    await assertFails(redeem(t.as.reader2(), 'reader2', CODE, 'editor'));
    await t.seed((db) => db.collection('users').doc('reader1').update({ role: 'reader' }));   // demoted
    await assertFails(redeem(t.as.reader(), 'reader1', CODE, 'editor'));
    // the old redeemedCode is worthless: role back without a new code
    await assertFails(t.as.reader().collection('users').doc('reader1').update({ role: 'editor' }));
  });
  it('neither half works alone', async () => {
    await seedCode(CODE);
    await assertFails(redeem(t.as.reader(), 'reader1', CODE, 'editor', { mark: false }));
    await assertFails(redeem(t.as.reader(), 'reader1', CODE, 'editor', { profile: false }));
  });
  it('the role must be exactly the code\'s role', async () => {
    await seedCode(CODE);
    await assertFails(redeem(t.as.reader(), 'reader1', CODE, 'admin'));
  });
  it('nothing else may change in the profile, and usedBy must be the user', async () => {
    await seedCode(CODE);
    await assertFails(redeem(t.as.reader(), 'reader1', CODE, 'editor', { extra: { name: 'x' } }));
    await assertFails(redeem(t.as.reader(), 'reader1', CODE, 'editor', { usedBy: 'reader2' }));
  });
  it('not for another user\'s profile', async () => {
    await seedCode(CODE);
    const db = t.as.reader();
    const b = db.batch();
    b.update(db.collection('users').doc('reader2'), { role: 'editor', redeemedCode: CODE });
    b.update(codes(db).doc(CODE), { used: true, usedBy: 'reader2', usedAt: ts() });
    await assertFails(b.commit());
  });
  it('revoked or expired codes are refused', async () => {
    await seedCode(CODE, { revoked: true });
    await assertFails(redeem(t.as.reader(), 'reader1', CODE, 'editor'));
    await seedCode('ABCDEFGH', { expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await assertFails(redeem(t.as.reader(), 'reader1', 'ABCDEFGH', 'editor'));
  });
  it('no same-role or lower-role codes, no blocked users', async () => {
    await seedCode(CODE);   // editor
    await assertFails(redeem(t.as.editor(), 'editor1', CODE, 'editor'));
    await assertFails(redeem(t.as.admin(), 'admin1', CODE, 'editor'));
    await assertFails(redeem(t.as.blocked(), 'blocked1', CODE, 'editor'));
  });
  it('a second code works after the first (redeemedCode changes)', async () => {
    await seedCode(CODE);
    await seedCode('ABCDEFGH', { role: 'admin' });
    await assertSucceeds(redeem(t.as.reader(), 'reader1', CODE, 'editor'));
    await assertSucceeds(redeem(t.as.reader(), 'reader1', 'ABCDEFGH', 'admin'));
  });
  it('a code id that doesn\'t exist is refused', async () => {
    await assertFails(redeem(t.as.reader(), 'reader1', 'ZZZZZZZZ', 'editor'));
  });
});
