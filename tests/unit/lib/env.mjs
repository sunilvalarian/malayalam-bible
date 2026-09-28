// Fake browser environment for loading the app's classic (non-module) scripts with node:vm.
// Controllable clock + timers, localStorage, navigator, document, window events, and a fake Cloud.
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..', '..');
export const APP = path.join(ROOT, 'app', 'js');
export const readApp = (name) => fs.readFileSync(path.join(APP, name), 'utf8');

export const T0 = Date.UTC(2026, 8, 28, 6, 0, 0);   // fixed start time
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

export const Q_KEY = 'mlb.usageQueue';
export const SEND_KEY = 'mlb.usageSending';
export const DEVICE_KEY = 'mlb.deviceId';
export const SESSION_KEY = 'mlb.usageSession';
export const GEO_KEY = 'mlb.usageGeo';
export const HW_KEY = 'mlb.usageHw';
export const UID_KEY = 'mlb.usageUid';

// let pending promise chains settle (the vm context shares this process' microtask queue)
export async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

export class Clock {
  constructor(now = T0) { this.now = now; this.timers = []; this.seq = 0; this.fired = 0; }
  setTimeout(fn, ms) {
    const id = ++this.seq;
    ms = Math.max(0, Number(ms) || 0);
    this.timers.push({ id, at: this.now + ms, ms, fn });
    return id;
  }
  clearTimeout(id) { this.timers = this.timers.filter((t) => t.id !== id); }
  pending(filter) { return this.timers.filter(filter || (() => true)); }
  // run every timer due within `ms`, in time order, letting promises settle after each
  async advance(ms) {
    const end = this.now + ms;
    await settle();
    for (;;) {
      const due = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t !== due);
      this.now = Math.max(this.now, due.at);
      this.fired++;
      due.fn();
      await settle();
    }
    this.now = end;
    await settle();
  }
  // move the clock without running timers (e.g. the device slept / a page reload later)
  jump(ms) { this.now += ms; }
}

export function makeDate(clock) {
  return class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  };
}

// localStorage over a shared Map (share the Map between envs to simulate a reload or a second tab)
export function makeStorage(map = new Map(), opts = {}) {
  return {
    map,
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) {
      v = String(v);
      if (opts.quota && !opts.quota(k, v)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      map.set(k, v);
    },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    key(i) { return [...map.keys()][i] ?? null; },
    get length() { return map.size; },
  };
}
export const lsGet = (map, k) => (map.has(k) ? JSON.parse(map.get(k)) : null);
export const lsSet = (map, k, v) => map.set(k, JSON.stringify(v));

export function makeEvents() {
  const listeners = {};
  return {
    listeners,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    dispatch(type, ev = {}) { (listeners[type] || []).slice().forEach((fn) => fn(Object.assign({ type }, ev))); },
  };
}

// JS mirror of firestore.rules usageOk + the id check of match /usage/{id}.
// `at` is added by Cloud.saveUsage, so the doc from usage.js must NOT contain it.
export function usageProblems(id, d, auth) {
  const p = [];
  const keys = Object.keys(d);
  const allowed = ['v', 'device', 'uid', 'email', 'name', 'dev', 'geo', 'events', 'n', 'from', 'to'];
  for (const k of keys) if (!allowed.includes(k)) p.push('extra key ' + k);
  for (const k of ['v', 'device', 'uid', 'email', 'events', 'n', 'from', 'to']) if (!(k in d)) p.push('missing ' + k);
  if (!/^[A-Za-z0-9]{20}$/.test(id)) p.push('bad id ' + id);
  if (d.v !== 1) p.push('v');
  if (typeof d.device !== 'string' || !/^[A-Za-z0-9]{16,32}$/.test(d.device)) p.push('device');
  if (auth) {
    if (d.uid !== auth.uid) p.push('uid');
    if (d.email !== String(auth.email || '').toLowerCase()) p.push('email');
  } else if (d.uid !== null || d.email !== null) p.push('visitor uid/email must be null');
  if ('name' in d && d.name !== null && !(typeof d.name === 'string' && d.name.length <= 100)) p.push('name');
  const isMap = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if ('dev' in d && !(isMap(d.dev) && Object.keys(d.dev).length <= 20)) p.push('dev');
  if ('geo' in d && d.geo !== null && !(isMap(d.geo) && Object.keys(d.geo).length <= 8)) p.push('geo');
  if (!Array.isArray(d.events) || d.events.length < 1 || d.events.length > 200) p.push('events size');
  else if (d.n !== d.events.length) p.push('n');
  if (!Number.isInteger(d.from) || !Number.isInteger(d.to)) p.push('from/to int');
  else if (!(d.from <= d.to)) p.push('from > to');
  return p;
}

