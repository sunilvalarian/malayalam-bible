/*
 * Firebase layer: login (single sign-on for the reader and the admin portal), roles, shared
 * chapter edits, personal data sync, admin tools, passkeys — plus the local-owner passcode
 * used when Firebase is not configured.
 * Firebase is used only when FIREBASE_CONFIG is set and the page is served over http(s).
 * Open a page with ?emulator on localhost to use the Firebase Local Emulator Suite.
 */
(function () {
  'use strict';

  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  const ROLE_RANK = { none: 0, reader: 1, editor: 2, admin: 3 };
  // minimum role for each permission (see firestore.rules)
  // (aiTranslate is checked by functions/api/translate.js, the only writer of aiTranslations;
  // aiView only decides who is shown the AI translation in the reader)
  const PERMS = { edit: 'editor', upload: 'editor', restore: 'editor', export: 'editor', aiView: 'editor', aiTranslate: 'editor', delete: 'admin', reset: 'admin', users: 'admin' };
  // permissions an admin can open to every signed-in, non-blocked user (settings/permissions)
  const OPEN_PERMS = { upload: 'openUpload', edit: 'openEdit' };
  // access codes: 8 characters without the look-alikes 0 O 1 I L (31^8 ≈ 2^39.6), shown as XXXX-XXXX
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8,16}$/;
  const normCode = (s) => String(s || '').toUpperCase().replace(/[\s\-–—_.]/g, '');
  const fmtCode = (c) => (c.length === 8 ? c.slice(0, 4) + '-' + c.slice(4) : c);
  function newCode() {
    let out = '';
    while (out.length < 8) {
      for (const b of crypto.getRandomValues(new Uint8Array(16))) {
        // 248 = 8 × 31: drop the top bytes so every character is equally likely
        if (b < 248 && out.length < 8) out += CODE_ALPHABET[b % 31];
      }
    }
    return out;
  }
  // values of users/{uid}.provider (the sign-in method last used)
  const PROVIDER_IDS = ['google.com', 'github.com', 'microsoft.com', 'emailLink', 'password', 'passkey'];
  const PROVIDERS = Object.assign({ google: true, github: true, microsoft: true, emailLink: true, password: true, passkey: true }, window.AUTH_PROVIDERS || {});
  const LINK_PARAMS = ['apiKey', 'oobCode', 'mode', 'lang', 'continueUrl', 'tenantId'];

  const params = new URLSearchParams(location.search);
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const emulator = params.has('emulator') && isLocalHost;
  const config = emulator
    ? { apiKey: 'demo-key', authDomain: 'demo-bible.firebaseapp.com', projectId: 'demo-bible' }
    : window.FIREBASE_CONFIG;
  const OWNERS = (window.APP_OWNERS || []).map((e) => e.toLowerCase());
  const PRESET_EDITORS = (window.APP_EDITORS || []).map((e) => e.toLowerCase());
  const configured = !!(config && config.apiKey && config.projectId);

  const ss = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  // names: firestore.rules allow at most 100 characters
  const clip = (s) => String(s || '').trim().slice(0, 100);

  // ---------- base64 / base64url ----------
  const bytes = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b));
  const b64 = (b) => { let s = ''; bytes(b).forEach((x) => { s += String.fromCharCode(x); }); return btoa(s); };
  const b64u = (b) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(t + '==='.slice((t.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };

  // ---------- local owner (Firebase not configured) ----------
  // A passcode that unlocks editing in THIS browser only, offered only when the app is opened
  // from disk or from localhost. Stored as a PBKDF2-SHA256 hash; the unlock lasts until the
  // browser tab is closed (sessionStorage). Anyone who controls this browser's storage can get
  // around it — it keeps visitors out of the editing tools, it is not server security.
  const LocalOwner = (function () {
    const KEY = 'mlb.localOwner', UNLOCK = 'mlb.localOwnerUnlocked', LOCKED_AT = 'mlb.localOwnerLockedAt';
    const ITER = 100000;
    const allowed = location.protocol === 'file:' || isLocalHost;
    const listeners = [];
    const emit = () => listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    const record = () => { const r = ls.get(KEY); return r && r.hash && r.salt ? r : null; };
    const token = (r) => r.hash.slice(0, 24);

    async function derive(pass, saltB64, iter) {
      const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
      const pw = new TextEncoder().encode(pass);
      if (window.crypto && crypto.subtle) {
        try {
          const key = await crypto.subtle.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']);
          const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
          return b64(bits);
        } catch (e) { /* fall back to the JavaScript implementation */ }
      }
      return b64(pbkdf2Sha256(pw, salt, iter));
    }

    window.addEventListener('storage', (e) => {
      if (e.key === LOCKED_AT) { ss.set(UNLOCK, null); emit(); }    // locked in another tab
      else if (e.key === KEY) emit();
    });

    return {
      allowed,
      isSet() { return !!record(); },
      isUnlocked() {
        if (!allowed) return false;
        const r = record();
        return !!r && ss.get(UNLOCK) === token(r);
      },
      async setup(pass) {
        if (!allowed) throw err('local/not-allowed');
        if (record()) throw err('local/already-set');
        if (!pass || pass.length < 4) throw err('local/too-short');
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        const hash = await derive(pass, salt, ITER);
        const r = { v: 1, salt, hash, iter: ITER, created: Date.now() };
        ls.set(KEY, r);
        if (!record()) throw err('local/storage');     // storage blocked or full: nothing was saved
        ss.set(UNLOCK, token(r));
        emit();
        return true;
      },
      async unlock(pass) {
        const r = record();
        if (!allowed || !r) return false;
        const hash = await derive(pass || '', r.salt, r.iter || ITER);
        if (hash !== r.hash) return false;
        ss.set(UNLOCK, token(r));
        emit();
        return true;
      },
      lock() {
        ss.set(UNLOCK, null);
        ls.set(LOCKED_AT, Date.now());
        emit();
      },
      on(fn) { listeners.push(fn); },
    };
  })();

  // Pure-JS SHA-256 / PBKDF2 for browsers without crypto.subtle (e.g. some file:// setups).
  function sha256(msg) {
    const K = sha256.K || (sha256.K = Uint32Array.from([
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
      0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
      0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
      0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]));
    const len = msg.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const buf = new Uint8Array(total);
    buf.set(msg);
    buf[len] = 0x80;
    const dv = new DataView(buf.buffer);
    dv.setUint32(total - 4, len * 8);
    dv.setUint32(total - 8, Math.floor(len / 0x20000000));
    const H = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const W = new Uint32Array(64);
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    const out = new Uint8Array(32);
    const odv = new DataView(out.buffer);
    H.forEach((x, i) => odv.setUint32(i * 4, x));
    return out;
  }
  function pbkdf2Sha256(pw, salt, iter) {
    let key = pw.length > 64 ? sha256(pw) : pw;
    const k = new Uint8Array(64); k.set(key);
    const ipad = k.map((x) => x ^ 0x36), opad = k.map((x) => x ^ 0x5c);
    const hmac = (m) => {
      const inner = new Uint8Array(64 + m.length); inner.set(ipad); inner.set(m, 64);
      const outer = new Uint8Array(96); outer.set(opad); outer.set(sha256(inner), 64);
      return sha256(outer);
    };
    const first = new Uint8Array(salt.length + 4); first.set(salt); first[first.length - 1] = 1;
    let u = hmac(first);
    const t = u.slice();
    for (let i = 1; i < iter; i++) { u = hmac(u); for (let j = 0; j < 32; j++) t[j] ^= u[j]; }
    return t;
  }

  // ---------- Firebase ----------
  let fb, auth, db;
  let unsubUserData = null;
  let unsubProfile = null;
  let authSeq = 0;           // ignore results of an older sign-in that finishes late
  let initPromise = null;

  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
  const ts = () => fb.firestore.FieldValue.serverTimestamp();
  const tms = (t) => (t && t.toMillis ? t.toMillis() : t ? +new Date(t) : 0);
  const docs = (snap, idKey) => snap.docs.map((d) => Object.assign({ [idKey || 'id']: d.id }, d.data()));
  const cleanUrl = () => {
    const u = new URL(location.href);
    LINK_PARAMS.forEach((p) => u.searchParams.delete(p));
    return u.pathname + (u.searchParams.toString() ? '?' + u.searchParams.toString() : '') + u.hash;
  };
  // this page's address (no hash, no query except ?emulator): where the links in Firebase's e-mails lead back to
  const returnUrl = () => {
    const u = new URL(location.href);
    u.hash = '';
    [...u.searchParams.keys()].forEach((k) => { if (k !== 'emulator') u.searchParams.delete(k); });
    return u.href;
  };
  // verification / password-reset e-mails: add a "continue" link back to this page; if the domain isn't
  // an authorized domain in Firebase, send the e-mail without it rather than not at all
  const withReturn = (send) => send({ url: returnUrl() }).catch((e) => {
    if (/continue-uri|unauthorized-domain/.test((e && e.code) || '')) return send(undefined);
    throw e;
  });

  const Cloud = {
    available: configured && /^https?:/.test(location.protocol),
    configured,
    emulator,
    ready: false,
    authKnown: false,  // the first sign-in state (signed in or not) is known
    user: null,      // { uid, email, name, verified, provider }
    role: 'none',
    // admin switches (settings/permissions, readable by everyone; live)
    settings: { openUpload: false, openEdit: false, updatedBy: '', updatedAt: null },
    PERMS,
    OPEN_PERMS,
    ROLE_RANK,
    normCode,
    fmtCode,
    CODE_RE,
    PROVIDERS,
    PROVIDER_IDS,
    LocalOwner,
    // the address Firebase sends its e-mails from (for "look in Spam for …" hints)
    mailSender: config && config.authDomain ? 'noreply@' + config.authDomain : '',
    verificationError: null,
    pendingLink: null,   // { email, providerId, methods } while an account-exists conflict waits for sign-in
    _listeners: [],
    on(fn) { this._listeners.push(fn); },
    _emit(type, data) { this._listeners.forEach((fn) => { try { fn(type, data); } catch (e) { console.error(e); } }); },

    can(perm) {
      if (!this.user) return false;
      if (ROLE_RANK[this.role] >= ROLE_RANK[PERMS[perm] || 'admin']) return true;
      // opened to everyone by an admin: any signed-in user who isn't blocked
      return this.role !== 'none' && !!OPEN_PERMS[perm] && this.settings[OPEN_PERMS[perm]] === true;
    },
    // true when perm is open to everyone (not because of the user's role)
    isOpen(perm) { return !!OPEN_PERMS[perm] && this.settings[OPEN_PERMS[perm]] === true; },
    get blocked() { return !!this.user && this.role === 'none'; },
    // local mode: 'owner' (disk / localhost: passcode unlock available) or 'readonly' (public site without Firebase)
    get localKind() { return LocalOwner.allowed ? 'owner' : 'readonly'; },

    init(opts) {
      if (!initPromise) {
        // the Firebase library couldn't load (first visit offline, blocked): the login screen says so
        initPromise = this._init(opts || {}).catch((e) => { this.initFailed = true; this._emit('initError', e); throw e; });
      }
      return initPromise;
    },
    async _init(opts) {
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
      // offline: Firestore keeps what it has read (chapters, profile, settings, personal data, portal
      // lists) in IndexedDB and queues writes until the connection is back; shared by all open tabs
      await db.enablePersistence({ synchronizeTabs: true }).catch((e) => console.warn('offline cache off:', e && e.code));
      auth.useDeviceLanguage();
      this._method = ss.get('mlb.authMethod') || '';
      ss.set('mlb.authMethod', null);
      this._restorePending();
      // a sign-in redirect only comes back with a connection; offline this call would only fail
      if (!this.online) this._method = '';
      else {
        try {
          const r = await auth.getRedirectResult();
          if (!r || !r.user) {
            // a sign-in redirect was started but came back without a user (cancelled, or the browser
            // blocked the storage Firebase needs for it): say so instead of silently staying signed out
            if (this._method && !auth.currentUser) this._emit('authError', err('auth/redirect-incomplete'));
            this._method = '';
          }
        } catch (e) {
          this._method = '';
          this._emit('authError', await this._authError(e));
        }
      }
      if (opts.chapters !== false) {
        db.collection('chapters').onSnapshot(
          (snap) => this._emit('chapters', snap.docs.map((d) => d.data())),
          (e) => this._emit('error', e)
        );
      }
      // the admin switches that open upload / editing to everyone apply immediately
      db.collection('settings').doc('permissions').onSnapshot((snap) => {
        const d = snap.exists ? snap.data() : {};
        const next = { openUpload: d.openUpload === true, openEdit: d.openEdit === true, updatedBy: d.updatedBy || '', updatedAt: d.updatedAt || null };
        const changed = next.openUpload !== this.settings.openUpload || next.openEdit !== this.settings.openEdit;
        this.settings = next;
        this.settingsReady = true;
        this._emit('settings', Object.assign({ changed }, next));
      }, () => {});
      auth.onAuthStateChanged((u) => this._onAuth(u));
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this._checkVerified(); });
      // battery / mobile data: a page hidden for 2 minutes closes its live connection (the
      // listeners then answer from the offline cache); it reconnects and catches up when shown
      let idleTimer = null, paused = false;
      document.addEventListener('visibilitychange', () => {
        clearTimeout(idleTimer);
        if (document.visibilityState === 'hidden') {
          idleTimer = setTimeout(() => { paused = true; db.disableNetwork().catch(() => { paused = false; }); }, 2 * 60 * 1000);
        } else if (paused) {
          paused = false;
          db.enableNetwork().catch(() => {});
        }
      });
      window.addEventListener('focus', () => this._checkVerified());
      this.ready = true;
      this._emit('ready');
      // opened from a sign-in link in an e-mail
      if (PROVIDERS.emailLink && auth.isSignInWithEmailLink(location.href)) {
        const saved = ls.get('mlb.emailForSignIn');
        const ask = () => {
          // keep the link in memory and take it out of the address bar now: the login screen that
          // asks for the address adds a history entry of its own, and closing it (history.back())
          // would bring the used link back into the address bar
          this._emailLink = this._emailLink || location.href;
          history.replaceState(history.state, '', cleanUrl());
          this._emit('emailLinkNeedsEmail');
        };
        if (saved && saved.email && Date.now() - (saved.t || 0) < 24 * 3600e3) {
          this.completeEmailLink(saved.email).catch((e) => {
            // the address saved here isn't the one this link was sent to (a link for another address was
            // asked for in this browser since): ask for it
            if (/invalid-email|user-mismatch/.test((e && e.code) || '')) { ls.set('mlb.emailForSignIn', null); ask(); }
            else this._emit('authError', e);
          });
        } else ask();
      }
      return true;
    },

    async _onAuth(u) {
      const seq = ++authSeq;
      if (unsubUserData) { unsubUserData(); unsubUserData = null; }
      if (unsubProfile) { unsubProfile(); unsubProfile = null; }
      if (!u) {
        this.user = null;
        this.role = 'none';
        this.authKnown = true;
        this._emit('auth', null);
        return;
      }
      const fresh = !!this._method;           // a sign-in made on this page (not a restored session)
      await this._linkPending(u);
      let tok = null;
      try { tok = await u.getIdTokenResult(); } catch (e) { /* offline */ }
      // the e-mail was verified after this ID token was made (link opened in another tab or device):
      // the rules read the token, so fetch a fresh one before the invite / owner / preset checks
      if (tok && u.emailVerified && tok.claims.email_verified !== true && this.online) {
        try { await u.getIdToken(true); tok = await u.getIdTokenResult(); } catch (e) { /* next time */ }
      }
      const provider = this._providerOf(u, tok);
      this._method = '';
      const user = {
        uid: u.uid, email: (u.email || '').toLowerCase(), name: clip(u.displayName || this._pendingName),
        verified: !!u.emailVerified, provider,
      };
      let role;
      try {
        role = await this._ensureProfile(u, provider, fresh);
      } catch (e) {
        // offline (or the server didn't answer): keep the role this device last saw for this account
        role = await this._cachedRole(u.uid);
        if (!role) { role = 'reader'; this._emit('error', e); }
      }
      this._pendingName = '';
      if (seq !== authSeq) return;
      this.user = user;
      this.role = role;
      this.authKnown = true;
      ls.set('mlb.lastRole', { uid: u.uid, role });
      this._emit('auth', this.user);
      const ownerNow = user.verified && OWNERS.includes(user.email);
      // role changes by an admin apply immediately
      unsubProfile = db.collection('users').doc(u.uid).onSnapshot((snap) => {
        // a write of this page that the server hasn't confirmed yet (e.g. redeeming a code): the new role
        // applies once it has, or the portal would load with a role the rules don't know yet
        if (seq !== authSeq || snap.metadata.hasPendingWrites) return;
        // an admin removed the profile: the rules now treat this account as blocked
        const r = ownerNow ? 'admin' : snap.exists ? snap.data().role : snap.metadata.fromCache ? null : 'none';
        if (r && r !== this.role) {
          const wasActive = this.role !== 'none';
          this.role = r;
          ls.set('mlb.lastRole', { uid: u.uid, role: r });
          if (!wasActive && r !== 'none') this._watchUserData(u.uid, seq);
          this._emit('role', r);
        }
      }, () => {});
      if (role !== 'none') this._watchUserData(u.uid, seq);
    },
    _watchUserData(uid, seq) {
      if (unsubUserData) unsubUserData();
      unsubUserData = db.collection('userdata').doc(uid).onSnapshot((snap) => {
        if (seq !== authSeq || snap.metadata.hasPendingWrites) return;
        this._emit('userdata', snap.exists ? snap.data() : {});
      }, () => {});
    },

    _providerOf(u, tok) {
      let p = this._method || (tok && tok.signInProvider) || '';
      if (p === 'custom') p = 'passkey';
      // Firebase reports an e-mail-link sign-in as 'password': remember which one it was for this account
      const last = ls.get('mlb.lastMethod');
      if (this._method) ls.set('mlb.lastMethod', { uid: u.uid, p });
      else if (p === 'password' && last && last.uid === u.uid && last.p === 'emailLink') p = 'emailLink';
      if (!PROVIDER_IDS.includes(p)) p = ((u.providerData || [])[0] || {}).providerId || 'password';
      return PROVIDER_IDS.includes(p) ? p : 'password';
    },

    // the role from Firestore's offline cache, else the one remembered in this browser
    async _cachedRole(uid) {
      const snap = await db.collection('users').doc(uid).get({ source: 'cache' }).catch(() => null);
      const r = snap && snap.exists ? snap.data().role : null;
      if (r) return r;
      const last = ls.get('mlb.lastRole');
      return last && last.uid === uid ? last.role : null;
    },

    // Creates the profile on first sign-in, applies invites and the owner rule. Returns the role.
    async _ensureProfile(u, provider, fresh) {
      // a transaction needs the server: offline, _onAuth falls back to the cached role
      if (!this.online) throw err('offline');
      const email = (u.email || '').toLowerCase();
      const isOwner = !!u.emailVerified && OWNERS.includes(email);
      const ref = db.collection('users').doc(u.uid);
      let invited = null;
      // free plan: look for an invite once per browser session (and on every new sign-in), not on
      // every page load; an invite made meanwhile applies the next time the app is opened
      const checked = !fresh && ss.get('mlb.inviteChecked') === u.uid;
      if (u.emailVerified && !isOwner && email && !checked) {
        const inv = await db.collection('invites').doc(email).get().catch(() => null);
        if (inv && inv.exists) invited = inv.data().role;
        if (inv) ss.set('mlb.inviteChecked', u.uid);
      }
      // an invite is used up once claimed, so a later demotion by an admin sticks (not awaited: with the
      // offline cache a write only settles once the server has it)
      const consumeInvite = () => { db.collection('invites').doc(email).delete().catch(() => {}); };
      // Create the profile in a transaction: when two tabs sign in at once, the second one
      // sees the first one's profile (instead of a second create that the rules reject).
      // a preset editor starts as editor on first sign-in, unless invited for a higher role
      const preset = u.emailVerified && PRESET_EDITORS.includes(email) ? 'editor' : null;
      const newRole = isOwner ? 'admin'
        : preset && !(invited && ROLE_RANK[invited] > ROLE_RANK[preset]) ? preset
        : invited || 'reader';
      const existing = await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        if (s.exists) return s.data();
        tx.set(ref, Object.assign({ email, name: clip(u.displayName || this._pendingName), role: newRole, provider, createdAt: ts(), lastLogin: ts() }, preset ? { presetApplied: true } : {}));
        return null;
      });
      if (!existing) {
        if (invited) consumeInvite();
        return newRole;
      }
      const data = existing;
      let role = data.role;
      let claimed = false;
      if (isOwner && role !== 'admin') role = 'admin';
      else if (invited && ROLE_RANK[invited] > ROLE_RANK[role]) { role = invited; claimed = true; }
      else if (invited) consumeInvite();   // invite no longer needed
      // a preset editor whose profile was made before the e-mail was verified becomes editor now,
      // once (presetApplied), so a later demotion by an admin sticks
      const presetNow = preset && !data.presetApplied;
      if (presetNow && role === 'reader') role = 'editor';
      const upd = { role, name: clip(u.displayName || data.name), lastLogin: ts() };
      if (presetNow) upd.presetApplied = true;
      if (fresh || !data.provider) upd.provider = provider;
      // free plan: a restored session writes the profile only when something changed, or to
      // refresh lastLogin at most every 12 hours
      const changed = role !== data.role || presetNow || upd.name !== (data.name || '') || ('provider' in upd && upd.provider !== data.provider);
      if (fresh || changed || tms(data.lastLogin) < Date.now() - 12 * 3600 * 1000) {
        // true = saved, false = refused by the rules, null = still queued (the connection dropped)
        const saved = await Promise.race([
          ref.update(upd).then(() => true, (e) => { console.warn('profile update', e && e.code); return false; }),
          new Promise((r) => setTimeout(() => r(null), 8000)),
        ]);
        // refused: the role didn't change, and the invite stays for the next try
        if (saved === false) { role = data.role; claimed = false; }
      }
      if (claimed) consumeInvite();
      return role;
    },

    // ---- sign-in ----
    _setMethod(m) { this._method = m; },
    signIn(email, password) {
      this._pendingName = '';
      this._setMethod('password');
      return auth.signInWithEmailAndPassword(email.trim(), password).catch((e) => { this._method = ''; throw e; });
    },
    async signUp(name, email, password) {
      // onAuthStateChanged creates the profile as soon as the account exists — before
      // updateProfile() has set the display name — so hand the name over to it here
      // instead of writing users/{uid} a second time
      const pendingName = clip(name);
      this._pendingName = pendingName;
      this._setMethod('password');
      let cred;
      try { cred = await auth.createUserWithEmailAndPassword(email.trim(), password); } catch (e) { this._method = ''; throw e; }
      if (pendingName) await cred.user.updateProfile({ displayName: pendingName }).catch(() => {});
      // the account exists either way; remember a failed verification e-mail so the login screen can say so
      this.verificationError = null;
      await withReturn((a) => cred.user.sendEmailVerification(a)).catch((e) => { this.verificationError = e; });
      if (this.user && this.user.uid === cred.user.uid && !this.user.name && pendingName) {
        this.user.name = pendingName;
        this._emit('role', this.role);
      }
      return cred.user;
    },

    // passwordless: e-mail a sign-in link that comes back to this page
    async sendEmailLink(email, name) {
      email = email.trim();
      await auth.sendSignInLinkToEmail(email, { url: returnUrl(), handleCodeInApp: true });
      ls.set('mlb.emailForSignIn', { email, name: (name || '').trim(), t: Date.now() });
    },
    async completeEmailLink(email) {
      const saved = ls.get('mlb.emailForSignIn') || {};
      const pendingName = saved.email && saved.email.toLowerCase() === email.trim().toLowerCase() ? clip(saved.name) : '';
      this._pendingName = pendingName;
      this._setMethod('emailLink');
      try {
        const cred = await auth.signInWithEmailLink(email.trim(), this._emailLink || location.href);
        this._emailLink = null;
        ls.set('mlb.emailForSignIn', null);
        history.replaceState(history.state, '', cleanUrl());
        if (pendingName && cred.user && !cred.user.displayName) {
          await cred.user.updateProfile({ displayName: pendingName }).catch(() => {});
        }
        return cred;
      } catch (e) {
        this._method = '';
        // an expired / used link: drop it from the address bar so a reload doesn't retry
        if (/invalid-action-code|expired-action-code/.test(e.code || '')) { this._emailLink = null; history.replaceState(history.state, '', cleanUrl()); }
        throw await this._authError(e);
      }
    },

    _provider(name) {
      let p;
      if (name === 'google') {
        p = new fb.auth.GoogleAuthProvider();
        p.setCustomParameters({ prompt: 'select_account' });
      } else if (name === 'github') {
        p = new fb.auth.GithubAuthProvider();
        p.addScope('user:email');
      } else if (name === 'microsoft') {
        p = new fb.auth.OAuthProvider('microsoft.com');
        p.addScope('email');
        p.addScope('profile');
        p.setCustomParameters({ prompt: 'select_account', tenant: window.MICROSOFT_TENANT || 'common' });
      } else throw err('auth/operation-not-allowed');
      return p;
    },
    // Google / GitHub / Microsoft: popup, or a full-page redirect when popups can't work
    // (installed app, or the browser blocked the popup)
    async signInWith(name) {
      this._pendingName = '';
      const provider = this._provider(name);
      const method = provider.providerId;
      const redirect = () => { ss.set('mlb.authMethod', method); return auth.signInWithRedirect(provider).then(() => null); };
      this._setMethod(method);
      // a home-screen app on iPhone / iPad can't use popups. Everywhere else (also the installed app on
      // Android / desktop) the popup comes first: a redirect back from firebaseapp.com loses its result
      // in browsers that partition third-party storage
      if (navigator.standalone === true) return redirect();
      try {
        return await auth.signInWithPopup(provider);
      } catch (e) {
        this._method = '';
        if (e && ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported'].includes(e.code)) {
          this._setMethod(method);
          return redirect();
        }
        throw await this._authError(e);
      }
    },
    signInGoogle() { return this.signInWith('google'); },

    // "this e-mail already has an account with another sign-in method": remember the new
    // credential, and link it once the user has signed in with the original method
    async _authError(e) {
      if (!e || e.code !== 'auth/account-exists-with-different-credential') return e;
      const email = (e.email || (e.customData && e.customData.email) || '').toLowerCase();
      let credential = e.credential || null;
      if (!credential && fb.auth.OAuthProvider.credentialFromError) { try { credential = fb.auth.OAuthProvider.credentialFromError(e); } catch (x) { /* none */ } }
      let methods = [];
      // may be empty when e-mail enumeration protection is on
      if (email) methods = await auth.fetchSignInMethodsForEmail(email).catch(() => []);
      this.pendingLink = { email, providerId: credential ? credential.providerId : '', methods: methods || [] };
      this._pendingCred = credential;
      if (credential && credential.toJSON) {
        ls.set('mlb.pendingLink', { email, providerId: credential.providerId, cred: credential.toJSON(), t: Date.now() });
      }
      e.pendingLink = this.pendingLink;
      return e;
    },
    _restorePending() {
      const p = ls.get('mlb.pendingLink');
      if (!p) return;
      if (Date.now() - (p.t || 0) > 15 * 60 * 1000) { ls.set('mlb.pendingLink', null); return; }
      try {
        // the compat SDK has no AuthCredential.fromJSON: rebuild the OAuth credential
        const j = p.cred || {};
        let cred = null;
        if (j.providerId === 'github.com' && j.accessToken) cred = fb.auth.GithubAuthProvider.credential(j.accessToken);
        else if (j.providerId === 'google.com' && (j.idToken || j.accessToken)) cred = fb.auth.GoogleAuthProvider.credential(j.idToken || null, j.accessToken || null);
        else if (j.providerId && (j.idToken || j.accessToken)) cred = new fb.auth.OAuthProvider(j.providerId).credential({ idToken: j.idToken, accessToken: j.accessToken, rawNonce: j.nonce });
        if (!cred) { ls.set('mlb.pendingLink', null); return; }
        this._pendingCred = cred;
        this.pendingLink = { email: p.email, providerId: p.providerId, methods: [] };
      } catch (e) { ls.set('mlb.pendingLink', null); }
    },
    cancelPendingLink() { this.pendingLink = null; this._pendingCred = null; ls.set('mlb.pendingLink', null); },
    async _linkPending(u) {
      const cred = this._pendingCred;
      const p = this.pendingLink;
      if (!cred || !p) return;
      // link only into the account of the same e-mail address
      if (!p.email || (u.email || '').toLowerCase() !== p.email) return;
      if ((u.providerData || []).some((d) => d.providerId === cred.providerId)) { this.cancelPendingLink(); return; }
      try {
        await u.linkWithCredential(cred);
        this._emit('linked', cred.providerId);
      } catch (e) {
        // already signed in: shown as a message, not on the login screen (which closes now)
        this._emit('linkError', e);
      }
      this.cancelPendingLink();
    },

    resetPassword(email) { return withReturn((a) => auth.sendPasswordResetEmail(email.trim(), a)); },
    resendVerification() { return auth.currentUser ? withReturn((a) => auth.currentUser.sendEmailVerification(a)) : Promise.resolve(); },
    // an e-mail + password account that isn't verified yet: when the user comes back to this tab (after
    // opening the link in the verification e-mail elsewhere), check again, so the role applies without
    // pressing anything
    async _checkVerified() {
      const u = auth && auth.currentUser;
      // compared with what this page knows (this.user), not u.emailVerified: Firebase copies a verification
      // seen in another tab of this browser into u without telling this page
      if (!u || !u.email || !this.user || this.user.uid !== u.uid || this.user.verified || this._verifyCheck || Date.now() - (this._verifyCheckAt || 0) < 5000) return;
      this._verifyCheck = true;
      this._verifyCheckAt = Date.now();
      try {
        await u.reload();
        if (auth.currentUser === u && u.emailVerified) {
          await u.getIdToken(true);
          await this._onAuth(u);
          this._emit('verified', this.user);
        }
      } catch (e) { /* offline: try again next time */ }
      this._verifyCheck = false;
    },
    // after the user clicks the link in the verification e-mail
    async refreshUser() {
      if (!auth.currentUser) return;
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
      await this._onAuth(auth.currentUser);
    },
    // hooks that run (at most 2 s) before signing out, e.g. uploading this account's usage log
    _beforeSignOut: [],
    beforeSignOut(fn) { this._beforeSignOut.push(fn); },
    async signOut() {
      this._pendingName = '';
      this.cancelPendingLink();
      const wait = (p) => Promise.race([Promise.resolve(p).catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
      await Promise.all(this._beforeSignOut.map((fn) => wait(fn())));
      return auth.signOut();
    },
    get online() { return navigator.onLine !== false; },
    // opened from an e-mail sign-in link that still waits for the address to be typed in
    get emailLinkPending() { return !!this._emailLink; },
    get signedIn() { return !!(auth && auth.currentUser); },

    // ---- passkeys (WebAuthn; verified by the Cloudflare Pages Function in functions/api/passkey) ----
    passkeySupported() { return !!(window.PublicKeyCredential && navigator.credentials && window.isSecureContext); },
    async registerPasskey(name) {
      if (!this.user || this.blocked) throw err('passkey/not-signed-in');
      // a passkey added before the e-mail is verified would outlive the real owner of the address taking the account over
      if (!this.user.verified) throw err('passkey/unverified');
      if (!this.passkeySupported()) throw err('passkey/unsupported');
      const uid = this.user.uid;
      const mine = await this.listMyPasskeys().catch(() => []);
      let cred;
      try {
        cred = await navigator.credentials.create({
          publicKey: {
            rp: { name: 'പരിഷ്കരിച്ച മലയാളം ബൈബിൾ', id: location.hostname },
            user: { id: new TextEncoder().encode(uid), name: this.user.email || uid, displayName: this.user.name || this.user.email || uid },
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
            authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
            excludeCredentials: mine.map((p) => ({ type: 'public-key', id: unb64u(p.id) })),
            attestation: 'none',
            timeout: 120000,
          },
        });
      } catch (e) { throw this._webauthnError(e); }
      if (!cred) throw err('passkey/cancelled');
      const r = cred.response;
      if (!r.getPublicKey || !r.getPublicKeyAlgorithm) throw err('passkey/unsupported');
      const spki = r.getPublicKey();
      const alg = r.getPublicKeyAlgorithm();
      if (!spki || (alg !== -7 && alg !== -257)) throw err('passkey/unsupported');
      const id = b64u(cred.rawId);
      await db.collection('passkeys').doc(id).set({
        uid, publicKey: b64(spki), alg, counter: 0,
        name: String(name || '').trim().slice(0, 60) || 'പാസ്‌കീ',
        transports: (r.getTransports ? r.getTransports() : []).slice(0, 10),
        createdAt: ts(), lastUsedAt: null,
      });
      return id;
    },
    async signInPasskey() {
      if (!this.passkeySupported()) throw err('passkey/unsupported');
      let res;
      try { res = await fetch('/api/passkey/challenge', { cache: 'no-store' }); } catch (e) { throw err('passkey/server'); }
      if (res.status === 503) throw err('passkey/not-configured');
      if (!res.ok || !/json/.test(res.headers.get('content-type') || '')) throw err('passkey/server');
      const { challenge, token } = await res.json().catch(() => ({}));
      if (typeof challenge !== 'string' || !token) throw err('passkey/server');
      let cred;
      try {
        // the passkey is the only factor: the device must check the fingerprint / face / PIN
        cred = await navigator.credentials.get({
          publicKey: { challenge: unb64u(challenge), rpId: location.hostname, userVerification: 'required', timeout: 120000 },
        });
      } catch (e) { throw this._webauthnError(e); }
      if (!cred) throw err('passkey/cancelled');
      const r = cred.response;
      const body = {
        token, id: b64u(cred.rawId),
        clientDataJSON: b64u(r.clientDataJSON), authenticatorData: b64u(r.authenticatorData),
        signature: b64u(r.signature), userHandle: r.userHandle ? b64u(r.userHandle) : null,
      };
      let v;
      try {
        v = await fetch('/api/passkey/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
      } catch (e) { throw err('passkey/server'); }
      const j = await v.json().catch(() => ({}));
      if (v.status === 503) throw err('passkey/not-configured');
      if (!v.ok || !j.token) throw err('passkey/' + (j.error || 'failed'));
      this._pendingName = '';
      this._setMethod('passkey');
      try { return await auth.signInWithCustomToken(j.token); } catch (e) { this._method = ''; throw e; }
    },
    _webauthnError(e) {
      const n = (e && e.name) || '';
      if (n === 'NotAllowedError' || n === 'AbortError') return err('passkey/cancelled');
      if (n === 'InvalidStateError') return err('passkey/exists');
      if (n === 'SecurityError') return err('passkey/insecure');
      if (n === 'NotSupportedError') return err('passkey/unsupported');
      return e;
    },
    async listMyPasskeys() {
      if (!this.user) return [];
      const snap = await db.collection('passkeys').where('uid', '==', this.user.uid).get();
      return docs(snap);
    },
    async listAllPasskeys() { return docs(await db.collection('passkeys').get()); },
    deletePasskey(id) { return db.collection('passkeys').doc(id).delete(); },

    // ---- shared chapters ----
    saveChapter(book, chapter, items, bookName, hasBase) {
      return db.collection('chapters').doc(`${book}_${chapter}`).set({
        book, chapter, items: items || [], deleted: items === null, bookName: bookName || null,
        hasBase: !!hasBase, updatedAt: ts(), updatedBy: this.user.email,
      });
    },
    removeChapter(book, chapter) { return db.collection('chapters').doc(`${book}_${chapter}`).delete(); },
    log(action, book, chapter, detail) {
      const doc = { action, book, chapter, by: this.user.email, at: ts() };
      if (detail) doc.detail = String(detail).slice(0, 200);
      return db.collection('changes').add(doc).catch(() => {});
    },

    // ---- AI translation (made by Claude through functions/api/translate.js; read-only here) ----
    // → { items, done, model, createdBy, updatedAt } or null; from the offline cache when offline
    async getAiTranslation(book, chapter) {
      const snap = await db.collection('aiTranslations').doc(`${book}_${chapter}`).get();
      if (!snap.exists) return null;
      const d = snap.data();
      const parts = d.parts || {};
      const items = [];
      for (let i = 0; i < (d.nParts || 0); i++) if (parts['p' + i]) items.push(...parts['p' + i]);
      return { items, done: !!d.done, model: d.model || '', createdBy: d.createdBy || '', updatedAt: d.updatedAt || null };
    },
    // the chapters whose AI translation is finished: [{ book, chapter, verses, model, at }] (one read)
    async getAiIndex() {
      const snap = await db.collection('aiIndex').doc('chapters').get();
      return Object.values((snap.exists && snap.data().chapters) || {});
    },
    // Translates a chapter part by part (one request each); onProgress(done, total) after each.
    // req = { book, chapter, verses: [1, 2, …], names: { ml, en }, force }
    async aiTranslate(req, onProgress) {
      if (!this.user || !auth.currentUser) throw err('ai/not-signed-in');
      let runId = '', nParts = 1;
      const items = [];
      let model = '';
      for (let part = 0; part < nParts; part++) {
        const token = await auth.currentUser.getIdToken();
        let res;
        try {
          res = await fetch('/api/translate', {
            method: 'POST', cache: 'no-store',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ book: req.book, chapter: req.chapter, verses: req.verses, names: req.names, part, runId, force: !!req.force }),
          });
        } catch (e) { throw err('ai/network'); }
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(j.items)) throw err('ai/' + (j.error || (res.status === 404 ? 'not-configured' : 'server')));
        runId = j.runId; nParts = j.nParts; model = j.model;
        items.push(...j.items);
        if (onProgress) onProgress(part + 1, nParts);
      }
      return { items, done: true, model, createdBy: this.user.email, updatedAt: null };
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
      if (!this.user || this.blocked) return null;
      const snap = await db.collection('userdata').doc(this.user.uid).get();
      return snap.exists ? snap.data() : null;
    },
    // write only the changed entries: diff = { hl: { key: value | null(delete) }, bm: …, notes: … }
    // (per-key merge, so two devices editing different verses never overwrite each other)
    patchUserData(diff) {
      if (!this.user || this.blocked) return Promise.resolve();
      const del = fb.firestore.FieldValue.delete();
      const doc = { updatedAt: ts() };
      for (const k of Object.keys(diff)) {
        doc[k] = {};
        for (const key of Object.keys(diff[k])) doc[k][key] = diff[k][key] === null ? del : diff[k][key];
      }
      return db.collection('userdata').doc(this.user.uid).set(doc, { merge: true });
    },

    // ---- admin (every write is checked again by firestore.rules) ----
    async listUsers() {
      const snap = await db.collection('users').get();
      return docs(snap, 'uid').sort((a, b) => (a.email || '').localeCompare(b.email || ''));
    },
    // an admin's explicit role choice also cancels any pending invite for that e-mail;
    // role 'none' = blocked (no editing, no sync, no admin tools)
    async setRole(uid, role, email) {
      await db.collection('users').doc(uid).update({ role });
      if (email) await db.collection('invites').doc(email.toLowerCase()).delete().catch(() => {});
    },
    removeUser(uid) { return db.collection('users').doc(uid).delete(); },
    async listInvites() { return docs(await db.collection('invites').get(), 'email'); },
    setInvite(email, role) {
      return db.collection('invites').doc(email.trim().toLowerCase()).set({ role, by: this.user.email, at: ts() });
    },
    deleteInvite(email) { return db.collection('invites').doc(email).delete(); },
    // newest first. opts: { limit, by, action, cursor } → { items, cursor (for the next page) | null }
    async listChanges(opts) {
      opts = typeof opts === 'number' ? { limit: opts } : opts || {};
      const limit = opts.limit || 50;
      if (opts.by || opts.action) {
        // equality filters only (no composite index needed); sorted here
        let q = db.collection('changes');
        if (opts.by) q = q.where('by', '==', opts.by);
        if (opts.action) q = q.where('action', '==', opts.action);
        const all = docs(await q.limit(2000).get()).sort((a, b) => tms(b.at) - tms(a.at));
        const start = (opts.cursor && opts.cursor.offset) || 0;
        return { items: all.slice(start, start + limit), cursor: start + limit < all.length ? { offset: start + limit } : null };
      }
      let q = db.collection('changes').orderBy('at', 'desc');
      if (opts.cursor && opts.cursor.after) q = q.startAfter(opts.cursor.after);
      const snap = await q.limit(limit + 1).get();
      const page = snap.docs.slice(0, limit);
      return {
        items: page.map((d) => Object.assign({ id: d.id }, d.data())),
        cursor: snap.docs.length > limit ? { after: page[page.length - 1] } : null,
      };
    },
    // ---- usage log (js/usage.js): one document per uploaded batch of events ----
    // create-only; the device picks the id, so a batch that is sent twice is stored once
    saveUsage(id, doc) {
      return db.collection('usage').doc(id).set(Object.assign({}, doc, { at: ts() }));
    },
    // batches uploaded since `since` (ms), newest first. opts: { since, limit, cursor }
    //   → { items, cursor (for the next, older page) | null }. The portal filters by person here.
    async listUsage(opts) {
      opts = opts || {};
      const limit = opts.limit || 500;
      let q = db.collection('usage');
      if (opts.since) q = q.where('at', '>=', new Date(opts.since));
      q = q.orderBy('at', 'desc');
      if (opts.cursor && opts.cursor.after) q = q.startAfter(opts.cursor.after);
      const snap = await q.limit(limit + 1).get();
      const page = snap.docs.slice(0, limit);
      return {
        items: page.map((d) => Object.assign({ id: d.id }, d.data())),
        cursor: snap.docs.length > limit ? { after: page[page.length - 1] } : null,
      };
    },
    // delete the batches uploaded before `before` (ms); returns how many were deleted
    async purgeUsage(before) {
      let n = 0;
      for (;;) {
        const snap = await db.collection('usage').where('at', '<', new Date(before)).limit(400).get();
        if (snap.empty) break;
        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        n += snap.size;
        if (snap.size < 400) break;
      }
      if (n) await this.log('usage-purge', '-', 0, String(n));
      return n;
    },

    async listChapters() { return docs(await db.collection('chapters').get()); },
    async revertChapter(book, chapter) {
      await this.removeChapter(book, chapter);
      await this.log('revert', book, chapter);
    },
    isOwnerEmail(email) { return OWNERS.includes((email || '').toLowerCase()); },

    // ---- admin switches: open PDF upload / chapter editing to everyone who is signed in ----
    async saveSettings(patch) {
      const s = Object.assign({ openUpload: this.settings.openUpload, openEdit: this.settings.openEdit }, patch || {});
      const doc = { openUpload: !!s.openUpload, openEdit: !!s.openEdit, updatedBy: this.user.email, updatedAt: ts() };
      await db.collection('settings').doc('permissions').set(doc);
      await this.log('settings', '-', 0, `openUpload=${doc.openUpload} · openEdit=${doc.openEdit}`);
    },

    // ---- access codes (one-time; grant editor / admin; see firestore.rules → accessCodes) ----
    async createAccessCode(role, hours, note) {
      const expiresAt = fb.firestore.Timestamp.fromMillis(Date.now() + hours * 3600e3);
      for (let attempt = 0; ; attempt++) {
        const code = newCode();
        const data = {
          role, note: String(note || '').trim().slice(0, 100), createdBy: this.user.email, createdAt: ts(), expiresAt,
          used: false, usedBy: null, usedAt: null, revoked: false,
        };
        try {
          await db.collection('accessCodes').doc(code).set(data);
        } catch (e) {
          // the (astronomically unlikely) same code already exists: writing it would be an update, which the rules refuse
          if (attempt < 2 && /permission-denied/.test(e.code || '') && (await db.collection('accessCodes').doc(code).get().then((s) => s.exists, () => false))) continue;
          throw e;
        }
        await this.log('code-create', '-', 0, `${role} · …${code.slice(-4)}${data.note ? ' · ' + data.note : ''}`);
        return Object.assign({ code, expiresAt }, data);
      }
    },
    async listAccessCodes() {
      return docs(await db.collection('accessCodes').get(), 'code').sort((a, b) => tms(b.createdAt) - tms(a.createdAt));
    },
    async revokeAccessCode(code) {
      await db.collection('accessCodes').doc(code).update({ revoked: true });
      await this.log('code-revoke', '-', 0, '…' + code.slice(-4));
    },
    // Redeem a code: one batched write gives this user the code's role and marks the code used
    // (the rules check both halves against each other). No e-mail verification needed.
    // Errors (err.code): code/not-signed-in, code/blocked, code/invalid, code/used, code/expired,
    // code/revoked, code/has-role, code/failed
    async redeemCode(input) {
      if (!this.user) throw err('code/not-signed-in');
      if (this.blocked) throw err('code/blocked');
      // offline the batch would only wait in the queue
      if (!this.online) throw err('code/offline');
      // an unverified account with the owner's address must not become an admin nobody can remove
      if (!this.user.verified && OWNERS.includes(this.user.email)) throw err('code/verify-first');
      const code = normCode(input);
      if (!CODE_RE.test(code)) throw err('code/invalid');
      const ref = db.collection('accessCodes').doc(code);
      const read = async (opts) => {
        try {
          const s = await ref.get(opts);
          return s.exists ? s.data() : null;
        } catch (e) {
          if (/permission-denied/.test(e.code || '')) throw err('code/invalid');
          throw e;
        }
      };
      const judge = (c) => {
        if (!c) throw err('code/invalid');
        if (c.revoked) throw err('code/revoked');
        if (c.used) throw Object.assign(err('code/used'), { usedByMe: c.usedBy === this.user.uid });
        if (tms(c.expiresAt) <= Date.now()) throw err('code/expired');
        if (ROLE_RANK[this.role] >= ROLE_RANK[c.role]) throw err('code/has-role');
      };
      const c = await read();
      judge(c);
      const uid = this.user.uid;
      const batch = db.batch();
      batch.update(db.collection('users').doc(uid), { role: c.role, redeemedCode: code });
      batch.update(ref, { used: true, usedBy: uid, usedAt: ts() });
      try {
        await batch.commit();
      } catch (e) {
        if (!/permission-denied/.test(e.code || '')) throw e;
        // someone else was quicker, or it expired / was revoked meanwhile: say which
        if (this.blocked) throw err('code/blocked');
        judge(await read({ source: 'server' }));
        throw err('code/failed');
      }
      if (this.user && this.user.uid === uid && this.role !== c.role && !(this.user.verified && OWNERS.includes(this.user.email))) {
        this.role = c.role;
        this._emit('role', c.role);
      }
      await this.log('redeem', '-', 0, `${c.role} · …${code.slice(-4)}`);
      return c.role;
    },
  };

  window.Cloud = Cloud;
  window.LocalOwner = LocalOwner;
})();
