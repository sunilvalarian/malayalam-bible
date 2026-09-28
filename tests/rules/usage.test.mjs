// firestore.rules → usage/{id} (usageOk) and the 'usage-purge' activity-log entry
import { describe, it, beforeEach } from 'node:test';
import { setup, assertSucceeds, assertFails, ts, Timestamp, OWNER } from './helpers.mjs';

const t = setup();

const ID = 'AbCdEfGhIjKlMnOpQr12';          // 20 alphanumerics, like rid(20) in usage.js
const DEVICE = 'Dev1ce0123456789XYZa';        // 20 alphanumerics
let seq = 0;
const newId = () => ('Batch' + String(++seq).padStart(15, '0'));   // 20 chars

// the `dev` object exactly as usage.js deviceInfo() builds it (14 keys)
const DEV = {
  os: 'Android', osv: '14', browser: 'Chrome', bv: '128', model: 'Pixel 8',
  mobile: true, tablet: false, screen: '412x915@2.63', lang: 'ml-IN', tz: 'Asia/Kolkata',
  installed: false, app: 'v15', net: '4g',
  ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36',
};
// `geo` as geo() builds it (5 keys)
const GEO = { ip: '203.0.113.7', country: 'IN', region: 'Kerala', city: 'Kochi', isp: 'Example ISP' };

function events(n, t0 = 1727500000000) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ e: i ? 'read' : 'open', t: t0 + i * 1000, s: 'Sess012345', net: 1, b: 'GEN', c: 1, sec: 12 });
  return out;
}
// a batch as usage.js upload() + Cloud.saveUsage() write it
function batch(user, over = {}) {
  const ev = events(3);
  const doc = {
    v: 1, device: DEVICE,
    uid: user ? user.uid : null,
    email: user ? (user.email || '') : null,
    name: user ? (user.name || null) : null,
    dev: { ...DEV }, geo: { ...GEO },
    events: ev, n: ev.length, from: ev[0].t, to: ev[ev.length - 1].t,
    at: ts(),
  };
  for (const [k, v] of Object.entries(over)) { if (v === undefined) delete doc[k]; else doc[k] = v; }
  return doc;
}
const put = (db, doc, id = newId()) => db.collection('usage').doc(id).set(doc);

const READER = { uid: 'reader1', email: 'reader@example.com', name: 'Reader One' };

describe('usage: create by a visitor', () => {
  beforeEach(() => t.seedUsers());

  it('a valid visitor batch (uid null, email null, name null) is accepted', async () => {
    await assertSucceeds(put(t.anon(), batch(null)));
  });
  it('the exact usage.js shape (dev 14 keys, geo 5 keys) with id = rid(20)', async () => {
    const doc = batch(null);
    // same key set as usage.js upload()
    const keys = Object.keys(doc).sort().join(',');
    if (keys !== 'at,dev,device,email,events,from,geo,n,name,to,uid,v') throw new Error('shape changed: ' + keys);
    if (Object.keys(doc.dev).length !== 14 || Object.keys(doc.geo).length !== 5) throw new Error('dev/geo size');
    await assertSucceeds(put(t.anon(), doc, ID));
  });
  it('geo null (no /api/where) is accepted', async () => {
    await assertSucceeds(put(t.anon(), batch(null, { geo: null })));
  });
  it('without the optional name / dev / geo keys is accepted', async () => {
    await assertSucceeds(put(t.anon(), batch(null, { name: undefined, dev: undefined, geo: undefined })));
  });
  it('a visitor claiming a uid is refused', async () => {
    await assertFails(put(t.anon(), batch(null, { uid: 'reader1' })));
  });
  it('a visitor claiming an e-mail is refused', async () => {
    await assertFails(put(t.anon(), batch(null, { email: 'reader@example.com' })));
    await assertFails(put(t.anon(), batch(null, { email: '' })));
  });
});

describe('usage: create by a signed-in user', () => {
  beforeEach(() => t.seedUsers());

  it('own uid + own e-mail is accepted', async () => {
    await assertSucceeds(put(t.as.reader(), batch(READER)));
  });
  it('a blocked user may still upload their own batch', async () => {
    await assertSucceeds(put(t.as.blocked(), batch({ uid: 'blocked1', email: 'blocked@example.com' })));
  });
  it('a token with an upper-case e-mail: the lower-case e-mail is accepted, the raw one refused', async () => {
    const db = t.user('mixed1', 'Mixed.Case@Example.COM');
    await assertSucceeds(put(db, batch({ uid: 'mixed1', email: 'mixed.case@example.com' })));
    await assertFails(put(db, batch({ uid: 'mixed1', email: 'Mixed.Case@Example.COM' })));
  });
  it('a token without an e-mail claim (passkey / custom token) must send email ""', async () => {
    const db = t.db('pk1', {});
    await assertSucceeds(put(db, batch({ uid: 'pk1', email: '' })));
    await assertFails(put(db, batch({ uid: 'pk1' }, { email: null })));
    await assertFails(put(db, batch({ uid: 'pk1', email: 'someone@example.com' })));
  });
  it('an unverified e-mail is fine (the e-mail in the token is what is checked)', async () => {
    await assertSucceeds(put(t.user('unv1', 'new@example.com', false), batch({ uid: 'unv1', email: 'new@example.com' })));
  });
  it('another uid is refused', async () => {
    await assertFails(put(t.as.reader(), batch({ ...READER, uid: 'reader2' })));
  });
  it('another e-mail is refused', async () => {
    await assertFails(put(t.as.reader(), batch({ ...READER, email: 'reader2@example.com' })));
  });
  it('a signed-in user sending a visitor batch (uid null) is refused', async () => {
    await assertFails(put(t.as.reader(), batch(null)));
  });
  it('name longer than 100 characters is refused, 100 is fine, non-string refused', async () => {
    await assertSucceeds(put(t.as.reader(), batch(READER, { name: 'x'.repeat(100) })));
    await assertFails(put(t.as.reader(), batch(READER, { name: 'x'.repeat(101) })));
    await assertFails(put(t.as.reader(), batch(READER, { name: 5 })));
  });
});