const err = (code) => Object.assign(new Error(code), { code });

// Fake window.Cloud. saveUsage behaves like Firestore with the rules: create-only, usageOk checked.
// cloud.mode: 'ok' | 'unavailable' | 'denied' | 'hang' | 'lost' (stored, but the answer is lost) | fn(id, doc)
export function makeCloud(opts = {}) {
  const cloud = {
    available: true,
    ready: false,
    authKnown: false,
    user: null,
    role: 'none',
    listeners: [],
    hooks: [],
    calls: [],
    stored: new Map(),
    mode: 'ok',
    on(fn) { this.listeners.push(fn); },
    emit(type, data) { this.listeners.forEach((fn) => fn(type, data)); },
    beforeSignOut(fn) { this.hooks.push(fn); },
    saveUsage(id, doc) {
      const copy = JSON.parse(JSON.stringify(doc));
      this.calls.push({ id, doc: copy, raw: doc });
      const mode = this.mode;
      if (typeof mode === 'function') return mode(id, copy);
      if (mode === 'unavailable') return Promise.reject(err('unavailable'));
      if (mode === 'denied') return Promise.reject(err('permission-denied'));
      if (mode === 'invalid') return Promise.reject(err('invalid-argument'));
      if (mode === 'hang') return new Promise(() => {});
      if (this.stored.has(id)) return Promise.reject(err('permission-denied'));   // create-only
      const problems = usageProblems(id, copy, this.user);
      if (problems.length) { this.lastProblems = problems; return Promise.reject(err('permission-denied')); }
      this.stored.set(id, copy);
      if (mode === 'lost') return Promise.reject(err('unavailable'));
      return Promise.resolve();
    },
    // helpers
    signIn(user) {
      this.ready = true;
      this.user = user;
      this.authKnown = true;
      this.role = 'reader';
      this.emit('auth', user);
    },
    signOutNow() { this.user = null; this.role = 'none'; this.authKnown = true; this.emit('auth', null); },
    async logout() {
      await Promise.all(this.hooks.map((fn) => fn()));
      this.signOutNow();
    },
  };
  return Object.assign(cloud, opts);
}

export const USER_A = { uid: 'uidAAAA', email: 'a@example.com', name: 'Anna', provider: 'google.com' };
export const USER_B = { uid: 'uidBBBB', email: 'b@example.com', name: 'Babu', provider: 'password' };

