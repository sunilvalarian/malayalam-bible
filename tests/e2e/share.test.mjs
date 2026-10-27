// Sharing: ☰ → ആപ്പ് പങ്കിടുക (the app's link) and a selected verse → പങ്കിടുക (text + verse link,
// Instagram / ചിത്രം as a picture), on a desktop and on a phone. The clipboard and the phone's share
// menu (navigator.share) are replaced by stand-ins that record what they get; the WhatsApp /
// Telegram / Facebook / e-mail buttons are links, so their href is checked instead of opening them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KnownDevices } from 'puppeteer-core';
import { READER, launch, watch, waitVerses, sleep, badErrors, debugErrors, tap } from './helpers.mjs';

const APP_LINK = 'https://penuel.pages.dev/';   // the public address, wherever the app runs
const APP_NAME = 'പരിഷ്കരിച്ച മലയാളം ബൈബിൾ';

async function openReader(b, phone) {
  const page = await b.browser.newPage();
  const w = watch(page);
  if (phone) await page.emulate(KnownDevices['Pixel 5']);
  await page.evaluateOnNewDocument((phone) => {
    window.__shared = [];
    navigator.clipboard.writeText = async (t) => { window.__copied = t; };
    if (phone) {
      navigator.share = async (d) => { window.__shared.push({ title: d.title, text: d.text, files: d.files ? d.files.length : 0 }); };
      navigator.canShare = () => true;
    }
  }, phone);
  await page.goto(READER + '#/GEN/15', { waitUntil: 'load' });
  await waitVerses(page);
  return { page, w };
}

async function openAppShare(page) {
  await tap(page, '#btnMenu');
  await page.waitForSelector('#dlgMenu[open]');
  await page.$eval('#dlgMenu [data-menu="share"]', (e) => e.scrollIntoView({ block: 'center' }));
  await sleep(400);   // the drawer slides in
  await tap(page, '#dlgMenu [data-menu="share"]');
  await page.waitForSelector('#dlgShare[open]', { timeout: 5000 });
}

// what the share sheet shows and where its link buttons point
const sheet = (page) => page.evaluate(() => {
  const vis = (s) => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; };
  const href = (to) => decodeURIComponent(document.querySelector(`#shareGrid [data-to="${to}"]`).href);
  return {
    open: document.querySelector('#dlgShare').open, menuOpen: document.querySelector('#dlgMenu').open,
    title: document.querySelector('#shareTitle').textContent, body: document.querySelector('#shareVerse').textContent,
    linkRow: vis('#shareLinkRow'), instagram: vis('[data-to="instagram"]'), image: vis('[data-to="image"]'),
    more: vis('#shareMore'), sms: vis('#shareSms'), facebook: vis('[data-to="facebook"]'),
    nativeShare: !!navigator.share,
    wa: href('whatsapp'), tg: href('telegram'), fb: href('facebook'), mail: href('email'),
  };
});

