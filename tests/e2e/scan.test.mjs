// Camera scan: photos of printed pages → OCR in the browser (js/ocr.js, Tesseract.js from jsdelivr)
// → the upload dialog's result rows → text corrected by hand → saved chapter in the reader.
// The test page is drawn on a canvas in the browser (white page, Noto Serif Malayalam, a heading
// and word-wrapped numbered verses), so no image file is kept in the repository.
// The first read downloads the OCR core and the Malayalam model (several MB): allow minutes.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  READER, launch, watch, waitCloud, waitVerses, waitServiceWorker, waitFor, sleep, cacheContents, setOffline,
  clearEmulators, createUser, setDoc, getDoc, uniq, badErrors, debugErrors, tap,
} from './helpers.mjs';

const OCR_MS = 180000;
const VERSES = [
  '1 ആദിയിൽ ദൈവം ആകാശവും ഭൂമിയും സൃഷ്ടിച്ചു.',
  '2 ഭൂമി പാഴായും ശൂന്യമായും ഇരുന്നു; ആഴത്തിന്മീതെ ഇരുൾ ഉണ്ടായിരുന്നു. ദൈവത്തിന്റെ ആത്മാവ് വെള്ളത്തിൻമീതെ പരിവർത്തിച്ചുകൊണ്ടിരുന്നു.',
  '3 വെളിച്ചം ഉണ്ടാകട്ടെ എന്നു ദൈവം കല്പിച്ചു; വെളിച്ചം ഉണ്ടായി.',
  '4 വെളിച്ചം നല്ലതു എന്നു ദൈവം കണ്ടു; ദൈവം വെളിച്ചവും ഇരുളും തമ്മിൽ വേർപിരിച്ചു.',
  '5 ദൈവം വെളിച്ചത്തിന്നു പകൽ എന്നും ഇരുളിന്നു രാത്രി എന്നും പേരിട്ടു; സന്ധ്യയായി ഉഷസ്സുമായി ഒന്നാം ദിവസം.',
];
const HEADING = 'ലോകസൃഷ്ടി';
const ADDED = 'പരിശോധനയ്ക്കായി ചേർത്ത വാക്യം.';
// the Tesseract worker prints these about its own configuration (harmless)
const OCR_OK = [/Parameter not found/];

let editor;
before(async () => {
  await clearEmulators();
  editor = await createUser(uniq('scanner'), 'scanner-pass-1', { verified: true, name: 'Scanner' });
  await setDoc(`users/${editor.uid}`, { email: editor.email, name: 'Scanner', role: 'editor', provider: 'password', createdAt: new Date(), lastLogin: new Date() });
});

// a printed-looking page (text: heading + verses wrapped to the column) or a blank sheet, as PNG bytes
async function pagePng(page, { heading, verses } = {}) {
  const b64 = await page.evaluate(async (heading, verses) => {
    await document.fonts.load("400 30px 'Noto Serif Malayalam'");
    await document.fonts.load("700 30px 'Noto Serif Malayalam'");
    const W = 1200, M = 70, FS = 30, LH = 52;
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    g.font = `400 ${FS}px 'Noto Serif Malayalam'`;
    const rows = heading ? [{ t: heading, head: true }] : [];
    let cur = '';
    for (const w of (verses || []).join(' ').split(' ').filter(Boolean)) {
      const t = cur ? cur + ' ' + w : w;
      if (cur && g.measureText(t).width > W - 2 * M) { rows.push({ t: cur }); cur = w; } else cur = t;
    }
    if (cur) rows.push({ t: cur });
    c.width = W; c.height = Math.max(900, M * 2 + rows.length * LH);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, c.height);
    g.fillStyle = '#111'; g.textBaseline = 'top';
    rows.forEach((r, i) => {
      g.font = `${r.head ? 700 : 400} ${FS}px 'Noto Serif Malayalam'`;
      g.textAlign = r.head ? 'center' : 'left';
      g.fillText(r.t, r.head ? W / 2 : M, M + i * LH);
    });
    const url = c.toDataURL('image/png');
    return url.slice(url.indexOf(',') + 1);
  }, heading || '', verses || []);
  return Buffer.from(b64, 'base64');
}

const scanState = (page) => page.evaluate(() => {
  const s = document.querySelector('#upList .up-item[data-scan]');
  return s && {
    pages: s.querySelectorAll('.scan-pages img').length,
    captions: [...s.querySelectorAll('.scan-pages figcaption')].map((f) => f.textContent),
    readDisabled: s.querySelector('[data-scan-read]').disabled,
    warn: (s.querySelector('.up-warn') || {}).textContent || '',
  };
});
const rowState = (page) => page.evaluate(() => {
  const r = document.querySelector('#upList .up-item[data-u]');
  if (!r) return null;
  const ta = r.querySelector('.up-text');
  const warn = r.querySelector('.up-warn');
  return {
    count: r.querySelector('.up-count').textContent,
    verses: +r.querySelector('.up-count').textContent.match(/^(\d+)/)[1],
    status: r.querySelector('.status').textContent,
    warn: warn && !warn.hidden ? warn.textContent : '',
    preview: (r.querySelector('.up-preview') || {}).textContent || '',
    text: ta ? ta.value : null,
    thumbs: r.querySelectorAll('.scan-pages img').length,
  };
});
// choose a file through the file chooser the click opens (the camera on a phone)
async function choose(page, sel, file) {
  const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10000 }), tap(page, sel)]);
  await chooser.accept([file]);
}
async function typeText(page, text) {
  await page.$eval('#upList .up-text', (ta, t) => { ta.value = t; ta.dispatchEvent(new Event('input', { bubbles: true })); }, text);
}