describe('usage: format checks', () => {
  beforeEach(() => t.seedUsers());
  const anon = () => t.anon();

  it('id: 19 / 21 characters or symbols are refused', async () => {
    await assertFails(put(anon(), batch(null), 'A'.repeat(19)));
    await assertFails(put(anon(), batch(null), 'A'.repeat(21)));
    await assertFails(put(anon(), batch(null), 'AbCdEfGhIjKlMnOpQr-_'));
    await assertFails(put(anon(), batch(null), 'AbCdEfGhIjKlMnOpQr1.'));
    await assertSucceeds(put(anon(), batch(null), 'Z'.repeat(20)));
  });
  it('device: 16 and 32 alphanumerics ok; 15, 33, symbols, non-string refused', async () => {
    await assertSucceeds(put(anon(), batch(null, { device: 'a'.repeat(16) })));
    await assertSucceeds(put(anon(), batch(null, { device: 'B'.repeat(32) })));
    await assertFails(put(anon(), batch(null, { device: 'a'.repeat(15) })));
    await assertFails(put(anon(), batch(null, { device: 'a'.repeat(33) })));
    await assertFails(put(anon(), batch(null, { device: 'abcdefghijklmno-' })));
    await assertFails(put(anon(), batch(null, { device: 1234567890123456 })));
  });
  it('an extra key is refused', async () => {
    await assertFails(put(anon(), batch(null, { extra: 1 })));
    await assertFails(put(anon(), batch(null, { role: 'admin' })));
  });
  for (const k of ['v', 'device', 'uid', 'email', 'events', 'n', 'from', 'to', 'at']) {
    it(`missing required key "${k}" is refused`, async () => {
      await assertFails(put(anon(), batch(null, { [k]: undefined })));
    });
  }
  it('v must be 1', async () => {
    await assertFails(put(anon(), batch(null, { v: 2 })));
    await assertFails(put(anon(), batch(null, { v: '1' })));
    await assertFails(put(anon(), batch(null, { v: 0 })));
  });
  it('events: empty refused, 1 and 200 ok, 201 refused, not a list refused', async () => {
    await assertFails(put(anon(), batch(null, { events: [], n: 0 })));
    const one = events(1);
    await assertSucceeds(put(anon(), batch(null, { events: one, n: 1, from: one[0].t, to: one[0].t })));
    const e200 = events(200);
    await assertSucceeds(put(anon(), batch(null, { events: e200, n: 200, from: e200[0].t, to: e200[199].t })));
    const e201 = events(201);
    await assertFails(put(anon(), batch(null, { events: e201, n: 201, from: e201[0].t, to: e201[200].t })));
    await assertFails(put(anon(), batch(null, { events: { 0: { e: 'open' } }, n: 1 })));
    await assertFails(put(anon(), batch(null, { events: 'open', n: 1 })));
  });
  it('n must equal the number of events', async () => {
    await assertFails(put(anon(), batch(null, { n: 2 })));
    await assertFails(put(anon(), batch(null, { n: 4 })));
    await assertFails(put(anon(), batch(null, { n: '3' })));
  });
  it('from / to must be integers with from <= to', async () => {
    await assertFails(put(anon(), batch(null, { from: 1727500000000.5 })));
    await assertFails(put(anon(), batch(null, { to: 1727500002000.5 })));
    await assertFails(put(anon(), batch(null, { from: '1727500000000' })));
    await assertFails(put(anon(), batch(null, { from: Timestamp.now() })));
    await assertFails(put(anon(), batch(null, { from: 20, to: 10 })));
    await assertSucceeds(put(anon(), batch(null, { from: 10, to: 10 })));
  });
  it('dev: at most 20 keys, must be a map (null refused)', async () => {
    const d20 = {}; for (let i = 0; i < 20; i++) d20['k' + i] = i;
    const d21 = { ...d20, k20: 20 };
    await assertSucceeds(put(anon(), batch(null, { dev: d20 })));
    await assertFails(put(anon(), batch(null, { dev: d21 })));
    await assertFails(put(anon(), batch(null, { dev: 'Android' })));
    await assertFails(put(anon(), batch(null, { dev: null })));
  });
  it('geo: at most 8 keys, a map or null', async () => {
    const g8 = {}; for (let i = 0; i < 8; i++) g8['k' + i] = 'x';
    await assertSucceeds(put(anon(), batch(null, { geo: g8 })));
    await assertFails(put(anon(), batch(null, { geo: { ...g8, k8: 'x' } })));
    await assertFails(put(anon(), batch(null, { geo: 'Kochi' })));
  });
  it('at must be the server time', async () => {
    await assertFails(put(anon(), batch(null, { at: Timestamp.now() })));
    await assertFails(put(anon(), batch(null, { at: Timestamp.fromMillis(Date.now() - 3600e3) })));
    await assertFails(put(anon(), batch(null, { at: Date.now() })));
  });
});