for (const phone of [false, true]) {
  const where = phone ? 'phone' : 'desktop';

  test(`share (${where}): ☰ → ആപ്പ് പങ്കിടുക sends the app's link`, async (t) => {
    const b = await launch();
    try {
      const { page, w } = await openReader(b, phone);
      await openAppShare(page);
      const s = await sheet(page);
      assert.ok(s.open && !s.menuOpen, 'the share sheet opens and the menu closes');
      assert.equal(s.title, 'പങ്കിടുക · ' + APP_NAME);
      assert.ok(s.body.startsWith(APP_NAME), 'the sheet shows the invitation text');
      assert.ok(!s.linkRow && !s.instagram && !s.image, 'no link checkbox, Instagram or picture for the app');
      assert.equal(s.more, s.nativeShare, 'മറ്റുള്ളവ only with a share menu (navigator.share)');
      assert.equal(s.sms, phone, 'SMS only on a phone');
      assert.ok(s.wa.startsWith('https://wa.me/?text=' + APP_NAME) && s.wa.endsWith('\n' + APP_LINK), 'WhatsApp: text + app link: ' + s.wa);
      assert.ok(!s.wa.includes('#/'), 'the app link has no chapter in it');
      assert.ok(s.tg.includes('url=' + APP_LINK) && s.tg.includes('text=' + APP_NAME) && !s.tg.includes('\n— '), 'Telegram: link + text: ' + s.tg);
      assert.ok(s.facebook && s.fb.endsWith('u=' + APP_LINK), 'Facebook: the app link');
      assert.ok(s.mail.startsWith('mailto:?subject=' + APP_NAME + '&body=' + APP_NAME), 'e-mail subject is the app name');

      await tap(page, '#shareGrid [data-to="copy"]');
      await sleep(300);
      const copied = await page.evaluate(() => window.__copied);
      assert.ok(copied && copied.startsWith(APP_NAME) && copied.endsWith('\n' + APP_LINK), 'പകർത്തുക copies text + link: ' + copied);
      assert.equal(await page.$eval('#dlgShare', (d) => d.open), false, 'the sheet closes after copying');

      if (phone) {
        await openAppShare(page);
        await tap(page, '#shareMore');
        await sleep(300);
        const sent = await page.evaluate(() => window.__shared.pop());
        assert.ok(sent && sent.text.endsWith(APP_LINK) && sent.title === APP_NAME, 'മറ്റുള്ളവ hands text + link to the phone share menu');
      }
      debugErrors(t, w);
      assert.deepEqual(badErrors(w), []);
    } finally { await b.close(); }
  });

  test(`share (${where}): a selected verse → പങ്കിടുക sends the verse, its link or a picture`, async (t) => {
    const b = await launch();
    try {
      const { page, w } = await openReader(b, phone);
      // the app's share sheet first: the verse sheet must bring back what it hid
      await openAppShare(page);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#dlgShare').open);

      await page.$eval('#reader .v[data-v="1"]', (e) => e.scrollIntoView({ block: 'center' }));
      await page.click('#reader .v[data-v="1"]');
      await tap(page, '#actionbar [data-act="share"]');
      await page.waitForSelector('#dlgShare[open]', { timeout: 5000 });
      const s = await sheet(page);
      assert.equal(s.title, 'പങ്കിടുക · ഉത്പത്തി 15:1');
      assert.ok(s.linkRow && s.instagram && s.image, 'link checkbox, Instagram and picture are shown again');
      assert.ok(s.wa.includes('\n— ഉത്പത്തി 15:1\n') && s.wa.endsWith('#/GEN/15/1'), 'WhatsApp: verse + reference + verse link: ' + s.wa);

      await page.click('#shareLink');
      await sleep(100);
      const { wa } = await sheet(page);
      assert.ok(wa.endsWith('— ഉത്പത്തി 15:1') && !wa.includes(APP_LINK), 'unticking the link leaves it out: ' + wa);

      if (phone) {
        await tap(page, '#shareGrid [data-to="instagram"]');
        await page.waitForFunction(() => window.__shared.length, { timeout: 15000 });
        const sent = await page.evaluate(() => window.__shared.pop());
        assert.equal(sent.files, 1, 'Instagram gets the verse picture through the phone share menu');
      } else {
        // ചിത്രം saves the card: catch the download link instead of writing a file
        const name = await page.evaluate(async () => {
          let got = null;
          const orig = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () { if (this.download) got = this.download; else orig.call(this); };
          document.querySelector('#shareGrid [data-to="image"]').click();
          for (let i = 0; i < 150 && !got; i++) await new Promise((r) => setTimeout(r, 100));
          HTMLAnchorElement.prototype.click = orig;
          return got;
        });
        assert.equal(name, 'GEN-15-1.png', 'ചിത്രം saves the verse card as a PNG');
      }
      debugErrors(t, w);
      assert.deepEqual(badErrors(w), []);
    } finally { await b.close(); }
  });
}
