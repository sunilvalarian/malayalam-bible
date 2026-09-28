// app/js/usage.js — device info (User-Agent + Client Hints) and the place lookup (/api/where).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadUsage, lsGet, lsSet, settle, jsonResponse, readApp, GEO, UA, T0, HOUR, GEO_KEY, HW_KEY, APP } from './lib/env.mjs';

const info = (ua, extra = {}) => loadUsage(Object.assign({ ua }, extra)).Usage.deviceInfo();
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
const K = ['os', 'osv', 'browser', 'bv', 'model', 'mobile', 'tablet'];

describe('usage.js: User-Agent parsing', () => {
  const cases = [
    ['Android Chrome with model', UA.androidChrome, {}, { os: 'Android', osv: '13', browser: 'Chrome', bv: '126', model: 'SM-S918B', mobile: true, tablet: false }],
    ["reduced UA: model 'K' ignored", UA.androidReduced, {}, { os: 'Android', osv: '10', browser: 'Chrome', bv: '126', model: '', mobile: true, tablet: false }],
    ['Android tablet (no "Mobile")', UA.androidTablet, {}, { os: 'Android', osv: '13', browser: 'Chrome', bv: '126', model: 'SM-X710', mobile: false, tablet: true }],
    ['iPhone Safari', UA.iphoneSafari, {}, { os: 'iOS', osv: '17.5', browser: 'Safari', bv: '17', model: 'iPhone', mobile: true, tablet: false }],
    ['iPhone Chrome (CriOS)', UA.iphoneChrome, {}, { os: 'iOS', osv: '17.5', browser: 'Chrome', bv: '126', model: 'iPhone', mobile: true, tablet: false }],
    ['iPad (desktop UA "Macintosh" + touch)', UA.ipadDesktop, { maxTouchPoints: 5 }, { os: 'iPadOS', osv: '10.15.7', browser: 'Safari', bv: '17', model: '', mobile: false, tablet: true }],
    ['Mac Safari (no touch)', UA.ipadDesktop, { maxTouchPoints: 0 }, { os: 'macOS', osv: '10.15.7', browser: 'Safari', bv: '17', model: '', mobile: false, tablet: false }],
    ['Mac Chrome', UA.macChrome, {}, { os: 'macOS', osv: '10.15.7', browser: 'Chrome', bv: '126', model: '', mobile: false, tablet: false }],
    ['Windows Edge', UA.windowsEdge, {}, { os: 'Windows', osv: '10', browser: 'Edge', bv: '126', model: '', mobile: false, tablet: false }],
    ['Windows Chrome', UA.windowsChrome, {}, { os: 'Windows', osv: '10', browser: 'Chrome', bv: '126', model: '', mobile: false, tablet: false }],
    ['Windows 8.1 Firefox', UA.windows81Firefox, {}, { os: 'Windows', osv: '8.1', browser: 'Firefox', bv: '115', model: '', mobile: false, tablet: false }],
    ['Windows Firefox', UA.windowsFirefox, {}, { os: 'Windows', osv: '10', browser: 'Firefox', bv: '128', model: '', mobile: false, tablet: false }],
    ['Android Firefox (no model in UA)', UA.androidFirefox, {}, { os: 'Android', osv: '14', browser: 'Firefox', bv: '128', model: '', mobile: true, tablet: false }],
    ['Samsung Internet', UA.samsung, {}, { os: 'Android', osv: '14', browser: 'Samsung Internet', bv: '25', model: 'SAMSUNG SM-A546E', mobile: true, tablet: false }],
    ['WhatsApp in-app browser', UA.whatsapp, {}, { os: 'Android', osv: '12', browser: 'WhatsApp', bv: '2', model: 'RMX3085', mobile: true, tablet: false }],
    ['Linux Firefox', UA.linuxFirefox, {}, { os: 'Linux', osv: '', browser: 'Firefox', bv: '128', model: '', mobile: false, tablet: false }],
    ['ChromeOS', UA.chromeOS, {}, { os: 'ChromeOS', osv: '', browser: 'Chrome', bv: '126', model: '', mobile: false, tablet: false }],
  ];
  for (const [label, ua, extra, want] of cases) {
    test(label, () => assert.deepEqual(pick(info(ua, extra), K), want));
  }
  test('tablet is never also mobile, even when UA-CH says mobile', () => {
    const d = info(UA.androidTablet, { uaData: { mobile: true } });
    assert.deepEqual([d.tablet, d.mobile], [true, false]);
    const p = info(UA.androidChrome, { uaData: { mobile: true } });
    assert.deepEqual([p.tablet, p.mobile], [false, true]);
    const w = info(UA.windowsChrome, { uaData: { mobile: false } });
    assert.deepEqual([w.tablet, w.mobile], [false, false]);
  });
  test('empty User-Agent does not throw', () => {
    assert.deepEqual(pick(info(''), ['os', 'browser', 'model']), { os: '', browser: '', model: '' });
  });
  test('other fields: screen, language, app version, ua clipped to 300; at most 20 keys', () => {
    const d = info(UA.androidChrome + ' ' + 'z'.repeat(400), { standalone: true });
    assert.equal(d.screen, '412x915@2.63');
    assert.equal(d.lang, 'ml-IN');
    assert.equal(d.installed, true);
    assert.equal(d.ua.length, 300);
    assert.equal(d.net, '');
    assert.equal(typeof d.tz, 'string');
    assert.ok(Object.keys(d).length <= 20, 'rules: dev.size() <= 20');
  });
  test('APP_VERSION is in step with VERSION in sw.js', () => {
    const sw = fs.readFileSync(path.join(APP, '..', 'sw.js'), 'utf8').match(/const VERSION = '([^']+)'/)[1];
    assert.equal(info(UA.androidChrome).app, sw);
  });
});

