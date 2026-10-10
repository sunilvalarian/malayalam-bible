/* Malayalam Bible reader — app logic (no build step, works from file://). */
(function () {
  'use strict';

  const P = window.BibleParser;
  const CAT = window.BOOK_CATALOG || [];
  const catById = new Map(CAT.map((b) => [b.id, b]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  // ---------- storage ----------
  const LS = {
    get(k, d) {
      try { const v = localStorage.getItem('mlb.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem('mlb.' + k, JSON.stringify(v)); return true; } catch (e) {
        toast('സൂക്ഷിക്കാൻ കഴിഞ്ഞില്ല: ബ്രൗസർ സ്റ്റോറേജ് നിറഞ്ഞിരിക്കാം. data.js / ബാക്കപ്പ് എക്സ്പോർട്ട് ചെയ്യുക.', 6000);
        return false;
      }
    },
  };

  const base = window.BIBLE_DATA || { books: [] };
  // Cloud mode (Firebase configured, served over http/https): login + roles, shared edits.
  // Local mode (no config, or opened from disk): edits stay in this browser. Editing and the data
  // tools need the local-owner passcode, which is offered only from disk / localhost; on a public
  // web address without Firebase everyone is read-only.
  const Cloud = window.Cloud || { available: false };
  const LocalOwner = window.LocalOwner || { allowed: false, isSet: () => false, isUnlocked: () => false, lock() {}, on() {} };
  const AuthUI = window.AuthUI || null;
  // usage log for the administrator portal (js/usage.js; recorded offline too)
  const Usage = window.Usage || { track() {}, view() {}, enabled: false };
  const cloudMode = !!Cloud.available;
  let cloudStatus = cloudMode ? 'connecting' : 'local';   // connecting | ready | offline | local
  let cloudDocs = new Set();                              // chapter override docs that exist in Firestore
  let overlay = cloudMode ? LS.get('cloudOverlay', { books: {} }) : LS.get('overlay', { books: {} });
  const can = (perm) => (cloudMode ? Cloud.can(perm) : LocalOwner.isUnlocked());
  const user = Object.assign({ hl: {}, bm: {}, notes: {} }, LS.get('user', {}));
  const settings = Object.assign({
    fontSize: 20, lineHeight: 1.9, font: 'noto-serif', theme: 'light', layout: 'verse',
    numbers: true, headings: true, last: null, recent: [], history: [], whole: false, scope: 'all',
  }, LS.get('settings', {}));
  // one verse per line is now the default — switch readers who still have the old saved default
  if (!settings.layoutV) { settings.layout = 'verse'; settings.layoutV = 2; LS.set('settings', settings); }
  // free plan: several highlights / bookmarks in a row go up as one write (and at once when hidden)
  const pushUserData = debounce(() => flushUserData(), 3000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushUserData(); });
  // a highlight / note made in the last 3 seconds goes up before signing out (afterwards it would be lost)
  if (cloudMode) Cloud.beforeSignOut(() => flushUserData());
  const saveUser = () => { const ok = LS.set('user', user); pushUserData(); return ok; };
  const saveSettings = () => LS.set('settings', settings);

  // ---------- library ----------
  let books = [];            // [{id, name, chapters: Map<n, items>, nums: [n..], base: Set, changed: Set}]
  let bookMap = new Map();
  let index = null;          // search index, built lazily
  let lexicon = null;        // word list for PDF line-break repair, built lazily

  function baseChapter(id, n) {
    const b = base.books.find((x) => x.id === id);
    return b && b.chapters[n] ? b.chapters[n] : null;
  }

  function buildLibrary() {
    const map = new Map();
    for (const b of base.books) {
      map.set(b.id, {
        id: b.id, name: b.name,
        chapters: new Map(Object.entries(b.chapters).map(([k, v]) => [+k, v])),
        base: new Set(Object.keys(b.chapters).map(Number)), changed: new Set(),
      });
    }
    for (const [id, ob] of Object.entries(overlay.books || {})) {
      let b = map.get(id);
      if (!b) {
        b = { id, name: ob.name || (catById.get(id) || {}).name || id, chapters: new Map(), base: new Set(), changed: new Set() };
        map.set(id, b);
      }
      if (ob.name) b.name = ob.name;
      for (const [k, items] of Object.entries(ob.chapters || {})) {
        const n = +k;
        if (items === null) b.chapters.delete(n); else b.chapters.set(n, items);
        b.changed.add(n);
      }
    }
    const order = (b) => (catById.has(b.id) ? catById.get(b.id).order : 1000);
    books = [...map.values()].filter((b) => b.chapters.size)
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
    books.forEach((b) => { b.nums = [...b.chapters.keys()].sort((x, y) => x - y); });
    bookMap = new Map(books.map((b) => [b.id, b]));
    index = null;
    lexicon = null;
    updateStats();
  }

  function saveOverlay() { return LS.set(cloudMode ? 'cloudOverlay' : 'overlay', overlay); }

  // Save the given chapters: to this browser (local mode) or to Firestore (cloud mode).
  // keys = [[bookId, chapter], ...]; action is recorded in the activity log.
  function persist(keys, action) {
    if (!cloudMode) return saveOverlay();
    if (cloudStatus !== 'ready') { toast('ബന്ധിപ്പിക്കാനായില്ല — മാറ്റങ്ങൾ സേവ് ചെയ്യാൻ ഒരിക്കൽ ഇന്റർനെറ്റോടെ ആപ്പ് തുറക്കുക', 4000); return false; }
    // offline: Firestore keeps the writes and sends them when the connection is back
    const offline = !Cloud.online;
    if (offline) toast('ഓഫ്‌ലൈൻ — ഇന്റർനെറ്റ് കിട്ടുമ്പോൾ മാറ്റങ്ങൾ സിങ്ക് ചെയ്യും', 4000);
    saveOverlay();
    for (const [id, n] of keys) {
      const ob = overlay.books[id];
      const val = ob && ob.chapters ? ob.chapters[n] : undefined;
      const docId = `${id}_${n}`;
      let p;
      if (val === undefined) {
        if (!cloudDocs.has(docId)) continue;   // nothing stored online for this chapter
        // an edit that brings a bundled chapter back to its original text, by someone who may edit
        // (opened to everyone) but not "restore original" (remove the override): store the text itself
        if (!can('restore') && baseChapter(id, n)) p = Cloud.saveChapter(id, n, baseChapter(id, n), ob && ob.name, true);
        else p = Cloud.removeChapter(id, n);
      } else {
        p = Cloud.saveChapter(id, n, val, ob.name, !!baseChapter(id, n));
      }
      Usage.track(action, { b: id, c: n });
      // online: log once the server has taken it; offline: queue the log entry with it now, since
      // this page may be closed before the connection comes back
      if (offline) { Cloud.log(action, id, n); p.catch(cloudError); } else p.then(() => Cloud.log(action, id, n)).catch(cloudError);
    }
    return true;
  }

  function restoreChapter(id, n) {
    const ob = overlay.books[id];
    if (!ob) return;
    delete ob.chapters[n];
    if (!Object.keys(ob.chapters).length && !ob.name) delete overlay.books[id];
  }

  function overlayFromDocs(docs) {
    const o = { books: {} };
    for (const d of docs) {
      if (!d.book || !d.chapter) continue;
      const ob = (o.books[d.book] = o.books[d.book] || { chapters: {} });
      if (d.bookName) ob.name = d.bookName;
      ob.chapters[d.chapter] = d.deleted ? null : d.items;
    }
    return o;
  }

  function cloudError(err) {
    const code = (err && err.code) || '';
    console.warn('cloud:', code, err && err.message);
    if (/permission-denied/.test(code)) toast('അനുമതിയില്ല — ഈ മാറ്റം സേവ് ചെയ്തില്ല', 4000);
    else if (/unavailable|network/.test(code)) toast('നെറ്റ്‌വർക്ക് പ്രശ്നം — പിന്നീട് ശ്രമിക്കുക', 4000);
    else if (code) toast('പിശക്: ' + code, 4000);
  }

  function setChapter(id, n, items, name) {
    const ob = (overlay.books[id] = overlay.books[id] || { chapters: {} });
    if (name) ob.name = name;
    const orig = baseChapter(id, n);
    if (orig && JSON.stringify(orig) === JSON.stringify(items)) delete ob.chapters[n];
    else ob.chapters[n] = items;
    if (!Object.keys(ob.chapters).length && !ob.name) delete overlay.books[id];
  }

  function deleteChapter(id, n) {
    const ob = (overlay.books[id] = overlay.books[id] || { chapters: {} });
    if (baseChapter(id, n)) ob.chapters[n] = null; else delete ob.chapters[n];
    if (!Object.keys(ob.chapters).length && !ob.name) delete overlay.books[id];
  }

  function getIndex() {
    if (index) return index;
    index = [];
    for (const b of books) {
      for (const n of b.nums) {
        for (const [v, t] of P.verseMap(b.chapters.get(n))) index.push({ b: b.id, c: n, v, t, k: P.searchKey(t) });
      }
    }
    return index;
  }

  function getLexicon() {
    if (lexicon) return lexicon;
    lexicon = new Map();
    for (const e of getIndex()) P.addToLexicon(lexicon, e.t);
    return lexicon;
  }

  function updateStats() {
    let ch = 0, vs = 0;
    books.forEach((b) => { ch += b.nums.length; b.nums.forEach((n) => { vs += P.verseMap(b.chapters.get(n)).size; }); });
    const el = $('#libStats');
    if (el) el.textContent = `${books.length} പുസ്തകം · ${ch} അധ്യായം · ${vs} വാക്യം`;
  }

  // ---------- references ----------
  const bookName = (id) => (bookMap.get(id) || catById.get(id) || { name: id }).name;
  const vkey = (b, c, v) => `${b}.${c}.${v}`;
  const splitKey = (k) => { const [b, c, v] = k.split('.'); return { b, c: +c, v: +v }; };
  const squash = (s) => P.normalize(s).toLowerCase().replace(/[\s.]/g, '');

  function refText(b, c, verses) {
    const vs = [...verses].sort((x, y) => x - y);
    return `${bookName(b)} ${c}` + (vs.length ? ':' + P.compressRanges(vs).replace(/–/g, '-') : '');
  }

  function findBook(part, pool) {
    const q = squash(part);
    if (!q) return null;
    const cands = (pool || books).map((b) => {
      const cat = catById.get(b.id) || {};
      return { id: b.id, keys: [b.name, cat.name, cat.en, b.id, cat.short, ...(cat.aliases || [])].filter(Boolean).map(squash) };
    });
    for (const c of cands) if (c.keys.includes(q)) return c.id;
    if (q.length < 2) return null;
    for (const c of cands) if (c.keys.some((k) => k.startsWith(q))) return c.id;
    for (const c of cands) if (c.keys.some((k) => q.startsWith(k) && k.length >= 3)) return c.id;
    return null;
  }

  // "3", "3:15", "3 15", "3.15-18", "ഉത്പ 3:15", "gen 3", "അധ്യായം 3 വാക്യം 15"
  function parseRef(q) {
    let s = P.normalize(q).toLowerCase()
      .replace(/(അധ്യായം|അദ്ധ്യായം|chapter|ch\.?)(?=\s*\d)/g, ' ')
      .replace(/\s*(വാക്യം|വാ\.|verse|vs?\.?)\s*(?=\d)/g, ':')
      .trim();
    const m = s.match(/^(.*?)\s*(\d{1,3})(?:\s*[:.,\s]\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?)?\s*$/);
    if (!m) return null;
    const bookPart = m[1].replace(/[:.,\s]+$/, '').trim();
    let b = cur.book;
    if (bookPart) { b = findBook(bookPart); if (!b) return null; }
    if (!b) return null;
    return { b, c: +m[2], v: m[3] ? +m[3] : null, ve: m[4] ? +m[4] : null };
  }

  // ---------- state ----------
  const cur = { book: null, chapter: null };
  const selection = new Set();
  const reader = $('#reader');

  // ---------- rendering ----------
  function renderItems(items, ctx) {
    ctx = ctx || {};
    const lastSeg = new Map();
    items.forEach((it, i) => { if (it.v) lastSeg.set(it.v, i); });
    const seen = new Set();
    let html = '', open = false;
    const close = () => { if (open) { html += '</p>'; open = false; } };
    items.forEach((it, i) => {
      if (it.h !== undefined) { close(); html += `<h3 class="sec">${esc(it.h)}</h3>`; return; }
      if (it.p || !open) { close(); html += '<p>'; open = true; }
      const first = !seen.has(it.v);
      seen.add(it.v);
      let cls = 'v' + (first ? '' : ' cont');
      let marks = '';
      if (ctx.book) {
        const k = vkey(ctx.book, ctx.chapter, it.v);
        const hl = user.hl[k];
        if (hl) cls += ' hl-' + hl.c;
        if (lastSeg.get(it.v) === i) {
          if (user.bm[k]) marks += '<svg aria-label="ബുക്ക്മാർക്ക്"><use href="#i-bookmark"/></svg>';
          const nk = noteFor(ctx.book, ctx.chapter, it.v);
          if (nk) marks += `<svg class="note-ic" data-note="${esc(nk)}" aria-label="കുറിപ്പ്"><use href="#i-note"/></svg>`;
          if (marks) marks = `<span class="mark-icons">${marks}</span>`;
        }
      }
      html += `<span class="${cls}" data-v="${it.v}">${first ? `<sup class="vn">${it.v}</sup>` : ''}${esc(it.t)}${marks}</span> `;
    });
    close();
    return html;
  }

  function noteFor(b, c, v) {
    const direct = vkey(b, c, v);
    if (user.notes[direct]) return direct;
    for (const [k, n] of Object.entries(user.notes)) {
      const r = splitKey(k);
      if (r.b === b && r.c === c && (n.vs || []).includes(v)) return k;
    }
    return null;
  }

  const refOrder = (b, c) => books.findIndex((x) => x.id === b) * 1000 + c;

  function neighbours() {
    const bi = books.findIndex((b) => b.id === cur.book);
    if (bi < 0) return {};
    const b = books[bi];
    const ci = b.nums.indexOf(cur.chapter);
    const prev = ci > 0 ? { b: b.id, c: b.nums[ci - 1] } : bi > 0 ? { b: books[bi - 1].id, c: books[bi - 1].nums.slice(-1)[0] } : null;
    const next = ci < b.nums.length - 1 ? { b: b.id, c: b.nums[ci + 1] } : bi < books.length - 1 ? { b: books[bi + 1].id, c: books[bi + 1].nums[0] } : null;
    return { prev, next };
  }

  function render(opts) {
    opts = opts || {};
    clearSelection();
    const b = bookMap.get(cur.book);
    const items = b && b.chapters.get(cur.chapter);
    if (!items) {
      reader.innerHTML = `<div class="empty"><p>ഉള്ളടക്കം ഒന്നുമില്ല.</p>${can('upload') ? '<p><button class="btn primary" data-menu-open="upload">PDF / Word അപ്‌ലോഡ് ചെയ്യുക</button></p>' : ''}</div>`;
      $('#refLabel').textContent = 'പരിഷ്കരിച്ച മലയാളം ബൈബിൾ';
      $('#btnPrev').disabled = $('#btnNext').disabled = true;
      return;
    }
    const nb = neighbours();
    const badge = b.changed.has(cur.chapter) ? `<span class="ch-badge">${b.base.has(cur.chapter) ? 'തിരുത്തിയത്' : 'അപ്‌ലോഡ് ചെയ്തത്'}</span>` : '';
    const foot = `<div class="ch-foot">
      ${nb.prev ? `<button class="btn ghost" data-go="${nb.prev.b}/${nb.prev.c}"><svg><use href="#i-left"/></svg>${esc(bookName(nb.prev.b))} ${nb.prev.c}</button>` : '<span></span>'}
      ${nb.next ? `<button class="btn ghost" data-go="${nb.next.b}/${nb.next.c}">${esc(bookName(nb.next.b))} ${nb.next.c}<svg><use href="#i-right"/></svg></button>` : '<span></span>'}
    </div>`;
    reader.innerHTML = `<header class="ch-title"><small>${esc(b.name)}</small><span>അധ്യായം <b class="ch-num">${cur.chapter}</b></span>${badge}</header>` +
      renderItems(items, { book: cur.book, chapter: cur.chapter }) + foot;
    $('#refLabel').textContent = `${b.name} ${cur.chapter}`;
    document.title = `${b.name} ${cur.chapter} · പരിഷ്കരിച്ച മലയാളം ബൈബിൾ`;
    $('#btnPrev').disabled = !nb.prev;
    $('#btnNext').disabled = !nb.next;
    const h = `#/${cur.book}/${cur.chapter}` + (opts.verse ? '/' + opts.verse : '');
    if (location.hash !== h) history.replaceState(history.state, '', h);
    if (opts.dir && reader.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      reader.animate([{ opacity: 0, transform: `translateX(${opts.dir * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    }
    if (opts.keepScroll != null) window.scrollTo(0, opts.keepScroll);
    else if (opts.verse) scrollToVerse(opts.verse, opts.verseEnd, true);
    else window.scrollTo(0, 0);
  }

  function scrollToVerse(v, ve, flash) {
    const el = reader.querySelector(`.v[data-v="${v}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 90;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    if (flash) {
      const vs = [];
      for (let i = v; i <= (ve || v); i++) vs.push(i);
      const els = vs.flatMap((x) => $$(`.v[data-v="${x}"]`, reader));
      els.forEach((e) => e.classList.add('flash'));
      setTimeout(() => els.forEach((e) => e.classList.remove('flash')), 2200);
    }
  }

  function go(b, c, opts) {
    const book = bookMap.get(b);
    if (!book) return false;
    if (!book.chapters.has(c)) {
      toast(`${book.name} ${c} ലഭ്യമല്ല`);
      return false;
    }
    // called from inside a dialog that is closing: navigate once its history entry is gone
    if (historyBusy()) { hist.queue.push(() => go(b, c, opts)); return true; }
    const changed = cur.book !== b || cur.chapter !== c;
    const dir = cur.book ? Math.sign(refOrder(b, c) - refOrder(cur.book, cur.chapter)) : 0;
    cur.book = b; cur.chapter = c;
    if (changed || !opts || !opts.verse) render(Object.assign({ dir: changed ? dir : 0 }, opts));
    else {
      history.replaceState(history.state, '', `#/${b}/${c}/${opts.verse}`);
      scrollToVerse(opts.verse, opts.verseEnd, true);
    }
    settings.last = { b, c };
    Usage.view(b, c);
    if (changed) {
      settings.history = [{ b, c, t: Date.now() }, ...(settings.history || []).filter((h) => !(h.b === b && h.c === c))].slice(0, 60);
    }
    saveSettings();
    return true;
  }

  function goRef(r) {
    if (!r) return false;
    return go(r.b, r.c, r.v ? { verse: r.v, verseEnd: r.ve } : undefined);
  }

  // ---------- selection + actions ----------
  function clearSelection() {
    selection.clear();
    $$('.v.sel', reader).forEach((e) => e.classList.remove('sel'));
    $('#actionbar').hidden = true;
    document.body.classList.remove('selecting');
  }

  function updateSelection() {
    $$('.v', reader).forEach((e) => e.classList.toggle('sel', selection.has(+e.dataset.v)));
    const bar = $('#actionbar');
    if (!selection.size) { clearSelection(); return; }
    bar.hidden = false;
    document.body.classList.add('selecting');
    $('#selRef').textContent = refText(cur.book, cur.chapter, selection);
    const keys = [...selection].map((v) => vkey(cur.book, cur.chapter, v));
    const colors = new Set(keys.map((k) => (user.hl[k] || {}).c || ''));
    $$('.swatch', bar).forEach((s) => s.classList.toggle('active', colors.size === 1 && s.dataset.color && colors.has(s.dataset.color)));
    $('[data-act="bookmark"]', bar).classList.toggle('on', keys.every((k) => user.bm[k]));
    $('[data-act="note"]', bar).classList.toggle('on', [...selection].some((v) => noteFor(cur.book, cur.chapter, v)));
    $('[data-act="edit"]', bar).disabled = selection.size !== 1;
  }

  function selectedText() {
    const vm = P.verseMap(bookMap.get(cur.book).chapters.get(cur.chapter));
    const vs = [...selection].sort((a, b) => a - b);
    const body = vs.length === 1 ? vm.get(vs[0]) : vs.map((v) => `${v} ${vm.get(v)}`).join(' ');
    return `${body}\n— ${refText(cur.book, cur.chapter, vs)}`;
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  function rerenderKeep() { render({ keepScroll: window.scrollY }); }

  reader.addEventListener('click', (e) => {
    const goBtn = e.target.closest('[data-go]');
    if (goBtn) { const [b, c] = goBtn.dataset.go.split('/'); go(b, +c); return; }
    const up = e.target.closest('[data-menu-open]');
    if (up) { menuAction(up.dataset.menuOpen); return; }
    const noteIc = e.target.closest('.note-ic');
    if (noteIc) { openNote(noteIc.dataset.note); return; }
    const span = e.target.closest('.v');
    if (!span) { if (selection.size) clearSelection(); return; }
    if (String(window.getSelection && window.getSelection()).trim()) return; // user is selecting text
    const v = +span.dataset.v;
    if (selection.has(v)) selection.delete(v); else selection.add(v);
    updateSelection();
    if (selection.has(v)) keepAboveActionbar(span);
  });

  // make sure the tapped verse isn't hidden behind the bottom action bar
  function keepAboveActionbar(span) {
    requestAnimationFrame(() => {
      const bar = $('#actionbar');
      const rects = span.getClientRects();
      if (!rects.length || bar.hidden) return;
      const bottom = rects[rects.length - 1].bottom;
      const limit = window.innerHeight - bar.offsetHeight - 12;
      if (bottom > limit) window.scrollBy({ top: bottom - limit, behavior: 'smooth' });
    });
  }


  $('#btnSelClose').addEventListener('click', clearSelection);

  // the selected verses, for the usage log
  const selRef = (extra) => Object.assign({ b: cur.book, c: cur.chapter, v: [...selection].sort((a, b) => a - b).join(',') }, extra);

  $('#actionbar').addEventListener('click', async (e) => {
    const sw = e.target.closest('.swatch');
    if (sw) {
      const color = sw.dataset.color;
      for (const v of selection) {
        const k = vkey(cur.book, cur.chapter, v);
        if (color) user.hl[k] = { c: color, t: Date.now() }; else delete user.hl[k];
      }
      Usage.track(color ? 'highlight' : 'unhighlight', selRef(color ? { col: color } : null));
      saveUser();
      rerenderKeep();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === 'copy' || act === 'share') Usage.track(act, selRef());
    if (act === 'copy') {
      toast((await copyText(selectedText())) ? 'പകർത്തി' : 'പകർത്താൻ കഴിഞ്ഞില്ല');
      clearSelection();
    } else if (act === 'share') {
      const text = selectedText();
      if (navigator.share) {
        try { await navigator.share({ title: refText(cur.book, cur.chapter, selection), text }); } catch (err) { /* cancelled */ }
      } else {
        toast((await copyText(text)) ? 'പങ്കിടാനായി പകർത്തി' : 'പകർത്താൻ കഴിഞ്ഞില്ല');
      }
      clearSelection();
    } else if (act === 'bookmark') {
      const keys = [...selection].map((v) => vkey(cur.book, cur.chapter, v));
      const all = keys.every((k) => user.bm[k]);
      keys.forEach((k) => { if (all) delete user.bm[k]; else user.bm[k] = Date.now(); });
      Usage.track(all ? 'unbookmark' : 'bookmark', selRef());
      saveUser();
      toast(all ? 'ബുക്ക്മാർക്ക് നീക്കി' : 'ബുക്ക്മാർക്ക് ചെയ്തു');
      rerenderKeep();
    } else if (act === 'note') {
      const vs = [...selection].sort((a, b) => a - b);
      const existing = vs.map((v) => noteFor(cur.book, cur.chapter, v)).find(Boolean);
      openNote(existing || vkey(cur.book, cur.chapter, vs[0]), vs);
    } else if (act === 'edit') {
      if (!can('edit')) { needPermission('edit'); return; }
      openVerseEdit([...selection][0]);
    }
  });

  // ---------- notes ----------
  let noteCtx = null;
  function openNote(key, vs) {
    const r = splitKey(key);
    const existing = user.notes[key];
    const verses = existing ? existing.vs : (vs || [r.v]);
    noteCtx = { key, vs: verses };
    const book = bookMap.get(r.b);
    const vm = book && book.chapters.get(r.c) ? P.verseMap(book.chapters.get(r.c)) : new Map();
    $('#noteTitle').textContent = 'കുറിപ്പ് · ' + refText(r.b, r.c, verses);
    $('#noteVerse').textContent = verses.map((v) => vm.get(v) || '').join(' ');
    $('#noteText').value = existing ? existing.text : '';
    $('#noteDelete').hidden = !existing;
    openDialog($('#dlgNote'));
    setTimeout(() => $('#noteText').focus(), 50);
  }
  $('#dlgNote').addEventListener('close', () => {
    if ($('#dlgNote').returnValue !== 'save' || !noteCtx) return;
    const text = $('#noteText').value.trim();
    if (text) user.notes[noteCtx.key] = { text, vs: noteCtx.vs, t: Date.now() };
    else delete user.notes[noteCtx.key];
    const nr = splitKey(noteCtx.key);
    Usage.track(text ? 'note' : 'note-delete', { b: nr.b, c: nr.c, v: noteCtx.vs.join(','), len: text.length });
    saveUser();
    toast(text ? 'കുറിപ്പ് സേവ് ചെയ്തു' : 'കുറിപ്പ് നീക്കി');
    rerenderKeep();
  });
  $('#noteDelete').addEventListener('click', () => {
    if (noteCtx) {
      const nr = splitKey(noteCtx.key);
      Usage.track('note-delete', { b: nr.b, c: nr.c, v: noteCtx.vs.join(',') });
      delete user.notes[noteCtx.key];
    }
    saveUser();
    $('#dlgNote').close('deleted');
    toast('കുറിപ്പ് നീക്കി');
    rerenderKeep();
  });

  // ---------- dialogs ----------
  // Each open dialog owns one history entry, so the phone's Back button closes the
  // dialog instead of leaving the app. Closing a dialog in the UI removes its entry
  // (history.back()); navigation waits for that to finish so the URL stays right.
  const hist = { stack: [], pendingBack: 0, queue: [] };
  const historyBusy = () => hist.stack.length > 0 || hist.pendingBack > 0;
  function openDialog(d) {
    if (d.open) return;
    if (hist.pendingBack) { hist.queue.push(() => openDialog(d)); return; }
    d.showModal();
    hist.stack.push(d.id);
    history.pushState({ dlg: d.id }, '', location.href);
  }
  window.addEventListener('popstate', () => {
    if (hist.pendingBack) {
      if (--hist.pendingBack === 0) hist.queue.splice(0).forEach((fn) => fn());
      return;
    }
    const id = hist.stack.pop();
    const d = id && document.getElementById(id);
    if (!d || !d.open) return;
    if (d.id === 'dlgEditor' && editorDirty()) {
      hist.stack.push(id);
      history.pushState({ dlg: id }, '', location.href);
      requestClose(d);
      return;
    }
    d.dataset.popClose = '1';
    d.close();
  });
  $$('dialog').forEach((d) => {
    d.addEventListener('close', () => {
      if (d.dataset.popClose) { delete d.dataset.popClose; return; }
      const i = hist.stack.lastIndexOf(d.id);
      if (i < 0) return;
      hist.stack.splice(i, 1);
      hist.pendingBack++;
      history.back();
    });
  });
  $$('dialog').forEach((d) => {
    d.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) { requestClose(d); return; }
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) requestClose(d);
    });
    d.addEventListener('cancel', (e) => { if (d.id === 'dlgEditor' && editorDirty()) { e.preventDefault(); requestClose(d); } });
  });
  function requestClose(d) {
    if (d.id === 'dlgEditor' && editorDirty()) {
      confirmBox('സേവ് ചെയ്യാത്ത മാറ്റങ്ങൾ', 'മാറ്റങ്ങൾ ഉപേക്ഷിച്ച് അടയ്ക്കണോ?', 'ഉപേക്ഷിക്കുക').then((ok) => { if (ok) { editor.dirty = false; d.close(); } });
      return;
    }
    d.close();
  }

  function confirmBox(title, text, okLabel) {
    const d = $('#dlgConfirm');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = okLabel || 'ശരി';
    d.returnValue = '';
    openDialog(d);
    return new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
  }

  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2200);
  }

  // ---------- picker ----------
  const picker = { tab: 'chapters', book: null, chapter: null };
  // navigation happens only once a verse is chosen: book → chapter → verse
  function pickVerse(bookId, ch, v) {
    if (go(bookId, ch, { verse: v })) $('#dlgPicker').close();
  }

  function openPicker(tab) {
    picker.book = cur.book;
    picker.chapter = cur.chapter;
    openDialog($('#dlgPicker'));
    renderPicker(tab || 'chapters');
  }
  function renderPicker(tab) {
    picker.tab = tab;
    $$('#dlgPicker [data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    const body = $('#pickerBody');
    const b = bookMap.get(picker.book);
    if (tab === 'books') {
      // every book of the canon by its short name (greyed out until it has text), then uploaded extras
      const groups = { OT: [], NT: [], X: [] };
      CAT.forEach((c) => groups[c.testament].push({ id: c.id, short: c.short, name: (bookMap.get(c.id) || c).name }));
      books.filter((bk) => !catById.has(bk.id)).forEach((bk) => groups.X.push({ id: bk.id, short: bk.name, name: bk.name }));
      const label = { OT: 'പഴയ നിയമം', NT: 'പുതിയ നിയമം', X: 'മറ്റുള്ളവ' };
      const cell = (bk) => {
        const has = bookMap.has(bk.id);
        return `<button${bk.id === cur.book ? ' class="cur"' : ''} data-book="${bk.id}" title="${esc(bk.name)}${has ? '' : ' · ലഭ്യമല്ല'}"${has ? '' : ' disabled'}>${esc(bk.short)}</button>`;
      };
      body.innerHTML = Object.entries(groups).filter(([, l]) => l.length).map(([g, l]) => `
        <div class="book-group"><h4>${label[g]}</h4><div class="book-grid">${l.map(cell).join('')}</div></div>`).join('');
    } else if (tab === 'chapters') {
      if (!b) { renderPicker('books'); return; }
      const max = Math.max((catById.get(b.id) || {}).chapters || 0, b.nums[b.nums.length - 1]);
      let cells = '';
      for (let n = 1; n <= max; n++) {
        const has = b.chapters.has(n);
        const cls = [b.id === cur.book && n === cur.chapter ? 'cur' : '', b.changed.has(n) ? 'edited' : ''].join(' ').trim();
        cells += `<button ${cls ? `class="${cls}"` : ''} data-ch="${n}" ${has ? '' : 'disabled title="ലഭ്യമല്ല"'}>${n}</button>`;
      }
      body.innerHTML = `<h3 class="picker-title">${esc(b.name)} <small class="hint">· അധ്യായം തിരഞ്ഞെടുക്കുക</small></h3><div class="grid">${cells}</div>`;
    } else {
      if (!b || !b.chapters.has(picker.chapter)) { renderPicker('chapters'); return; }
      const vm = P.verseMap(b.chapters.get(picker.chapter));
      const max = Math.max(0, ...vm.keys());
      let cells = '';
      for (let v = 1; v <= max; v++) cells += `<button data-verse="${v}" ${vm.has(v) ? '' : 'disabled'}>${v}</button>`;
      body.innerHTML = `<h3 class="picker-title">${esc(b.name)} ${picker.chapter} <small class="hint">· വാക്യം തിരഞ്ഞെടുക്കുക</small></h3><div class="grid">${cells}</div>`;
    }
  }
  $('#dlgPicker').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (t) { renderPicker(t.dataset.tab); return; }
    const bk = e.target.closest('[data-book]');
    if (bk && !bk.disabled) { picker.book = bk.dataset.book; picker.chapter = bookMap.get(picker.book).nums[0]; renderPicker('chapters'); return; }
    const ch = e.target.closest('[data-ch]');
    if (ch && !ch.disabled) { picker.chapter = +ch.dataset.ch; renderPicker('verses'); return; }
    const vs = e.target.closest('[data-verse]');
    if (vs && !vs.disabled) pickVerse(picker.book, picker.chapter, +vs.dataset.verse);
  });

  // ---------- search ----------
  const search = { results: [], shown: 0, terms: [], whole: false, bookFilter: null };
  const PAGE = 80;

  function openSearch() {
    openDialog($('#dlgSearch'));
    $('#searchScope').value = settings.scope || 'all';
    $('#searchWhole').checked = !!settings.whole;
    const inp = $('#searchInput');
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    if (!inp.value) renderSearchHome();
  }

  function renderSearchHome() {
    const recent = (settings.recent || []).slice(0, 10);
    $('#searchBody').innerHTML = `
      ${recent.length ? `<div class="result-summary">സമീപകാല തിരച്ചിലുകൾ</div><div class="recent">${recent.map((r) => `<button class="chip" data-q="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''}
      <div class="tips">
        <div><b>അധ്യായം / വാക്യം:</b> <button class="chip" data-q="3">3</button> <button class="chip" data-q="3:15">3:15</button> <button class="chip" data-q="12 1-5">12 1-5</button> <button class="chip" data-q="ഉത്പ 22:2">ഉത്പ 22:2</button></div>
        <div><b>വാക്ക്:</b> <button class="chip" data-q="ദൈവം">ദൈവം</button> <button class="chip" data-q="അനുഗ്രഹ">അനുഗ്രഹ</button> <button class="chip" data-q="നോഹ പെട്ടകം">നോഹ പെട്ടകം</button></div>
        <div><b>കൃത്യമായ വാചകം:</b> <button class="chip" data-q="&quot;ആദിയിൽ ദൈവം&quot;">"ആദിയിൽ ദൈവം"</button></div>
        <div>ഒന്നിലധികം വാക്കുകൾ നൽകിയാൽ എല്ലാം ഉള്ള വാക്യങ്ങൾ കാണിക്കും.</div>
      </div>`;
  }

  function parseTerms(q) {
    const terms = [];
    q = P.normalize(q).replace(/"([^"]+)"|“([^”]+)”/g, (m, a, b) => { terms.push(P.searchKey(a || b)); return ' '; });
    q.split(/\s+/).filter(Boolean).forEach((t) => terms.push(P.searchKey(t)));
    return terms.filter((t) => t.length > 0);
  }

  const ML_CHAR = /[ഀ-ൿ\w]/;
  function findAll(key, term, whole) {
    const out = [];
    let i = key.indexOf(term);
    while (i >= 0) {
      if (!whole || ((i === 0 || !ML_CHAR.test(key[i - 1])) && (i + term.length >= key.length || !ML_CHAR.test(key[i + term.length])))) out.push([i, i + term.length]);
      i = key.indexOf(term, i + 1);
    }
    return out;
  }

  // Highlight terms in text; searchKey drops joiners so map key positions back to the text.
  function highlight(text, terms, whole) {
    const map = [];
    let key = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === '‌' || ch === '‍') continue;
      key += (ch === 'ൌ' ? 'ൗ' : ch).toLowerCase();
      map.push(i);
    }
    const ranges = [];
    terms.forEach((t) => findAll(key, t, whole).forEach(([s, e]) => ranges.push([map[s], map[e - 1] + 1])));
    ranges.sort((a, b) => a[0] - b[0]);
    let out = '', pos = 0;
    for (const [s, e] of ranges) {
      if (s < pos) continue;
      out += esc(text.slice(pos, s)) + '<mark>' + esc(text.slice(s, e)) + '</mark>';
      pos = e;
    }
    return out + esc(text.slice(pos));
  }

  function runSearch() {
    const q = $('#searchInput').value.trim();
    const body = $('#searchBody');
    settings.scope = $('#searchScope').value;
    settings.whole = $('#searchWhole').checked;
    if (!q) { renderSearchHome(); return; }
    let html = '';
    const ref = parseRef(q);
    if (ref && bookMap.get(ref.b) && bookMap.get(ref.b).chapters.has(ref.c)) {
      const vm = P.verseMap(bookMap.get(ref.b).chapters.get(ref.c));
      const vs = ref.v ? [...vm.keys()].filter((v) => v >= ref.v && v <= (ref.ve || ref.v)) : [...vm.keys()].slice(0, 3);
      const preview = vs.map((v) => (vs.length > 1 ? `<sup class="vn">${v}</sup>` : '') + esc(vm.get(v))).join(' ');
      html += `<button class="result ref-card" data-ref="${ref.b}/${ref.c}/${ref.v || ''}/${ref.ve || ''}">
        <div class="r-ref">→ ${esc(refText(ref.b, ref.c, ref.v ? vs : []))}</div>
        <div class="r-text">${preview || '<span class="hint">ഈ വാക്യം ലഭ്യമല്ല</span>'}${!ref.v ? ' …' : ''}</div></button>`;
    } else if (ref) {
      html += `<div class="result-summary">${esc(bookName(ref.b))} ${ref.c} ലഭ്യമല്ല</div>`;
    }
    // pure references ("3:15") don't need a word search
    const isPureRef = ref && /^[\d\s:.,\-–]+$/.test(q);
    if (!isPureRef) {
      const terms = parseTerms(q);
      const whole = settings.whole;
      let pool = getIndex();
      if (settings.scope === 'book') pool = pool.filter((e) => e.b === cur.book);
      else if (settings.scope === 'chapter') pool = pool.filter((e) => e.b === cur.book && e.c === cur.chapter);
      const res = terms.length ? pool.filter((e) => terms.every((t) => (whole ? findAll(e.k, t, true).length : e.k.includes(t)))) : [];
      Object.assign(search, { results: res, shown: 0, terms, whole, bookFilter: null });
      const chapters = new Set(res.map((e) => e.b + e.c)).size;
      const byBook = new Map();
      res.forEach((e) => byBook.set(e.b, (byBook.get(e.b) || 0) + 1));
      html += `<div class="result-summary"><span>${res.length ? `${res.length} വാക്യങ്ങൾ · ${chapters} അധ്യായങ്ങൾ` : (ref ? '' : 'ഫലങ്ങളൊന്നുമില്ല')}</span>
        ${byBook.size > 1 ? [...byBook].map(([b, n]) => `<button class="chip" data-bookfilter="${b}">${esc(bookName(b))} ${n}</button>`).join('') : ''}</div>
        <div id="resultList"></div>`;
    }
    body.innerHTML = html;
    if (!isPureRef) showMore();
    saveSettings();
    logSearch(q, isPureRef ? -1 : search.results.length);
  }
  // the search that was settled on (not every keystroke), for the usage log; n = -1: a reference
  let lastLogged = '';
  const logSearch = debounce((q, n) => {
    const key = [q, settings.scope, settings.whole].join('|');
    if (key === lastLogged) return;
    lastLogged = key;
    Usage.track('search', { q, n, scope: settings.scope, whole: settings.whole || null });
  }, 1500);

  function showMore() {
    const list = $('#resultList');
    if (!list) return;
    const res = search.bookFilter ? search.results.filter((e) => e.b === search.bookFilter) : search.results;
    const slice = res.slice(search.shown, search.shown + PAGE);
    $('.more', list) && $('.more', list).remove();
    list.insertAdjacentHTML('beforeend', slice.map((e) => `
      <button class="result" data-ref="${e.b}/${e.c}/${e.v}/">
        <div class="r-ref">${esc(bookName(e.b))} ${e.c}:${e.v}</div>
        <div class="r-text">${highlight(e.t, search.terms, search.whole)}</div>
      </button>`).join(''));
    search.shown += slice.length;
    if (search.shown < res.length) list.insertAdjacentHTML('beforeend', `<button class="btn more" data-more>കൂടുതൽ കാണിക്കുക (${res.length - search.shown})</button>`);
  }

  function addRecent(q) {
    q = q.trim();
    if (!q) return;
    settings.recent = [q, ...(settings.recent || []).filter((r) => r !== q)].slice(0, 12);
    saveSettings();
  }

  const runSearchDebounced = debounce(runSearch, 220);
  $('#searchInput').addEventListener('input', runSearchDebounced);
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
      addRecent($('#searchInput').value);
      const first = $('#searchBody .result');
      const q = $('#searchInput').value.trim();
      if (first && /^[\d\s:.,\-–]+$/.test(q)) first.click();
    }
  });
  $('#searchScope').addEventListener('change', runSearch);
  $('#searchWhole').addEventListener('change', runSearch);
  $('#searchBody').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-q]');
    if (chip) { $('#searchInput').value = chip.dataset.q; runSearch(); return; }
    if (e.target.closest('[data-more]')) { showMore(); return; }
    const bf = e.target.closest('[data-bookfilter]');
    if (bf) {
      search.bookFilter = search.bookFilter === bf.dataset.bookfilter ? null : bf.dataset.bookfilter;
      $$('[data-bookfilter]').forEach((c) => c.classList.toggle('on', c.dataset.bookfilter === search.bookFilter));
      search.shown = 0;
      $('#resultList').innerHTML = '';
      showMore();
      return;
    }
    const r = e.target.closest('[data-ref]');
    if (r) {
      const [b, c, v, ve] = r.dataset.ref.split('/');
      addRecent($('#searchInput').value);
      $('#dlgSearch').close();
      go(b, +c, v ? { verse: +v, verseEnd: ve ? +ve : null } : undefined);
    }
  });

  // ---------- settings ----------
  const FONT_MIN = 14, FONT_MAX = 60;   // reading text size range (px)
  function applySettings() {
    const root = document.documentElement;
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    root.style.setProperty('--fs', settings.fontSize + 'px');
    root.style.setProperty('--lh', settings.lineHeight);
    reader.classList.toggle('hide-numbers', !settings.numbers);
    reader.classList.toggle('hide-headings', !settings.headings);
    reader.classList.toggle('layout-verse', settings.layout === 'verse');
    $('#fontSizeOut').textContent = settings.fontSize;
    $$('#dlgSettings button[data-font]').forEach((b) => {
      b.disabled = +b.dataset.font < 0 ? settings.fontSize <= FONT_MIN : settings.fontSize >= FONT_MAX;
    });
    $('#lineHeight').value = settings.lineHeight;
    $('#optNumbers').checked = settings.numbers;
    $('#optHeadings').checked = settings.headings;
    const segOn = (sel, v) => $$(sel + ' button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    segOn('#fontSeg', settings.font);
    segOn('#themeSeg', settings.theme);
    segOn('#layoutSeg', settings.layout);
    const dark = settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    $('meta[name="theme-color"]').content = dark ? '#121212' : settings.theme === 'sepia' ? '#f4ecd8' : '#fbfaf7';
  }
  // the last value of a setting that was changed (a slider gives many steps), for the usage log
  const logSetting = debounce((k, v) => Usage.track('setting', { key: k, val: String(v) }), 1500);
  const changeSetting = (k, v) => { settings[k] = v; saveSettings(); applySettings(); logSetting(k, v); };
  $('#dlgSettings').addEventListener('click', (e) => {
    const f = e.target.closest('button[data-font]');
    if (f) changeSetting('fontSize', Math.min(FONT_MAX, Math.max(FONT_MIN, settings.fontSize + +f.dataset.font)));
    const seg = e.target.closest('.seg button');
    if (seg) {
      const k = { fontSeg: 'font', themeSeg: 'theme', layoutSeg: 'layout' }[seg.parentElement.id];
      if (k) changeSetting(k, seg.dataset.v);
    }
  });
  $('#lineHeight').addEventListener('input', (e) => changeSetting('lineHeight', +e.target.value));
  $('#optNumbers').addEventListener('change', (e) => changeSetting('numbers', e.target.checked));
  $('#optHeadings').addEventListener('change', (e) => changeSetting('headings', e.target.checked));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);

  // ---------- library lists ----------
  function openLibrary(tab) {
    openDialog($('#dlgLibrary'));
    renderLibrary(tab);
  }
  function verseTextOf(k, vs) {
    const r = splitKey(k);
    const b = bookMap.get(r.b);
    if (!b || !b.chapters.has(r.c)) return '';
    const vm = P.verseMap(b.chapters.get(r.c));
    return (vs || [r.v]).map((v) => vm.get(v) || '').join(' ');
  }
  const COLOR_VAR = (c) => `var(--hl-${c})`;
  function renderLibrary(tab) {
    $$('#dlgLibrary [data-lib]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.lib === tab)));
    const body = $('#libraryBody');
    body.dataset.tab = tab;
    let rows = [];
    if (tab === 'bookmarks') rows = Object.entries(user.bm).map(([k, t]) => ({ k, t }));
    else if (tab === 'highlights') rows = Object.entries(user.hl).map(([k, h]) => ({ k, t: h.t, c: h.c }));
    else if (tab === 'notes') rows = Object.entries(user.notes).map(([k, n]) => ({ k, t: n.t, note: n.text, vs: n.vs }));
    else rows = (settings.history || []).map((h) => ({ k: vkey(h.b, h.c, 0), t: h.t, hist: true }));
    rows.sort((a, b) => (b.t || 0) - (a.t || 0));
    if (!rows.length) {
      const icon = { bookmarks: 'i-bookmark', highlights: 'i-highlight', notes: 'i-note', history: 'i-history' }[tab];
      body.innerHTML = `<div class="empty-state"><svg><use href="#${icon}"/></svg><p>ഒന്നുമില്ല. വാക്യത്തിൽ തൊട്ട് ${tab === 'history' ? 'വായന തുടങ്ങുക' : 'ചേർക്കുക'}.</p></div>`;
      return;
    }
    body.innerHTML = rows.map((r) => {
      const { b, c, v } = splitKey(r.k);
      const when = r.t ? new Date(r.t).toLocaleDateString('ml-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      if (r.hist) {
        return `<div class="lib-item"><button class="result" data-ref="${b}/${c}//"><div class="r-ref">${esc(bookName(b))} ${c}</div><div class="hint">${when}</div></button></div>`;
      }
      const vs = r.vs || [v];
      return `<div class="lib-item">
        <button class="result" data-ref="${b}/${c}/${vs[0]}/${vs.length > 1 ? vs[vs.length - 1] : ''}">
          <div class="r-ref">${r.c ? `<span class="dot" style="background:${COLOR_VAR(r.c)}"></span>` : ''}${esc(refText(b, c, vs))} <span class="hint">· ${when}</span></div>
          <div class="r-text">${esc(verseTextOf(r.k, vs))}</div>
          ${r.note ? `<div class="lib-note">${esc(r.note)}</div>` : ''}
        </button>
        <button class="icon-btn sm" data-del="${esc(r.k)}" aria-label="നീക്കുക"><svg><use href="#i-trash"/></svg></button>
      </div>`;
    }).join('');
  }
  $('#dlgLibrary').addEventListener('click', (e) => {
    const t = e.target.closest('[data-lib]');
    if (t) { renderLibrary(t.dataset.lib); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      const tab = $('#libraryBody').dataset.tab;
      const store = { bookmarks: user.bm, highlights: user.hl, notes: user.notes }[tab];
      delete store[del.dataset.del];
      saveUser(); renderLibrary(tab); updateCounts(); rerenderKeep();
      return;
    }
    const r = e.target.closest('[data-ref]');
    if (r) {
      const [b, c, v, ve] = r.dataset.ref.split('/');
      $('#dlgLibrary').close();
      go(b, +c, v ? { verse: +v, verseEnd: ve ? +ve : null } : undefined);
    }
  });
  function updateCounts() {
    const set = (id, n) => { $(id).textContent = n || ''; };
    set('#cntBookmarks', Object.keys(user.bm).length);
    set('#cntHighlights', Object.keys(user.hl).length);
    set('#cntNotes', Object.keys(user.notes).length);
  }

  // ---------- quick verse edit ----------
  let verseEditCtx = null;
  function openVerseEdit(v) {
    if (!can('edit')) { needPermission('edit'); return; }
    const items = bookMap.get(cur.book).chapters.get(cur.chapter);
    verseEditCtx = { book: cur.book, chapter: cur.chapter, v };
    $('#verseEditTitle').textContent = 'തിരുത്തുക · ' + refText(cur.book, cur.chapter, [v]);
    $('#verseEditText').value = items.filter((it) => it.v === v).map((it) => it.t).join('\n');
    openDialog($('#dlgVerseEdit'));
    setTimeout(() => $('#verseEditText').focus(), 50);
  }
  $('#dlgVerseEdit').addEventListener('close', () => {
    if ($('#dlgVerseEdit').returnValue !== 'save' || !verseEditCtx) return;
    if (!can('edit')) { needPermission('edit'); return; }
    const { book, chapter, v } = verseEditCtx;
    const items = bookMap.get(book).chapters.get(chapter).map((x) => ({ ...x }));
    const lines = $('#verseEditText').value.split(/\r?\n/).map(P.normalize).filter(Boolean);
    const first = items.findIndex((it) => it.v === v);
    if (first < 0) return;
    const firstP = items[first].p;
    const rest = items.filter((it, i) => !(it.v === v && i !== first));
    const idx = rest.findIndex((it) => it.v === v);
    const repl = lines.map((t, i) => (i === 0 ? (firstP ? { v, t, p: 1 } : { v, t }) : { v, t, p: 1 }));
    rest.splice(idx, 1, ...repl);
    setChapter(book, chapter, rest);
    if (!persist([[book, chapter]], 'edit-verse')) { revertOverlay(); return; }
    buildLibrary(); rerenderKeep(); toast('വാക്യം സേവ് ചെയ്തു');
  });
  $('#verseEditFull').addEventListener('click', () => { $('#dlgVerseEdit').close('full'); if (can('edit')) openEditor(cur.book, cur.chapter); });

  // ---------- chapter editor ----------
  const editor = { book: null, chapter: null, original: '', dirty: false };
  const editorDirty = () => editor.dirty && $('#edText').value !== editor.original;

  function openEditor(bookId, ch) {
    if (!can('edit')) { needPermission('edit'); return; }
    const b = bookMap.get(bookId);
    if (!b || !b.chapters.has(ch)) { toast('തിരുത്താൻ ഒരു അധ്യായം തുറക്കുക'); return; }
    clearSelection();
    Object.assign(editor, { book: bookId, chapter: ch, dirty: false });
    editor.original = P.toEditorText(b.chapters.get(ch));
    $('#edText').value = editor.original;
    $('#editorTitle').textContent = `${b.name} ${ch} · തിരുത്തുക`;
    $('#edRestore').hidden = !(can('restore') && b.base.has(ch) && b.changed.has(ch));
    $('#edDelete').hidden = !can('delete');
    setEditorView(matchMedia('(max-width: 800px)').matches ? 'text' : 'split');
    updateEditorPreview();
    openDialog($('#dlgEditor'));
    $('#edText').scrollTop = 0;
  }
  function setEditorView(v) {
    const panes = $('#edPanes');
    panes.classList.toggle('v-text', v === 'text');
    panes.classList.toggle('v-preview', v === 'preview');
    $$('#edViewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    if (v !== 'text') updateEditorPreview();
  }
  function editorWarnings(items) {
    const w = P.validate(items);
    const seq = [];
    let prev = 0;
    items.forEach((it) => { if (it.v && it.v !== prev) { if (it.v < prev) seq.push(`${prev} → ${it.v}`); prev = it.v; } });
    if (seq.length) w.push('ക്രമം തെറ്റി (out of order): ' + seq.join(', '));
    return w;
  }
  function updateEditorPreview() {
    const items = P.parseEditorText($('#edText').value);
    $('#edPreview').innerHTML = renderItems(items) || '<p class="hint">ശൂന്യം</p>';
    const w = editorWarnings(items);
    $('#edWarn').hidden = !w.length;
    $('#edWarn').textContent = w.join(' · ');
    return items;
  }
  const updateEditorPreviewDebounced = debounce(updateEditorPreview, 300);
  $('#edText').addEventListener('input', () => { editor.dirty = true; updateEditorPreviewDebounced(); });
  $('#edViewSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setEditorView(b.dataset.v); });
  function insertAtCursor(ta, text) {
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.setRangeText(text, s, e, 'end');
    ta.focus();
    editor.dirty = true;
    updateEditorPreviewDebounced();
  }
  $('#edInsVerse').addEventListener('click', () => {
    const ta = $('#edText');
    const before = ta.value.slice(0, ta.selectionStart);
    const nums = [...before.matchAll(/\[(\d{1,3})\]/g)];
    const n = nums.length ? +nums[nums.length - 1][1] + 1 : 1;
    const pad = before && !/\s$/.test(before) ? ' ' : '';
    insertAtCursor(ta, `${pad}[${n}] `);
  });
  $('#edInsHead').addEventListener('click', () => {
    const ta = $('#edText');
    const before = ta.value.slice(0, ta.selectionStart);
    insertAtCursor(ta, (before && !before.endsWith('\n') ? '\n' : '') + '## ');
  });
  $('#edSave').addEventListener('click', () => {
    if (!can('edit')) { needPermission('edit'); return; }
    const items = updateEditorPreview();
    if (!items.some((it) => it.v)) { toast('വാക്യങ്ങൾ ഒന്നുമില്ല — സേവ് ചെയ്തില്ല'); return; }
    setChapter(editor.book, editor.chapter, items);
    if (!persist([[editor.book, editor.chapter]], 'edit')) { revertOverlay(); return; }
    buildLibrary();
    editor.dirty = false;
    $('#dlgEditor').close();
    if (cur.book === editor.book && cur.chapter === editor.chapter) rerenderKeep();
    toast('അധ്യായം സേവ് ചെയ്തു');
  });
  $('#edRestore').addEventListener('click', async () => {
    if (!can('restore')) { needPermission('restore'); return; }
    if (!(await confirmBox('യഥാർത്ഥ പാഠം', 'ഈ അധ്യായത്തിലെ എല്ലാ തിരുത്തലുകളും മായ്ച്ച് PDF-ൽ നിന്നുള്ള പാഠം തിരികെ കൊണ്ടുവരണോ?', 'പുനഃസ്ഥാപിക്കുക'))) return;
    restoreChapter(editor.book, editor.chapter);
    if (!persist([[editor.book, editor.chapter]], 'restore')) { revertOverlay(); return; }
    buildLibrary();
    editor.dirty = false;
    $('#dlgEditor').close();
    rerenderKeep();
    toast('യഥാർത്ഥ പാഠം പുനഃസ്ഥാപിച്ചു');
  });
  $('#edDelete').addEventListener('click', async () => {
    if (!can('delete')) { needPermission('delete'); return; }
    const name = `${bookName(editor.book)} ${editor.chapter}`;
    if (!(await confirmBox('അധ്യായം നീക്കുക', `${name} ലൈബ്രറിയിൽ നിന്ന് നീക്കണോ?`, 'നീക്കുക'))) return;
    const nb = neighbours();
    deleteChapter(editor.book, editor.chapter);
    if (!persist([[editor.book, editor.chapter]], 'delete')) { revertOverlay(); return; }
    buildLibrary();
    editor.dirty = false;
    $('#dlgEditor').close();
    const target = (nb.next && bookMap.get(nb.next.b)) ? nb.next : nb.prev;
    if (target && bookMap.get(target.b) && bookMap.get(target.b).chapters.has(target.c)) go(target.b, target.c);
    else startAtFirst();
    toast(`${name} നീക്കി`);
  });

  // ---------- upload ----------
  const uploads = [];
  function bookOptions(selected, noNew) {
    const known = new Set(CAT.map((b) => b.id));
    const extra = books.filter((b) => !known.has(b.id));
    const opt = (id, name) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(name)}</option>`;
    return `<optgroup label="പഴയ നിയമം">${CAT.filter((b) => b.testament === 'OT').map((b) => opt(b.id, b.name)).join('')}</optgroup>
      <optgroup label="പുതിയ നിയമം">${CAT.filter((b) => b.testament === 'NT').map((b) => opt(b.id, b.name)).join('')}</optgroup>
      ${extra.length ? `<optgroup label="മറ്റുള്ളവ">${extra.map((b) => opt(b.id, b.name)).join('')}</optgroup>` : ''}
      ${noNew ? '' : '<option value="__new">+ പുതിയ പുസ്തകം…</option>'}`;
  }
  function openUpload() {
    if (!can('upload')) { needPermission('upload'); return; }
    $('#upBook').innerHTML = bookOptions(cur.book || 'GEN');
    renderUploads();
    openDialog($('#dlgUpload'));
  }
  function customBook(sel) {
    const name = (prompt('പുതിയ പുസ്തകത്തിന്റെ പേര്:') || '').trim();
    if (!name) { sel.value = cur.book || 'GEN'; return null; }
    const id = findBook(name, CAT) || findBook(name) || ('X' + Date.now().toString(36).toUpperCase());
    if (!catById.has(id) && !bookMap.has(id)) {
      overlay.books[id] = overlay.books[id] || { chapters: {} };
      overlay.books[id].name = name;
      pendingNames[id] = name;
    }
    const o = document.createElement('option');
    o.value = id; o.textContent = name; o.selected = true;
    sel.insertBefore(o, sel.lastElementChild);
    return id;
  }
  const pendingNames = {};

  const isPdf = (f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
  // Word: .docx is read (js/docx-extract.js); the old binary .doc only gets a "save as .docx" hint
  const isDocx = (f) => /\.docx$/i.test(f.name) || f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isOldDoc = (f) => /\.doc$/i.test(f.name) || f.type === 'application/msword';
  const isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|bmp|gif)$/i.test(f.name);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const OLD_DOC = 'പഴയ .doc ഫയൽ — Word-ൽ തുറന്ന് "Save As → Word Document (.docx)" ആയി സേവ് ചെയ്ത് വീണ്ടും അപ്‌ലോഡ് ചെയ്യുക';

  async function handleFiles(files) {
    const all = [...files];
    const docs = all.filter((f) => isPdf(f) || isDocx(f) || isOldDoc(f));
    const images = all.filter((f) => !docs.includes(f) && isImage(f));
    if (!docs.length && !images.length) { toast('PDF, Word (.docx) അല്ലെങ്കിൽ ചിത്രങ്ങൾ മാത്രം'); return; }
    if (images.length) addScanPages(images.sort(byName));
    if (!docs.length) return;
    const defBook = $('#upBook').value;
    const mine = docs.map((f) => ({ kind: isPdf(f) ? 'pdf' : 'docx', name: f.name, file: f, status: 'processing', results: [], error: null, defBook }));
    uploads.push(...mine);
    renderUploads();
    for (const u of mine) {
      try {
        if (u.kind === 'pdf') {
          const ex = await window.PdfExtract.extract(await u.file.arrayBuffer());
          const flat = ex.pages.flat().map((p) => p.text).join(' ');
          if (!/[ഀ-ൿ]/.test(flat)) throw new Error(flat.trim() ? 'മലയാളം ടെക്സ്റ്റ് കണ്ടെത്തിയില്ല (ഫോണ്ട് എൻകോഡിംഗ് പിന്തുണയ്ക്കുന്നില്ല)' : 'ടെക്സ്റ്റ് ഇല്ല — സ്കാൻ ചെയ്ത (ചിത്ര) PDF ആകാം');
          const garbled = !ex.actualText && (flat.match(/(^|\s)[െേൈ]/g) || []).length > 20;
          parseInto(u, ex.pages, P.chapterFromFilename(u.file.name), garbled ? ['അക്ഷരക്രമം തെറ്റായിരിക്കാം — പ്രിവ്യൂ പരിശോധിക്കുക'] : []);
        } else {
          if (isOldDoc(u.file) && !isDocx(u.file)) throw new Error(OLD_DOC);
          let ex;
          try { ex = await window.DocxExtract.extract(await u.file.arrayBuffer()); } catch (e) {
            throw new Error(e.code === 'docx/old-doc' ? OLD_DOC : 'ഈ Word ഫയൽ വായിക്കാൻ കഴിഞ്ഞില്ല (കേടായതോ .docx അല്ലാത്തതോ ആകാം)');
          }
          const flat = ex.pages.flat().join(' ');
          // text typed in an old ASCII Malayalam font (ML-TT etc.) has no Malayalam letters
          if (!/[ഀ-ൿ]/.test(flat)) throw new Error(flat.trim() ? 'മലയാളം യൂണികോഡ് ടെക്സ്റ്റ് കണ്ടെത്തിയില്ല (പഴയ ASCII ഫോണ്ട് ആകാം)' : 'ഈ Word ഫയലിൽ ടെക്സ്റ്റ് ഇല്ല');
          parseInto(u, ex.pages, P.chapterFromFilename(u.file.name), []);
        }
      } catch (err) {
        u.status = 'error';
        u.error = err.message || String(err);
      }
      renderUploads();
    }
  }

  // extracted pages (PDF paragraphs or OCR lines) → u.results, one per chapter found
  function parseInto(u, pages, hint, extraWarnings) {
    const lex = new Map(getLexicon());
    pages.flat().forEach((p) => P.addToLexicon(lex, P.normalize(typeof p === 'string' ? p : p.text)));
    // only the target book's name counts as a chapter header ("ഉത്പത്തി 3"); other
    // catalog names double as people's names (യാക്കോബ്) and would split chapters wrongly
    // OCR gives the printed lines one by one, however long they are, and a line break there
    // never splits a word (the PDF guesses both from the line lengths)
    const scan = u.kind === 'scan';
    // a Word paragraph / line is complete as typed: a line break there never splits a word either
    const res = P.parsePdfParagraphs(pages, { chapter: hint, bookNames: [bookName(u.defBook)], lexicon: lex, wrapped: scan || undefined, wholeWords: scan || u.kind === 'docx' });
    const detected = res.bookTitle ? findBook(res.bookTitle, CAT) || findBook(res.bookTitle) : null;
    u.results = res.chapters.map((c, i) => ({
      chapter: c.chapter || (hint && i === 0 ? hint : null),
      items: c.items, warnings: c.warnings.concat(extraWarnings), extra: extraWarnings,
      book: detected || u.defBook, include: true, preview: u.kind === 'scan', editing: false, text: null,
    }));
    if (!u.results.length) throw new Error('വാക്യങ്ങൾ കണ്ടെത്തിയില്ല');
    u.status = 'ok';
  }

  // ---------- camera scan: photos of printed pages → text (js/ocr.js) ----------
  // Photos are gathered into one scan (one photo per page, in order) and read together, so a
  // chapter that runs over several pages comes out whole.
  function scanGroup() {
    let u = uploads.find((x) => x.kind === 'scan' && x.status === 'collecting');
    if (!u) {
      u = { kind: 'scan', name: 'ക്യാമറ സ്കാൻ', images: [], status: 'collecting', results: [], error: null, defBook: $('#upBook').value };
      uploads.push(u);
    }
    return u;
  }
  function addScanPages(files) {
    const u = scanGroup();
    u.error = null;
    for (const f of files) u.images.push({ file: f, url: URL.createObjectURL(f) });
    renderUploads();
  }
  function removeUpload(i) {
    const [u] = uploads.splice(i, 1);
    if (u && u.images) u.images.forEach((im) => URL.revokeObjectURL(im.url));
  }
  async function readScan(u) {
    if (!window.Ocr) { toast('OCR ലഭ്യമല്ല'); return; }
    u.status = 'processing';
    u.progress = 'OCR തയ്യാറാക്കുന്നു…';
    u.defBook = $('#upBook').value;
    renderUploads();
    const t0 = Date.now();
    try {
      const ex = await window.Ocr.recognize(u.images.map((im) => im.file), (pr) => {
        const pct = Math.round(pr.p * 100) + '%';
        u.progress = pr.stage === 'load' ? `OCR തയ്യാറാക്കുന്നു (ആദ്യ തവണ ~4 MB ഡൗൺലോഡ്)… ${pct}` : `പേജ് ${pr.page}/${pr.pages} വായിക്കുന്നു… ${pct}`;
        const el = $(`#upList [data-prog="${uploads.indexOf(u)}"]`);
        if (el) el.textContent = u.progress;
      });
      if (!/[ഀ-ൿ]/.test(ex.pages.flat().join(' '))) throw new Error('മലയാളം ടെക്സ്റ്റ് കണ്ടെത്തിയില്ല — കൂടുതൽ വ്യക്തവും നേരെയുമുള്ള ഫോട്ടോ എടുക്കുക');
      parseInto(u, ex.pages, null, ['സ്കാൻ ചെയ്ത ടെക്സ്റ്റ് — തെറ്റുകൾ ഉണ്ടാകാം, സേവ് ചെയ്യുന്നതിന് മുമ്പ് ഫോട്ടോയുമായി ഒത്തുനോക്കി തിരുത്തുക']);
      Usage.track('scan', { pages: u.images.length, n: u.results.length, sec: Math.round((Date.now() - t0) / 1000) });
    } catch (err) {
      // keep the photos, so the scan can be retried or a page retaken
      u.status = 'collecting';
      u.error = err.message || String(err);
    }
    renderUploads();
  }
  function scanPagesHtml(u, removable) {
    return `<div class="scan-pages">${u.images.map((im, i) => `<figure>
      <a href="${im.url}" target="_blank" rel="noopener"><img src="${im.url}" alt="പേജ് ${i + 1}" loading="lazy"></a>
      <figcaption>${i + 1}</figcaption>
      ${removable ? `<button class="icon-btn sm" data-img-rm="${i}" aria-label="പേജ് ${i + 1} നീക്കുക"><svg><use href="#i-x"/></svg></button>` : ''}
    </figure>`).join('')}</div>`;
  }
  const scanBusy = () => uploads.some((u) => u.kind === 'scan' && u.status === 'processing');
  $('#upScan').addEventListener('click', () => $('#upCamera').click());
  $('#upCamera').addEventListener('change', (e) => {
    const files = [...e.target.files].filter(isImage);
    e.target.value = '';
    if (files.length) addScanPages(files);
  });
  // the Malayalam model takes a lot of memory: free it when the dialog closes
  $('#dlgUpload').addEventListener('close', () => { if (window.Ocr && !scanBusy()) window.Ocr.release(); });

  function renderUploads() {
    const list = $('#upList');
    list.innerHTML = uploads.map((u, ui) => {
      if (u.status === 'processing') return `<div class="up-item"><div class="up-row"><span class="spin"></span><span class="fname">${esc(u.name)}<small data-prog="${ui}">${esc(u.progress || 'വായിക്കുന്നു…')}</small></span></div></div>`;
      if (u.status === 'error') return `<div class="up-item"><div class="up-row"><span class="fname">${esc(u.name)}<small>${esc(u.error)}</small></span><span class="status err">പിശക്</span><button class="icon-btn sm" data-rm="${ui}" aria-label="നീക്കുക"><svg><use href="#i-x"/></svg></button></div></div>`;
      if (u.status === 'collecting') return `<div class="up-item scan-item" data-scan="${ui}">
          <div class="up-row">
            <svg class="scan-ic"><use href="#i-camera"/></svg>
            <span class="fname">${esc(u.name)}<small>${u.images.length} പേജ് · എല്ലാ പേജുകളും ചേർത്ത ശേഷം "ടെക്സ്റ്റ് ആക്കുക" അമർത്തുക</small></span>
            <button class="btn sm" data-scan-add><svg><use href="#i-camera"/></svg><span>അടുത്ത പേജ്</span></button>
            <button class="btn sm primary" data-scan-read ${u.images.length ? '' : 'disabled'}><svg><use href="#i-check"/></svg><span>ടെക്സ്റ്റ് ആക്കുക</span></button>
            <button class="icon-btn sm" data-rm="${ui}" aria-label="സ്കാൻ നീക്കുക"><svg><use href="#i-x"/></svg></button>
          </div>
          ${u.error ? `<div class="up-warn">⚠ ${esc(u.error)}</div>` : ''}
          ${scanPagesHtml(u, true)}
        </div>`;
      return u.results.map((r, ri) => {
        const b = bookMap.get(r.book);
        const exists = r.chapter && b && b.chapters.has(r.chapter);
        const st = !r.chapter ? '<span class="status err">അധ്യായ നമ്പർ നൽകുക</span>'
          : exists ? '<span class="status warn">നിലവിലുള്ളത് മാറ്റിസ്ഥാപിക്കും</span>' : '<span class="status ok">പുതിയത്</span>';
        return `<div class="up-item" data-u="${ui}" data-r="${ri}">
          <div class="up-row">
            <input type="checkbox" class="up-inc" ${r.include ? 'checked' : ''} aria-label="ഉൾപ്പെടുത്തുക">
            <span class="fname">${esc(u.name)}${u.results.length > 1 ? ` <small>ഭാഗം ${ri + 1}/${u.results.length}</small>` : ''}<small class="up-count">${countText(r)}</small></span>
            <select class="up-book" aria-label="പുസ്തകം">${bookOptions(r.book)}</select>
            <label>അധ്യായം <input type="number" class="up-ch" min="1" max="200" value="${r.chapter || ''}"></label>
            ${st}
            <button class="btn sm up-prev">${r.preview ? 'പ്രിവ്യൂ മറയ്ക്കുക' : 'പ്രിവ്യൂ'}</button>
            <button class="btn sm up-edit">${r.editing ? 'തിരുത്തൽ മറയ്ക്കുക' : 'ടെക്സ്റ്റ് തിരുത്തുക'}</button>
          </div>
          <div class="up-warn" ${r.warnings.length ? '' : 'hidden'}>⚠ ${esc(r.warnings.join(' · '))}</div>
          ${r.editing && u.kind === 'scan' && ri === 0 ? scanPagesHtml(u, false) : ''}
          ${r.editing ? `<textarea class="up-text" spellcheck="false" aria-label="ടെക്സ്റ്റ് തിരുത്തുക">${esc(r.text != null ? r.text : P.toEditorText(r.items))}</textarea>
            <small class="up-hint">[5] = വാക്യം 5 തുടങ്ങുന്നു · ## = തലക്കെട്ട് · ഓരോ വരിയും ഒരു ഖണ്ഡിക</small>` : ''}
          ${r.preview ? `<div class="up-preview reader">${renderItems(r.items)}</div>` : ''}
        </div>`;
      }).join('');
    }).join('');
    const ready = uploads.some((u) => u.status === 'ok' && u.results.some((r) => r.include && r.chapter));
    $('#upSave').disabled = !ready || uploads.some((u) => u.status === 'processing');
  }
  const countText = (r) => `${P.verseMap(r.items).size} വാക്യങ്ങൾ · ${r.items.filter((x) => x.h).length} തലക്കെട്ടുകൾ`;
  $('#upList').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { removeUpload(+rm.dataset.rm); renderUploads(); return; }
    const scan = e.target.closest('.up-item[data-scan]');
    if (scan) {
      const u = uploads[+scan.dataset.scan];
      const img = e.target.closest('[data-img-rm]');
      // the last read's error was about these photos: gone once one is retaken or removed
      if (img) { const [im] = u.images.splice(+img.dataset.imgRm, 1); URL.revokeObjectURL(im.url); u.error = null; renderUploads(); }
      else if (e.target.closest('[data-scan-add]')) $('#upCamera').click();
      else if (e.target.closest('[data-scan-read]')) readScan(u);
      return;
    }
    const item = e.target.closest('.up-item[data-u]');
    if (!item) return;
    const r = uploads[+item.dataset.u].results[+item.dataset.r];
    if (e.target.closest('.up-prev')) { r.preview = !r.preview; renderUploads(); }
    if (e.target.closest('.up-edit')) { r.editing = !r.editing; renderUploads(); }
  });
  // text edited before saving (editor format): the preview and counts follow as you type
  $('#upList').addEventListener('input', (e) => {
    if (!e.target.classList.contains('up-text')) return;
    const item = e.target.closest('.up-item[data-u]');
    const r = uploads[+item.dataset.u].results[+item.dataset.r];
    r.text = e.target.value;
    r.items = P.parseEditorText(r.text);
    r.warnings = P.validate(r.items).concat(r.extra);
    const warn = item.querySelector('.up-warn');
    // always rendered (hidden when empty), so a warning that comes up while typing shows too
    warn.textContent = '⚠ ' + r.warnings.join(' · ');
    warn.hidden = !r.warnings.length;
    const prev = item.querySelector('.up-preview');
    if (prev) prev.innerHTML = renderItems(r.items);
    item.querySelector('.up-count').textContent = countText(r);
  });
  $('#upList').addEventListener('change', (e) => {
    if (e.target.classList.contains('up-text')) return;
    const item = e.target.closest('.up-item[data-u]');
    if (!item) return;
    const r = uploads[+item.dataset.u].results[+item.dataset.r];
    if (e.target.classList.contains('up-inc')) r.include = e.target.checked;
    if (e.target.classList.contains('up-ch')) r.chapter = +e.target.value || null;
    if (e.target.classList.contains('up-book')) {
      if (e.target.value === '__new') { const id = customBook(e.target); if (id) r.book = id; }
      else r.book = e.target.value;
    }
    renderUploads();
  });
  $('#upBook').addEventListener('change', (e) => {
    if (e.target.value === '__new') customBook(e.target);
  });
  $('#upInput').addEventListener('change', (e) => { handleFiles(e.target.files); e.target.value = ''; });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files));
  $('#upSave').addEventListener('click', () => {
    if (!can('upload')) { needPermission('upload'); return; }
    const chosen = [];
    uploads.forEach((u) => u.status === 'ok' && u.results.forEach((r) => { if (r.include && r.chapter) chosen.push(r); }));
    if (!chosen.length) return;
    chosen.forEach((r) => {
      const name = pendingNames[r.book] || (!bookMap.has(r.book) && catById.has(r.book) ? catById.get(r.book).name : undefined);
      setChapter(r.book, r.chapter, r.items, name);
    });
    if (!persist(chosen.map((r) => [r.book, r.chapter]), 'upload')) { revertOverlay(); return; }
    buildLibrary();
    // photos still waiting to be read stay for next time
    for (let i = uploads.length - 1; i >= 0; i--) if (uploads[i].status !== 'collecting') removeUpload(i);
    $('#dlgUpload').close();
    const first = chosen[0];
    go(first.book, first.chapter);
    toast(`${chosen.length} അധ്യായം ചേർത്തു`);
  });

  // ---------- source documents ----------
  // Files are kept as they are in the repository, tools/uploads/<BOOK>/[<chapter>/], by
  // functions/api/sources/upload.js (a commit on GitHub; tools/dev-server.mjs writes to disk),
  // to be turned into text later. Nothing is read or changed in the reader here.
  const sources = [];        // { file, name, status: ready | sending | done | error, error, where }
  const SRC_MAX = 2 * 1024 * 1024;           // the upload function only has ~10 ms of CPU on the free plan
  const SRC_TYPES = /\.(pdf|docx?|odt|rtf|txt|jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i;
  const SRC_ERRORS = {
    'not-configured': 'സെർവറിൽ സംഭരണം ഇതുവരെ സജ്ജമാക്കിയിട്ടില്ല (GITHUB_TOKEN)',
    'permission-denied': 'ഫയലുകൾ അപ്‌ലോഡ് ചെയ്യാൻ അനുമതിയില്ല',
    'exists': 'ഈ പേരിൽ ഫയലുകൾ ഇപ്പോൾ തന്നെ ഉണ്ട് — പേര് മാറ്റി വീണ്ടും ശ്രമിക്കുക',
    'sign-in-required': 'ലോഗിൻ ചെയ്യുക', 'bad-token': 'വീണ്ടും ലോഗിൻ ചെയ്യുക', 'token-expired': 'വീണ്ടും ലോഗിൻ ചെയ്യുക',
    'too-large': 'ഫയൽ വളരെ വലുതാണ് (2 MB വരെ) — PDF ചെറിയ ഭാഗങ്ങളായി വിഭജിക്കുക', 'bad-type': 'ഈ തരം ഫയൽ സ്വീകരിക്കില്ല', 'bad-chapter': 'അധ്യായ നമ്പർ ശരിയല്ല',
    'photo-too-large': 'ഫോട്ടോ വളരെ വലുതാണ് (2 MB വരെ), ഈ ബ്രൗസറിന് ചെറുതാക്കാനായില്ല — ക്യാമറയിൽ JPEG ആയി എടുത്ത് വീണ്ടും ശ്രമിക്കുക',
    // the server's GitHub token (Cloudflare Pages → Settings → Variables and Secrets)
    'github-401': 'സെർവറിലെ GitHub ടോക്കൺ (GITHUB_TOKEN) തെറ്റാണ് അല്ലെങ്കിൽ കാലാവധി കഴിഞ്ഞു',
    'github-403': 'GitHub ടോക്കണിന് repository-യിൽ എഴുതാൻ അനുമതിയില്ല (Contents: Read and write വേണം)',
    'github-404': 'GitHub ടോക്കണിന് repository കാണാനാകുന്നില്ല (GITHUB_REPO / ടോക്കണിന്റെ repository access)',
    'github-422': 'GitHub ഫയൽ സ്വീകരിച്ചില്ല (branch / ruleset — GITHUB_BRANCH)',
  };
  let srcBusy = false;
  let srcShots = 0;
  const sizeText = (n) => (n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB');

  function openSources() {
    if (!can('upload')) { needPermission('upload'); return; }
    if (!sources.some((s) => s.status === 'ready')) $('#srcBook').innerHTML = bookOptions(cur.book || 'GEN', true);
    renderSources();
    openDialog($('#dlgSources'));
  }
  function addSources(files, fromCamera) {
    const bad = [];
    for (const f of files) {
      if (!SRC_TYPES.test(f.name) && !/^image\//.test(f.type)) { bad.push(f.name); continue; }
      // the camera calls every photo image.jpg: number them in the order taken
      const name = fromCamera ? `page-${String(++srcShots).padStart(2, '0')}${(f.name.match(/\.[A-Za-z0-9]+$/) || ['.jpg'])[0].toLowerCase()}` : f.name;
      sources.push({ file: f, name, status: 'ready', error: null, where: '' });
    }
    if (bad.length) toast('സ്വീകരിക്കാത്ത ഫയൽ: ' + bad.join(', '), 5000);
    renderSources();
  }
  function renderSources() {
    $('#srcList').innerHTML = sources.map((s, i) => {
      const st = s.status === 'done' ? '<span class="status ok">സൂക്ഷിച്ചു</span>'
        : s.status === 'error' ? '<span class="status err">പിശക്</span>'
        : s.status === 'sending' ? '<span class="status">അയയ്ക്കുന്നു…</span>' : '<span class="status">തയ്യാർ</span>';
      const info = [sizeText(s.file.size), s.where, s.error].filter(Boolean).join(' · ');
      return `<div class="up-item"><div class="up-row">
        ${s.status === 'sending' ? '<span class="spin"></span>' : ''}
        <span class="fname">${esc(s.name)}<small>${esc(info)}</small></span>
        ${st}
        ${s.status === 'ready' || s.status === 'error' ? `<button class="icon-btn sm" data-src-rm="${i}" aria-label="നീക്കുക"><svg><use href="#i-x"/></svg></button>` : ''}
      </div></div>`;
    }).join('');
    $('#srcSend').disabled = srcBusy || !sources.some((s) => s.status === 'ready' || s.status === 'error');
  }
  // phone photos → at most 2000 px JPEG (plenty to read a printed page, and small enough for the upload function).
  // Some galleries / file pickers give a photo no type (or application/octet-stream): go by the name then.
  // A format the browser can't decode (HEIC outside Safari) stays as it is.
  async function shrinkPhoto(file) {
    const photo = /^image\//.test(file.type) || /\.(jpe?g|jfif|png|webp|bmp|gif|tiff?|heic|heif|avif)$/i.test(file.name || '');
    if (!photo || file.size <= 700 * 1024 || !window.createImageBitmap) return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      if (bmp.close) bmp.close();
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
      return blob && blob.size < file.size ? blob : file;
    } catch (e) { return file; }
  }
  const toBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).slice(String(r.result).indexOf(',') + 1));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  async function sendSources() {
    if (!can('upload')) { needPermission('upload'); return; }
    const book = $('#srcBook').value;
    const chapter = $('#srcChapter').value.trim();
    if (chapter && !(/^\d{1,3}$/.test(chapter) && +chapter >= 1 && +chapter <= 150)) { toast(SRC_ERRORS['bad-chapter']); $('#srcChapter').focus(); return; }
    if (!navigator.onLine) { toast('ഓൺലൈൻ അല്ല — ഫയലുകൾ അയയ്ക്കാൻ ഇന്റർനെറ്റ് വേണം'); return; }
    const note = $('#srcNote').value.trim();
    const where = bookName(book) + (chapter ? ' ' + +chapter : '');
    srcBusy = true;
    let sent = 0;
    // one at a time, in the order added: each is a commit on the same branch
    for (const s of sources) {
      if (s.status !== 'ready' && s.status !== 'error') continue;
      s.status = 'sending'; s.error = null;
      renderSources();
      try {
        const blob = await shrinkPhoto(s.file);
        if (blob.size > SRC_MAX) throw new Error(SRC_ERRORS[/^image\//.test(blob.type) || /\.(jpe?g|jfif|png|webp|bmp|gif|tiff?|heic|heif|avif)$/i.test(s.name) ? 'photo-too-large' : 'too-large']);
        let name = blob === s.file ? s.name : s.name.replace(/\.[^.]*$/, '') + '.jpg';
        // a photo named .jfif, .avif or without an extension: the server goes by the extension
        const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic', 'image/heif': '.heif' }[blob.type];
        if (!SRC_TYPES.test(name) && ext) name = name.replace(/\.[^.]*$/, '') + ext;
        let body;
        try { body = await toBase64(blob); } catch (e) { throw new Error('ഫയൽ വായിക്കാനായില്ല — ഫോണിൽ സൂക്ഷിച്ച ശേഷം വീണ്ടും ചേർക്കുക'); }
        const token = cloudMode && Cloud.idToken ? await Cloud.idToken() : '';
        const qs = new URLSearchParams({ book, chapter, name, note });
        let res;
        try {
          res = await fetch('/api/sources/upload?' + qs, {
            method: 'POST', cache: 'no-store', body,
            headers: Object.assign({ 'Content-Type': 'text/plain' }, token ? { Authorization: 'Bearer ' + token } : {}),
          });
        } catch (e) { throw new Error('കണക്ഷൻ പിശക് — വീണ്ടും ശ്രമിക്കുക'); }
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          // a host without the function (a plain web server, or the app opened from disk)
          if (!j.error && (res.status === 404 || res.status === 405)) throw new Error('ഈ സെർവറിൽ ഈ സൗകര്യം ഇല്ല — പ്രസിദ്ധീകരിച്ച സൈറ്റ് അല്ലെങ്കിൽ node tools/dev-server.mjs ഉപയോഗിക്കുക');
          // Cloudflare's own error page, e.g. the function ran over its CPU limit
          if (!j.error) throw new Error('സെർവർ പിശക് (' + res.status + ') — ഫയൽ ചെറുതാക്കി വീണ്ടും ശ്രമിക്കുക');
          throw new Error(SRC_ERRORS[j.error] || 'പിശക് (' + j.error + ')');
        }
        s.status = 'done';
        s.where = where;
        sent++;
      } catch (err) {
        s.status = 'error';
        s.error = err.message || String(err);
      }
      renderSources();
    }
    srcBusy = false;
    renderSources();
    if (sent) {
      Usage.track('sources', { b: book, c: chapter ? +chapter : null, n: sent });
      toast(`${sent} ഫയൽ സൂക്ഷിച്ചു (${where})`);
    }
  }
  $('#srcInput').addEventListener('change', (e) => { addSources([...e.target.files]); e.target.value = ''; });
  $('#srcCamera').addEventListener('change', (e) => { addSources([...e.target.files], true); e.target.value = ''; });
  $('#srcShoot').addEventListener('click', () => $('#srcCamera').click());
  $('#srcSend').addEventListener('click', sendSources);
  $('#srcList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-src-rm]');
    if (b && !srcBusy) { sources.splice(+b.dataset.srcRm, 1); renderSources(); }
  });
  const srcDz = $('#srcDrop');
  ['dragenter', 'dragover'].forEach((ev) => srcDz.addEventListener(ev, (e) => { e.preventDefault(); srcDz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => srcDz.addEventListener(ev, (e) => { e.preventDefault(); srcDz.classList.remove('over'); }));
  srcDz.addEventListener('drop', (e) => addSources([...e.dataTransfer.files]));

  // ---------- export / import ----------
  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function mergedData() {
    return {
      version: new Date().toISOString().slice(0, 10),
      books: books.map((b) => ({ id: b.id, name: b.name, chapters: Object.fromEntries(b.nums.map((n) => [n, b.chapters.get(n)])) })),
    };
  }
  function exportDataJs() {
    download('data.js', '/* Exported from the app — replace app/js/data.js with this file to make edits permanent. */\nwindow.BIBLE_DATA = ' + JSON.stringify(mergedData()) + ';\n', 'text/javascript;charset=utf-8');
    toast('data.js ഡൗൺലോഡ് ചെയ്തു — app/js/data.js മാറ്റിവയ്ക്കുക', 5000);
  }
  function exportBackup() {
    const data = { app: 'ml-bible', version: 1, exported: new Date().toISOString(), overlay, user, settings };
    download(`bible-backup-${data.exported.slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
  }
  $('#restoreInput').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!can('restore')) { needPermission('restore'); return; }
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'ml-bible') throw new Error('bad file');
      if (!(await confirmBox('ബാക്കപ്പ് പുനഃസ്ഥാപിക്കുക', 'നിലവിലുള്ള തിരുത്തലുകൾ, ഹൈലൈറ്റുകൾ, കുറിപ്പുകൾ എന്നിവ ബാക്കപ്പിലുള്ളതുകൊണ്ട് മാറ്റിസ്ഥാപിക്കും.', 'പുനഃസ്ഥാപിക്കുക'))) return;
      if (!cloudMode) LS.set('overlay', data.overlay || { books: {} });
      LS.set('user', data.user || {});
      LS.set('settings', data.settings || {});
      location.reload();
    } catch (err) { toast('ഈ ഫയൽ വായിക്കാൻ കഴിഞ്ഞില്ല'); }
  });
  function exportHtmlBook() {
    const b = bookMap.get(cur.book);
    if (!b) return;
    const nums = b.nums;
    const toc = nums.map((n) => `<a href="#c${n}">${n}</a>`).join(' ');
    const body = nums.map((n) => `<section id="c${n}"><h2>അധ്യായം ${n}</h2>${renderItems(b.chapters.get(n))}</section>`).join('\n');
    const html = `<!doctype html><html lang="ml"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(b.name)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+Malayalam:wght@400;700&family=Noto+Sans+Malayalam:wght@400;700&display=swap">
<style>
:root{--bg:#fbfaf7;--text:#1f1d1a;--muted:#6b665e;--accent:#8a3b12;--line:#e4e0d8}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--text:#e8e6e1;--muted:#a09b92;--accent:#f0a868;--line:#34343a}}
body{margin:0;background:var(--bg);color:var(--text);font-family:'Noto Serif Malayalam','Nirmala UI',serif;font-size:19px;line-height:1.9}
main{max-width:720px;margin:0 auto;padding:24px 16px 80px}
h1{text-align:center;font-size:2.2em;margin:.4em 0}
nav{font-family:'Noto Sans Malayalam',sans-serif;font-size:15px;line-height:2.2;text-align:center;border-bottom:1px solid var(--line);padding-bottom:16px}
nav a{display:inline-block;min-width:2.2em;color:var(--accent);text-decoration:none}
h2{font-family:'Noto Sans Malayalam',sans-serif;text-align:center;margin:2.2em 0 .6em;font-size:1.3em}
h3.sec{font-family:'Noto Sans Malayalam',sans-serif;font-size:.86em;margin:1.5em 0 .4em}
p{margin:0 0 .9em}
.vn{font-family:'Noto Sans Malayalam',sans-serif;font-size:.58em;font-weight:700;color:var(--accent);vertical-align:super;line-height:0;margin:0 .2em}
</style></head><body><main><h1>${esc(b.name)}</h1><nav>${toc}</nav>${body}</main></body></html>`;
    download(`${b.name}.html`, html, 'text/html;charset=utf-8');
    toast(`${b.name}.html ഡൗൺലോഡ് ചെയ്തു`);
  }

  // ---------- menu ----------
  // every item of the ഉള്ളടക്കം and ഡാറ്റ sections (same keys as data-perm in index.html)
  const MENU_PERM = { upload: 'upload', scan: 'upload', sources: 'upload', edit: 'edit', exportHtml: 'export', admin: 'users', exportData: 'export', backup: 'export', restore: 'restore', reset: 'reset' };
  async function menuAction(a) {
    const m = $('#dlgMenu');
    if (m.open) m.close();
    if (MENU_PERM[a] && !can(MENU_PERM[a])) { needPermission(MENU_PERM[a]); return; }
    Usage.track('menu', { a });
    if (a === 'login') { openLogin('signin'); return; }
    if (a === 'logout') { await Cloud.signOut(); toast('ലോഗൗട്ട് ചെയ്തു'); return; }
    if (a === 'lock') { LocalOwner.lock(); toast('ലോക്ക് ചെയ്തു'); return; }
    if (a === 'addPasskey') { addPasskey(); return; }
    if (a === 'redeem') { if (AuthUI) AuthUI.openRedeem(); return; }
    if (a === 'admin') { openAdminPortal(); return; }
    if (a === 'verifyResend') { try { await Cloud.resendVerification(); toast('സ്ഥിരീകരണ ലിങ്ക് അയച്ചു. ' + (AuthUI ? AuthUI.mailHint() : 'ഇമെയിൽ നോക്കുക'), 10000); } catch (err) { toast(authMessage(err), 7000); } return; }
    if (a === 'verifyCheck') {
      await Cloud.refreshUser().catch(() => {});
      toast(Cloud.user && Cloud.user.verified ? 'ഇമെയിൽ സ്ഥിരീകരിച്ചു' : 'ഇതുവരെ സ്ഥിരീകരിച്ചിട്ടില്ല — ഇമെയിലിലെ ലിങ്ക് തുറക്കുക', 4000);
      return;
    }
    if (['bookmarks', 'highlights', 'notes', 'history'].includes(a)) openLibrary(a);
    else if (a === 'upload') openUpload();
    else if (a === 'scan') { openUpload(); $('#upCamera').click(); }
    else if (a === 'sources') openSources();
    else if (a === 'edit') openEditor(cur.book, cur.chapter);
    else if (a === 'exportHtml') exportHtmlBook();
    else if (a === 'exportData') exportDataJs();
    else if (a === 'backup') exportBackup();
    else if (a === 'restore') $('#restoreInput').click();
    else if (a === 'install') installApp();
    else if (a === 'reset') {
      const n = Object.values(overlay.books).reduce((s, b) => s + Object.keys(b.chapters || {}).length, 0);
      if (!n) { toast('തിരുത്തലുകൾ ഒന്നുമില്ല'); return; }
      const who = cloudMode ? ' ഇത് എല്ലാ ഉപയോക്താക്കൾക്കും ബാധകമാണ്.' : '';
      if (!(await confirmBox('എല്ലാ തിരുത്തലുകളും മായ്ക്കുക', `${n} അധ്യായങ്ങളിലെ തിരുത്തലുകളും അപ്‌ലോഡുകളും നീക്കം ചെയ്യും. ഹൈലൈറ്റുകളും കുറിപ്പുകളും നിലനിൽക്കും.${who}`, 'മായ്ക്കുക'))) return;
      if (cloudMode) {
        if (cloudStatus !== 'ready' || !Cloud.online) { toast('ഓൺലൈൻ അല്ല — ഇതിന് ഇന്റർനെറ്റ് വേണം'); return; }
        try { await Cloud.resetAll(); } catch (err) { cloudError(err); return; }
      }
      overlay = { books: {} };
      saveOverlay(); buildLibrary();
      if (!bookMap.has(cur.book) || !bookMap.get(cur.book).chapters.has(cur.chapter)) startAtFirst(); else rerenderKeep();
      toast('തിരുത്തലുകൾ മായ്ച്ചു');
    }
  }
  $('#dlgMenu').addEventListener('click', (e) => { const b = e.target.closest('[data-menu]'); if (b) menuAction(b.dataset.menu); });

  // ---------- top-level controls ----------
  $('#btnMenu').addEventListener('click', () => { updateCounts(); openDialog($('#dlgMenu')); });
  $('#btnRef').addEventListener('click', () => openPicker('books'));
  $('#btnSearch').addEventListener('click', openSearch);
  $('#btnSettings').addEventListener('click', () => { const d = $('#dlgSettings'); if (d.open) d.close(); else openDialog(d); });
  const step = (dir) => { const nb = neighbours(); const t = dir < 0 ? nb.prev : nb.next; if (t) go(t.b, t.c); };
  $('#btnPrev').addEventListener('click', () => step(-1));
  $('#btnNext').addEventListener('click', () => step(1));

  document.addEventListener('keydown', (e) => {
    if ($('dialog[open]')) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.altKey || e.metaKey) return;
    if (e.key === 'ArrowLeft' && !e.ctrlKey) { step(-1); e.preventDefault(); }
    else if (e.key === 'ArrowRight' && !e.ctrlKey) { step(1); e.preventDefault(); }
    else if (e.key === '/' || (e.ctrlKey && e.key.toLowerCase() === 'f')) { openSearch(); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'g' && !e.ctrlKey) { openPicker('books'); e.preventDefault(); }
    else if (e.key.toLowerCase() === 'e' && !e.ctrlKey && can('edit') && cur.book) { openEditor(cur.book, cur.chapter); e.preventDefault(); }
    else if (e.key === 'Escape' && selection.size) clearSelection();
  });

  // no page zoom: iOS Safari ignores user-scalable=no, and desktop zooms on ctrl+wheel / ctrl +/-
  const noZoom = (e) => e.preventDefault();
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, noZoom, { passive: false }));
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  document.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && ['+', '=', '-', '_', '0'].includes(e.key)) e.preventDefault();
  });

  // swipe left/right to change chapter
  let touch = null;
  $('#main').addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  $('#main').addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (Math.abs(dx) > 80 && Math.abs(dy) < 50 && Date.now() - touch.t < 600 && !String(window.getSelection()).trim()) step(dx < 0 ? 1 : -1);
    touch = null;
  }, { passive: true });

  // the top bar stays fixed at the top; it only gains a divider line once the page scrolls
  // (battery: the class changes only when crossing the line, and the position is saved once scrolling stops)
  const saveScroll = debounce(() => { settings.lastScroll = { b: cur.book, c: cur.chapter, y: window.scrollY }; saveSettings(); }, 1200);
  const topbar = $('.topbar');
  let scrolled = false;
  window.addEventListener('scroll', () => {
    const s = window.scrollY > 4;
    if (s !== scrolled) { scrolled = s; topbar.classList.toggle('scrolled', s); }
    saveScroll();
  }, { passive: true });

  window.addEventListener('hashchange', () => {
    const r = parseHash();
    if (r && (r.b !== cur.book || r.c !== cur.chapter || r.v)) go(r.b, r.c, r.v ? { verse: r.v } : undefined);
  });
  function parseHash() {
    const m = location.hash.match(/^#\/([^/]+)\/(\d+)(?:\/(\d+))?/);
    return m ? { b: decodeURIComponent(m[1]), c: +m[2], v: m[3] ? +m[3] : null } : null;
  }

  function startAtFirst() {
    if (!books.length) { cur.book = null; cur.chapter = null; render(); return; }
    go(books[0].id, books[0].nums[0]);
  }

  // ---------- login, roles, permissions ----------
  const ROLE_LABEL = { admin: 'അഡ്മിൻ', editor: 'എഡിറ്റർ', reader: 'വായനക്കാരൻ', none: 'തടഞ്ഞു' };

  function revertOverlay() { overlay = LS.get(cloudMode ? 'cloudOverlay' : 'overlay', { books: {} }); buildLibrary(); }
  const authMessage = (err) => (AuthUI ? AuthUI.message(err) : 'പിശക്' + (err && err.code ? ` (${err.code})` : ''));

  function needPermission(perm) {
    if (cloudMode && !Cloud.user) {
      toast('ഇതിന് ലോഗിൻ ചെയ്യണം');
      openLogin('signin');
    } else if (!cloudMode && LocalOwner.allowed) {
      toast('ഇതിന് ഉടമയുടെ പാസ്‌കോഡ് വേണം');
      openLogin('signin');
    } else if (!cloudMode) {
      toast('ഈ സൈറ്റ് വായനയ്ക്ക് മാത്രം — തിരുത്താനുള്ള ലോഗിൻ സജ്ജമാക്കിയിട്ടില്ല', 4500);
    } else if (Cloud.blocked) {
      toast('നിങ്ങളുടെ അക്കൗണ്ട് അഡ്മിൻ തടഞ്ഞിരിക്കുന്നു', 4500);
    } else {
      const min = (Cloud.PERMS || {})[perm];
      toast(`അനുമതിയില്ല — ${min ? ROLE_LABEL[min] + ' റോൾ ആവശ്യമാണ്. ' : ''}അഡ്മിനെ ബന്ധപ്പെടുക`, 4500);
    }
  }

  function applyPermissions() {
    $$('[data-perm]').forEach((el) => { el.hidden = !can(el.dataset.perm); });
    // a menu heading disappears when nothing under it is left
    $$('#dlgMenu .menu-label').forEach((label) => {
      let el = label.nextElementSibling, any = false, gated = false;
      for (; el && !el.classList.contains('menu-label'); el = el.nextElementSibling) {
        if (el.dataset.perm) gated = true;
        if (!el.hidden) any = true;
      }
      label.hidden = gated && !any;
    });
    document.body.dataset.role = cloudMode ? Cloud.role : LocalOwner.isUnlocked() ? 'local-owner' : 'local';
  }

  // an open editor / upload loses its permission: close it (returns true if it closed something)
  function enforcePermissions() {
    let closed = false;
    if ($('#dlgEditor').open && !can('edit')) { editor.dirty = false; $('#dlgEditor').close(); closed = true; }
    if ($('#dlgUpload').open && !can('upload')) { $('#dlgUpload').close(); closed = true; }
    if ($('#dlgSources').open && !can('upload')) { $('#dlgSources').close(); closed = true; }
    if ($('#dlgVerseEdit').open && !can('edit')) { $('#dlgVerseEdit').close('lost'); closed = true; }
    return closed;
  }

  function renderAccount() {
    const el = $('#accountCard');
    const loginBtn = (hint) => `<button class="btn primary block" data-menu="login"><svg><use href="#i-user"/></svg><span>ലോഗിൻ</span></button>
        <small class="acct-hint">${hint}</small>`;
    if (!cloudMode) {
      if (LocalOwner.isUnlocked()) {
        el.innerHTML = `<div class="acct">
            <span class="avatar"><svg><use href="#i-lock"/></svg></span>
            <div class="acct-info"><strong>ഈ കമ്പ്യൂട്ടറിലെ ഉടമ</strong><small>ലോക്കൽ മോഡ് — മാറ്റങ്ങൾ ഈ ബ്രൗസറിൽ മാത്രം</small></div>
            <span class="role-badge role-local">ഉടമ</span>
          </div>
          <div class="acct-actions"><button class="btn ghost sm" data-menu="lock"><svg><use href="#i-lock"/></svg><span>ലോക്ക് ചെയ്യുക</span></button></div>`;
      } else if (LocalOwner.allowed) {
        el.innerHTML = loginBtn('ലോക്കൽ മോഡ്: തിരുത്താനും ഡാറ്റ കൈകാര്യം ചെയ്യാനും ഉടമയുടെ പാസ്‌കോഡ് നൽകുക.');
      } else {
        el.innerHTML = loginBtn('വായനയ്ക്ക് മാത്രം. ലോഗിൻ ഇതുവരെ സജ്ജമാക്കിയിട്ടില്ല.');
      }
      return;
    }
    if (cloudStatus === 'connecting') { el.innerHTML = '<div class="acct-note"><span class="spin"></span><small>ബന്ധിപ്പിക്കുന്നു…</small></div>'; return; }
    if (cloudStatus === 'offline') { el.innerHTML = '<div class="acct-note"><svg><use href="#i-lock"/></svg><div><strong>ഓഫ്‌ലൈൻ</strong><small>വായിക്കാം; ലോഗിനും തിരുത്തലിനും ഇന്റർനെറ്റ് വേണം</small></div></div>'; return; }
    const u = Cloud.user;
    if (!u) {
      el.innerHTML = loginBtn('ഹൈലൈറ്റുകൾ എല്ലാ ഉപകരണങ്ങളിലും ലഭിക്കാനും, അനുമതിയുണ്ടെങ്കിൽ തിരുത്താനും.');
      return;
    }
    const initial = esc(((u.name || u.email || '?').trim()[0] || '?').toUpperCase());
    // also GitHub / Microsoft accounts, which Firebase often reports as unverified
    const unverified = !u.verified && !!u.email;
    const passkey = Cloud.PROVIDERS && Cloud.PROVIDERS.passkey && !Cloud.blocked && Cloud.passkeySupported && Cloud.passkeySupported();
    // an access code from an admin can make a reader / editor an editor / admin (admins need none)
    const redeem = !!AuthUI && (Cloud.role === 'reader' || Cloud.role === 'editor');
    el.innerHTML = `<div class="acct">
        <span class="avatar">${initial}</span>
        <div class="acct-info"><strong>${esc(u.name || (u.email || '').split('@')[0] || 'ഉപയോക്താവ്')}</strong><small>${esc(u.email || '')}</small></div>
        <span class="role-badge role-${esc(Cloud.role)}">${ROLE_LABEL[Cloud.role] || ''}</span>
      </div>
      ${Cloud.blocked ? '<div class="acct-blocked">ഈ അക്കൗണ്ട് അഡ്മിൻ തടഞ്ഞിരിക്കുന്നു — വായിക്കാം, പക്ഷേ തിരുത്താനോ സിങ്ക് ചെയ്യാനോ കഴിയില്ല.</div>' : ''}
      ${unverified ? `<div class="acct-verify">ഇമെയിൽ സ്ഥിരീകരിച്ചിട്ടില്ല. ക്ഷണിച്ച റോൾ ലഭിക്കാൻ ഇമെയിലിലെ ലിങ്ക് തുറക്കുക.${AuthUI ? ` <small>${esc(AuthUI.mailHint())}</small>` : ''}
        <div><button class="btn sm" data-menu="verifyResend">ലിങ്ക് വീണ്ടും അയയ്ക്കുക</button> <button class="btn sm" data-menu="verifyCheck">സ്ഥിരീകരിച്ചു</button></div></div>` : ''}
      <div class="acct-actions">
        <button class="btn ghost sm acct-logout" data-menu="logout"><svg><use href="#i-logout"/></svg><span>ലോഗൗട്ട്</span></button>
        ${passkey ? '<button class="btn ghost sm" data-menu="addPasskey"><svg><use href="#i-key"/></svg><span>പാസ്‌കീ ചേർക്കുക</span></button>' : ''}
        ${redeem ? '<button class="btn ghost sm" data-menu="redeem"><svg><use href="#i-ticket"/></svg><span>കോഡ് നൽകുക</span></button>' : ''}
      </div>`;
  }

  // ---- login screen (js/auth-ui.js, shared with the admin portal) ----
  if (AuthUI) AuthUI.configure({ show: (d) => openDialog(d), notify: (msg, ms) => toast(msg, ms || 4500) });
  function openLogin(mode) {
    if (!AuthUI) return;
    AuthUI.open({ mode: mode || 'signin' });
  }

  async function addPasskey() {
    if (!cloudMode || !Cloud.user) { openLogin('signin'); return; }
    const guess = /android/i.test(navigator.userAgent) ? 'Android' : /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone / iPad'
      : /mac/i.test(navigator.platform) ? 'Mac' : /win/i.test(navigator.platform) ? 'Windows' : 'ഈ ഉപകരണം';
    try {
      await Cloud.registerPasskey(guess);
      toast('പാസ്‌കീ ചേർത്തു — അടുത്ത തവണ "പാസ്‌കീ ഉപയോഗിച്ച് ലോഗിൻ" ഉപയോഗിക്കാം', 5000);
    } catch (err) {
      if (err && err.code === 'passkey/cancelled') return;
      toast(authMessage(err), 5000);
    }
  }

  // the administrator portal is a separate page (admin.html) with the same login
  function openAdminPortal() {
    const go = () => { location.href = 'admin.html' + (Cloud.emulator ? '?emulator' : ''); };
    // opened from the drawer: its history entry is removed with history.back(), which would cancel a navigation started now
    if (historyBusy()) hist.queue.push(go); else go();
  }

  // deep links: ?open=upload | edit | login | admin (checked against the same permissions)
  let pendingOpen = new URLSearchParams(location.search).get('open');
  function runPendingOpen() {
    if (!pendingOpen) return;
    const a = pendingOpen;
    pendingOpen = null;
    const search = location.search.replace(/([?&])open=[^&]*&?/, '$1').replace(/[?&]$/, '');
    history.replaceState(history.state, '', location.pathname + search + location.hash);
    if (a === 'login') { if (!(cloudMode && Cloud.user) && !LocalOwner.isUnlocked()) openLogin('signin'); return; }
    if (['upload', 'edit', 'admin'].includes(a)) menuAction(a);
  }

  // local owner unlocked / locked (possibly in another tab)
  LocalOwner.on(() => {
    if (cloudMode) return;
    applyPermissions();
    renderAccount();
    enforcePermissions();
    if (cur.book && !selection.size) rerenderKeep(); else if (!cur.book) render();
  });

  // ---- personal data sync ----
  // Three-way merge: this device's copy, the cloud copy, and syncBase = the last copy both agreed on.
  // Only entries that changed are written (per key), so nothing made on another device — or in the
  // second before a snapshot arrives — is overwritten. Data on the device belongs to one account
  // (userOwner); it is cleared on logout so the next person never inherits it.
  const DATA_KEYS = ['hl', 'bm', 'notes'];
  const itemTime = (v) => (typeof v === 'number' ? v : (v && v.t) || 0);
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const emptyData = () => ({ hl: {}, bm: {}, notes: {} });
  let syncBase = null;       // null = not syncing (signed out)
  let syncUid = null;
  const baseKey = (uid) => 'syncBase.' + uid;

  function localDiff() {
    const diff = {};
    let n = 0;
    for (const k of DATA_KEYS) {
      const b = syncBase[k] || {};
      for (const key of new Set([...Object.keys(user[k]), ...Object.keys(b)])) {
        if (same(user[k][key], b[key])) continue;
        (diff[k] = diff[k] || {})[key] = user[k][key] === undefined ? null : clone(user[k][key]);
        n++;
      }
    }
    return n ? diff : null;
  }

  async function flushUserData() {
    if (!cloudMode || !Cloud.user || !syncBase || syncUid !== Cloud.user.uid) return;
    const diff = localDiff();
    if (!diff) return;
    const uid = syncUid;
    try {
      await Cloud.patchUserData(diff);
      if (syncUid !== uid || !syncBase) return;
      for (const k of Object.keys(diff)) {
        syncBase[k] = syncBase[k] || {};
        for (const key of Object.keys(diff[k])) {
          if (diff[k][key] === null) delete syncBase[k][key]; else syncBase[k][key] = diff[k][key];
        }
      }
      LS.set(baseKey(uid), syncBase);
    } catch (err) { cloudError(err); }
  }

  // apply the cloud copy; returns true if anything visible changed
  function applyRemote(remote) {
    if (!syncBase) return false;
    let changed = false;
    for (const k of DATA_KEYS) {
      const r = (remote && remote[k]) || {};
      const b = syncBase[k] || {};
      for (const key of new Set([...Object.keys(r), ...Object.keys(b)])) {
        if (same(r[key], b[key])) continue;                 // the cloud did not change this entry
        const lv = user[k][key], rv = r[key];
        if (!same(lv, b[key])) {
          // changed on both sides: keep the newer; an edit beats a deletion
          const takeRemote = lv === undefined ? rv !== undefined : rv !== undefined && itemTime(rv) > itemTime(lv);
          if (!takeRemote) continue;
        }
        if (same(lv, rv)) continue;
        if (rv === undefined) delete user[k][key]; else user[k][key] = clone(rv);
        changed = true;
      }
      syncBase[k] = clone(r);
    }
    LS.set(baseKey(syncUid), syncBase);
    LS.set('user', user);
    return changed;
  }

  function clearPersonalData() {
    DATA_KEYS.forEach((k) => { user[k] = {}; });
    LS.set('user', user);
  }

  let authSeen = false;
  async function onAuthChanged() {
    if (cloudStatus !== 'ready') cloudStatus = 'ready';
    applyPermissions();
    renderAccount();
    enforcePermissions();
    if (!authSeen) { authSeen = true; runPendingOpen(); }
    const u = Cloud.user;
    if (u && Cloud.blocked) {
      // blocked: keep what is on this device, but don't sync it
      syncBase = null; syncUid = null;
      if (cur.book && !selection.size) rerenderKeep();
      return;
    }
    if (!u) {
      // signed out: personal data on this device belonged to that account
      // (another tab may already have handled the logout and reset userOwner, so also
      // clear if this tab was syncing an account)
      const owner = LS.get('userOwner', null) || syncUid;
      if (owner) {
        clearPersonalData();
        try { localStorage.removeItem('mlb.' + baseKey(owner)); } catch (e) { /* ignore */ }
        LS.set('userOwner', null);
      }
      syncBase = null; syncUid = null;
      updateCounts();
      if (cur.book) rerenderKeep();
      return;
    }
    const owner = LS.get('userOwner', null);
    if (owner && owner !== u.uid) clearPersonalData();      // another account's data: never merge it
    // the stored base is only valid if this device's data already belongs to this account
    syncBase = owner === u.uid ? LS.get(baseKey(u.uid), emptyData()) : emptyData();
    syncUid = u.uid;
    LS.set('userOwner', u.uid);
    try {
      const remote = await Cloud.loadUserData();
      if (syncUid !== u.uid) return;
      applyRemote(remote || {});
      await flushUserData();                                  // upload entries made on this device
    } catch (err) { if (syncUid === u.uid) console.warn(err); }   // (not after a sign-out that raced this load)
    updateCounts();
    if (cur.book) rerenderKeep();
  }

  function applyCloudUserData(data) {
    if (!syncBase || !Cloud.user || syncUid !== Cloud.user.uid) return;
    const changed = applyRemote(data || {});
    pushUserData();
    if (changed) { if (!selection.size) rerenderKeep(); updateCounts(); }
  }

  // keep open tabs of this browser in step: another tab changed (or cleared) personal data,
  // or (local mode) chapter edits — e.g. a chapter reverted in the admin portal
  window.addEventListener('storage', (e) => {
    if (e.key === 'mlb.overlay' && !cloudMode) {
      overlay = LS.get('overlay', { books: {} });
      buildLibrary();
      if (cur.book && bookMap.get(cur.book) && bookMap.get(cur.book).chapters.has(cur.chapter)) { if (!selection.size && !$('dialog[open]')) rerenderKeep(); }
      else if (!$('dialog[open]')) startAtFirst();
      return;
    }
    if (e.key !== 'mlb.user') return;
    const fresh = LS.get('user', {});
    DATA_KEYS.forEach((k) => { user[k] = (fresh && fresh[k]) || {}; });
    updateCounts();
    if (cur.book && !selection.size) rerenderKeep();
  });

  function onRoleChanged() {
    applyPermissions();
    renderAccount();
    enforcePermissions();
    if (Cloud.blocked) { syncBase = null; syncUid = null; }
    else if (Cloud.user && syncUid !== Cloud.user.uid) onAuthChanged();   // unblocked: start syncing again
    if (cur.book && !selection.size) rerenderKeep();
    toast('നിങ്ങളുടെ റോൾ: ' + (ROLE_LABEL[Cloud.role] || Cloud.role));
  }

  // an admin opened / closed PDF upload or chapter editing to everyone (settings/permissions)
  let openSeen = null;
  function onSettingsChanged() {
    const now = JSON.stringify([can('upload'), can('edit')]);
    if (now === openSeen) return;
    openSeen = now;
    applyPermissions();
    const closed = enforcePermissions();
    if (cur.book && !selection.size) rerenderKeep(); else if (!cur.book) render();
    if (closed) toast('അഡ്മിൻ ഈ അനുമതി പിൻവലിച്ചു — മാറ്റം സേവ് ചെയ്തില്ല', 4500);
  }

  function onCloudChapters(docs) {
    if (cloudStatus !== 'ready') { cloudStatus = 'ready'; renderAccount(); }
    cloudDocs = new Set(docs.map((d) => `${d.book}_${d.chapter}`));
    const cur0 = cur.book && bookMap.get(cur.book) ? JSON.stringify(bookMap.get(cur.book).chapters.get(cur.chapter) || null) : null;
    overlay = overlayFromDocs(docs);
    LS.set('cloudOverlay', overlay);
    buildLibrary();
    // a link to a chapter that exists only online (e.g. an uploaded book) can open now
    if (pendingLink) {
      const pl = pendingLink;
      pendingLink = null;
      if (bookMap.get(pl.b) && bookMap.get(pl.b).chapters.has(pl.c)) { go(pl.b, pl.c, pl.v ? { verse: pl.v } : undefined); return; }
    }
    const b = cur.book && bookMap.get(cur.book);
    if (!b || !b.chapters.has(cur.chapter)) { if (!$('dialog[open]')) startAtFirst(); return; }
    const cur1 = JSON.stringify(b.chapters.get(cur.chapter));
    if (cur1 !== cur0 && !(editor.dirty && $('#dlgEditor').open)) rerenderKeep();
    if ($('#dlgPicker').open) renderPicker(picker.tab);
  }

  if (cloudMode) {
    Cloud.on((type, data) => {
      if (type === 'chapters') onCloudChapters(data);
      else if (type === 'auth') onAuthChanged();
      else if (type === 'role') onRoleChanged();
      else if (type === 'settings') onSettingsChanged();
      else if (type === 'verified') toast('ഇമെയിൽ സ്ഥിരീകരിച്ചു', 4000);
      else if (type === 'userdata') applyCloudUserData(data);
      else if (type === 'error') cloudError(data);
    });
  }

  // ---------- offline indicator ----------
  // everything the reader does works offline; shared edits and the usage log go up once online
  const showNet = () => { $('#netPill').hidden = navigator.onLine !== false; };
  window.addEventListener('online', () => { showNet(); if (cloudMode) toast('വീണ്ടും ഓൺലൈൻ — മാറ്റങ്ങൾ സിങ്ക് ചെയ്യുന്നു'); });
  window.addEventListener('offline', () => { showNet(); toast('ഇന്റർനെറ്റ് ഇല്ല — ആപ്പ് തുടർന്നും പ്രവർത്തിക്കും', 3500); });
  showNet();
  $('#usageNote').hidden = !Usage.enabled;

  // ---------- install as app + offline ----------
  let installEvt = null;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvt = e;
    $('#menuInstall').hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    installEvt = null;
    $('#menuInstall').hidden = true;
    toast('ആപ്പ് ഇൻസ്റ്റാൾ ചെയ്തു — ഹോം സ്ക്രീനിൽ നോക്കുക');
  });
  if (isIOS && !isStandalone && /^https?:/.test(location.protocol)) $('#menuInstall').hidden = false;
  async function installApp() {
    if (installEvt) {
      installEvt.prompt();
      const choice = await installEvt.userChoice.catch(() => null);
      if (choice && choice.outcome === 'accepted') $('#menuInstall').hidden = true;
      installEvt = null;
    } else if (isIOS) {
      await confirmBox('ഹോം സ്ക്രീനിൽ ചേർക്കുക', 'Safari-യിൽ താഴെയുള്ള "Share" ബട്ടൺ (⬆︎) അമർത്തി "Add to Home Screen" തിരഞ്ഞെടുക്കുക.', 'ശരി');
    } else {
      toast('ബ്രൗസർ മെനുവിൽ (⋮) "Install app" / "Add to Home screen" തിരഞ്ഞെടുക്കുക', 5000);
    }
  }
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
    // sw.js has newer files / Bible text in its cache (e.g. a new book): offer to reload, once,
    // and not over an open dialog (the next launch shows the new version anyway)
    let updateOffered = false;
    navigator.serviceWorker.addEventListener('message', async (e) => {
      if (!e.data || e.data.type !== 'content-updated' || updateOffered || $('dialog[open]')) return;
      updateOffered = true;
      if (await confirmBox('പുതിയ പതിപ്പ്', 'പുതിയ ഉള്ളടക്കം ലഭ്യമാണ്. ഇപ്പോൾ പുതുക്കണോ?', 'പുതുക്കുക')) location.reload();
    });
  }

  // ---------- boot ----------
  // dialogs use history entries; the browser's own scroll restoration would undo verse jumps
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  let pendingLink = null;
  // a reload keeps the history entry of a dialog that was open; it isn't open any more
  if (history.state && history.state.dlg) history.replaceState(null, '', location.href);
  buildLibrary();
  applySettings();
  updateCounts();
  const fromHash = parseHash();
  if (cloudMode && fromHash && !(bookMap.get(fromHash.b) && bookMap.get(fromHash.b).chapters.has(fromHash.c))) pendingLink = fromHash;
  const last = settings.last;
  if (fromHash && bookMap.get(fromHash.b) && bookMap.get(fromHash.b).chapters.has(fromHash.c)) {
    go(fromHash.b, fromHash.c, fromHash.v ? { verse: fromHash.v } : undefined);
  } else if (last && bookMap.get(last.b) && bookMap.get(last.b).chapters.has(last.c)) {
    go(last.b, last.c);
    const s = settings.lastScroll;
    if (s && s.b === last.b && s.c === last.c) requestAnimationFrame(() => window.scrollTo(0, s.y));
  } else {
    startAtFirst();
  }
  applyPermissions();
  renderAccount();
  if (!cloudMode) runPendingOpen();
  if (cloudMode) {
    Cloud.init()
      .then(() => { cloudStatus = 'ready'; renderAccount(); })
      .catch((err) => { console.warn('cloud init failed', err); cloudStatus = 'offline'; renderAccount(); });
  }
})();