test('camera scan: OCR a printed page, correct the text, save the chapter', { timeout: 8 * 60000 }, async (t) => {
  const b = await launch();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlb-scan-'));
  try {
    const page = await b.browser.newPage();
    const w = watch(page);
    await page.goto(READER + '#/GEN/1', { waitUntil: 'load' });
    await waitVerses(page);
    await waitCloud(page);
    await waitServiceWorker(page);
    await page.evaluate((e, p) => window.Cloud.signIn(e, p), editor.email, editor.password);
    await waitFor(page, () => window.Cloud.user && window.Cloud.role === 'editor', { timeout: 20000 });

    const textPng = path.join(tmp, 'page-1.png'), blankPng = path.join(tmp, 'blank.png');
    fs.writeFileSync(textPng, await pagePng(page, { heading: HEADING, verses: VERSES }));
    fs.writeFileSync(blankPng, await pagePng(page));

    // ☰ → ക്യാമറയിൽ സ്കാൻ ചെയ്യുക opens the dialog and the camera straight away
    await tap(page, '#btnMenu');
    await waitFor(page, () => document.getElementById('dlgMenu').open);
    await sleep(500);   // the drawer slides in: a click by position needs it in place
    await choose(page, '#dlgMenu [data-menu="scan"]', blankPng);
    await waitFor(page, () => document.getElementById('dlgUpload').open && document.querySelector('#upList .up-item[data-scan] .scan-pages img'));
    assert.deepEqual(await scanState(page), { pages: 1, captions: ['1'], readDisabled: false, warn: '' });

    // a page without text: an error, the photo stays, back to collecting (this first read loads the OCR)
    const t0 = Date.now();
    await tap(page, '#upList [data-scan-read]');
    await waitFor(page, () => document.querySelector('#upList [data-prog]'), { timeout: 10000 });
    await waitFor(page, () => document.querySelector('#upList .up-item[data-scan] .up-warn'), { timeout: OCR_MS, polling: 500 });
    t.diagnostic(`OCR ready + blank page read in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const err = await scanState(page);
    assert.match(err.warn, /മലയാളം ടെക്സ്റ്റ് കണ്ടെത്തിയില്ല/);
    assert.equal(err.pages, 1, 'the photo is kept for a retry');
    assert.equal(await page.$('#upList .up-item[data-u]'), null, 'no result row');
    assert.equal(await page.$eval('#upSave', (x) => x.disabled), true);

    // remove the blank page; add the printed page (next-page button) and the blank one again (camera input)
    await tap(page, '#upList [data-img-rm="0"]');
    assert.deepEqual(await scanState(page), { pages: 0, captions: [], readDisabled: true, warn: '' });
    await choose(page, '#upList [data-scan-add]', textPng);
    await (await page.$('#upCamera')).uploadFile(blankPng);
    await waitFor(page, () => document.querySelectorAll('#upList .scan-pages img').length === 2);
    await tap(page, '#upList [data-img-rm="1"]');
    assert.deepEqual(await scanState(page), { pages: 1, captions: ['1'], readDisabled: false, warn: '' });

    // read the printed page
    const t1 = Date.now();
    await tap(page, '#upList [data-scan-read]');
    await waitFor(page, () => document.querySelector('#upList .up-item[data-u]') || document.querySelector('#upList .up-item[data-scan] .up-warn'), { timeout: OCR_MS, polling: 500 });
    const row = await rowState(page);
    assert.ok(row, 'a result row: ' + JSON.stringify(await scanState(page)));
    t.diagnostic(`page read in ${((Date.now() - t1) / 1000).toFixed(1)} s: ${row.count}`);
    assert.ok(row.verses >= 3, `at least 3 verses found (${row.count})`);
    assert.match(row.count, /1 തലക്കെട്ടുകൾ/, 'the heading is found');
    assert.match(row.status, /അധ്യായ നമ്പർ നൽകുക/, 'no chapter number on the page');
    assert.match(row.warn, /സ്കാൻ ചെയ്ത ടെക്സ്റ്റ്/, 'scan warning');
    assert.match(row.preview, /ആദിയിൽ ദൈവം/, 'preview open with the text');
    assert.equal(await page.$('#upList .up-item[data-scan]'), null, 'the collecting group became the result');
    assert.equal(await page.$eval('#upSave', (x) => x.disabled), true, 'no chapter number yet');

    // chapter number → replaces the existing chapter, save enabled
    await page.$eval('#upList .up-ch', (el) => { el.value = '3'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await waitFor(page, () => /നിലവിലുള്ളത്/.test(document.querySelector('#upList .up-item[data-u] .status').textContent));
    assert.equal(await page.$eval('#upSave', (x) => x.disabled), false);

    // text editor: OCR text in editor format, the photo next to it; counts / warnings / preview follow typing
    await tap(page, '#upList .up-edit');
    await waitFor(page, () => document.querySelector('#upList .up-text'));
    const ed = await rowState(page);
    t.diagnostic('OCR text:\n' + ed.text);
    assert.match(ed.text, /^## \S.*\n\[1\] /, 'editor format with the heading');
    assert.equal(ed.thumbs, 1, 'the photo is shown for comparing');
    await typeText(page, '[1] ഒന്ന്. [3] മൂന്ന്.');
    let now = await rowState(page);
    assert.match(now.count, /^2 വാക്യങ്ങൾ · 0 തലക്കെട്ടുകൾ/);
    assert.match(now.warn, /missing\): 2/, 'a missing verse is reported while typing');
    assert.match(now.preview, /മൂന്ന്/);
    const fixed = ed.text + `\n[${ed.verses + 1}] ${ADDED}`;
    await typeText(page, fixed);
    now = await rowState(page);
    assert.equal(now.verses, ed.verses + 1);
    assert.doesNotMatch(now.warn, /missing/);
    assert.match(now.preview, new RegExp(ADDED));
    // re-rendering (edit closed and opened again) keeps the corrected text
    await tap(page, '#upList .up-edit');
    await waitFor(page, () => !document.querySelector('#upList .up-text'));
    await tap(page, '#upList .up-edit');
    await waitFor(page, () => document.querySelector('#upList .up-text'));
    assert.equal((await rowState(page)).text, fixed);

    // save → the reader shows the chapter, Firestore has it
    await tap(page, '#upSave');
    await waitFor(page, () => !document.getElementById('dlgUpload').open && location.hash === '#/GEN/3');
    await waitFor(page, (a) => document.querySelector('#reader').textContent.includes(a), {}, ADDED);
    const shown = await page.evaluate(() => ({
      verses: document.querySelectorAll('#reader .v').length,
      text: document.querySelector('#reader').textContent,
    }));
    assert.equal(shown.verses, ed.verses + 1, 'every verse of the scan is in the reader');
    assert.match(shown.text, /ആദിയിൽ ദൈവം/);
    let ch = null;
    const end = Date.now() + 20000;
    while (Date.now() < end && !(ch = await getDoc('chapters/GEN_3'))) await sleep(300);
    assert.ok(ch, 'the chapter reached Firestore');
    assert.equal(ch.updatedBy, editor.email);
    assert.ok(ch.items.some((it) => it.t === ADDED));
    assert.ok(ch.items.some((it) => it.h), 'with the heading');

    // service worker: the OCR scripts are cached for offline scans
    const caches = await cacheContents(page);
    const lib = caches['ml-bible-lib'] || [];
    t.diagnostic('ml-bible-lib: ' + lib.filter((u) => /tesseract/.test(u)).join(', '));
    assert.ok(lib.some((u) => /tesseract\.js@7\.0\.0\/dist\/tesseract\.min\.js$/.test(u)), 'library cached');
    assert.ok(lib.some((u) => /tesseract\.js@v?7\.0\.0\/dist\/worker\.min\.js$/.test(u)), 'worker cached');
    assert.ok(lib.some((u) => /tesseract\.js-core@/.test(u)), 'OCR core cached');

    // offline: a new scan still reads (scripts from the service worker, the model from IndexedDB;
    // the worker was ended when the dialog closed, so this starts it again)
    await setOffline(page, true);
    await tap(page, '#btnMenu');
    await waitFor(page, () => document.getElementById('dlgMenu').open);
    await sleep(500);
    await tap(page, '#dlgMenu [data-menu="upload"]');
    await waitFor(page, () => document.getElementById('dlgUpload').open);
    assert.equal(await page.$('#upList .up-item'), null, 'the saved scan is gone from the dialog');
    await (await page.$('#upCamera')).uploadFile(textPng);
    await tap(page, '#upList [data-scan-read]');
    await waitFor(page, () => document.querySelector('#upList .up-item[data-u]') || document.querySelector('#upList .up-item[data-scan] .up-warn'), { timeout: 60000, polling: 500 });
    const off = await rowState(page);
    assert.ok(off && off.verses >= 3, 'offline scan read: ' + JSON.stringify(off || await scanState(page)));
    await setOffline(page, false);

    debugErrors(t, w);
    assert.deepEqual(badErrors(w, true).filter((e) => !OCR_OK.some((re) => re.test(e))), [], 'no unexpected errors');
  } finally {
    await b.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
