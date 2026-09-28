// Shared set-up for the Firestore rules tests (run through rules/run.mjs, which starts the emulator).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, after, beforeEach } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';

export { assertSucceeds, assertFails };

const here = path.dirname(fileURLToPath(import.meta.url));
export const RULES_PATH = path.resolve(here, '..', '..', 'firestore.rules');

export const OWNER = 'sunilvalarian@gmail.com';
export const PRESET_EDITOR = 'haiabel43@gmail.com';

export const ts = () => firebase.firestore.FieldValue.serverTimestamp();
export const del = () => firebase.firestore.FieldValue.delete();
export const Timestamp =firebase.firestore.Timestamp;
export const inMs = (ms) => Timestamp.fromMillis(Date.now() + ms);
export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

// Silence the SDK's "PERMISSION_DENIED" warnings that every assertFails would print.
firebase.firestore.setLogLevel('silent');

/**
 * Call once at the top of a test file. Returns an object whose methods work once `before` ran:
 *   env        the RulesTestEnvironment
 *   db(uid, claims) / anon()   Firestore (compat) as that user / as a visitor
 *   as.owner() / as.admin() / as.editor() / as.reader() / as.blocked() …   ready-made users (profiles seeded by seedUsers)
 *   seed(fn)   runs fn(adminDb) with the rules switched off
 */
export function setup() {
  const t = {};
  before(async () => {
    t.env = await initializeTestEnvironment({
      projectId: 'demo-rules',
      firestore: { host: '127.0.0.1', port: 8180, rules: fs.readFileSync(RULES_PATH, 'utf8') },
    });
  });
  after(async () => { if (t.env) await t.env.cleanup(); });
  beforeEach(async () => { await t.env.clearFirestore(); });

  t.db = (uid, claims) => t.env.authenticatedContext(uid, claims || {}).firestore();
  t.anon = () => t.env.unauthenticatedContext().firestore();
  t.seed = (fn) => t.env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
  t.user = (uid, email, verified = true) => t.db(uid, { email, email_verified: verified });

  // standard cast (profiles written by seedUsers)
  t.people = {
    owner: { uid: 'owner', email: OWNER, role: 'admin' },
    admin: { uid: 'admin1', email: 'admin@example.com', role: 'admin' },
    editor: { uid: 'editor1', email: 'editor@example.com', role: 'editor' },
    reader: { uid: 'reader1', email: 'reader@example.com', role: 'reader' },
    reader2: { uid: 'reader2', email: 'reader2@example.com', role: 'reader' },
    blocked: { uid: 'blocked1', email: 'blocked@example.com', role: 'none' },
  };
  t.as = {};
  for (const [k, p] of Object.entries(t.people)) t.as[k] = () => t.user(p.uid, p.email);
  t.seedUsers = (which) => t.seed(async (db) => {
    for (const [k, p] of Object.entries(t.people)) {
      if (which && !which.includes(k)) continue;
      await db.collection('users').doc(p.uid).set({
        email: p.email, name: k, role: p.role, provider: 'password',
        createdAt: Timestamp.fromMillis(Date.now() - DAY), lastLogin: Timestamp.fromMillis(Date.now() - DAY),
      });
    }
  });
  t.setSettings = (s) => t.seed((db) => db.collection('settings').doc('permissions').set({
    openUpload: !!s.openUpload, openEdit: !!s.openEdit, updatedBy: OWNER, updatedAt: Timestamp.now(),
  }));
  return t;
}
