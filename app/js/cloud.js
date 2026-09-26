/*
 * Firebase layer: login, roles, shared chapter edits, personal data sync, admin tools.
 * Loaded by app.js only when FIREBASE_CONFIG is set and the page is served over http(s).
 * Open the app with ?emulator on localhost to use the Firebase Local Emulator Suite.
 */
(function () {
  'use strict';

  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const ROLE_RANK = { none: 0, reader: 1, editor: 2, admin: 3 };
  // minimum role for each permission (see firestore.rules)
  const PERMS = { edit: 'editor', upload: 'editor', restore: 'editor', export: 'editor', delete: 'admin', reset: 'admin', users: 'admin' };

  const params = new URLSearchParams(location.search);
  const emulator = params.has('emulator') && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const config = emulator
    ? { apiKey: 'demo-key', authDomain: 'demo-bible.firebaseapp.com', projectId: 'demo-bible' }
    : window.FIREBASE_CONFIG;
  const OWNERS = (window.APP_OWNERS || []).map((e) => e.toLowerCase());

  let fb, auth, db;
  let unsubUserData = null;
  let unsubProfile = null;
  let authSeq = 0;           // ignore results of an older sign-in that finishes late

  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
  const ts = () => fb.firestore.FieldValue.serverTimestamp();

  const Cloud = {
    available: !!(config && config.apiKey && config.projectId && /^https?:/.test(location.protocol)),
    emulator,
    ready: false,
    user: null,      // { uid, email, name, verified, provider }
    role: 'none',
    PERMS,
    _listeners: [],
    on(fn) { this._listeners.push(fn); },
    _emit(type, data) { this._listeners.forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } }); },

    can(perm) { return ROLE_RANK[this.role] >= ROLE_RANK[PERMS[perm] || 'admin']; },

    async init() {
      if (!this.available) return false;
      await loadScript(SDK + 'firebase-app-compat.js');
      await Promise.all([loadScript(SDK + 'firebase-auth-compat.js'), loadScript(SDK + 'firebase-firestore-compat.js')]);
      fb = window.firebase;
      fb.initializeApp(config);
      auth = fb.auth();
      db = fb.firestore();
      if (emulator) {
        auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
        db.useEmulator('127.0.0.1', 8080);
      }
      auth.useDeviceLanguage();
      await auth.getRedirectResult().catch((e) => this._emit('error', e));
      db.collection('chapters').onSnapshot(
        (snap) => this._emit('chapters', snap.docs.map((d) => d.data())),
        (err) => this._emit('error', err)
      );
      auth.onAuthStateChanged((u) => this._onAuth(u));
      this.ready = true;
      return true;
    },

    async _onAuth(u) {
      const seq = ++authSeq;
      if (unsubUserData) { unsubUserData(); unsubUserData = null; }
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      if (!u) {
        this.user = null;
        this.role = 'none';
        this._emit('auth', null);
        return;
      }
      const user = {
        uid: u.uid, email: (u.email || '').toLowerCase(), name: u.displayName || this._pendingName || '',
        verified: !!u.emailVerified, provider: (u.providerData[0] || {}).providerId || 'password',
      };
      let role;
      try { role = await this._ensureProfile(u); } catch (e) { role = 'reader'; this._emit('error', e); }
      if (seq !== authSeq) return;
      this.user = user;
      this.role = role;
      this._emit('auth', this.user);
      const ownerNow = user.verified && OWNERS.includes(user.email);
      // role changes by an admin apply immediately
      unsubProfile = db.collection('users').doc(u.uid).onSnapshot((snap) => {
        if (seq !== authSeq || !snap.exists) return;
        const r = ownerNow ? 'admin' : snap.data().role;
        if (r && r !== this.role) { this.role = r; this._emit('role', r); }
      }, () => {});
      unsubUserData = db.collection('userdata').doc(u.uid).onSnapshot((snap) => {
        if (seq !== authSeq || snap.metadata.hasPendingWrites) return;
        this._emit('userdata', snap.exists ? snap.data() : {});
      }, () => {});
    },

    // Creates the profile on first sign-in, applies invites and the owner rule. Returns the role.
    async _ensureProfile(u) {
      const email = (u.email || '').toLowerCase();
      const isOwner = !!u.emailVerified && OWNERS.includes(email);
      const ref = db.collection('users').doc(u.uid);
      let invited = null;
      if (u.emailVerified && !isOwner) {
        const inv = await db.collection('invites').doc(email).get().catch(() => null);
        if (inv && inv.exists) invited = inv.data().role;
      }
      // an invite is used up once claimed, so a later demotion by an admin sticks
      const consumeInvite = () => db.collection('invites').doc(email).delete().catch(() => {});
      // Create the profile in a transaction: when two tabs sign in at once, the second one
      // sees the first one's profile (instead of a second create that the rules reject).
      const newRole = isOwner ? 'admin' : invited || 'reader';
      const existing = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (s.exists) return s.data();
        tx.set(ref, { email, name: u.displayName || this._pendingName || '', role: newRole, createdAt: ts(), lastLogin: ts() });
        return null;
      });
      if (!existing) {
        if (invited) await consumeInvite();
        return newRole;
      }
      const data = existing;
      let role = data.role;
      let claimed = false;
      if (isOwner && role !== 'admin') role = 'admin';
      else if (invited && ROLE_RANK[invited] > ROLE_RANK[role]) { role = invited; claimed = true; }
      else if (invited) await consumeInvite();   // invite no longer needed
      await ref.update({ role, name: u.displayName || data.name || '', lastLogin: ts() }).catch(() => {});
      if (claimed) await consumeInvite();
      return role;
    },

    // ---- auth ----
    signIn(email, password) { this._pendingName = ''; return auth.signInWithEmailAndPassword(email.trim(), password); },
    async signUp(name, email, password) {
      // onAuthStateChanged creates the profile as soon as the account exists — before
      // updateProfile() has set the display name — so hand the name over to it here
      // instead of writing users/{uid} a second time
      this._pendingName = (name || '').trim();
      const cred = await auth.createUserWithEmailAndPassword(email.trim(), password);
      if (this._pendingName) await cred.user.updateProfile({ displayName: this._pendingName }).catch(() => {});
      await cred.user.sendEmailVerification().catch(() => {});
      if (this.user && this.user.uid === cred.user.uid && !this.user.name && this._pendingName) {
        this.user.name = this._pendingName;
        this._emit('role', this.role);
      }
      return cred.user;
    },
    async signInGoogle() {
      this._pendingName = '';
      const provider = new fb.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try { return await auth.signInWithPopup(provider); } catch (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) return auth.signInWithRedirect(provider);
        throw e;
      }
    },
    resetPassword(email) { return auth.sendPasswordResetEmail(email.trim()); },
    resendVerification() { return auth.currentUser ? auth.currentUser.sendEmailVerification() : Promise.resolve(); },
    // after the user clicks the link in the verification e-mail
    async refreshUser() {
      if (!auth.currentUser) return;
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
      await this._onAuth(auth.currentUser);
    },
    signOut() { this._pendingName = ''; return auth.signOut(); },

    // ---- shared chapters ----
    saveChapter(book, chapter, items, bookName, hasBase) {
      return db.collection('chapters').doc(`${book}_${chapter}`).set({
        book, chapter, items: items || [], deleted: items === null, bookName: bookName || null,
        hasBase: !!hasBase, updatedAt: ts(), updatedBy: this.user.email,
      });
    },
    removeChapter(book, chapter) { return db.collection('chapters').doc(`${book}_${chapter}`).delete(); },
    log(action, book, chapter) {
      return db.collection('changes').add({ action, book, chapter, by: this.user.email, at: ts() }).catch(() => {});
    },
    async resetAll() {
      const snap = await db.collection('chapters').get();
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = db.batch();
        snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      await this.log('reset-all', '-', 0);
      return snap.size;
    },

    // ---- personal data ----
    async loadUserData() {
      if (!this.user) return null;
      const snap = await db.collection('userdata').doc(this.user.uid).get();
      return snap.exists ? snap.data() : null;
    },
    // write only the changed entries: diff = { hl: { key: value | null(delete) }, bm: …, notes: … }
    // (per-key merge, so two devices editing different verses never overwrite each other)
    patchUserData(diff) {
      if (!this.user) return Promise.resolve();
      const del = fb.firestore.FieldValue.delete();
      const doc = { updatedAt: ts() };
      for (const k of Object.keys(diff)) {
        doc[k] = {};
        for (const key of Object.keys(diff[k])) doc[k][key] = diff[k][key] === null ? del : diff[k][key];
      }
      return db.collection('userdata').doc(this.user.uid).set(doc, { merge: true });
    },

    // ---- admin ----
    async listUsers() {
      const snap = await db.collection('users').get();
      return snap.docs.map((d) => Object.assign({ uid: d.id }, d.data())).sort((a, b) => (a.email || '').localeCompare(b.email || ''));
    },
    // an admin's explicit role choice also cancels any pending invite for that e-mail
    async setRole(uid, role, email) {
      await db.collection('users').doc(uid).update({ role });
      if (email) await db.collection('invites').doc(email.toLowerCase()).delete().catch(() => {});
    },
    removeUser(uid) { return db.collection('users').doc(uid).delete(); },
    async listInvites() {
      const snap = await db.collection('invites').get();
      return snap.docs.map((d) => Object.assign({ email: d.id }, d.data()));
    },
    setInvite(email, role) {
      return db.collection('invites').doc(email.trim().toLowerCase()).set({ role, by: this.user.email, at: ts() });
    },
    deleteInvite(email) { return db.collection('invites').doc(email).delete(); },
    async listChanges(limit) {
      const snap = await db.collection('changes').orderBy('at', 'desc').limit(limit || 60).get();
      return snap.docs.map((d) => d.data());
    },
    isOwnerEmail(email) { return OWNERS.includes((email || '').toLowerCase()); },
  };

  window.Cloud = Cloud;
})();
