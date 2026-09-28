// Shared helpers for the browser end-to-end tests (run through e2e/run.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export const BASE = process.env.E2E_BASE || 'http://localhost:8788';
export const READER = BASE + '/?emulator';
export const PORTAL = BASE + '/admin.html?emulator';
export const OWNER = 'sunilvalarian@gmail.com';
const PROJECT = 'demo-bible';
const FS = 'http://127.0.0.1:8080';
const AUTH = 'http://127.0.0.1:9099';
const DOCS = `${FS}/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER_HDR = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const uniq = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;

// ---------- browser ----------
export async function launch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlb-e2e-'));
  const browser = await puppeteer.launch({
    executablePath: process.env.E2E_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: process.env.E2E_HEADFUL ? false : true,
    userDataDir: dir,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate,OptimizationHints', '--window-size=1280,900', '--lang=ml-IN'],
    defaultViewport: { width: 1280, height: 900 },
  });
  return {
    browser,
    dir,
    async close() {
      await browser.close().catch(() => {});
      for (let i = 0; i < 5; i++) {
        try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await sleep(300); }
      }
    },
  };
}

// console errors and uncaught page errors, for "no unexpected errors" checks
export function watch(page) {
  const errors = [];
  const all = [];
  page.on('console', (m) => {
    const loc = m.location() || {};
    const rec = { kind: 'console.' + m.type(), text: m.text(), url: loc.url || '' };
    all.push(rec);
    if (m.type() === 'error') errors.push(rec);
  });
  page.on('pageerror', (e) => errors.push({ kind: 'pageerror', text: String((e && e.message) || e) }));
  return {
    errors,
    all,
    // everything except the patterns that are expected in this situation
    unexpected(allow = []) {
      return errors.filter((e) => !allow.some((re) => re.test(e.text) || re.test(e.url || '')));
    },
  };
}
// always harmless: the emulator warning banner, favicon lookups, and the 400 the Firestore library's
// long-poll channel sometimes gets when it restarts (it reconnects by itself)
export const ALWAYS_OK = [/favicon/i, /running in emulator mode/i, /Firestore\/(Listen|Write)\/channel/];
// expected while the network is off: failed loads (fonts, Firestore channel, /api/where …)
export const OFFLINE_OK = [/ERR_INTERNET_DISCONNECTED/, /net::ERR_/, /Failed to load resource/, /Could not reach Cloud Firestore backend/i,
  /client is offline/i, /WebChannelConnection/i, /unavailable/i, /Failed to fetch/i, /network-request-failed/i];

export async function waitFor(page, fn, opts = {}, ...args) {
  return page.waitForFunction(fn, { timeout: opts.timeout || 20000, polling: opts.polling || 100 }, ...args);
}
export const waitCloud = (page, timeout = 30000) => waitFor(page, () => window.Cloud && window.Cloud.ready && window.Cloud.authKnown, { timeout });
export const waitVerses = (page, timeout = 20000) => waitFor(page, () => document.querySelectorAll('#reader .v').length > 3, { timeout });

// the service worker is installed, active and controls the page
export async function waitServiceWorker(page, timeout = 30000) {
  await waitFor(page, () => navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.state === 'activated', { timeout, polling: 250 });
}
export function cacheContents(page) {
  return page.evaluate(async () => {
    const out = {};
    for (const k of await caches.keys()) {
      const c = await caches.open(k);
      out[k] = (await c.keys()).map((r) => r.url);
    }
    return out;
  });
}

// offline for the page and (if running) its service worker, so nothing reaches the network
export async function setOffline(page, offline) {
  await page.setOfflineMode(offline);
  const b = page.browser();
  const sws = b.targets().filter((t) => t.type() === 'service_worker' && t.url().startsWith(BASE));
  for (const t of sws) {
    try {
      const s = await t.createCDPSession();
      await s.send('Network.enable');
      await s.send('Network.emulateNetworkConditions', { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      if (!page.__swSessions) page.__swSessions = [];
      page.__swSessions.push(s);
    } catch (e) { /* the worker may have stopped; it is started again offline-emulated with the page */ }
  }
}

export const queue = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('mlb.usageQueue') || '[]'));

// Usage.flush() until nothing of the current account waits (a flush already running is returned as is)
export async function flushAll(page, timeout = 20000) {
  const end = Date.now() + timeout;
  for (;;) {
    const left = await page.evaluate(async () => {
      await window.Usage.flush();
      const uid = window.Cloud.user ? window.Cloud.user.uid : '';
      return JSON.parse(localStorage.getItem('mlb.usageQueue') || '[]').filter((e) => e.u === uid).length;
    });
    if (!left) return;
    if (Date.now() > end) throw new Error(`usage queue still has ${left} events after ${timeout} ms`);
    await sleep(300);
  }
}

// ---------- emulator REST (admin access: "Bearer owner") ----------
export async function clearEmulators() {
  const a = await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  const b = await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
  if (!a.ok || !b.ok) throw new Error(`clearing the emulators failed: ${a.status} / ${b.status}`);
}

export async function createUser(email, password, { verified = false, name = '' } = {}) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, displayName: name || undefined, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('signUp: ' + JSON.stringify(j));
  if (verified) {
    const u = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:update`, {
      method: 'POST', headers: OWNER_HDR, body: JSON.stringify({ localId: j.localId, emailVerified: true }),
    });
    if (!u.ok) throw new Error('accounts:update: ' + (await u.text()));
  }
  return { uid: j.localId, email, password };
}

