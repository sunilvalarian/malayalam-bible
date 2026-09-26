/*
 * Bible text parser — shared by the browser app and tools/build-data.js.
 *
 * Chapter data model (array of items):
 *   { h: "section heading" }
 *   { v: 5, t: "verse text", p: 1 }   p = starts a new paragraph
 * A verse that spans paragraphs is stored as several items with the same v.
 *
 * Two inputs are supported:
 *   parsePdfParagraphs(pages, opts)  – heuristic, for text coming out of a PDF
 *   parseEditorText(text)            – strict, for the in-app editor format:
 *        ## heading
 *        [1] verse one text [2] verse two …
 *        (each line is a paragraph)
 */
(function (root) {
  'use strict';

  const ML = 'ഀ-ൿ';
  const SUPERSCRIPT = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
  const CHILLU = { 'ണ': 'ൺ', 'ന': 'ൻ', 'ര': 'ർ', 'ല': 'ൽ', 'ള': 'ൾ', 'ക': 'ൿ' };
  const TERMINAL = /[.!?:;।”"'’)\]]$/;

  function normalize(s) {
    return String(s || '')
      .normalize('NFC')
      .replace(/[​﻿­]/g, '')
      .replace(/([ണനരലളക])്‍/g, (m, c) => CHILLU[c])
      .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => SUPERSCRIPT[c])
      .replace(/\*\*|●|•/g, ' ')
      .replace(/\s+(?=[ംഃാ-്ൗൢൣ])/g, '') // stray space before a vowel sign / virama
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Key used for searching: drop joiners, unify the two AU-length-mark forms.
  function searchKey(s) {
    return s.replace(/[‌‍]/g, '').replace(/ൌ/g, 'ൗ').toLowerCase();
  }

  const CHAPTER_WORDS = ['അധ്യായം', 'അദ്ധ്യായം', 'അധ്യായം', 'അദ്ധ്യായം', 'chapter', 'ch'];

  function chapterHeader(p, bookNames) {
    const words = CHAPTER_WORDS.concat(bookNames || []).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp('^[.\\s|]*(?:' + words.join('|') + ')\\s*(\\d{1,3})(?![\\d])\\s*[.:|\\-–]*\\s*(.*)$', 'i');
    const m = p.match(re);
    if (!m) return null;
    // "ഉത്പത്തി 1 ആദിയിൽ ദൈവം…" would be a verse, not a header: rest must look like a heading
    const rest = m[2].trim();
    if (rest && !isHeadingLike(rest)) return null;
    return { chapter: +m[1], rest };
  }

  function isHeadingLike(p) {
    if (!p || p.length > 60) return false;
    if (/\d/.test(p)) return false;
    if (TERMINAL.test(p) || /[,;:]/.test(p)) return false;
    return p.split(/\s+/).length <= 7;
  }

  // Find verse-number candidates in a paragraph.
  // Matches "5", "5.", "5:", "5 -", "5)" when not glued to a preceding digit.
  function candidates(p) {
    const out = [];
    const re = new RegExp('(^|[^\\d])(\\d{1,3})(?!\\d)(\\s*[.:)\\-–]\\s*|\\s+|(?=[' + ML + '"“‘\'(]))', 'g');
    let m;
    while ((m = re.exec(p))) {
      const start = m.index + m[1].length;
      out.push({ n: +m[2], start, end: m.index + m[0].length, before: p.slice(0, start) });
      re.lastIndex = m.index + m[0].length;
    }
    return out;
  }

  const MAX_GAP = 40;

  // ---------- word list, used to repair words split by hard line breaks ----------

  const TOKEN_SPLIT = /[\s.,;:!?"“”‘’'()[\]\-–—|]+/;

  function addToLexicon(lex, text) {
    for (const w of String(text).split(TOKEN_SPLIT)) {
      if (w && /[ഀ-ൿ]/.test(w) && !/\d/.test(w)) lex.set(w, (lex.get(w) || 0) + 1);
    }
    return lex;
  }

  const DEPENDENT = /^[ംഃാ-്ൗൢൣ]/;
  const NASAL = 'ങഞണനമ';

  // Should the last word of one line and the first word of the next be glued?
  function shouldGlue(a, b, lex) {
    if (!a || !b || !/[ഀ-ൿ]$/.test(a) || !/^[ഀ-ൿ]/.test(b)) return false;
    if (DEPENDENT.test(b)) return true;
    // Malayalam words don't start with a doubled consonant (ക്ക, ത്ത) or a nasal cluster (ന്റ, ന്ത, മ്പ)
    const cl = b.match(/^([ക-ഹ])്([ക-ഹ])/);
    if (cl && (cl[1] === cl[2] || (NASAL.includes(cl[1]) && !'യരലവ'.includes(cl[2])))) return true;
    if (!lex) return false;
    const ca = lex.get(a) || 0, cb = lex.get(b) || 0, cj = lex.get(a + b) || 0;
    // the joined word is known and the halves are not much more common than it
    if (cj > 0 && Math.min(ca, cb) <= Math.max(2, cj * 3)) return true;
    // both halves are one-off fragments ("പർ" + "വത്യശൃംഗങ്ങൾ")
    if (ca <= 1 && cb <= 1) return true;
    return false;
  }

  function joinLines(a, b, lex) {
    const la = a.split(TOKEN_SPLIT).filter(Boolean).pop();
    const fb = b.split(TOKEN_SPLIT).filter(Boolean)[0];
    const endsInWord = /[ഀ-ൿ]$/.test(a) && /^[ഀ-ൿ]/.test(b);
    return endsInWord && shouldGlue(la, fb, lex) ? a + b : a + ' ' + b;
  }

  const startsWithVerseNo = (p) => /^\d{1,3}(?!\d)/.test(p);

  // Merge PDF paragraphs of one chapter into logical paragraphs + headings.
  function assembleParagraphs(paras, lex) {
    const lengths = paras.map((p) => p.length).sort((a, b) => a - b);
    const wrapped = lengths.length > 4 && lengths[lengths.length >> 1] < 80; // typed with hard line breaks
    const out = [];
    const isHeadingAt = (i) => {
      const p = paras[i];
      if (!isHeadingLike(p)) return false;
      const words = p.split(/\s+/).length;
      const prev = i > 0 ? paras[i - 1] : null;
      const next = paras[i + 1];
      if (next === undefined) return false;
      if (prev === null) return true;
      const prevEnds = /[.!?”"’]$/.test(prev);
      if (!prevEnds && !(!wrapped && words <= 5 && startsWithVerseNo(next))) return false;
      if (startsWithVerseNo(next)) return true;
      if (words <= 3 && next.length >= 80) return true;
      return !wrapped && (next.length >= 80 || !isHeadingLike(next));
    };
    const heads = paras.map((_, i) => isHeadingAt(i));
    paras.forEach((p, i) => {
      if (heads[i]) { out.push({ h: p }); return; }
      const last = out[out.length - 1];
      // hard-wrapped text: keep joining lines until a sentence end is followed by a verse number
      if (wrapped && last && !last.h && !(TERMINAL.test(last.text) && startsWithVerseNo(p))) {
        last.text = joinLines(last.text, p, lex);
        return;
      }
      out.push({ text: p });
    });
    return out;
  }

  /**
   * pages: [[paragraph | {text}, ...], ...]  (from PdfExtract)
   * opts:  { chapter?: number (hint from filename), bookNames?: [..], lexicon?: Map }
   * returns { chapters: [{ chapter, items, warnings }], bookTitle }
   */
  function parsePdfParagraphs(pages, opts) {
    opts = opts || {};
    // 1. normalise + clean
    const paras = [];
    let bookTitle = null;
    pages.forEach((page, pi) => {
      const list = page.map((p) => normalize(typeof p === 'string' ? p : p.text)).filter(Boolean);
      list.forEach((p, i) => {
        if (/^tab\s*\d+$/i.test(p)) return;
        if (!/[ഀ-ൿ\dA-Za-z]/.test(p)) return;                 // punctuation only
        if (/^\d{1,3}$/.test(p) && i === list.length - 1) return;       // page number footer
        const bt = p.match(/^(.+?)\s*പുസ്തകം\s*\|?$/);
        if (bt) { bookTitle = bt[1].trim(); return; }
        paras.push({ text: p, pageStart: i === 0 && pi > 0 });
      });
    });

    const bookNames = (opts.bookNames || []).concat(bookTitle ? [bookTitle] : []);
    const lex = opts.lexicon || new Map();
    if (!opts.lexicon) paras.forEach((p) => addToLexicon(lex, p.text));

    // 2. split into chapters on header paragraphs
    const chapters = [];
    let cur = null;
    const start = (n) => { cur = { chapter: n, paras: [] }; chapters.push(cur); };
    for (const para of paras) {
      const hd = chapterHeader(para.text, bookNames);
      if (hd) {
        if (cur && !cur.paras.length && cur.chapter == null) cur.chapter = hd.chapter;
        else if (!cur || cur.chapter !== hd.chapter) start(hd.chapter);
        if (hd.rest) cur.paras.push(hd.rest);
        continue;
      }
      if (!cur) start(null);
      // page-break joins for normal (non-wrapped) documents
      if (para.pageStart && cur.paras.length) {
        const prev = cur.paras[cur.paras.length - 1];
        if (!TERMINAL.test(prev) && !isHeadingLike(prev) && prev.length >= 80) {
          cur.paras[cur.paras.length - 1] = joinLines(prev, para.text, lex);
          continue;
        }
      }
      cur.paras.push(para.text);
    }
    if (chapters.length && chapters[0].chapter == null) chapters[0].chapter = opts.chapter || null;

    return {
      bookTitle,
      chapters: chapters.filter((c) => c.paras.length).map((c) => {
        const items = versify(assembleParagraphs(c.paras, lex), c.chapter);
        return { chapter: c.chapter, items, warnings: validate(items) };
      }),
    };
  }

  function versify(blocks, chapterNo) {
    const items = [];
    let last = 0;
    const push = (v, t, p) => {
      t = t.trim();
      if (!t) return;
      if (!p && items.length && items[items.length - 1].v === v) { items[items.length - 1].t += ' ' + t; return; }
      items.push(p ? { v, t, p: 1 } : { v, t });
    };

    // Collect every number candidate in the chapter, then keep the increasing
    // sequence that explains the most verses (so a stray/typo number like the
    // "40" in "5 … 40 … 7 8 9" is dropped instead of swallowing 7, 8, 9 …).
    const all = [];
    blocks.forEach((b, bi) => {
      if (b.h !== undefined) return;
      candidates(b.text).forEach((c) => {
        const bf = c.before.trimEnd();
        c.block = bi;
        c.gapOk = !bf || TERMINAL.test(bf) || /[-–—,]$/.test(bf);
        all.push(c);
      });
    });
    // chapter-number prefix at chapter start: "11 1 ഭൂമി…" (drop it) / drop-cap "13 അബ്രാം…" (= verse 1)
    if (all.length && chapterNo > 1 && all[0].n === chapterNo && !all[0].before.trim()) {
      const nx = all[1];
      if (nx && nx.n === 1 && nx.block === all[0].block && nx.start - all[0].end <= 1) all.shift();
      else all[0].n = 1;
    }
    const score = new Array(all.length).fill(-Infinity);
    const prevIdx = new Array(all.length).fill(-1);
    for (let i = 0; i < all.length; i++) {
      const c = all[i];
      if (c.n === 1 || (c.n <= MAX_GAP && c.gapOk)) score[i] = 1 - (c.n - 1) * 0.01;
      for (let j = 0; j < i; j++) {
        if (score[j] === -Infinity) continue;
        const gap = c.n - all[j].n;
        if (gap < 1 || gap > MAX_GAP || (gap > 3 && !c.gapOk)) continue;
        const s = score[j] + 1 - (gap - 1) * 0.01;
        if (s > score[i]) { score[i] = s; prevIdx[i] = j; }
      }
    }
    const chosen = new Set();
    let bestI = -1;
    for (let i = 0; i < all.length; i++) if (bestI < 0 || score[i] > score[bestI]) bestI = i;
    for (let i = score[bestI] > -Infinity ? bestI : -1; i >= 0; i = prevIdx[i]) chosen.add(all[i]);
    const acceptedByBlock = blocks.map(() => []);
    all.forEach((c) => { if (chosen.has(c)) acceptedByBlock[c.block].push(c); });

    blocks.forEach((b, bi) => {
      if (b.h !== undefined) { items.push({ h: b.h }); return; }
      const p = b.text;
      const accepted = acceptedByBlock[bi];

      if (!accepted.length) {
        push(last || 1, p, true);
        if (!last) last = 1;
        return;
      }

      // text before the first marker
      const lead = p.slice(0, accepted[0].start).trim();
      let firstPara = true;
      if (lead) {
        if (last === 0 && isHeadingLike(lead)) items.push({ h: lead });
        else { push(last || 1, lead, true); firstPara = false; if (!last) last = 1; }
      }
      accepted.forEach((c, i) => {
        const end = i + 1 < accepted.length ? accepted[i + 1].start : p.length;
        let text = p.slice(c.end, end).trim();
        if (c.n === last) { // implicit verse 1 followed by explicit "1"
          push(c.n, text, false);
        } else {
          push(c.n, text, firstPara && i === 0);
        }
        last = c.n;
      });
    });
    return items;
  }

  function validate(items) {
    const nums = [...new Set(items.filter((x) => x.v).map((x) => x.v))];
    const warnings = [];
    if (!nums.length) { warnings.push('വാക്യങ്ങൾ കണ്ടെത്തിയില്ല (no verses found)'); return warnings; }
    const max = Math.max(...nums);
    const missing = [];
    for (let i = 1; i <= max; i++) if (!nums.includes(i)) missing.push(i);
    if (missing.length) warnings.push('വാക്യ നമ്പർ ഇല്ല (missing): ' + compressRanges(missing));
    return warnings;
  }

  function compressRanges(nums) {
    const out = [];
    for (let i = 0; i < nums.length; i++) {
      let j = i;
      while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
      out.push(i === j ? '' + nums[i] : nums[i] + '–' + nums[j]);
      i = j;
    }
    return out.join(', ');
  }

  // ---------- editor format ----------

  function toEditorText(items) {
    const lines = [];
    let line = null;
    let prevV = null;
    const flush = () => { if (line !== null) lines.push(line); line = null; };
    for (const it of items) {
      if (it.h !== undefined) { flush(); lines.push('## ' + it.h); prevV = null; continue; }
      const mark = it.v !== prevV ? '[' + it.v + '] ' : '';
      if (it.p || line === null) { flush(); line = mark + it.t; }
      else line += ' ' + mark + it.t;
      prevV = it.v;
    }
    flush();
    return lines.join('\n');
  }

  function parseEditorText(text) {
    const items = [];
    let last = 0;
    String(text).split(/\r?\n/).forEach((raw) => {
      const line = normalize(raw);
      if (!line) return;
      const hm = line.match(/^#+\s*(.*)$/);
      if (hm) { if (hm[1]) items.push({ h: hm[1] }); return; }
      const re = /\[(\d{1,3})\]/g;
      let m, pos = 0, first = true, cv = last || 1;
      const add = (v, t) => {
        t = t.trim();
        if (!t) return;
        if (!first && items.length && items[items.length - 1].v === v) items[items.length - 1].t += ' ' + t;
        else items.push(first ? { v, t, p: 1 } : { v, t });
        first = false;
      };
      while ((m = re.exec(line))) {
        add(cv, line.slice(pos, m.index));
        cv = +m[1];
        pos = m.index + m[0].length;
      }
      add(cv, line.slice(pos));
      last = cv;
    });
    return items;
  }

  // Group items by verse → Map(v → text)
  function verseMap(items) {
    const map = new Map();
    for (const it of items) if (it.v) map.set(it.v, map.has(it.v) ? map.get(it.v) + ' ' + it.t : it.t);
    return map;
  }

  // Guess chapter number from a file name like "അധ്യായം 12.pdf" / "Genesis_12.pdf"
  function chapterFromFilename(name) {
    const m = String(name).normalize('NFC').replace(/\.pdf$/i, '').match(/(\d{1,3})(?!.*\d)/);
    return m ? +m[1] : null;
  }

  const api = {
    normalize, searchKey, parsePdfParagraphs, parseEditorText, toEditorText,
    validate, verseMap, chapterFromFilename, compressRanges, addToLexicon, shouldGlue,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BibleParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