export const UA = {
  androidChrome: 'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidReduced: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.87',
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windows81Firefox: 'Mozilla/5.0 (Windows NT 6.3; Win64; x64; rv:115.0) Gecko/20100101 Firefox/115.0',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  whatsapp: 'Mozilla/5.0 (Linux; Android 12; RMX3085 Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.165 Mobile Safari/537.36 WhatsApp/2.24.13.78',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  chromeOS: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

export function jsonResponse(body, { ok = true, type = 'application/json; charset=utf-8' } = {}) {
  return Promise.resolve({ ok, headers: { get: (h) => (/content-type/i.test(h) ? type : null) }, json: async () => body });
}
export const GEO = { ip: '203.0.113.7', country: 'IN', region: 'Kerala', city: 'Kochi', isp: 'Example Broadband' };

/**
 * Load app/js/usage.js in a fresh fake browser.
 * opts: { store (Map, shared), clock, cloud (object | null for no Cloud), online, ua, uaData, locks,
 *         visibility, protocol, pathname, referrer, fetch, maxTouchPoints, quota }
 */
export function loadUsage(opts = {}) {
  const clock = opts.clock || new Clock();
  const store = opts.store || new Map();
  const localStorage = makeStorage(store, { quota: opts.quota });
  const win = makeEvents();
  const doc = makeEvents();
  const warnings = [];
  const fetchCalls = [];
  const cloud = opts.cloud === null ? undefined : (opts.cloud || makeCloud());
  const navigator = {
    onLine: opts.online !== false,
    userAgent: opts.ua ?? UA.androidChrome,
    language: 'ml-IN',
    maxTouchPoints: opts.maxTouchPoints ?? 0,
  };
  if (opts.uaData) navigator.userAgentData = opts.uaData;
  if (opts.locks) navigator.locks = opts.locks;
  const document = {
    visibilityState: opts.visibility || 'visible',
    referrer: opts.referrer || '',
    addEventListener: doc.addEventListener,
    removeEventListener: doc.removeEventListener,
  };
  const protocol = opts.protocol || 'https:';
  const location = {
    protocol, origin: protocol + '//bible.example.org', pathname: opts.pathname || '/', hash: opts.hash || '',
    href: protocol + '//bible.example.org' + (opts.pathname || '/'),
  };
  const fetchImpl = opts.fetch || (() => jsonResponse(GEO));
  const ctx = {
    console: { log() {}, info() {}, error: (...a) => warnings.push(a), warn: (...a) => warnings.push(a) },
    localStorage,
    navigator,
    document,
    location,
    screen: { width: 412, height: 915 },
    devicePixelRatio: 2.625,
    matchMedia: (q) => ({ matches: !!opts.standalone && /standalone/.test(q), media: q }),
    crypto: webcrypto,
    fetch: (url, init) => { fetchCalls.push({ url, init }); return fetchImpl(url, init); },
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clearTimeout(id),
    setInterval: () => { throw new Error('setInterval must not be used'); },
    Date: makeDate(clock),
    URL,
    Intl,
    addEventListener: win.addEventListener,
    removeEventListener: win.removeEventListener,
  };
  if (cloud) ctx.Cloud = cloud;
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readApp('usage.js'), ctx, { filename: 'usage.js' });
  const env = {
    ctx, clock, store, cloud, navigator, document, location, warnings, fetchCalls,
    get Usage() { return ctx.Usage; },
    queue: () => lsGet(store, Q_KEY) || [],
    sending: () => lsGet(store, SEND_KEY),
    fireWindow: (type, ev) => win.dispatch(type, ev),
    winListeners: win.listeners,
    docListeners: doc.listeners,
    setVisibility(state) { document.visibilityState = state; doc.dispatch('visibilitychange'); },
    setOnline(on) { navigator.onLine = on; win.dispatch(on ? 'online' : 'offline'); },
    // the due-timers (not the 20 s upload timeouts / the 1.5 s "soon" flush)
    dueTimers: () => clock.pending((t) => t.ms !== 20000 && t.ms !== 1500),
  };
  return env;
}

// a queued event as usage.js stores it (for seeding the queue)
let seedN = 0;
export function seedEvent(u, t, extra = {}) {
  seedN++;
  const k = ('S' + seedN.toString(36).padStart(7, '0')).slice(0, 8);
  return Object.assign({ k, e: 'seed', t, s: 'sessSEED00', net: 1, u }, extra);
}
export function seedEvents(u, n, t0, step = 1000, extra) {
  return Array.from({ length: n }, (_, i) => seedEvent(u, t0 + i * step, extra));
}
