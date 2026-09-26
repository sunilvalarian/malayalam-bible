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
  let overlay = LS.get('overlay', { books: {} });
  const user = Object.assign({ hl: {}, bm: {}, notes: {} }, LS.get('user', {}));
  const settings = Object.assign({
    fontSize: 20, lineHeight: 1.9, font: 'noto-serif', theme: 'light', layout: 'para',
    numbers: true, headings: true, last: null, recent: [], history: [], whole: false, scope: 'all',
  }, LS.get('settings', {}));
  const saveUser = () => LS.set('user', user);
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

  function saveOverlay() { return LS.set('overlay', overlay); }

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
      return { id: b.id, keys: [b.name, cat.name, cat.en, b.id, ...(cat.aliases || [])].filter(Boolean).map(squash) };
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
      reader.innerHTML = `<div class="empty"><p>ഉള്ളടക്കം ഒന്നുമില്ല.</p><p><button class="btn primary" data-menu-open="upload">PDF അപ്‌ലോഡ് ചെയ്യുക</button></p></div>`;
      $('#refLabel').textContent = 'ബൈബിൾ';
      $('#btnPrev').disabled = $('#btnNext').disabled = true;
      return;
    }
    const nb = neighbours();
    const badge = b.changed.has(cur.chapter) ? `<span class="ch-badge">${b.base.has(cur.chapter) ? 'തിരുത്തിയത്' : 'അപ്‌ലോഡ് ചെയ്തത്'}</span>` : '';
    const foot = `<div class="ch-foot">
      ${nb.prev ? `<button class="btn ghost" data-go="${nb.prev.b}/${nb.prev.c}"><svg><use href="#i-left"/></svg>${esc(bookName(nb.prev.b))} ${nb.prev.c}</button>` : '<span></span>'}
      ${nb.next ? `<button class="btn ghost" data-go="${nb.next.b}/${nb.next.c}">${esc(bookName(nb.next.b))} ${nb.next.c}<svg><use href="#i-right"/></svg></button>` : '<span></span>'}
    </div>`;
    reader.innerHTML = `<header class="ch-title"><small>${esc(b.name)}</small><span>അധ്യായം ${cur.chapter}</span>${badge}</header>` +
      renderItems(items, { book: cur.book, chapter: cur.chapter }) + foot;
    $('#refLabel').textContent = `${b.name} ${cur.chapter}`;
    document.title = `${b.name} ${cur.chapter} · മലയാളം ബൈബിൾ`;
    $('#btnPrev').disabled = !nb.prev;
    $('#btnNext').disabled = !nb.next;
    const h = `#/${cur.book}/${cur.chapter}` + (opts.verse ? '/' + opts.verse : '');
    if (location.hash !== h) history.replaceState(null, '', h);
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
    const changed = cur.book !== b || cur.chapter !== c;
    cur.book = b; cur.chapter = c;
    if (changed || !opts || !opts.verse) render(opts);
    else scrollToVerse(opts.verse, opts.verseEnd, true);
    settings.last = { b, c };
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
  });

  $('#btnSelClose').addEventListener('click', clearSelection);

  $('#actionbar').addEventListener('click', async (e) => {
    const sw = e.target.closest('.swatch');
    if (sw) {
      const color = sw.dataset.color;
      for (const v of selection) {
        const k = vkey(cur.book, cur.chapter, v);
        if (color) user.hl[k] = { c: color, t: Date.now() }; else delete user.hl[k];
      }
      saveUser();
      rerenderKeep();
      return;
    }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
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
      saveUser();
      toast(all ? 'ബുക്ക്മാർക്ക് നീക്കി' : 'ബുക്ക്മാർക്ക് ചെയ്തു');
      rerenderKeep();
    } else if (act === 'note') {
      const vs = [...selection].sort((a, b) => a - b);
      const existing = vs.map((v) => noteFor(cur.book, cur.chapter, v)).find(Boolean);
      openNote(existing || vkey(cur.book, cur.chapter, vs[0]), vs);
    } else if (act === 'edit') {
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
    saveUser();
    toast(text ? 'കുറിപ്പ് സേവ് ചെയ്തു' : 'കുറിപ്പ് നീക്കി');
    rerenderKeep();
  });
  $('#noteDelete').addEventListener('click', () => {
    if (noteCtx) delete user.notes[noteCtx.key];
    saveUser();
    $('#dlgNote').close('deleted');
    toast('കുറിപ്പ് നീക്കി');
    rerenderKeep();
  });

  // ---------- dialogs ----------
  function openDialog(d) {
    if (!d.open) d.showModal();
  }
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
  function openPicker(tab) {
    picker.book = cur.book;
    picker.chapter = cur.chapter;
    $('#gotoInput').value = '';
    openDialog($('#dlgPicker'));
    renderPicker(tab || 'chapters');
  }
  function renderPicker(tab) {
    picker.tab = tab;
    $$('#dlgPicker [data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
    const body = $('#pickerBody');
    const b = bookMap.get(picker.book);
    if (tab === 'books') {
      const groups = { OT: [], NT: [], X: [] };
      books.forEach((bk) => groups[(catById.get(bk.id) || {}).testament || 'X'].push(bk));
      const label = { OT: 'പഴയ നിയമം', NT: 'പുതിയ നിയമം', X: 'മറ്റുള്ളവ' };
      body.innerHTML = Object.entries(groups).filter(([, l]) => l.length).map(([g, l]) => `
        <div class="book-group"><h4>${label[g]}</h4><div class="book-list">
          ${l.map((bk) => `<button class="book-item${bk.id === cur.book ? ' cur' : ''}" data-book="${bk.id}"><span>${esc(bk.name)}</span><small>${bk.nums.length}</small></button>`).join('')}
        </div></div>`).join('') || '<p class="empty-state">പുസ്തകങ്ങൾ ഇല്ല</p>';
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
    if (bk) { picker.book = bk.dataset.book; picker.chapter = bookMap.get(picker.book).nums[0]; renderPicker('chapters'); return; }
    const ch = e.target.closest('[data-ch]');
    if (ch && !ch.disabled) { picker.chapter = +ch.dataset.ch; go(picker.book, picker.chapter); $('#dlgPicker').close(); return; }
    const vs = e.target.closest('[data-verse]');
    if (vs && !vs.disabled) { go(picker.book, picker.chapter, { verse: +vs.dataset.verse }); $('#dlgPicker').close(); }
  });
  $('#gotoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const r = parseRef($('#gotoInput').value);
    if (r && goRef(r)) $('#dlgPicker').close();
    else toast('റഫറൻസ് കണ്ടെത്താനായില്ല (ഉദാ: 3:15, ഉത്പ 12:1)');
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
  }

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
  const changeSetting = (k, v) => { settings[k] = v; saveSettings(); applySettings(); };
  $('#dlgSettings').addEventListener('click', (e) => {
    const f = e.target.closest('[data-font]');
    if (f) changeSetting('fontSize', Math.min(34, Math.max(14, settings.fontSize + +f.dataset.font)));
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
    const items = bookMap.get(cur.book).chapters.get(cur.chapter);
    verseEditCtx = { book: cur.book, chapter: cur.chapter, v };
    $('#verseEditTitle').textContent = 'തിരുത്തുക · ' + refText(cur.book, cur.chapter, [v]);
    $('#verseEditText').value = items.filter((it) => it.v === v).map((it) => it.t).join('\n');
    openDialog($('#dlgVerseEdit'));
    setTimeout(() => $('#verseEditText').focus(), 50);
  }
  $('#dlgVerseEdit').addEventListener('close', () => {
    if ($('#dlgVerseEdit').returnValue !== 'save' || !verseEditCtx) return;
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
    if (saveOverlay()) { buildLibrary(); rerenderKeep(); toast('വാക്യം സേവ് ചെയ്തു'); }
  });
  $('#verseEditFull').addEventListener('click', () => { $('#dlgVerseEdit').close('full'); openEditor(cur.book, cur.chapter); });

  // ---------- chapter editor ----------
  const editor = { book: null, chapter: null, original: '', dirty: false };
  const editorDirty = () => editor.dirty && $('#edText').value !== editor.original;

  function openEditor(bookId, ch) {
    const b = bookMap.get(bookId);
    if (!b || !b.chapters.has(ch)) { toast('തിരുത്താൻ ഒരു അധ്യായം തുറക്കുക'); return; }
    clearSelection();
    Object.assign(editor, { book: bookId, chapter: ch, dirty: false });
    editor.original = P.toEditorText(b.chapters.get(ch));
    $('#edText').value = editor.original;
    $('#editorTitle').textContent = `തിരുത്തുക · ${b.name} ${ch}`;
    $('#edRestore').hidden = !(b.base.has(ch) && b.changed.has(ch));
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
    const items = updateEditorPreview();
    if (!items.some((it) => it.v)) { toast('വാക്യങ്ങൾ ഒന്നുമില്ല — സേവ് ചെയ്തില്ല'); return; }
    setChapter(editor.book, editor.chapter, items);
    if (!saveOverlay()) return;
    buildLibrary();
    editor.dirty = false;
    $('#dlgEditor').close();
    if (cur.book === editor.book && cur.chapter === editor.chapter) rerenderKeep();
    toast('അധ്യായം സേവ് ചെയ്തു');
  });
  $('#edRestore').addEventListener('click', async () => {
    if (!(await confirmBox('യഥാർത്ഥ പാഠം', 'ഈ അധ്യായത്തിലെ എല്ലാ തിരുത്തലുകളും മായ്ച്ച് PDF-ൽ നിന്നുള്ള പാഠം തിരികെ കൊണ്ടുവരണോ?', 'പുനഃസ്ഥാപിക്കുക'))) return;
    const ob = overlay.books[editor.book];
    if (ob) { delete ob.chapters[editor.chapter]; if (!Object.keys(ob.chapters).length && !ob.name) delete overlay.books[editor.book]; }
    saveOverlay(); buildLibrary();
    editor.dirty = false;
    $('#dlgEditor').close();
    rerenderKeep();
    toast('യഥാർത്ഥ പാഠം പുനഃസ്ഥാപിച്ചു');
  });
  $('#edDelete').addEventListener('click', async () => {
    const name = `${bookName(editor.book)} ${editor.chapter}`;
    if (!(await confirmBox('അധ്യായം നീക്കുക', `${name} ലൈബ്രറിയിൽ നിന്ന് നീക്കണോ?`, 'നീക്കുക'))) return;
    const nb = neighbours();
    deleteChapter(editor.book, editor.chapter);
    saveOverlay(); buildLibrary();
    editor.dirty = false;
    $('#dlgEditor').close();
    const target = (nb.next && bookMap.get(nb.next.b)) ? nb.next : nb.prev;
    if (target && bookMap.get(target.b) && bookMap.get(target.b).chapters.has(target.c)) go(target.b, target.c);
    else startAtFirst();
    toast(`${name} നീക്കി`);
  });

  // ---------- upload ----------
  const uploads = [];
  function bookOptions(selected) {
    const known = new Set(CAT.map((b) => b.id));
    const extra = books.filter((b) => !known.has(b.id));
    const opt = (id, name) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${esc(name)}</option>`;
    return `<optgroup label="പഴയ നിയമം">${CAT.filter((b) => b.testament === 'OT').map((b) => opt(b.id, b.name)).join('')}</optgroup>
      <optgroup label="പുതിയ നിയമം">${CAT.filter((b) => b.testament === 'NT').map((b) => opt(b.id, b.name)).join('')}</optgroup>
      ${extra.length ? `<optgroup label="മറ്റുള്ളവ">${extra.map((b) => opt(b.id, b.name)).join('')}</optgroup>` : ''}
      <option value="__new">+ പുതിയ പുസ്തകം…</option>`;
  }
  function openUpload() {
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

  async function handleFiles(files) {
    const list = [...files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!list.length) { toast('PDF ഫയലുകൾ മാത്രം'); return; }
    const defBook = $('#upBook').value;
    for (const f of list) uploads.push({ file: f, status: 'processing', results: [], error: null, defBook });
    renderUploads();
    for (const u of uploads.filter((x) => x.status === 'processing')) {
      try {
        const ex = await window.PdfExtract.extract(await u.file.arrayBuffer());
        const flat = ex.pages.flat().map((p) => p.text).join(' ');
        if (!/[ഀ-ൿ]/.test(flat)) throw new Error(flat.trim() ? 'മലയാളം ടെക്സ്റ്റ് കണ്ടെത്തിയില്ല (ഫോണ്ട് എൻകോഡിംഗ് പിന്തുണയ്ക്കുന്നില്ല)' : 'ടെക്സ്റ്റ് ഇല്ല — സ്കാൻ ചെയ്ത (ചിത്ര) PDF ആകാം');
        const lex = new Map(getLexicon());
        ex.pages.flat().forEach((p) => P.addToLexicon(lex, P.normalize(p.text)));
        const hint = P.chapterFromFilename(u.file.name);
        // only the target book's name counts as a chapter header ("ഉത്പത്തി 3"); other
        // catalog names double as people's names (യാക്കോബ്) and would split chapters wrongly
        const res = P.parsePdfParagraphs(ex.pages, { chapter: hint, bookNames: [bookName(u.defBook)], lexicon: lex });
        const detected = res.bookTitle ? findBook(res.bookTitle, CAT) || findBook(res.bookTitle) : null;
        const garbled = !ex.actualText && (flat.match(/(^|\s)[െേൈ]/g) || []).length > 20;
        u.results = res.chapters.map((c, i) => ({
          chapter: c.chapter || (hint && i === 0 ? hint : null),
          items: c.items, warnings: c.warnings.concat(garbled ? ['അക്ഷരക്രമം തെറ്റായിരിക്കാം — പ്രിവ്യൂ പരിശോധിക്കുക'] : []),
          book: detected || u.defBook, include: true, preview: false,
        }));
        if (!u.results.length) throw new Error('വാക്യങ്ങൾ കണ്ടെത്തിയില്ല');
        u.status = 'ok';
      } catch (err) {
        u.status = 'error';
        u.error = err.message || String(err);
      }
      renderUploads();
    }
  }

  function renderUploads() {
    const list = $('#upList');
    list.innerHTML = uploads.map((u, ui) => {
      if (u.status === 'processing') return `<div class="up-item"><div class="up-row"><span class="spin"></span><span class="fname">${esc(u.file.name)}<small>വായിക്കുന്നു…</small></span></div></div>`;
      if (u.status === 'error') return `<div class="up-item"><div class="up-row"><span class="fname">${esc(u.file.name)}<small>${esc(u.error)}</small></span><span class="status err">പിശക്</span><button class="icon-btn sm" data-rm="${ui}" aria-label="നീക്കുക"><svg><use href="#i-x"/></svg></button></div></div>`;
      return u.results.map((r, ri) => {
        const b = bookMap.get(r.book);
        const exists = r.chapter && b && b.chapters.has(r.chapter);
        const vcount = P.verseMap(r.items).size;
        const st = !r.chapter ? '<span class="status err">അധ്യായ നമ്പർ നൽകുക</span>'
          : exists ? '<span class="status warn">നിലവിലുള്ളത് മാറ്റിസ്ഥാപിക്കും</span>' : '<span class="status ok">പുതിയത്</span>';
        return `<div class="up-item" data-u="${ui}" data-r="${ri}">
          <div class="up-row">
            <input type="checkbox" class="up-inc" ${r.include ? 'checked' : ''} aria-label="ഉൾപ്പെടുത്തുക">
            <span class="fname">${esc(u.file.name)}${u.results.length > 1 ? ` <small>ഭാഗം ${ri + 1}/${u.results.length}</small>` : ''}<small>${vcount} വാക്യങ്ങൾ · ${r.items.filter((x) => x.h).length} തലക്കെട്ടുകൾ</small></span>
            <select class="up-book" aria-label="പുസ്തകം">${bookOptions(r.book)}</select>
            <label>അധ്യായം <input type="number" class="up-ch" min="1" max="200" value="${r.chapter || ''}"></label>
            ${st}
            <button class="btn sm up-prev">${r.preview ? 'പ്രിവ്യൂ മറയ്ക്കുക' : 'പ്രിവ്യൂ'}</button>
          </div>
          ${r.warnings.length ? `<div class="up-warn">⚠ ${esc(r.warnings.join(' · '))}</div>` : ''}
          ${r.preview ? `<div class="up-preview reader">${renderItems(r.items)}</div>` : ''}
        </div>`;
      }).join('');
    }).join('');
    const ready = uploads.some((u) => u.status === 'ok' && u.results.some((r) => r.include && r.chapter));
    $('#upSave').disabled = !ready || uploads.some((u) => u.status === 'processing');
  }
  $('#upList').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { uploads.splice(+rm.dataset.rm, 1); renderUploads(); return; }
    const item = e.target.closest('.up-item[data-u]');
    if (!item) return;
    const r = uploads[+item.dataset.u].results[+item.dataset.r];
    if (e.target.closest('.up-prev')) { r.preview = !r.preview; renderUploads(); }
  });
  $('#upList').addEventListener('change', (e) => {
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
    const chosen = [];
    uploads.forEach((u) => u.status === 'ok' && u.results.forEach((r) => { if (r.include && r.chapter) chosen.push(r); }));
    if (!chosen.length) return;
    chosen.forEach((r) => {
      const name = pendingNames[r.book] || (!bookMap.has(r.book) && catById.has(r.book) ? catById.get(r.book).name : undefined);
      setChapter(r.book, r.chapter, r.items, name);
    });
    if (!saveOverlay()) return;
    buildLibrary();
    uploads.length = 0;
    $('#dlgUpload').close();
    const first = chosen[0];
    go(first.book, first.chapter);
    toast(`${chosen.length} അധ്യായം ചേർത്തു`);
  });

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
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'ml-bible') throw new Error('bad file');
      if (!(await confirmBox('ബാക്കപ്പ് പുനഃസ്ഥാപിക്കുക', 'നിലവിലുള്ള തിരുത്തലുകൾ, ഹൈലൈറ്റുകൾ, കുറിപ്പുകൾ എന്നിവ ബാക്കപ്പിലുള്ളതുകൊണ്ട് മാറ്റിസ്ഥാപിക്കും.', 'പുനഃസ്ഥാപിക്കുക'))) return;
      LS.set('overlay', data.overlay || { books: {} });
      LS.set('user', data.user || {});
      LS.set('settings', data.settings || {});
      location.reload();
    } catch (err) { toast('ഈ ഫയൽ വായിക്കാൻ കഴിഞ്ഞില്ല'); }
  });
  function exportHtmlBook() {
    const b = bookMap.get(cur.book);
    if (!b) return;
    const toc = b.nums.map((n) => `<a href="#c${n}">${n}</a>`).join(' ');
    const body = b.nums.map((n) => `<section id="c${n}"><h2>അധ്യായം ${n}</h2>${renderItems(b.chapters.get(n))}</section>`).join('\n');
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
  async function menuAction(a) {
    const m = $('#dlgMenu');
    if (m.open) m.close();
    if (['bookmarks', 'highlights', 'notes', 'history'].includes(a)) openLibrary(a);
    else if (a === 'upload') openUpload();
    else if (a === 'edit') openEditor(cur.book, cur.chapter);
    else if (a === 'exportHtml') exportHtmlBook();
    else if (a === 'exportData') exportDataJs();
    else if (a === 'backup') exportBackup();
    else if (a === 'restore') $('#restoreInput').click();
    else if (a === 'reset') {
      const n = Object.values(overlay.books).reduce((s, b) => s + Object.keys(b.chapters || {}).length, 0);
      if (!n) { toast('തിരുത്തലുകൾ ഒന്നുമില്ല'); return; }
      if (!(await confirmBox('എല്ലാ തിരുത്തലുകളും മായ്ക്കുക', `${n} അധ്യായങ്ങളിലെ തിരുത്തലുകളും അപ്‌ലോഡുകളും നീക്കം ചെയ്യും. ഹൈലൈറ്റുകളും കുറിപ്പുകളും നിലനിൽക്കും.`, 'മായ്ക്കുക'))) return;
      overlay = { books: {} };
      saveOverlay(); buildLibrary();
      if (!bookMap.has(cur.book) || !bookMap.get(cur.book).chapters.has(cur.chapter)) startAtFirst(); else rerenderKeep();
      toast('തിരുത്തലുകൾ മായ്ച്ചു');
    }
  }
  $('#dlgMenu').addEventListener('click', (e) => { const b = e.target.closest('[data-menu]'); if (b) menuAction(b.dataset.menu); });

  // ---------- top-level controls ----------
  $('#btnMenu').addEventListener('click', () => { updateCounts(); openDialog($('#dlgMenu')); });
  $('#btnRef').addEventListener('click', () => openPicker('chapters'));
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
    else if (e.key.toLowerCase() === 'g' && !e.ctrlKey) { openPicker('chapters'); e.preventDefault(); }
    else if (e.key === 'Escape' && selection.size) clearSelection();
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

  // hide the top bar while scrolling down (more room to read), show on scroll up
  let lastY = 0;
  const saveScroll = debounce(() => { settings.lastScroll = { b: cur.book, c: cur.chapter, y: window.scrollY }; saveSettings(); }, 400);
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    const bar = $('.topbar');
    bar.classList.toggle('scrolled', y > 4);
    if (y > lastY + 8 && y > 120 && !selection.size) { bar.classList.add('hide'); document.body.classList.add('chrome-hidden'); }
    else if (y < lastY - 8 || y < 60) { bar.classList.remove('hide'); document.body.classList.remove('chrome-hidden'); }
    lastY = y;
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

  // ---------- boot ----------
  buildLibrary();
  applySettings();
  updateCounts();
  const fromHash = parseHash();
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
})();
