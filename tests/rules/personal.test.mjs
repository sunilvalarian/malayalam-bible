// firestore.rules → userdata/{uid}, passkeys/{id}, passkeyChallenges/{id}
import { describe, it, beforeEach } from 'node:test';
import { setup, assertSucceeds, assertFails, ts, del, Timestamp } from './helpers.mjs';

const t = setup();

describe('userdata (own highlights / bookmarks / notes)', () => {
  beforeEach(() => t.seedUsers());
  const patch = () => ({ updatedAt: ts(), hl: { 'GEN.1.1': 'yellow' }, bm: { 'GEN.1': 1 } });

  it('a reader reads and writes their own document (merge, as patchUserData)', async () => {
    const ref = t.as.reader().collection('userdata').doc('reader1');
    await assertSucceeds(ref.set(patch(), { merge: true }));
    await assertSucceeds(ref.set({ updatedAt: ts(), hl: { 'GEN.1.1': del() } }, { merge: true }));
    await assertSucceeds(ref.get());
    await assertSucceeds(ref.delete());
  });
  it('the owner without a profile document may use it too', async () => {
    await assertSucceeds(t.user('ownerNew', 'sunilvalarian@gmail.com').collection('userdata').doc('ownerNew').set(patch()));
  });
  it('another user\'s document, blocked users, users without profile and visitors are refused', async () => {
    await t.seed((db) => db.collection('userdata').doc('reader2').set({ hl: {} }));
    await assertFails(t.as.reader().collection('userdata').doc('reader2').get());
    await assertFails(t.as.reader().collection('userdata').doc('reader2').set(patch()));
    await assertFails(t.as.admin().collection('userdata').doc('reader2').get());
    await assertFails(t.as.blocked().collection('userdata').doc('blocked1').set(patch()));
    await assertFails(t.as.blocked().collection('userdata').doc('blocked1').get());
    await assertFails(t.user('nobody', 'nobody@example.com').collection('userdata').doc('nobody').set(patch()));
    await assertFails(t.anon().collection('userdata').doc('reader1').get());
  });
});

describe('passkeys', () => {
  beforeEach(() => t.seedUsers());
  const ID = 'AbCdEfGhIjKlMnOp_-12345678';
  // what Cloud.registerPasskey() writes
  const pk = (uid, over = {}) => ({
    uid, publicKey: 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' + 'A'.repeat(60), alg: -7, counter: 0,
    name: 'പാസ്‌കീ', transports: ['internal', 'hybrid'], createdAt: ts(), lastUsedAt: null, ...over,
  });
  const col = (db) => db.collection('passkeys');
  const seedPk = (id, uid) => t.seed((db) => col(db).doc(id).set({ ...pk(uid), createdAt: Timestamp.now() }));

  it('an active user registers a passkey for their own account', async () => {
    await assertSucceeds(col(t.as.reader()).doc(ID).set(pk('reader1')));
    const noTransports = pk('editor1', { alg: -257 }); delete noTransports.transports;
    await assertSucceeds(col(t.as.editor()).doc('X'.repeat(16)).set(noTransports));
  });
  it('bad registrations are refused', async () => {
    const c = col(t.as.reader());
    await assertFails(c.doc(ID).set(pk('reader2')));
    await assertFails(c.doc('short123').set(pk('reader1')));
    await assertFails(c.doc('AbCdEfGhIjKlMnOp+AB==').set(pk('reader1')));
    await assertFails(c.doc(ID).set(pk('reader1', { alg: -8 })));
    await assertFails(c.doc(ID).set(pk('reader1', { counter: 5 })));
    await assertFails(c.doc(ID).set(pk('reader1', { publicKey: 'short' })));
    await assertFails(c.doc(ID).set(pk('reader1', { name: 'x'.repeat(61) })));
    await assertFails(c.doc(ID).set(pk('reader1', { transports: 'usb' })));
    await assertFails(c.doc(ID).set(pk('reader1', { lastUsedAt: Timestamp.now() })));
    await assertFails(c.doc(ID).set(pk('reader1', { createdAt: Timestamp.now() })));
    await assertFails(c.doc(ID).set(pk('reader1', { extra: 1 })));
    await assertFails(col(t.as.blocked()).doc(ID).set(pk('blocked1')));
    await assertFails(col(t.anon()).doc(ID).set(pk('reader1')));
  });
  it('read / list / delete: own passkeys, admins all; nobody updates', async () => {
    await seedPk(ID, 'reader1');
    await seedPk('Other0000000000000001', 'reader2');
    await assertSucceeds(col(t.as.reader()).doc(ID).get());
    await assertSucceeds(col(t.as.reader()).where('uid', '==', 'reader1').get());      // listMyPasskeys
    await assertFails(col(t.as.reader()).doc('Other0000000000000001').get());
    await assertFails(col(t.as.reader()).get());
    await assertSucceeds(col(t.as.admin()).get());                                     // listAllPasskeys
    await assertFails(col(t.as.reader()).doc(ID).update({ counter: 9 }));
    await assertFails(col(t.as.admin()).doc(ID).update({ name: 'x' }));
    await assertFails(col(t.as.reader()).doc('Other0000000000000001').delete());
    await assertSucceeds(col(t.as.reader()).doc(ID).delete());
    await assertSucceeds(col(t.as.admin()).doc('Other0000000000000001').delete());
  });
  it('passkeyChallenges are closed to every client', async () => {
    await assertFails(t.as.owner().collection('passkeyChallenges').doc('abc').get());
    await assertFails(t.as.owner().collection('passkeyChallenges').doc('abc').set({ t: 1 }));
    await assertFails(t.anon().collection('passkeyChallenges').doc('abc').set({ t: 1 }));
  });
});
