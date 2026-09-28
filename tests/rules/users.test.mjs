// firestore.rules → users/{uid} and invites/{email}
import { describe, it, beforeEach } from 'node:test';
import { setup, assertSucceeds, assertFails, ts, del as firebaseDelete, Timestamp, OWNER, PRESET_EDITOR, DAY } from './helpers.mjs';

const t = setup();
const profile = (email, role = 'reader', over = {}) => ({
  email, name: 'Name', role, provider: 'password', createdAt: ts(), lastLogin: ts(), ...over,
});
const users = (db) => db.collection('users');

describe('users: first sign-in (create)', () => {
  it('a new user creates their own profile as reader', async () => {
    await assertSucceeds(users(t.user('u1', 'u1@example.com', false)).doc('u1').set(profile('u1@example.com')));
  });
  it('the e-mail is stored lower case (token e-mail in any case)', async () => {
    const db = t.user('u2', 'Mixed@Example.COM');
    await assertFails(users(db).doc('u2').set(profile('Mixed@Example.COM')));
    await assertSucceeds(users(db).doc('u2').set(profile('mixed@example.com')));
  });
  it('someone else\'s profile, another e-mail, or no sign-in is refused', async () => {
    await assertFails(users(t.user('u1', 'u1@example.com')).doc('u9').set(profile('u1@example.com')));
    await assertFails(users(t.user('u1', 'u1@example.com')).doc('u1').set(profile('other@example.com')));
    await assertFails(users(t.anon()).doc('u1').set(profile('u1@example.com')));
  });
  it('starting as editor / admin / none without a reason is refused', async () => {
    const db = t.user('u1', 'u1@example.com');
    await assertFails(users(db).doc('u1').set(profile('u1@example.com', 'editor')));
    await assertFails(users(db).doc('u1').set(profile('u1@example.com', 'admin')));
    await assertFails(users(db).doc('u1').set(profile('u1@example.com', 'none')));
  });
  it('bad fields are refused: extra key, redeemedCode, client times, bad provider, long name', async () => {
    const db = t.user('u1', 'u1@example.com');
    const ref = users(db).doc('u1');
    await assertFails(ref.set(profile('u1@example.com', 'reader', { extra: 1 })));
    await assertFails(ref.set(profile('u1@example.com', 'reader', { redeemedCode: 'ABCDEFGH' })));
    await assertFails(ref.set(profile('u1@example.com', 'reader', { createdAt: Timestamp.now() })));
    await assertFails(ref.set(profile('u1@example.com', 'reader', { lastLogin: Timestamp.now() })));
    await assertFails(ref.set(profile('u1@example.com', 'reader', { provider: 'facebook.com' })));
    await assertFails(ref.set(profile('u1@example.com', 'reader', { name: 'x'.repeat(101) })));
    await assertFails(ref.set(profile('u1@example.com', 'reader', { presetApplied: false })));
    await assertSucceeds(ref.set(profile('u1@example.com', 'reader', { provider: 'passkey' })));
  });
  it('the owner starts as admin once verified', async () => {
    await assertFails(users(t.user('own', OWNER, false)).doc('own').set(profile(OWNER, 'admin')));
    await assertSucceeds(users(t.user('own', OWNER)).doc('own').set(profile(OWNER, 'admin', { provider: 'google.com' })));
  });
  it('the preset editor starts as editor once verified', async () => {
    await assertFails(users(t.user('pe', PRESET_EDITOR, false)).doc('pe').set(profile(PRESET_EDITOR, 'editor', { presetApplied: true })));
    await assertSucceeds(users(t.user('pe', PRESET_EDITOR)).doc('pe').set(profile(PRESET_EDITOR, 'editor', { presetApplied: true })));
  });
  it('an invited e-mail starts with the invited role (verified only)', async () => {
    await t.seed((db) => db.collection('invites').doc('inv@example.com').set({ role: 'editor', by: OWNER, at: Timestamp.now() }));
    await assertFails(users(t.user('iv', 'inv@example.com', false)).doc('iv').set(profile('inv@example.com', 'editor')));
    await assertFails(users(t.user('iv', 'inv@example.com')).doc('iv').set(profile('inv@example.com', 'admin')));
    await assertSucceeds(users(t.user('iv', 'Inv@Example.com')).doc('iv').set(profile('inv@example.com', 'editor')));
  });
});