describe('usage.js: User-Agent Client Hints', () => {
  const uaData = (h, mobile = false) => ({
    mobile, platform: h.platform,
    getHighEntropyValues: async (hints) => { uaData.asked = hints; return Object.assign({ brands: [], mobile }, h); },
  });
  test('Windows platformVersion >= 13 → Windows 11 (remembered in localStorage)', async () => {
    const env = loadUsage({ ua: UA.windowsEdge, uaData: uaData({ platform: 'Windows', platformVersion: '15.0.0', model: '' }) });
    await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(uaData.asked)), ['model', 'platformVersion']);
    assert.deepEqual(lsGet(env.store, HW_KEY), { model: '', osv: '11' });
    const d = env.Usage.deviceInfo();
    assert.equal(d.osv, '11');
    assert.equal(d.mobile, false, 'mobile from userAgentData');
  });
  test('Windows platformVersion below 13 → 10', async () => {
    const env = loadUsage({ ua: UA.windowsChrome, uaData: uaData({ platform: 'Windows', platformVersion: '10.0.0', model: '' }) });
    await settle();
    assert.equal(env.Usage.deviceInfo().osv, '10');
  });
  test("Android: exact model replaces the reduced UA's 'K'", async () => {
    const env = loadUsage({ ua: UA.androidReduced, uaData: uaData({ platform: 'Android', platformVersion: '14.0.0', model: 'Pixel 8' }, true) });
    await settle();
    const d = env.Usage.deviceInfo();
    assert.equal(d.model, 'Pixel 8');
    assert.equal(d.osv, '14.0.0');
    assert.equal(d.mobile, true);
  });
  test('stored hints are used on the next load, before the new answer', () => {
    const store = new Map();
    lsSet(store, HW_KEY, { model: 'Pixel 7', osv: '13.0.0' });
    const d = loadUsage({ store, ua: UA.androidReduced }).Usage.deviceInfo();
    assert.equal(d.model, 'Pixel 7');
    assert.equal(d.osv, '13.0.0');
  });
  test('a failing getHighEntropyValues is ignored', async () => {
    const env = loadUsage({ ua: UA.windowsEdge, uaData: { mobile: false, getHighEntropyValues: () => Promise.reject(new Error('no')) } });
    await settle();
    assert.equal(env.store.has(HW_KEY), false);
    assert.equal(env.Usage.deviceInfo().osv, '10');
  });
});

describe('usage.js: place (/api/where)', () => {
  test('looked up once, stored with a time; long values clipped', async () => {
    const env = loadUsage({ fetch: () => jsonResponse(Object.assign({}, GEO, { city: 'c'.repeat(100), extra: 'x' })) });
    await settle();
    assert.equal(env.fetchCalls.length, 1);
    assert.equal(env.fetchCalls[0].url, '/api/where');
    assert.equal(env.fetchCalls[0].init.cache, 'no-store');
    const g = lsGet(env.store, GEO_KEY);
    assert.equal(g.t, T0);
    assert.equal(g.city.length, 60);
    assert.deepEqual(Object.keys(g).sort(), ['city', 'country', 'ip', 'isp', 'region', 't']);
  });
  test('not again within 24 hours; again after', async () => {
    const store = new Map();
    lsSet(store, GEO_KEY, Object.assign({}, GEO, { t: T0 - 23 * HOUR }));
    const env = loadUsage({ store });
    assert.equal(env.fetchCalls.length, 0);
    lsSet(store, GEO_KEY, Object.assign({}, GEO, { t: T0 - 25 * HOUR }));
    const env2 = loadUsage({ store });
    await settle();
    assert.equal(env2.fetchCalls.length, 1);
    assert.equal(lsGet(store, GEO_KEY).t, T0);
  });
  test('not when offline or not http(s)', () => {
    assert.equal(loadUsage({ online: false }).fetchCalls.length, 0);
    assert.equal(loadUsage({ protocol: 'file:' }).fetchCalls.length, 0);
    assert.equal(loadUsage({ protocol: 'http:' }).fetchCalls.length, 1);
  });
  test('non-JSON, error status or network failure → nothing stored', async () => {
    for (const fetch of [
      () => jsonResponse('<html>', { type: 'text/html' }),
      () => jsonResponse(GEO, { ok: false }),
      () => Promise.reject(new TypeError('Failed to fetch')),
    ]) {
      const env = loadUsage({ fetch });
      await settle();
      assert.equal(env.store.has(GEO_KEY), false);
    }
  });
});

test('usage.js source uses no setInterval', () => {
  assert.equal(/setInterval\s*\(/.test(readApp('usage.js')), false);
});
