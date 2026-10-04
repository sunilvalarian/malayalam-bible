/*
 * Usage log: what is done in the app on this device (app opened, chapters read and for how long,
 * searches, copy / share / highlight / bookmark / note, settings, logins, installs, going online /
 * offline, errors, portal pages), for the administrator portal → ഉപയോഗം.
 *
 * Every event is first saved in this browser (localStorage), so nothing is lost offline. When
 * there is a connection, the events are uploaded to Firestore as usage/{batchId}: one document
 * per batch of at most 200 events, with the account (or none for a visitor), a random device id,
 * the device / browser, and the approximate place from /api/where (Cloudflare). To stay inside
 * the free plan, a batch goes up only once its oldest event is 15 minutes old or enough events
 * have gathered (see FLUSH_*), and always before signing out. firestore.rules check the account
 * on every batch; only admins can read the log.
 * Cloud mode only (Firebase configured): in local mode nothing is recorded.
 */
(function () {
  'use strict';

  const Cloud = window.Cloud || { available: false };
  const APP_VERSION = 'v18';               // keep in step with VERSION in sw.js
  const Q_KEY = 'mlb.usageQueue';          // events not uploaded yet
  const SEND_KEY = 'mlb.usageSending';     // { [uid]: { id, keys, tries } } batch being uploaded (resent with the same id)
  const REFUSED_KEY = 'mlb.usageRefused';  // { [uid]: { n, first } } batches the rules refused (page loads, first time)
  const DEVICE_KEY = 'mlb.deviceId';
  const SESSION_KEY = 'mlb.usageSession';  // { id, last }
  const GEO_KEY = 'mlb.usageGeo';          // { ip, country, region, city, isp, t }
  const HW_KEY = 'mlb.usageHw';            // { model, osv } from User-Agent Client Hints
  const UID_KEY = 'mlb.usageUid';          // the account seen last on this device ('' = none)
  // Free plan (20 000 writes a day): one write per batch, so events are gathered for a while.
  // A batch goes up once its oldest event is 15 minutes old or 100 events have gathered; when the
  // app is hidden, already at 25 events. Short visits therefore go up at the start of the next one.
  const MAX_QUEUE = 1500;
  const BATCH = 200;
  const FLUSH_COUNT = 100;
  const FLUSH_COUNT_HIDDEN = 25;
  const FLUSH_AGE = 15 * 60 * 1000;
  const SESSION_IDLE = 30 * 60 * 1000;
  const KEEP_OTHER = 30 * 24 * 3600 * 1000; // events of another account that never came back
  const GEO_AGE = 24 * 3600 * 1000;
  const MAX_ERRORS = 10;                    // per page

  const noop = { track() {}, view() {}, flush() { return Promise.resolve(); }, enabled: false };
  if (!Cloud.available) { window.Usage = noop; return; }

  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) {
      try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
  };
  const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const rid = (n) => {
    let s = '';
    for (const b of crypto.getRandomValues(new Uint8Array(n * 2))) { if (b < 248 && s.length < n) s += ALNUM[b % 62]; }
    return s.length === n ? s : s + rid(n - s.length);
  };
  const online = () => navigator.onLine !== false;
  const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const clip = (s, n) => String(s == null ? '' : s).slice(0, n);

  let deviceId = ls.get(DEVICE_KEY);
  if (typeof deviceId !== 'string' || !/^[A-Za-z0-9]{16,32}$/.test(deviceId)) { deviceId = rid(20); ls.set(DEVICE_KEY, deviceId); }
  const page = /admin(\.html)?$/.test(location.pathname) ? 'admin' : 'reader';

  // ---------- device ----------
  function parseUA(ua) {
    let m, os = '', osv = '', browser = '', bv = '', model = '';
    if ((m = ua.match(/Android\s([\d.]+)/))) { os = 'Android'; osv = m[1]; }
    else if ((m = ua.match(/(iPhone|iPad|iPod).*?OS\s([\d_]+)/))) { os = m[1] === 'iPad' ? 'iPadOS' : 'iOS'; osv = m[2].replace(/_/g, '.'); model = m[1]; }
    else if (/Macintosh/.test(ua)) {
      os = navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS';
      m = ua.match(/Mac OS X ([\d_.]+)/);
      osv = m ? m[1].replace(/_/g, '.') : '';
    } else if ((m = ua.match(/Windows NT ([\d.]+)/))) { os = 'Windows'; osv = { '10.0': '10', '6.3': '8.1', '6.2': '8', '6.1': '7' }[m[1]] || m[1]; }
    else if (/CrOS/.test(ua)) os = 'ChromeOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    if ((m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build\/|\))/)) && m[1] !== 'K') model = m[1].trim();
    const B = [
      ['WhatsApp', /WhatsApp\/([\d.]+)/], ['Facebook', /FB(?:AV|_IAB)\/([\d.]+)/], ['Instagram', /Instagram ([\d.]+)/],
      ['Edge', /Edg(?:A|iOS)?\/([\d.]+)/], ['Opera', /OPR\/([\d.]+)/], ['Samsung Internet', /SamsungBrowser\/([\d.]+)/],
      ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/], ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/], ['Safari', /Version\/([\d.]+).*Safari/],
    ];
    for (const [name, re] of B) { if ((m = ua.match(re))) { browser = name; bv = m[1].split('.')[0]; break; } }
    return { os, osv, browser, bv, model };
  }
  // exact model / Windows 11 (Chrome, Edge): User-Agent Client Hints, remembered for the next time
  if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
    navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']).then((h) => {
      const hw = { model: clip(h.model, 60), osv: '' };
      if (h.platform === 'Windows' && h.platformVersion) hw.osv = parseInt(h.platformVersion, 10) >= 13 ? '11' : '10';
      else if (h.platformVersion) hw.osv = clip(h.platformVersion, 20);
      ls.set(HW_KEY, hw);
    }).catch(() => {});
  }
  function deviceInfo() {
    const ua = navigator.userAgent || '';
    const p = parseUA(ua);
    const hw = ls.get(HW_KEY) || {};
    const tablet = /iPad|Tablet/.test(ua) || (p.os === 'iPadOS') || (/Android/.test(ua) && !/Mobile/.test(ua));
    const mobile = !tablet && (navigator.userAgentData ? !!navigator.userAgentData.mobile : /Mobi|Android|iPhone|iPod/.test(ua));
    const conn = navigator.connection || {};
    return {
      os: p.os, osv: hw.osv || p.osv, browser: p.browser, bv: p.bv, model: hw.model || p.model,
      mobile, tablet,
      screen: `${screen.width}x${screen.height}@${Math.round((window.devicePixelRatio || 1) * 100) / 100}`,
      lang: clip(navigator.language, 20), tz: clip((Intl.DateTimeFormat().resolvedOptions() || {}).timeZone, 40),
      installed: standalone(), app: APP_VERSION, net: clip(conn.effectiveType, 10),
      ua: clip(ua, 300),
    };
  }

  // ---------- place (Cloudflare Pages Function) ----------
  function refreshGeo() {
    const g = ls.get(GEO_KEY);
    if (!online() || !/^https?:/.test(location.protocol) || (g && Date.now() - g.t < GEO_AGE)) return;
    fetch('/api/where', { cache: 'no-store' })
      .then((r) => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : null))
      .then((j) => {
        if (!j) return;
        ls.set(GEO_KEY, { ip: clip(j.ip, 64), country: clip(j.country, 8), region: clip(j.region, 60), city: clip(j.city, 60), isp: clip(j.isp, 80), t: Date.now() });
      })
      .catch(() => {});
  }
  const geo = () => {
    const g = ls.get(GEO_KEY);
    return g ? { ip: g.ip || '', country: g.country || '', region: g.region || '', city: g.city || '', isp: g.isp || '' } : null;
  };

  // ---------- session: one run of use; a new one after 30 minutes without activity ----------
  function sessionId() {
    const now = Date.now();
    let s = ls.get(SESSION_KEY);
    if (!s || !s.id || now - (s.last || 0) > SESSION_IDLE) s = { id: rid(10) };
    s.last = now;
    ls.set(SESSION_KEY, s);
    return s.id;
  }

  // ---------- queue ----------
  // kept parsed in memory (no JSON.parse per event); another tab's change drops the copy
  let qCache = null;
  window.addEventListener('storage', (e) => { if (e.key === Q_KEY || e.key === null) qCache = null; });
  const readQueue = () => {
    if (!qCache) { const q = ls.get(Q_KEY); qCache = Array.isArray(q) ? q : []; }
    return qCache.slice();
  };
  function writeQueue(q) {
    if (q.length > MAX_QUEUE) q = q.slice(q.length - MAX_QUEUE);
    while (!ls.set(Q_KEY, q) && q.length > 10) q = q.slice(Math.floor(q.length / 2));   // storage full: keep the newest
    qCache = q.slice();
  }
  // who the events belong to: known once Cloud has restored the sign-in; until then they wait here
  const uidNow = () => (Cloud.user ? Cloud.user.uid : '');
  let early = [];
  function push(ev) {
    if (!Cloud.authKnown) { early.push(ev); return; }
    ev.u = uidNow();
    const q = readQueue();
    q.push(ev);
    writeQueue(q);
    if (q.filter((x) => x.u === ev.u).length >= FLUSH_COUNT) flushSoon();
    else schedule();
  }
  function releaseEarly(uid) {
    if (!early.length) return;
    const q = readQueue();
    early.forEach((ev) => { ev.u = uid; q.push(ev); });
    early = [];
    writeQueue(q);
    schedule();
  }

  // the event's own fields; data can't overwrite them
  const RESERVED = new Set(['k', 'e', 't', 's', 'net', 'u', 'pg']);
  function track(e, data) {
    const ev = Object.assign({ k: rid(8), e: clip(e, 24), t: Date.now(), s: sessionId(), net: online() ? 1 : 0 }, page === 'admin' ? { pg: 'admin' } : {});
    for (const [key, v] of Object.entries(data || {})) {
      if (v == null || v === '' || RESERVED.has(key)) continue;
      ev[key] = typeof v === 'string' ? clip(v, 200) : typeof v === 'number' || typeof v === 'boolean' ? v : clip(JSON.stringify(v), 200);
    }
    push(ev);
  }

  // ---------- reading time per chapter (only while the page is visible) ----------
  let reading = null;   // { b, c, since }
  function endRead() {
    if (!reading) return;
    if (reading.hidden) { reading = null; return; }   // paused (hidden): its time was counted when hidden
    const sec = Math.round((Date.now() - reading.since) / 1000);
    if (sec >= 3) track('read', { b: reading.b, c: reading.c, sec: Math.min(sec, 6 * 3600) });
    reading = null;
  }
  function view(b, c) {
    if (reading && reading.b === b && reading.c === c) return;
    endRead();
    if (document.visibilityState !== 'hidden') reading = { b, c, since: Date.now() };
    else reading = { b, c, since: 0, hidden: true };
  }

  // ---------- upload ----------
  // flush(min): upload when at least `min` events wait, or the oldest is FLUSH_AGE old;
  // min = 1 uploads everything (sign-out, portal "refresh")
  let flushing = null, flushingMin = 0;
  let flushTimer = null;
  let dueTimer = null;
  let refused = false;   // the rules refused a new batch: keep the events, try again on the next page load
  const RETRY = 5 * 60 * 1000;
  const flushSoon = () => { clearTimeout(flushTimer); flushTimer = setTimeout(() => flush(FLUSH_COUNT), 1500); };
  // battery: no polling — one timer for when the oldest waiting event is due, only while visible
  // and able to upload ('online' / 'ready' / 'auth' start a flush themselves); an upload that
  // failed (e.g. a bad connection) is retried after 5 minutes, not in a tight loop
  function schedule() {
    if (dueTimer || document.visibilityState === 'hidden' || refused || !online() || !Cloud.ready || !Cloud.authKnown) return;
    const uid = uidNow();
    const first = readQueue().find((ev) => ev.u === uid);
    if (!first) return;
    const due = first.t + FLUSH_AGE - Date.now() + 1000;
    dueTimer = setTimeout(() => { dueTimer = null; flush(FLUSH_COUNT).then(schedule); }, due > 0 ? Math.max(5000, due) : RETRY);
  }
  const unschedule = () => { clearTimeout(dueTimer); dueTimer = null; };
  const withLock = (fn) => (navigator.locks && navigator.locks.request
    ? navigator.locks.request('mlb-usage-upload', { ifAvailable: true }, (lock) => (lock ? fn() : null))
    : fn());
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'timeout' })), ms))]);

  function flush(min) {
    min = min || FLUSH_COUNT;
    // one already running with a higher threshold (it may upload nothing): run this one after it
    if (flushing) return min < flushingMin ? flushing.then(() => flush(min)) : flushing;
    if (refused || !Cloud.ready || !Cloud.authKnown || !online()) return Promise.resolve();
    flushingMin = min;
    flushing = withLock(() => upload(min)).catch((e) => console.warn('usage upload:', e && (e.code || e.message))).then(() => { flushing = null; });
    return flushing;
  }
  // the batch being uploaded, per account: { [uid]: { id, keys, tries } }
  const sendingOf = (uid) => { const s = ls.get(SEND_KEY); return s && typeof s === 'object' && s[uid] && Array.isArray(s[uid].keys) ? s[uid] : null; };
  const setSending = (uid, rec) => {
    const s = ls.get(SEND_KEY);
    const all = s && typeof s === 'object' && !Array.isArray(s) && !s.keys ? s : {};
    if (rec) all[uid] = rec; else delete all[uid];
    ls.set(SEND_KEY, Object.keys(all).length ? all : null);
  };
  async function upload(min) {
    for (let round = 0; round < Math.ceil(MAX_QUEUE / BATCH); round++) {
      const uid = uidNow();
      let q = readQueue();
      // events of another account on this device: kept for its next sign-in, but not forever
      const cutoff = Date.now() - KEEP_OTHER;
      const before = q.length;
      q = q.filter((ev) => ev.u === uid || ev.t > cutoff);
      if (q.length !== before) writeQueue(q);
      const mine = q.filter((ev) => ev.u === uid);
      if (!mine.length) return;
      if (mine.length < min && Date.now() - mine[0].t < FLUSH_AGE) return;
      // a batch that may already have gone up (the page closed before the answer): same id, same events
      let sending = sendingOf(uid);
      let events;
      if (sending) {
        const set = new Set(sending.keys);
        events = mine.filter((ev) => set.has(ev.k));
        if (!events.length) sending = null;
      }
      if (!sending) {
        events = mine.slice(0, BATCH);
        sending = { id: rid(20), keys: events.map((ev) => ev.k), tries: 0 };
      }
      sending.tries = (sending.tries || 0) + 1;
      setSending(uid, sending);
      const u = Cloud.user;
      const times = events.map((ev) => ev.t);
      const doc = {
        v: 1, device: deviceId, uid: u ? u.uid : null, email: u ? u.email || '' : null, name: u ? clip(u.name, 100) || null : null,
        dev: deviceInfo(), geo: geo(),
        events: events.map((ev) => { const o = Object.assign({}, ev); delete o.k; delete o.u; return o; }),
        // queue order isn't always time order (events held before sign-in was known, clock changes)
        n: events.length, from: Math.min(...times), to: Math.max(...times),
      };
      try {
        await timeout(Cloud.saveUsage(sending.id, doc), 20000);
      } catch (e) {
        const code = (e && e.code) || '';
        if (!/permission-denied|invalid-argument/.test(code)) throw e;     // offline, timeout: again later
        // refused on the first try: the batch itself, or the rules aren't deployed yet — keep the
        // events, forget this id (the next page load tries them as a new batch), stop for this page.
        // refused on a later try: stored by an earlier try whose answer was lost (create-only), so done.
        if (sending.tries <= 1 && !/invalid-argument/.test(code)) {
          setSending(uid, null);
          refused = true;
          console.warn('usage batch refused', e.message);
          // refused on 3 page loads over at least 3 days: those events are the problem (not rules
          // that weren't deployed yet) — drop them, so the account's newer events can go up
          const all = ls.get(REFUSED_KEY) || {};
          const r = all[uid] || { n: 0, first: Date.now() };
          r.n++;
          if (r.n >= 3 && Date.now() - r.first > 3 * 24 * 3600 * 1000) {
            const bad = new Set(sending.keys);
            writeQueue(readQueue().filter((ev) => !bad.has(ev.k)));
            delete all[uid];
          } else all[uid] = r;
          ls.set(REFUSED_KEY, Object.keys(all).length ? all : null);
          return;
        }
      }
      const rf = ls.get(REFUSED_KEY);
      if (rf && rf[uid]) { delete rf[uid]; ls.set(REFUSED_KEY, Object.keys(rf).length ? rf : null); }
      const sent = new Set(sending.keys);
      writeQueue(readQueue().filter((ev) => !sent.has(ev.k)));
      setSending(uid, null);
      min = 1;   // more than one batch was waiting: the rest goes up now too
    }
  }

  // ---------- what is recorded automatically ----------
  track('open', {
    page, hash: clip(location.hash, 40), installed: standalone(),
    ref: document.referrer && !document.referrer.startsWith(location.origin) ? (() => { try { return new URL(document.referrer).host; } catch (e) { return ''; } })() : '',
  });
  refreshGeo();

  let lastUid = ls.get(UID_KEY);
  if (Cloud.on) {
    Cloud.on((type, data) => {
      if (type === 'auth') {
        const uid = data ? data.uid : '';
        releaseEarly(uid);
        if (lastUid !== null && uid && uid !== lastUid) track('login', { m: data.provider });
        else if (lastUid === null && uid) track('login', { m: data.provider, first: true });
        else if (!uid && lastUid) track('signed-out');   // not through the logout button (e.g. account removed)
        lastUid = uid;
        ls.set(UID_KEY, uid);
        unschedule();
        flush(FLUSH_COUNT).then(schedule);
      } else if (type === 'role') track('role', { r: Cloud.role });
      else if (type === 'ready') flush(FLUSH_COUNT).then(schedule);
    });
  }
  if (Cloud.beforeSignOut) {
    Cloud.beforeSignOut(() => {
      endRead();
      track('logout');
      lastUid = '';
      ls.set(UID_KEY, '');
      unschedule();
      return flush(1);
    });
  }

  window.addEventListener('online', () => { track('online'); refreshGeo(); flush(FLUSH_COUNT); });
  window.addEventListener('offline', () => track('offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { unschedule(); endReadKeep(); flush(FLUSH_COUNT_HIDDEN); }
    else {
      if (reading && reading.hidden) { reading.since = Date.now(); reading.hidden = false; }
      schedule();
    }
  });
  // leaving: the chapter being read counts, and events still waiting before sign-in was known are kept
  window.addEventListener('pagehide', () => {
    endReadKeep();
    if (early.length) releaseEarly(lastUid || '');
  });
  // hidden: close the reading segment, but keep the chapter so reading continues when shown again
  function endReadKeep() {
    if (!reading || reading.hidden) return;
    const r = reading;
    endRead();
    reading = { b: r.b, c: r.c, since: 0, hidden: true };
  }
  window.addEventListener('appinstalled', () => track('install'));
  let errors = 0;
  window.addEventListener('error', (e) => {
    if (++errors > MAX_ERRORS || !e.message) return;
    track('error', { msg: e.message, at: `${(e.filename || '').split('/').pop()}:${e.lineno || 0}` });
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (++errors > MAX_ERRORS) return;
    const r = e.reason;
    track('error', { msg: (r && (r.code || r.message)) || String(r) });
  });
  window.Usage = { track, view, flush: () => flush(1), enabled: true, deviceId, deviceInfo };
})();
