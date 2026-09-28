// app/js/parser.js (window.BibleParser), loaded like the browser does: a classic script, fake window.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import path from 'node:path';
import { readApp, APP } from './lib/env.mjs';

function loadParser() {
  const ctx = {};
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(readApp('parser.js'), ctx, { filename: 'parser.js' });
  return ctx.BibleParser;
}
const P = loadParser();
// results come from another realm: compare as plain JSON
const plain = (x) => JSON.parse(JSON.stringify(x));

describe('parser.js: loading', () => {
  test('sets window.BibleParser with the public API', () => {
    for (const fn of ['normalize', 'searchKey', 'parsePdfParagraphs', 'parseEditorText', 'toEditorText', 'validate', 'verseMap', 'chapterFromFilename', 'compressRanges', 'addToLexicon', 'shouldGlue']) {
      assert.equal(typeof P[fn], 'function', fn);
    }
  });
  test('CommonJS export for tools/build-data.js', () => {
    const require = createRequire(import.meta.url);
    const C = require(path.join(APP, 'parser.js'));
    assert.equal(typeof C.parseEditorText, 'function');
  });
});

describe('parser.js: normalize / searchKey', () => {
  test('removes invisible characters, fixes chillu, superscripts, bullets, spaces', () => {
    const s = ' a​ b­  c¹² ** d ● e • f ന്‍ ക ാ ';
    assert.equal(P.normalize(s), 'a b c12 d e f ൻ കാ');
  });
  test('all chillu forms written with virama + ZWJ', () => {
    assert.equal(P.normalize('ണ്‍ ന്‍ ര്‍ ല്‍ ള്‍ ക്‍'), 'ൺ ൻ ർ ൽ ൾ ൿ');
  });
  test('NFC and null-safe', () => {
    assert.equal(P.normalize('é'), 'é');
    assert.equal(P.normalize(null), '');
    assert.equal(P.normalize(undefined), '');
  });
  test('searchKey drops joiners, unifies the AU length mark, lower-cases', () => {
    assert.equal(P.searchKey('ക‌ൌ‍ABC'), 'കൗabc');
  });
});

describe('parser.js: editor format', () => {
  const text = '## സൃഷ്ടി\n[1] ആദിയിൽ ദൈവം [2] ഭൂമി പാഴായിരുന്നു\r\nതുടർച്ച [3] വെളിച്ചം\n\n#\n[3] വീണ്ടും';
  const items = [
    { h: 'സൃഷ്ടി' },
    { v: 1, t: 'ആദിയിൽ ദൈവം', p: 1 },
    { v: 2, t: 'ഭൂമി പാഴായിരുന്നു' },
    { v: 2, t: 'തുടർച്ച', p: 1 },
    { v: 3, t: 'വെളിച്ചം' },
    { v: 3, t: 'വീണ്ടും', p: 1 },
  ];
  test('parseEditorText: headings, verse markers, one paragraph per line', () => {
    assert.deepEqual(plain(P.parseEditorText(text)), items);
  });
  test('text before the first marker belongs to verse 1', () => {
    assert.deepEqual(plain(P.parseEditorText('ആമുഖം [2] രണ്ട്')), [{ v: 1, t: 'ആമുഖം', p: 1 }, { v: 2, t: 'രണ്ട്' }]);
  });
  test('a repeated marker in the same line continues the verse', () => {
    assert.deepEqual(plain(P.parseEditorText('[1] a [1] b')), [{ v: 1, t: 'a b', p: 1 }]);
  });
  test('toEditorText writes the format back; the round trip is stable', () => {
    const out = P.toEditorText(items);
    assert.equal(out, '## സൃഷ്ടി\n[1] ആദിയിൽ ദൈവം [2] ഭൂമി പാഴായിരുന്നു\nതുടർച്ച [3] വെളിച്ചം\nവീണ്ടും');
    assert.deepEqual(plain(P.parseEditorText(out)), items);
    assert.equal(P.toEditorText(P.parseEditorText(out)), out);
  });
  test('empty input', () => {
    assert.deepEqual(plain(P.parseEditorText('')), []);
    assert.equal(P.toEditorText([]), '');
  });
});

describe('parser.js: verseMap / validate / compressRanges', () => {
  test('verseMap joins the parts of a verse and skips headings', () => {
    const m = P.verseMap([{ h: 'H' }, { v: 1, t: 'a', p: 1 }, { v: 2, t: 'b' }, { v: 2, t: 'c', p: 1 }]);
    assert.deepEqual(plain([...m.entries()]), [[1, 'a'], [2, 'b c']]);
  });
  test('compressRanges', () => {
    assert.equal(P.compressRanges([1, 2, 3, 5, 7, 8]), '1–3, 5, 7–8');
    assert.equal(P.compressRanges([4]), '4');
    assert.equal(P.compressRanges([]), '');
  });
  test('validate: complete, missing numbers, no verses', () => {
    assert.deepEqual(plain(P.validate([{ v: 1, t: 'a' }, { v: 2, t: 'b' }])), []);
    assert.deepEqual(plain(P.validate([{ v: 1, t: 'a' }, { v: 4, t: 'b' }, { v: 6, t: 'c' }])), ['വാക്യ നമ്പർ ഇല്ല (missing): 2–3, 5']);
    assert.deepEqual(plain(P.validate([{ h: 'only a heading' }])), ['വാക്യങ്ങൾ കണ്ടെത്തിയില്ല (no verses found)']);
  });
});

describe('parser.js: chapterFromFilename', () => {
  for (const [name, want] of [
    ['അധ്യായം 12.pdf', 12], ['Genesis_12.pdf', 12], ['ch 3 part 2.PDF', 2], ['notes.pdf', null], ['1234.pdf', 234],
  ]) test(`${name} → ${want}`, () => assert.equal(P.chapterFromFilename(name), want));
});