describe('users: updates by the user', () => {
  beforeEach(() => t.seedUsers());

  it('own name / lastLogin / provider may change', async () => {
    await assertSucceeds(users(t.as.reader()).doc('reader1').update({ name: 'New name', lastLogin: ts(), provider: 'google.com' }));
    await assertSucceeds(users(t.as.reader()).doc('reader1').update({ name: 'Only the name' }));
  });
  it('createdAt and lastLogin can\'t be set to a client time', async () => {
    await assertFails(users(t.as.reader()).doc('reader1').update({ createdAt: ts() }));
    await assertFails(users(t.as.reader()).doc('reader1').update({ lastLogin: Timestamp.fromMillis(Date.now() + DAY) }));
  });
  it('no self-promotion (reader → editor / admin, editor → admin)', async () => {
    await assertFails(users(t.as.reader()).doc('reader1').update({ role: 'editor' }));
    await assertFails(users(t.as.reader()).doc('reader1').update({ role: 'admin' }));
    await assertFails(users(t.as.editor()).doc('editor1').update({ role: 'admin' }));
  });
  it('a blocked user can\'t unblock themselves, but may update their name', async () => {
    await assertFails(users(t.as.blocked()).doc('blocked1').update({ role: 'reader' }));
    await assertSucceeds(users(t.as.blocked()).doc('blocked1').update({ name: 'x', lastLogin: ts() }));
  });
  it('someone else\'s profile can\'t be changed by a non-admin', async () => {
    await assertFails(users(t.as.reader()).doc('reader2').update({ name: 'x' }));
    await assertFails(users(t.as.editor()).doc('reader1').update({ role: 'editor' }));
  });
  it('an existing profile takes up an invite', async () => {
    await t.seed((db) => db.collection('invites').doc('reader@example.com').set({ role: 'admin', by: OWNER, at: Timestamp.now() }));
    await assertSucceeds(users(t.as.reader()).doc('reader1').update({ role: 'admin', lastLogin: ts() }));
  });
  it('the owner becomes admin again (e.g. after the profile was made unverified)', async () => {
    await t.seed((db) => db.collection('users').doc('owner').update({ role: 'reader' }));
    await assertSucceeds(users(t.as.owner()).doc('owner').update({ role: 'admin', lastLogin: ts() }));
  });
  it('preset editor: reader → editor once with presetApplied; a later demotion sticks', async () => {
    await t.seed((db) => db.collection('users').doc('pe').set({
      email: PRESET_EDITOR, name: 'P', role: 'reader', provider: 'password', createdAt: Timestamp.now(), lastLogin: Timestamp.now(),
    }));
    const pe = t.user('pe', PRESET_EDITOR);
    await assertFails(users(t.user('pe', PRESET_EDITOR, false)).doc('pe').update({ role: 'editor', presetApplied: true }));
    await assertFails(users(pe).doc('pe').update({ role: 'editor' }));                       // needs presetApplied
    await assertSucceeds(users(pe).doc('pe').update({ role: 'editor', presetApplied: true, lastLogin: ts() }));
    await t.seed((db) => db.collection('users').doc('pe').update({ role: 'reader' }));        // admin demoted
    await assertFails(users(pe).doc('pe').update({ role: 'editor', presetApplied: true }));
    await assertFails(users(pe).doc('pe').update({ presetApplied: firebaseDelete() }));
  });
  it('redeemedCode can\'t be set or removed outside the code flow', async () => {
    await assertFails(users(t.as.reader()).doc('reader1').update({ redeemedCode: 'ABCDEFGH' }));
    await t.seed((db) => db.collection('users').doc('reader2').update({ redeemedCode: 'ABCDEFGH' }));
    await assertFails(users(t.as.reader2()).doc('reader2').update({ redeemedCode: firebaseDelete() }));
    await assertSucceeds(users(t.as.reader2()).doc('reader2').update({ name: 'still fine' }));
  });
});