describe('usage: create-only, admin read / delete', () => {
  const IDS = ['Seed0000000000000001', 'Seed0000000000000002', 'Seed0000000000000003'];
  beforeEach(async () => {
    await t.seedUsers();
    await t.seed(async (db) => {
      for (let i = 0; i < IDS.length; i++) {
        const d = batch(i ? READER : null);
        d.at = Timestamp.fromMillis(Date.now() - i * 86400e3);
        await db.collection('usage').doc(IDS[i]).set(d);
      }
    });
  });

  it('a resend with the same id is refused (update), for everyone', async () => {
    await assertFails(put(t.anon(), batch(null), IDS[0]));
    await assertFails(put(t.as.reader(), batch(READER), IDS[1]));
    await assertFails(put(t.as.owner(), batch({ uid: 'owner', email: OWNER }), IDS[1]));
    await assertFails(put(t.as.admin(), batch({ uid: 'admin1', email: 'admin@example.com' }), IDS[2]));
  });
  it('update() of a field is refused even for an admin', async () => {
    await assertFails(t.as.owner().collection('usage').doc(IDS[0]).update({ n: 3 }));
    await assertFails(t.as.admin().collection('usage').doc(IDS[0]).update({ name: 'x' }));
  });
  it('read: owner (verified) and role admin allowed', async () => {
    await assertSucceeds(t.as.owner().collection('usage').doc(IDS[0]).get());
    await assertSucceeds(t.as.admin().collection('usage').doc(IDS[0]).get());
  });
  it('read: owner e-mail but not verified is refused', async () => {
    await assertFails(t.user('ownerUnverified', OWNER, false).collection('usage').doc(IDS[0]).get());
  });
  it('read: owner with no profile document yet is allowed', async () => {
    await assertSucceeds(t.user('ownerNew', OWNER).collection('usage').doc(IDS[0]).get());
  });
  it('read: reader / editor / blocked / visitor refused, also their own batch', async () => {
    await assertFails(t.as.reader().collection('usage').doc(IDS[1]).get());
    await assertFails(t.as.editor().collection('usage').doc(IDS[0]).get());
    await assertFails(t.as.blocked().collection('usage').doc(IDS[0]).get());
    await assertFails(t.anon().collection('usage').doc(IDS[0]).get());
    await assertFails(t.as.reader().collection('usage').get());
  });
  it('list as the portal does: where(at >= since).orderBy(at desc) by an admin', async () => {
    const q = (db) => db.collection('usage').where('at', '>=', new Date(Date.now() - 36 * 3600e3)).orderBy('at', 'desc').limit(501).get();
    const snap = await assertSucceeds(q(t.as.admin()));
    if (snap.size !== 2) throw new Error('expected 2 batches, got ' + snap.size);
    await assertSucceeds(q(t.as.owner()));
    await assertFails(q(t.as.editor()));
    await assertFails(q(t.anon()));
  });
  it('delete: admin only (as purgeUsage does in a batch)', async () => {
    await assertFails(t.as.editor().collection('usage').doc(IDS[0]).delete());
    await assertFails(t.as.reader().collection('usage').doc(IDS[1]).delete());
    await assertFails(t.anon().collection('usage').doc(IDS[0]).delete());
    const db = t.as.admin();
    const snap = await assertSucceeds(db.collection('usage').where('at', '<', new Date(Date.now() - 12 * 3600e3)).limit(400).get());
    const b = db.batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    await assertSucceeds(b.commit());
    await assertSucceeds(t.as.owner().collection('usage').doc(IDS[0]).delete());
  });
});

describe('changes: usage-purge entry', () => {
  beforeEach(() => t.seedUsers());
  const entry = (email) => ({ action: 'usage-purge', book: '-', chapter: 0, by: email, at: ts(), detail: '12' });

  it('an admin can log usage-purge', async () => {
    await assertSucceeds(t.as.admin().collection('changes').add(entry('admin@example.com')));
    await assertSucceeds(t.as.owner().collection('changes').add(entry(OWNER)));
  });
  it('a reader cannot, also while editing is open to everyone', async () => {
    await assertFails(t.as.reader().collection('changes').add(entry('reader@example.com')));
    await t.setSettings({ openEdit: true, openUpload: true });
    await assertFails(t.as.reader().collection('changes').add(entry('reader@example.com')));
    await assertFails(t.anon().collection('changes').add(entry('x@example.com')));
  });
});