// JS value ↔ Firestore REST value
export function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toValue(x)])) } };
}
export function fromValue(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fromValue(x)]));
  return v;
}
export async function setDoc(pathName, data) {
  const r = await fetch(`${DOCS}/${pathName}`, {
    method: 'PATCH', headers: OWNER_HDR, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, x]) => [k, toValue(x)])) }),
  });
  if (!r.ok) throw new Error(`setDoc ${pathName}: ${r.status} ${await r.text()}`);
}
export async function getDoc(pathName) {
  const r = await fetch(`${DOCS}/${pathName}`, { headers: OWNER_HDR });
  if (r.status === 404) return null;
  const j = await r.json();
  return fromValue({ mapValue: { fields: j.fields || {} } });
}
export async function listDocs(collection) {
  const out = [];
  let token = '';
  do {
    const r = await fetch(`${DOCS}/${collection}?pageSize=300${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { headers: OWNER_HDR });
    const j = await r.json();
    if (!r.ok) throw new Error(`list ${collection}: ${JSON.stringify(j)}`);
    for (const d of j.documents || []) out.push(Object.assign({ id: d.name.split('/').pop() }, fromValue({ mapValue: { fields: d.fields || {} } })));
    token = j.nextPageToken || '';
  } while (token);
  return out;
}
export const listUsageDocs = () => listDocs('usage');

// a usage batch as usage.js uploads it; `at` = when it was uploaded
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const rid = (n) => Array.from({ length: n }, () => ALNUM[Math.floor(Math.random() * 62)]).join('');
export async function seedUsage({ at, device, uid = null, email = null, name = null, events, os = 'Android', browser = 'Chrome', model = 'Pixel 7', city = 'Kochi' }) {
  const id = rid(20);
  const doc = {
    v: 1, device: device || rid(20), uid, email, name,
    dev: { os, osv: '14', browser, bv: '129', model, mobile: true, tablet: false, screen: '412x915@2.63', lang: 'ml-IN', tz: 'Asia/Kolkata', installed: false, app: 'v15', net: '4g', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/129.0 Mobile' },
    geo: { ip: '203.0.113.7', country: 'IN', region: 'Kerala', city, isp: 'Example ISP' },
    events: events.map((e) => Object.assign({ s: 'sess1', net: 1 }, e)),
    n: events.length, from: events[0].t, to: events[events.length - 1].t, at: new Date(at),
  };
  await setDoc('usage/' + id, doc);
  return Object.assign({ id }, doc);
}

// ---------- downloads ----------
export async function allowDownloads(browser, dir) {
  const s = await browser.target().createCDPSession();
  await s.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
  return s;
}
export async function waitFile(dir, re, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const f = fs.existsSync(dir) ? fs.readdirSync(dir).find((x) => re.test(x) && !/\.crdownload$/.test(x)) : null;
    if (f) return path.join(dir, f);
    if (Date.now() > end) throw new Error(`no download matching ${re} in ${dir}`);
    await sleep(200);
  }
}

// E2E_DEBUG=1: list the console errors a test tolerated (to review the allow-lists)
export function debugErrors(t, w) {
  if (!process.env.E2E_DEBUG) return;
  const seen = new Set();
  for (const e of w.errors) {
    const k = e.kind + ' ' + e.text.slice(0, 160) + (e.url ? ' @ ' + e.url.slice(0, 80) : '');
    if (!seen.has(k)) { seen.add(k); t.diagnostic(k); }
  }
}
// uncaught page errors always count; console errors unless expected (offline: failed network loads)
export function badErrors(w, offline) {
  const allow = offline ? ALWAYS_OK.concat(OFFLINE_OK) : ALWAYS_OK;
  return w.errors.filter((e) => e.kind === 'pageerror' || !allow.some((re) => re.test(e.text) || re.test(e.url || '')))
    .map((e) => `${e.kind}: ${e.text.slice(0, 300)}`);
}
// click once visible; an element still sliding in (action bar) can't be clicked by position yet, so
// fall back to a DOM click
export async function tap(page, sel, timeout = 10000) {
  await page.waitForSelector(sel, { visible: true, timeout });
  try { await page.click(sel); } catch (e) { await page.$eval(sel, (el) => el.click()); }
}