describe('users: admins', () => {
  beforeEach(() => t.seedUsers());

  it('an admin changes / blocks other users\' roles', async () => {
    await assertSucceeds(users(t.as.admin()).doc('reader1').update({ role: 'editor' }));
    await assertSucceeds(users(t.as.admin()).doc('editor1').update({ role: 'none' }));
    await assertSucceeds(users(t.as.owner()).doc('admin1').update({ role: 'reader' }));
  });
  it('only the role, and only to a known role', async () => {
    await assertFails(users(t.as.admin()).doc('reader1').update({ role: 'superuser' }));
    await assertFails(users(t.as.admin()).doc('reader1').update({ role: 'editor', name: 'x' }));
    await assertFails(users(t.as.admin()).doc('reader1').update({ redeemedCode: 'ABCDEFGH' }));
  });
  it('an admin can\'t change their own role or the owner\'s', async () => {
    await assertFails(users(t.as.admin()).doc('admin1').update({ role: 'reader' }));
    await assertFails(users(t.as.admin()).doc('owner').update({ role: 'reader' }));
    await assertFails(users(t.as.admin()).doc('owner').delete());
  });
  it('delete: admin deletes others, not themselves; non-admins can\'t', async () => {
    await assertFails(users(t.as.admin()).doc('admin1').delete());
    await assertFails(users(t.as.editor()).doc('reader1').delete());
    await assertFails(users(t.as.reader()).doc('reader1').delete());
    await assertSucceeds(users(t.as.admin()).doc('reader1').delete());
  });
  it('read: own profile, admins all (get and list)', async () => {
    await assertSucceeds(users(t.as.reader()).doc('reader1').get());
    await assertFails(users(t.as.reader()).doc('reader2').get());
    await assertFails(users(t.as.reader()).get());
    await assertFails(users(t.anon()).doc('reader1').get());
    await assertSucceeds(users(t.as.admin()).get());
    await assertSucceeds(users(t.as.owner()).doc('reader1').get());
  });
  it('a demoted admin (role reader) has no admin rights', async () => {
    await t.seed((db) => db.collection('users').doc('admin1').update({ role: 'reader' }));
    await assertFails(users(t.as.admin()).doc('reader1').update({ role: 'editor' }));
  });
  it('an unverified account that claims the owner e-mail can still be blocked / removed by an admin', async () => {
    // e.g. a password account registered with the owner's address but never verified: it stays a
    // reader (only an admin-role owner profile is protected)
    await assertSucceeds(users(t.user('squat', OWNER, false)).doc('squat').set(profile(OWNER)));
    await assertSucceeds(users(t.as.admin()).doc('squat').update({ role: 'none' }));
    await assertSucceeds(users(t.as.admin()).doc('squat').delete());
  });
});

describe('invites', () => {
  beforeEach(() => t.seedUsers());
  const inv = (by, role = 'editor', over = {}) => ({ role, by, at: ts(), ...over });

  it('an admin invites a lower-case e-mail as editor / admin', async () => {
    await assertSucceeds(t.as.admin().collection('invites').doc('new@example.com').set(inv('admin@example.com')));
    await assertSucceeds(t.as.owner().collection('invites').doc('new2@example.com').set(inv(OWNER, 'admin')));
  });
  it('bad invites are refused', async () => {
    const c = t.as.admin().collection('invites');
    await assertFails(c.doc('New@Example.com').set(inv('admin@example.com')));
    await assertFails(c.doc('new@example.com').set(inv('admin@example.com', 'reader')));
    await assertFails(c.doc('new@example.com').set(inv('someone@example.com')));
    await assertFails(c.doc('new@example.com').set(inv('admin@example.com', 'editor', { extra: 1 })));
    await assertFails(t.as.editor().collection('invites').doc('new@example.com').set(inv('editor@example.com')));
  });
  it('read / delete: admins, and the invited person once verified', async () => {
    await t.seed((db) => db.collection('invites').doc('reader@example.com').set({ role: 'editor', by: OWNER, at: Timestamp.now() }));
    await assertSucceeds(t.as.reader().collection('invites').doc('reader@example.com').get());
    await assertFails(t.user('reader1', 'reader@example.com', false).collection('invites').doc('reader@example.com').get());
    await assertFails(t.as.reader2().collection('invites').doc('reader@example.com').get());
    await assertFails(t.as.reader().collection('invites').get());
    await assertSucceeds(t.as.admin().collection('invites').get());
    await assertFails(t.as.reader2().collection('invites').doc('reader@example.com').delete());
    await assertSucceeds(t.as.reader().collection('invites').doc('reader@example.com').delete());
  });
});
