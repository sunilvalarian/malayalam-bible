// app/js/docx-extract.js (window.DocxExtract): Word .docx → paragraphs, and on through the parser
// the way the upload dialog uses it. The .docx files are built here (zip with deflate / stored entries).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readApp, APP } from './lib/env.mjs';

const require = createRequire(import.meta.url);
const D = require(path.join(APP, 'docx-extract.js'));
const plain = (x) => JSON.parse(JSON.stringify(x));

function loadParser() {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readApp('parser.js'), ctx, { filename: 'parser.js' });
  return ctx.BibleParser;
}

// CRC-32 (zlib.crc32 only exists from Node 20.15)
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}

// a minimal zip writer: { name: string | Buffer }, deflated unless listed in `stored`
function zip(files, stored = []) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const method = stored.includes(name) ? 0 : 8;
    const data = method ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(zlib.crc32 ? zlib.crc32(raw) : crc32(raw), 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  const buf = Buffer.concat([...locals, cd, end]);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (inner, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
const r = (text, attr = '') => `<w:r><w:rPr><w:b/></w:rPr><w:t${attr}>${text}</w:t></w:r>`;
const doc = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`;

describe('docx-extract.js', () => {
  test('paragraphs, split runs, tabs, entities, soft line breaks; page breaks and deletions ignored', async () => {
    const body = [
      p(r('ഉത്പത്തി 3'), 'Heading1'),
      p(r('1 ') + r('ആദിയിൽ ദൈവം', ' xml:space="preserve"') + '<w:r><w:tab/></w:r>' + r('ആകാശവും &amp; ഭൂമിയും &#x0D38;ൃഷ്ടിച്ചു.')),
      '<w:p/>',
      p(r('2 ഭൂമി ശൂന്യമായിരുന്നു.') + '<w:r><w:br/></w:r>' + r('3 ദൈവം അരുളിച്ചെയ്തു.') + '<w:r><w:br w:type="page"/></w:r>' + r(' തുടർച്ച.')),
      p(r('4 വെളിച്ചം ') + '<w:del w:id="1"><w:r><w:delText>മായ്ച്ചത് </w:delText></w:r></w:del>' + '<w:ins w:id="2">' + r('നല്ലത്') + '</w:ins>' + r(' എന്നു ദൈവം കണ്ടു.')),
      '<w:tbl><w:tr><w:tc>' + p(r('5 പട്ടികയിലെ വാക്യം.')) + '</w:tc></w:tr></w:tbl>',
    ].join('');
    const file = zip({
      '[Content_Types].xml': '<Types/>',
      'word/document.xml': doc(body),
      'docProps/core.xml': '<cp:coreProperties><dc:title>ഉത്പത്തി &amp; പുറപ്പാട്</dc:title></cp:coreProperties>',
    }, ['[Content_Types].xml']);
    const ex = plain(await D.extract(file));
    assert.equal(ex.title, 'ഉത്പത്തി & പുറപ്പാട്');
    assert.deepEqual(ex.pages, [[
      'ഉത്പത്തി 3',
      '1 ആദിയിൽ ദൈവം ആകാശവും & ഭൂമിയും സൃഷ്ടിച്ചു.',
      '2 ഭൂമി ശൂന്യമായിരുന്നു.',
      '3 ദൈവം അരുളിച്ചെയ്തു. തുടർച്ച.',
      '4 വെളിച്ചം നല്ലത് എന്നു ദൈവം കണ്ടു.',
      '5 പട്ടികയിലെ വാക്യം.',
    ]]);
  });

  test('a stored (uncompressed) document.xml works too', async () => {
    const ex = await D.extract(zip({ 'word/document.xml': doc(p(r('ഒന്ന്')) + p(r('രണ്ട്'))) }, ['word/document.xml']));
    assert.deepEqual(plain(ex.pages), [['ഒന്ന്', 'രണ്ട്']]);
  });

  test('old .doc, other files and zips without a Word document are refused with a code', async () => {
    const ole = new Uint8Array(64); ole.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await assert.rejects(D.extract(ole.buffer), (e) => e.code === 'docx/old-doc');
    await assert.rejects(D.extract(new TextEncoder().encode('%PDF-1.7 not a zip').buffer), (e) => e.code === 'docx/not-zip');
    await assert.rejects(D.extract(zip({ 'xl/workbook.xml': '<workbook/>' })), (e) => e.code === 'docx/not-word');
  });

  test('through the parser, as the upload dialog does: chapter header, verses, heading', async () => {
    const P = loadParser();
    const body = [
      p(r('ഉത്പത്തി 2')),
      p(r('സൃഷ്ടിയുടെ പൂർത്തീകരണം'), 'Heading2'),
      p(r('1 അങ്ങനെ ആകാശവും ഭൂമിയും അവയിലുള്ള സകലവും പൂർത്തിയായി.')),
      p(r('2 താൻ ചെയ്ത പ്രവൃത്തി ദൈവം ഏഴാം ദിവസം പൂർത്തിയാക്കി.') + '<w:r><w:br/></w:r>' + r('3 ദൈവം ഏഴാം ദിവസത്തെ അനുഗ്രഹിച്ചു.')),
    ].join('');
    const ex = await D.extract(zip({ 'word/document.xml': doc(body) }));
    const res = plain(P.parsePdfParagraphs(ex.pages, { bookNames: ['ഉത്പത്തി'], wholeWords: true }));
    assert.equal(res.chapters.length, 1);
    const ch = res.chapters[0];
    assert.equal(ch.chapter, 2);
    assert.deepEqual(ch.items.filter((x) => x.v).map((x) => x.v), [1, 2, 3]);
    assert.ok(ch.items.some((x) => x.h === 'സൃഷ്ടിയുടെ പൂർത്തീകരണം'), JSON.stringify(ch.items));
    assert.match(ch.items.find((x) => x.v === 3).t, /അനുഗ്രഹിച്ചു/);
  });
});