describe('parser.js: lexicon / shouldGlue', () => {
  test('addToLexicon counts Malayalam words only', () => {
    const lex = P.addToLexicon(new Map(), 'ദൈവം ദൈവം, abc 12 ഭൂമി3 "വെളിച്ചം"');
    assert.deepEqual([...lex.entries()], [['ദൈവം', 2], ['വെളിച്ചം', 1]]);
  });
  test('glue when the next part starts with a vowel sign or a doubled consonant', () => {
    assert.equal(P.shouldGlue('ദൈവ', 'ായ', null), true);
    assert.equal(P.shouldGlue('കൊടു', 'ക്കും', null), true);
    assert.equal(P.shouldGlue('ദൈവം', 'ഭൂമി', null), false, 'no lexicon: keep the space');
    assert.equal(P.shouldGlue('abc', 'def', new Map()), false);
  });
  test('lexicon: a known joined word, or two one-off fragments', () => {
    const lex = new Map([['ആകാശവും', 5], ['ആകാ', 1], ['ശവും', 1], ['ദൈവം', 40], ['ഭൂമി', 30]]);
    assert.equal(P.shouldGlue('ആകാ', 'ശവും', lex), true);
    assert.equal(P.shouldGlue('ദൈവം', 'ഭൂമി', lex), false);
    assert.equal(P.shouldGlue('പർ', 'വത', new Map()), true);
  });
});

describe('parser.js: parsePdfParagraphs', () => {
  test('book title, chapter header, heading, verses, page-number footer', () => {
    const r = plain(P.parsePdfParagraphs([[
      'ഉല്പത്തി പുസ്തകം',
      'അധ്യായം 1',
      'സൃഷ്ടി',
      '1 ആദിയിൽ ദൈവം ആകാശവും ഭൂമിയും സൃഷ്ടിച്ചു. 2 ഭൂമി പാഴായും ശൂന്യമായും ഇരുന്നു; ആഴത്തിന്മീതെ ഇരുൾ ഉണ്ടായിരുന്നു. 3 ദൈവം: വെളിച്ചം ഉണ്ടാകട്ടെ എന്നു കല്പിച്ചു; വെളിച്ചം ഉണ്ടായി.',
      '4 വെളിച്ചം നല്ലതു എന്നു ദൈവം കണ്ടു.',
      '7',
    ]]));
    assert.equal(r.bookTitle, 'ഉല്പത്തി');
    assert.equal(r.chapters.length, 1);
    const c = r.chapters[0];
    assert.equal(c.chapter, 1);
    assert.deepEqual(c.warnings, []);
    assert.deepEqual(c.items, [
      { h: 'സൃഷ്ടി' },
      { v: 1, t: 'ആദിയിൽ ദൈവം ആകാശവും ഭൂമിയും സൃഷ്ടിച്ചു.', p: 1 },
      { v: 2, t: 'ഭൂമി പാഴായും ശൂന്യമായും ഇരുന്നു; ആഴത്തിന്മീതെ ഇരുൾ ഉണ്ടായിരുന്നു.' },
      { v: 3, t: 'ദൈവം: വെളിച്ചം ഉണ്ടാകട്ടെ എന്നു കല്പിച്ചു; വെളിച്ചം ഉണ്ടായി.' },
      { v: 4, t: 'വെളിച്ചം നല്ലതു എന്നു ദൈവം കണ്ടു.', p: 1 },
    ]);
  });
  test('a stray number that breaks the sequence stays in the text; chapter from the hint', () => {
    const r = plain(P.parsePdfParagraphs([[
      '1 ആദിയിൽ ദൈവം ആകാശവും ഭൂമിയും സൃഷ്ടിച്ചു. 2 ഭൂമി പാഴായും ശൂന്യമായും ഇരുന്നു. 40 ദൈവം കണ്ടു 3 വെളിച്ചം ഉണ്ടായി. 4 നല്ലതു. 5 പകൽ എന്നു പേരിട്ടു.',
    ]], { chapter: 7 }));
    const c = r.chapters[0];
    assert.equal(c.chapter, 7);
    assert.deepEqual(c.items.map((x) => x.v), [1, 2, 3, 4, 5]);
    assert.match(c.items[1].t, /40 ദൈവം കണ്ടു$/);
  });
  test('several chapters; missing verse numbers are reported', () => {
    const r = plain(P.parsePdfParagraphs([[
      'അധ്യായം 1', '1 ഒന്ന് എന്നു. 2 രണ്ട് എന്നു.',
      'അധ്യായം 2', '1 മൂന്ന് എന്നു. 3 നാല് എന്നു.',
    ]]));
    assert.deepEqual(r.chapters.map((c) => c.chapter), [1, 2]);
    assert.deepEqual(r.chapters.map((c) => c.items.length), [2, 2]);
    assert.deepEqual(r.chapters[1].warnings, ['വാക്യ നമ്പർ ഇല്ല (missing): 2']);
  });
  test('paragraph objects ({ text }) and empty pages are accepted', () => {
    const r = plain(P.parsePdfParagraphs([[], [{ text: '1 ഒന്ന് എന്നു.' }, { text: '   ' }]], { chapter: 3 }));
    assert.deepEqual(r.chapters, [{ chapter: 3, items: [{ v: 1, t: 'ഒന്ന് എന്നു.', p: 1 }], warnings: [] }]);
  });
  test('nothing usable → no chapters', () => {
    assert.deepEqual(plain(P.parsePdfParagraphs([['...', '---']])), { bookTitle: null, chapters: [] });
  });
});
