/* Administrator portal (admin.html). Uses the same login screen and Firebase session as the
 * reader (js/auth-ui.js + js/cloud.js). Every change goes through Firestore, so firestore.rules
 * decide what is allowed — this page only shows the tools.
 * Local mode (no Firebase): needs the local-owner passcode and shows only this browser's edits. */
(function () {
  'use strict';

  const Cloud = window.Cloud;
  const LocalOwner = window.LocalOwner;
  const AuthUI = window.AuthUI;
  const CAT = window.BOOK_CATALOG || [];
  const catById = new Map(CAT.map((b) => [b.id, b]));
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const cloudMode = !!Cloud.available;
  const readerUrl = './' + (Cloud.emulator ? '?emulator' : '');

  const ROLE_LABEL = { admin: 'അഡ്മിൻ', editor: 'എഡിറ്റർ', reader: 'വായനക്കാരൻ', none: 'തടഞ്ഞു' };
  const ACTION_LABEL = {
    edit: 'അധ്യായം തിരുത്തി', 'edit-verse': 'വാക്യം തിരുത്തി', restore: 'യഥാർത്ഥം പുനഃസ്ഥാപിച്ചു', delete: 'അധ്യായം നീക്കി',
    upload: 'PDF അപ്‌ലോഡ് ചെയ്തു', 'reset-all': 'എല്ലാ തിരുത്തലുകളും മായ്ച്ചു', revert: 'അഡ്മിൻ യഥാർത്ഥത്തിലേക്ക് മാറ്റി',
    'code-create': 'ആക്സസ് കോഡ് ഉണ്ടാക്കി', 'code-revoke': 'ആക്സസ് കോഡ് റദ്ദാക്കി', redeem: 'ആക്സസ് കോഡ് ഉപയോഗിച്ചു',
    settings: 'ക്രമീകരണം മാറ്റി', 'ai-translate': 'AI പരിഭാഷ ഉണ്ടാക്കി',
  };
  const EXPIRY = [[1, '1 മണിക്കൂർ'], [24, '24 മണിക്കൂർ'], [168, '7 ദിവസം'], [720, '30 ദിവസം']];
  const PERM_LABEL = {
    edit: 'വാക്യം / അധ്യായം തിരുത്തുക', upload: 'PDF അപ്‌ലോഡ്', restore: 'യഥാർത്ഥ പാഠം / ബാക്കപ്പ് പുനഃസ്ഥാപിക്കുക',
    export: 'data.js, ബാക്കപ്പ്, HTML ഡൗൺലോഡ്', aiView: 'AI പരിഭാഷ കാണുക (Original | AI | രണ്ടും)', aiTranslate: 'AI പരിഭാഷ ഉണ്ടാക്കുക (Claude)', delete: 'അധ്യായം നീക്കുക', reset: 'എല്ലാ തിരുത്തലുകളും മായ്ക്കുക',
    users: 'അഡ്മിൻ പോർട്ടൽ: ഉപയോക്താക്കൾ, റോളുകൾ, ക്ഷണങ്ങൾ, ചരിത്രം, പാസ്‌കീകൾ',
  };
  const SECTIONS = [
    { id: 'dashboard', icon: 'i-grid', title: 'ഡാഷ്‌ബോർഡ്', cloud: true },
    { id: 'usage', icon: 'i-chart', title: 'ഉപയോഗം', cloud: true },
    { id: 'users', icon: 'i-users', title: 'ഉപയോക്താക്കൾ', cloud: true },
    { id: 'invites', icon: 'i-mail', title: 'ക്ഷണങ്ങൾ', cloud: true },
    { id: 'codes', icon: 'i-ticket', title: 'ആക്സസ് കോഡുകൾ', cloud: true },
    { id: 'roles', icon: 'i-shield', title: 'അനുമതികൾ', cloud: true },
    { id: 'settings', icon: 'i-sliders', title: 'ക്രമീകരണങ്ങൾ', cloud: true },
    { id: 'activity', icon: 'i-history', title: 'പ്രവർത്തന ചരിത്രം', cloud: true },
    { id: 'content', icon: 'i-book', title: 'ഉള്ളടക്കം', cloud: true, local: true },
    { id: 'passkeys', icon: 'i-key', title: 'പാസ്‌കീകൾ', cloud: true },
    { id: 'methods', icon: 'i-login', title: 'ലോഗിൻ രീതികൾ', cloud: true },
  ];
  const sections = () => SECTIONS.filter((s) => (cloudMode ? s.cloud : s.local));

  const bookName = (id) => (catById.get(id) || {}).name || id;
  const methodName = (id) => (AuthUI ? AuthUI.methodName(id) : id) || '—';
  const toDate = (t) => (t && t.toDate ? t.toDate() : t ? new Date(t) : null);
  const fmtTime = (t) => {
    const d = toDate(t);
    return d && !isNaN(d) ? d.toLocaleString('ml-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  };
  const tms = (t) => { const d = toDate(t); return d && !isNaN(d) ? +d : 0; };
  const roleOptions = (sel, list) => list.map((r) => `<option value="${r}" ${r === sel ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('');
  const spinner = '<div class="adm-empty"><span class="spin"></span></div>';
  const failMsg = (e) => `<div class="adm-empty">ലോഡ് ചെയ്യാനായില്ല (${esc((e && (e.code || e.message)) || '')})</div>`;

  let toastTimer;
  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 2600);
  }
  function confirmBox(title, text, okLabel) {
    const d = $('#dlgConfirm');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmOk').textContent = okLabel || 'ശരി';
    d.returnValue = '';
    d.showModal();
    return new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'ok'), { once: true }));
  }
  function cloudError(e) {
    const c = (e && e.code) || '';
    console.warn('admin:', c, e && e.message);
    toast(/permission-denied/.test(c) ? 'അനുമതിയില്ല — firestore.rules ഈ മാറ്റം തടഞ്ഞു' : /unavailable|network/.test(c) ? 'നെറ്റ്‌വർക്ക് പ്രശ്നം' : 'പിശക്: ' + (c || (e && e.message) || ''), 4500);
  }

  // ---------- which screen ----------
  let authKnown = !cloudMode;
  let current = null;           // current section id
  AuthUI.configure({ dismissible: false, notify: (m, ms) => toast(m, ms || 4500) });
  $('#authBack').href = readerUrl;

  function showOnly(which) {
    $('#admBoot').hidden = which !== 'boot';
    $('#admDenied').hidden = which !== 'denied';
    $('#admShell').hidden = which !== 'portal';
    if (which !== 'login' && AuthUI.isOpen) AuthUI.close();
  }

  function evaluate() {
    if (cloudMode) {
      if (!authKnown) { showOnly('boot'); return; }
      if (!Cloud.user) { showOnly('login'); if (!AuthUI.isOpen) AuthUI.open({ dismissible: false }); return; }
      if (Cloud.role !== 'admin') { showDenied(); return; }
    } else if (!LocalOwner.isUnlocked()) {
      showOnly('login');
      if (!AuthUI.isOpen) AuthUI.open({ dismissible: false });
      return;
    }
    showPortal();
  }

  function showDenied() {
    const u = Cloud.user;
    $('#admDenied').innerHTML = `<div class="adm-denied-card">
        <svg class="adm-denied-ic"><use href="#i-lock"/></svg>
        <h1>പ്രവേശനമില്ല</h1>
        <p>അഡ്മിനിസ്ട്രേറ്റർ പോർട്ടൽ അഡ്മിൻമാർക്ക് മാത്രം.</p>
        <dl>
          <dt>ഇമെയിൽ</dt><dd>${esc(u.email || '—')}</dd>
          <dt>റോൾ</dt><dd><span class="role-badge role-${esc(Cloud.role)}">${esc(ROLE_LABEL[Cloud.role] || Cloud.role)}</span></dd>
        </dl>
        ${Cloud.blocked ? '' : '<p class="adm-denied-code">അഡ്മിൻ തന്ന ആക്സസ് കോഡ് ഉണ്ടോ? <button class="btn sm" id="deniedCode"><svg><use href="#i-ticket"/></svg><span>കോഡ് നൽകുക</span></button></p>'}
        <div class="adm-denied-actions">
          <button class="btn" id="deniedLogout"><svg><use href="#i-logout"/></svg><span>ലോഗൗട്ട്</span></button>
          <a class="btn primary" href="${esc(readerUrl)}"><svg><use href="#i-left"/></svg><span>വായനയിലേക്ക് മടങ്ങുക</span></a>
        </div>
      </div>`;
    $('#deniedLogout').addEventListener('click', () => Cloud.signOut());
    const code = $('#deniedCode');
    if (code) code.addEventListener('click', () => AuthUI.openRedeem());
    showOnly('denied');
  }

  function showPortal() {
    const list = sections();
    $('#admLinks').innerHTML = list.map((s) => `<a href="#${s.id}" data-sec="${s.id}"><svg><use href="#${s.icon}"/></svg><span>${s.title}</span></a>`).join('')
      + `<a href="${esc(readerUrl)}" class="adm-back"><svg><use href="#i-left"/></svg><span>വായനയിലേക്ക് മടങ്ങുക</span></a>`;
    renderMe();
    const banner = $('#admBanner');
    banner.hidden = cloudMode;
    if (!cloudMode) {
      banner.innerHTML = '<strong>ലോക്കൽ മോഡ്.</strong> ഉപയോക്താക്കൾ, റോളുകൾ, ക്ഷണങ്ങൾ, SSO ലോഗിൻ, പാസ്‌കീകൾ എന്നിവയ്ക്ക് Firebase വേണം (README → Login and permissions). ഇവിടെ ഈ ബ്രൗസറിലെ തിരുത്തലുകൾ മാത്രം കാണിക്കുന്നു.';
    }
    showOnly('portal');
    route(true);
  }

  // offline: the portal shows Firestore's saved copy; changes wait until the connection is back
  const showNet = () => { $('#admOffline').hidden = !cloudMode || navigator.onLine !== false; };
  window.addEventListener('online', () => {
    showNet();
    toast('വീണ്ടും ഓൺലൈൻ');
    if (!$('#admShell').hidden && current) RENDER[current]($('#secBody'), currentArg);
  });
  window.addEventListener('offline', () => { showNet(); toast('ഇന്റർനെറ്റ് ഇല്ല — സൂക്ഷിച്ച പകർപ്പ് കാണിക്കുന്നു', 4000); });
  showNet();

  function renderMe() {
    const me = $('#admMe');
    if (!cloudMode) {
      me.innerHTML = `<div class="adm-me-row"><span class="avatar sm"><svg><use href="#i-lock"/></svg></span>
          <div class="u-info"><strong>ഈ കമ്പ്യൂട്ടറിലെ ഉടമ</strong><small>ലോക്കൽ മോഡ്</small></div></div>
        <button class="btn ghost sm" id="meLock"><svg><use href="#i-lock"/></svg><span>ലോക്ക് ചെയ്യുക</span></button>`;
      $('#meLock').addEventListener('click', () => { LocalOwner.lock(); toast('ലോക്ക് ചെയ്തു'); });
      return;
    }
    const u = Cloud.user;
    me.innerHTML = `<div class="adm-me-row"><span class="avatar sm">${esc(((u.name || u.email || '?')[0] || '?').toUpperCase())}</span>
        <div class="u-info"><strong>${esc(u.name || u.email)}</strong><small>${esc(u.email)} · ${esc(methodName(u.provider))}</small></div></div>
      <button class="btn ghost sm" id="meLogout"><svg><use href="#i-logout"/></svg><span>ലോഗൗട്ട്</span></button>`;
    $('#meLogout').addEventListener('click', async () => { await Cloud.signOut(); toast('ലോഗൗട്ട് ചെയ്തു'); });
  }

  // ---------- routing (#section) ----------
  // #section or #section/argument (e.g. #usage/u:<uid> = one person's usage)
  let currentArg = '';
  function route(force) {
    if ($('#admShell').hidden) return;
    const list = sections();
    const parts = location.hash.replace(/^#/, '').split('/');
    let id = parts[0];
    let arg = decodeURIComponent(parts.slice(1).join('/'));
    if (!list.some((s) => s.id === id)) { id = list[0].id; arg = ''; }
    if (id === current && arg === currentArg && !force) return;
    current = id;
    currentArg = arg;
    if (window.Usage) window.Usage.track('admin', { sec: id });
    const sec = SECTIONS.find((s) => s.id === id);
    $$('#admLinks [data-sec]').forEach((a) => a.setAttribute('aria-current', a.dataset.sec === id ? 'page' : 'false'));
    $('#secTitle').textContent = sec.title;
    $('#secActions').innerHTML = '';
    document.title = sec.title + ' · അഡ്മിനിസ്ട്രേറ്റർ പോർട്ടൽ';
    setMenu(false);
    RENDER[id]($('#secBody'), arg);
    $('#admMain').scrollTop = 0;
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => route(false));

  function setMenu(open) {
    $('.adm-nav').classList.toggle('open', open);
    $('#admMenuBtn').setAttribute('aria-expanded', String(open));
  }
  $('#admMenuBtn').addEventListener('click', () => setMenu(!$('.adm-nav').classList.contains('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('.adm-nav').classList.contains('open')) setMenu(false); });

  // ---------- sections ----------
  const RENDER = {};
  const still = (id) => current === id;     // the user may have moved on while data was loading

  // free plan (50 000 reads a day): what several pages show is read once and reused for a while
  const memo = new Map();   // key → { t, p }
  function cached(key, ttl, fn) {
    const m = memo.get(key);
    if (m && Date.now() - m.t < ttl) return m.p;
    const p = fn();
    memo.set(key, { t: Date.now(), p });
    p.catch(() => memo.delete(key));
    return p;
  }
  // the users section always reads afresh (and so refreshes the copy the other pages use)
  const usersList = (fresh) => { if (fresh) memo.delete('users'); return cached('users', 2 * 60 * 1000, () => Cloud.listUsers()); };
  // usage batches: one load serves every shorter period and the dashboard for 5 minutes
  let usageCache = null;    // { since, batches, cursor, t }
  const USAGE_TTL = 5 * 60 * 1000;
  async function usageFor(since, force) {
    const c = usageCache;
    const oldest = c && c.batches.length ? tms(c.batches[c.batches.length - 1].at) : Infinity;
    // newest first, so a cut-off page is still complete for any period that starts after its oldest batch
    if (!force && c && Date.now() - c.t < USAGE_TTL && c.since <= since && (!c.cursor || oldest <= since || c.since === since)) {
      return { batches: c.batches, cursor: c.since === since ? c.cursor : null };
    }
    const page = await Cloud.listUsage({ since, limit: 500 });
    usageCache = { since, batches: page.items, cursor: page.cursor, t: Date.now() };
    return { batches: page.items, cursor: page.cursor };
  }
  async function usageMore(since) {
    const c = usageCache;
    const page = await Cloud.listUsage({ since, limit: 500, cursor: c.cursor });
    c.batches = c.batches.concat(page.items);
    c.cursor = page.cursor;
    return { batches: c.batches, cursor: c.cursor };
  }

  RENDER.dashboard = async (body) => {
    body.innerHTML = spinner;
    const safe = (p) => p.catch((e) => { console.warn(e); return null; });
    const [users, invites, chapters, passkeys, changes, codes, usage] = await Promise.all([
      safe(usersList()), safe(Cloud.listInvites()), safe(Cloud.listChapters()), safe(Cloud.listAllPasskeys()), safe(Cloud.listChanges({ limit: 10 })),
      safe(Cloud.listAccessCodes()), safe(usageFor(dayStart(1))),
    ]);
    const today = usage ? summarize(flatten(usage.batches, dayStart(1))) : null;
    if (!still('dashboard')) return;
    const byRole = { admin: 0, editor: 0, reader: 0, none: 0 };
    (users || []).forEach((u) => { byRole[u.role] = (byRole[u.role] || 0) + 1; });
    const edited = (chapters || []).filter((c) => !c.deleted && c.hasBase).length;
    const uploaded = (chapters || []).filter((c) => !c.deleted && !c.hasBase).length;
    const hidden = (chapters || []).filter((c) => c.deleted).length;
    const n = (x) => (x == null ? '—' : x);
    const card = (href, label, value, detail) => `<a class="adm-stat" href="#${href}"><span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ''}</a>`;
    body.innerHTML = `<div class="adm-stats">
        ${card('usage', 'ഇന്ന് ആപ്പ് ഉപയോഗിച്ചവർ', n(today && today.people.length), today ? `ലോഗിൻ ${today.signedIn} · സന്ദർശകർ ${today.visitors} · സെഷൻ ${today.sessions} · വായന ${fmtDur(today.readSec)}${today.offline ? ` · ഓഫ്‌ലൈൻ ${today.offline}` : ''}` : '')}
        ${card('users', 'ഉപയോക്താക്കൾ', n(users && users.length), users ? `അഡ്മിൻ ${byRole.admin} · എഡിറ്റർ ${byRole.editor} · വായനക്കാർ ${byRole.reader} · തടഞ്ഞു ${byRole.none}` : '')}
        ${card('invites', 'ക്ഷണങ്ങൾ (ബാക്കി)', n(invites && invites.length), '')}
        ${card('content', 'തിരുത്തിയ അധ്യായങ്ങൾ', n(chapters && chapters.length), chapters ? `തിരുത്ത് ${edited} · അപ്‌ലോഡ് ${uploaded} · മറച്ചത് ${hidden}` : '')}
        ${card('passkeys', 'പാസ്‌കീകൾ', n(passkeys && passkeys.length), '')}
        ${card('codes', 'ആക്സസ് കോഡുകൾ (സജീവം)', n(codes && codes.filter((c) => codeStatus(c) === 'active').length), codes ? `ആകെ ${codes.length} · ഉപയോഗിച്ചത് ${codes.filter((c) => c.used).length}` : '')}
        ${card('settings', 'എല്ലാവർക്കും തുറന്നത്', `<span class="adm-stat-text">${[Cloud.settings.openUpload && 'PDF അപ്‌ലോഡ്', Cloud.settings.openEdit && 'തിരുത്തൽ'].filter(Boolean).join(' · ') || 'ഒന്നുമില്ല'}</span>`, 'ലോഗിൻ ചെയ്ത എല്ലാവർക്കും (ക്രമീകരണങ്ങൾ)')}
      </div>
      <h2 class="adm-h2">അവസാന 10 പ്രവർത്തനങ്ങൾ</h2>
      ${changes ? activityTable(changes.items) : failMsg()}
      <p><a class="btn" href="#activity">മുഴുവൻ ചരിത്രം</a></p>`;
  };

  function activityTable(items) {
    if (!items.length) return '<div class="adm-empty">പ്രവർത്തനങ്ങൾ ഒന്നുമില്ല</div>';
    return `<table class="adm-table"><thead><tr><th>സമയം</th><th>പ്രവർത്തനം</th><th>അധ്യായം / വിവരം</th><th>ആര്</th></tr></thead><tbody>
      ${items.map((c) => `<tr>
        <td data-label="സമയം">${esc(fmtTime(c.at))}</td>
        <td data-label="പ്രവർത്തനം">${esc(ACTION_LABEL[c.action] || c.action)}</td>
        <td data-label="അധ്യായം">${c.book && c.book !== '-' ? `<a href="${esc(readerUrl)}#/${encodeURIComponent(c.book)}/${+c.chapter}">${esc(bookName(c.book))} ${+c.chapter}</a>` : c.detail ? `<span class="adm-wrap">${esc(detailText(c.detail))}</span>` : '—'}</td>
        <td data-label="ആര്">${esc(c.by || '')}</td></tr>`).join('')}
      </tbody></table>`;
  }

  // -- usage: what everyone does in the app (js/usage.js), also what was done offline --
  const EVENT_LABEL = {
    open: 'ആപ്പ് തുറന്നു', read: 'വായിച്ചു', search: 'തിരഞ്ഞു', copy: 'പകർത്തി', share: 'പങ്കിട്ടു',
    highlight: 'ഹൈലൈറ്റ് ചെയ്തു', unhighlight: 'ഹൈലൈറ്റ് നീക്കി', bookmark: 'ബുക്ക്മാർക്ക് ചെയ്തു', unbookmark: 'ബുക്ക്മാർക്ക് നീക്കി',
    note: 'കുറിപ്പ് എഴുതി', 'note-delete': 'കുറിപ്പ് നീക്കി', setting: 'ക്രമീകരണം മാറ്റി', menu: 'മെനു',
    login: 'ലോഗിൻ', logout: 'ലോഗൗട്ട്', 'signed-out': 'ലോഗിൻ അവസാനിച്ചു', role: 'റോൾ മാറി',
    online: 'ഓൺലൈൻ ആയി', offline: 'ഓഫ്‌ലൈൻ ആയി', install: 'ആപ്പ് ഇൻസ്റ്റാൾ ചെയ്തു', error: 'പിശക്', admin: 'പോർട്ടൽ പേജ്',
    edit: ACTION_LABEL.edit, 'edit-verse': ACTION_LABEL['edit-verse'], upload: ACTION_LABEL.upload, restore: ACTION_LABEL.restore, delete: ACTION_LABEL.delete,
    scan: 'ക്യാമറയിൽ സ്കാൻ ചെയ്തു', 'ai-translate': ACTION_LABEL['ai-translate'],
  };
  const MENU_LABEL = {
    bookmarks: 'ബുക്ക്മാർക്കുകൾ', highlights: 'ഹൈലൈറ്റുകൾ', notes: 'കുറിപ്പുകൾ', history: 'വായന ചരിത്രം', aiList: 'AI പരിഭാഷകൾ', upload: 'PDF അപ്‌ലോഡ്', scan: 'ക്യാമറ സ്കാൻ',
    edit: 'അധ്യായം തിരുത്തൽ', exportHtml: 'HTML ഡൗൺലോഡ്', exportData: 'data.js എക്സ്പോർട്ട്', backup: 'ബാക്കപ്പ്', restore: 'ബാക്കപ്പ് പുനഃസ്ഥാപിക്കൽ',
    install: 'ഇൻസ്റ്റാൾ', reset: 'എല്ലാ തിരുത്തലും മായ്ക്കൽ', login: 'ലോഗിൻ', logout: 'ലോഗൗട്ട്', admin: 'അഡ്മിൻ പോർട്ടൽ',
    redeem: 'കോഡ് നൽകൽ', addPasskey: 'പാസ്‌കീ ചേർക്കൽ', lock: 'ലോക്ക്', verifyResend: 'സ്ഥിരീകരണ ലിങ്ക്', verifyCheck: 'സ്ഥിരീകരണം',
  };
  const SETTING_LABEL = { fontSize: 'അക്ഷര വലിപ്പം', lineHeight: 'വരി അകലം', font: 'ഫോണ്ട്', theme: 'തീം', layout: 'ക്രമീകരണം', numbers: 'വാക്യ നമ്പറുകൾ', headings: 'തലക്കെട്ടുകൾ' };
  const SCOPE_LABEL = { all: 'എല്ലാ പുസ്തകങ്ങളും', book: 'ഈ പുസ്തകം', chapter: 'ഈ അധ്യായം' };
  const PERIODS = [[1, 'ഇന്ന്'], [7, 'കഴിഞ്ഞ 7 ദിവസം'], [30, 'കഴിഞ്ഞ 30 ദിവസം'], [90, 'കഴിഞ്ഞ 90 ദിവസം']];
  // midnight `days - 1` days ago (days = 1: today)
  const dayStart = (days) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (days - 1)); return +d; };
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fmtDay = (k) => new Date(k + 'T00:00').toLocaleDateString('ml-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  const fmtSec = (t) => new Date(t).toLocaleString('ml-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtDur = (s) => {
    s = Math.round(s || 0);
    if (s < 60) return `${s} സെ`;
    if (s < 3600) return `${Math.round(s / 60)} മി`;
    return `${Math.floor(s / 3600)} മ ${Math.round((s % 3600) / 60)} മി`;
  };
  const refOf = (e) => (e.b ? `${bookName(e.b)} ${e.c}${e.v ? ':' + e.v : ''}` : '');
  const devLabel = (d) => (d ? [d.model, d.os && d.os + (d.osv ? ' ' + d.osv : ''), d.browser && d.browser + (d.bv ? ' ' + d.bv : '')].filter(Boolean).join(' · ') : '') || '—';
  const placeLabel = (g) => (g ? [g.city, g.region, g.country].filter(Boolean).join(', ') : '');
  const whoKey = (e) => (e.uid ? 'u:' + e.uid : 'd:' + e.device);
  const shortDev = (id) => String(id || '').slice(0, 6);
  function eventDetail(e) {
    const ref = refOf(e);
    switch (e.e) {
      case 'read': return `${ref} · ${fmtDur(e.sec)}`;
      case 'search': return `“${e.q || ''}” · ${e.n < 0 ? 'വാക്യ റഫറൻസ്' : `${e.n} ഫലങ്ങൾ`}${e.scope && e.scope !== 'all' ? ' · ' + (SCOPE_LABEL[e.scope] || e.scope) : ''}${e.whole ? ' · മുഴുവൻ വാക്ക്' : ''}`;
      case 'setting': return `${SETTING_LABEL[e.key] || e.key || ''}: ${e.val}`;
      case 'menu': return MENU_LABEL[e.a] || e.a || '';
      case 'login': return methodName(e.m) + (e.first ? ' · ഈ ഉപകരണത്തിൽ ആദ്യമായി' : '');
      case 'role': return ROLE_LABEL[e.r] || e.r || '';
      case 'error': return `${e.msg || ''}${e.at ? ` (${e.at})` : ''}`;
      case 'admin': return (SECTIONS.find((s) => s.id === e.sec) || {}).title || e.sec || '';
      case 'open': return [e.pg === 'admin' || e.page === 'admin' ? 'പോർട്ടൽ' : 'വായന', e.installed ? 'ഇൻസ്റ്റാൾ ചെയ്ത ആപ്പ്' : 'ബ്രൗസർ', e.ref ? 'വന്നത്: ' + e.ref : ''].filter(Boolean).join(' · ');
      case 'highlight': return ref + (e.col ? ` · ${e.col}` : '');
      case 'note': return ref + (e.len ? ` · ${e.len} അക്ഷരം` : '');
      case 'scan': return `${e.pages || 0} പേജ് · ${e.n || 0} അധ്യായം · ${fmtDur(e.sec)}`;
      default: return ref;
    }
  }
  // batches → events (newest first), each with the account, device and place of its batch
  function flatten(batches, since) {
    const out = [];
    for (const b of batches) {
      for (const ev of b.events || []) {
        if (ev.t < since) continue;
        out.push(Object.assign({}, ev, { uid: b.uid || null, email: b.email || '', name: b.name || '', device: b.device, dev: b.dev || {}, geo: b.geo || null }));
      }
    }
    return out.sort((a, b) => b.t - a.t);
  }
  function summarize(events) {
    const people = new Map(), chapters = new Map(), searches = new Map(), days = new Map();
    const sessions = new Set();
    let readSec = 0, reads = 0, offline = 0, errors = 0;
    for (const e of events) {                                     // newest first
      const key = whoKey(e);
      let p = people.get(key);
      if (!p) {
        p = { key, uid: e.uid, email: e.email, name: e.name, device: e.device, dev: e.dev, geo: e.geo, devices: new Set(), sessions: new Set(), sec: 0, reads: 0, searches: 0, offline: 0, events: 0, last: e.t, first: e.t, installed: false };
        people.set(key, p);
      }
      p.devices.add(e.device);
      p.sessions.add(e.device + e.s);
      p.events++;
      p.first = e.t;
      if (!p.geo && e.geo) p.geo = e.geo;
      if (e.dev && e.dev.installed) p.installed = true;
      sessions.add(e.device + e.s);
      if (!e.net) { offline++; p.offline++; }
      const dk = dayKey(e.t);
      let d = days.get(dk);
      if (!d) { d = { key: dk, people: new Set(), sessions: new Set(), sec: 0, reads: 0, searches: 0, events: 0, offline: 0 }; days.set(dk, d); }
      d.people.add(key); d.sessions.add(e.device + e.s); d.events++;
      if (!e.net) d.offline++;
      if (e.e === 'read') {
        reads++; readSec += e.sec || 0; p.reads++; p.sec += e.sec || 0; d.reads++; d.sec += e.sec || 0;
        const ck = e.b + '|' + e.c;
        const c = chapters.get(ck) || { b: e.b, c: e.c, n: 0, sec: 0, people: new Set() };
        c.n++; c.sec += e.sec || 0; c.people.add(key);
        chapters.set(ck, c);
      } else if (e.e === 'search' && e.q) {
        p.searches++; d.searches++;
        const q = e.q.trim();
        const s = searches.get(q) || { q, n: 0, results: e.n, people: new Set() };
        s.n++; s.people.add(key);
        searches.set(q, s);
      } else if (e.e === 'error') errors++;
    }
    const byNumber = (k) => (a, b) => b[k] - a[k];
    return {
      people: [...people.values()].sort(byNumber('last')),
      chapters: [...chapters.values()].sort((a, b) => b.n - a.n || b.sec - a.sec),
      searches: [...searches.values()].sort(byNumber('n')),
      days: [...days.values()].sort((a, b) => (a.key < b.key ? 1 : -1)),
      sessions: sessions.size, readSec, reads, offline, errors,
      signedIn: [...people.values()].filter((p) => p.uid).length,
      visitors: [...people.values()].filter((p) => !p.uid).length,
      installed: [...people.values()].filter((p) => p.installed).length,
    };
  }
  const personLabel = (p) => (p.uid ? `<strong>${esc(p.name || p.email || p.uid)}</strong>${p.name && p.email ? `<br><small class="hint">${esc(p.email)}</small>` : ''}`
    : `<strong>സന്ദർശകൻ</strong> <small class="hint">#${esc(shortDev(p.device))}</small>`);

  function usageCsv(events) {
    const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = ['time', 'event', 'detail', 'book', 'chapter', 'verses', 'seconds', 'online', 'email', 'name', 'uid', 'device', 'session', 'os', 'browser', 'model', 'installed', 'city', 'region', 'country', 'ip', 'isp'];
    const rows = events.map((e) => [new Date(e.t).toISOString(), e.e, eventDetail(e), e.b || '', e.c || '', e.v || '', e.sec || '', e.net ? 1 : 0,
      e.email, e.name, e.uid || '', e.device, e.s, [e.dev.os, e.dev.osv].filter(Boolean).join(' '), [e.dev.browser, e.dev.bv].filter(Boolean).join(' '), e.dev.model || '',
      e.dev.installed ? 1 : 0, (e.geo || {}).city || '', (e.geo || {}).region || '', (e.geo || {}).country || '', (e.geo || {}).ip || '', (e.geo || {}).isp || '']);
    const text = '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `usage-${dayKey(Date.now())}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  RENDER.usage = async (body, arg) => {
    const state = { days: 7, who: arg || '', type: '', text: '', batches: [], cursor: null, shown: 100, users: new Map() };
    if (state.who) state.days = 30;
    $('#secActions').innerHTML = `<button class="btn" id="useRefresh"><svg><use href="#i-reset"/></svg><span>പുതുക്കുക</span></button>
      <button class="btn" id="useCsv"><svg><use href="#i-download"/></svg><span>CSV</span></button>`;
    body.innerHTML = `<div class="adm-toolbar">
        <select id="usePeriod" aria-label="കാലയളവ്">${PERIODS.map(([d, l]) => `<option value="${d}" ${d === state.days ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="useWho" aria-label="ആര്"><option value="">എല്ലാവരും</option><option value="signed">ലോഗിൻ ചെയ്തവർ</option><option value="visitors">സന്ദർശകർ (ലോഗിൻ ഇല്ലാതെ)</option></select>
        <select id="useType" aria-label="പ്രവർത്തനം"><option value="">എല്ലാ പ്രവർത്തനങ്ങളും</option>${Object.keys(EVENT_LABEL).map((k) => `<option value="${k}">${EVENT_LABEL[k]}</option>`).join('')}</select>
        <label class="adm-search"><svg><use href="#i-search"/></svg><input type="search" id="useText" placeholder="തിരയുക: പേര്, ഇമെയിൽ, അധ്യായം, തിരഞ്ഞ വാക്ക്, സ്ഥലം…" aria-label="ലോഗിൽ തിരയുക"></label>
      </div>
      <p class="hint">ഓരോ ഉപകരണവും ചെയ്തത് ആദ്യം അതിൽത്തന്നെ സൂക്ഷിക്കും (ഇന്റർനെറ്റ് ഇല്ലെങ്കിലും), പിന്നീട് ഓൺലൈൻ ആകുമ്പോൾ ഇവിടെ എത്തും. Firebase സൗജന്യ പ്ലാനിൽ ഒതുങ്ങാൻ ഓരോ ഉപകരണവും ഏകദേശം 15 മിനിറ്റിലൊരിക്കൽ (ചെറിയ ഉപയോഗം അടുത്ത തവണ തുറക്കുമ്പോൾ) ഒന്നിച്ചാണ് അയയ്ക്കുന്നത് — അതുകൊണ്ട് പുതിയ ഉപയോഗം അൽപം വൈകി കാണാം. സ്ഥലം IP വിലാസം വെച്ചുള്ള ഏകദേശമാണ്.</p>
      <div id="useOut">${spinner}</div>`;

    // all events of the period, flattened once per load (not on every filter change / keystroke)
    let all = null, everyone = null;
    const allEvents = () => all || (all = flatten(state.batches, dayStart(state.days)));
    const setBatches = (r) => { state.batches = r.batches; state.cursor = r.cursor; all = null; everyone = null; };
    const filtered = () => {
      const q = state.text.trim().toLowerCase();
      if (!state.who && !state.type && !q) return allEvents();
      return allEvents().filter((e) => {
        if (state.who === 'signed' && !e.uid) return false;
        if (state.who === 'visitors' && e.uid) return false;
        if (/^[ud]:/.test(state.who) && whoKey(e) !== state.who && !(state.who.startsWith('d:') && e.device === state.who.slice(2))) return false;
        if (state.type && e.e !== state.type) return false;
        if (q) {
          const hay = [e.email, e.name, e.uid ? '' : 'സന്ദർശകൻ', EVENT_LABEL[e.e] || e.e, eventDetail(e), devLabel(e.dev), placeLabel(e.geo), e.geo && e.geo.ip, e.device].join(' ').toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
    };

    const draw = () => {
      if (!still('usage')) return;
      const events = filtered();
      const sum = summarize(events);
      // the person / device choices come from what was loaded
      const whoSel = $('#useWho');
      if (!everyone) everyone = summarize(allEvents()).people;
      const opts = everyone.map((p) => `<option value="${esc(p.key)}">${esc(p.uid ? p.name || p.email || p.uid : 'സന്ദർശകൻ #' + shortDev(p.device) + ' · ' + devLabel(p.dev))}</option>`).join('');
      whoSel.innerHTML = `<option value="">എല്ലാവരും</option><option value="signed">ലോഗിൻ ചെയ്തവർ</option><option value="visitors">സന്ദർശകർ (ലോഗിൻ ഇല്ലാതെ)</option>${opts}`
        + (/^[ud]:/.test(state.who) && !everyone.some((p) => p.key === state.who) ? `<option value="${esc(state.who)}">${esc(state.who.startsWith('u:') && state.users.get(state.who.slice(2)) ? state.users.get(state.who.slice(2)).email : state.who)}</option>` : '');
      whoSel.value = state.who;

      const stat = (label, value, detail) => `<div class="adm-stat"><span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ''}</div>`;
      const more = state.cursor ? `<p class="hint">ഈ കാലയളവിലെ ${state.batches.length} ബാച്ചുകൾ മാത്രം ലോഡ് ചെയ്തു. <button class="btn sm" id="useMore">കൂടുതൽ ലോഡ് ചെയ്യുക</button></p>` : '';
      const person = /^[ud]:/.test(state.who) ? sum.people.find((p) => p.key === state.who) || sum.people[0] : null;
      const role = (p) => (p.uid && state.users.get(p.uid) ? `<span class="role-badge role-${esc(state.users.get(p.uid).role)}">${esc(ROLE_LABEL[state.users.get(p.uid).role] || '')}</span>` : '');

      const peopleTable = sum.people.length ? `<table class="adm-table"><thead><tr><th>ആര്</th><th>ഉപകരണം</th><th>സ്ഥലം</th><th>സെഷൻ</th><th>വായന</th><th>തിരയൽ</th><th>ഓഫ്‌ലൈൻ</th><th>അവസാനം</th></tr></thead><tbody>
        ${sum.people.map((p) => `<tr>
          <td data-label="ആര്"><button class="linkish" data-who="${esc(p.key)}" title="ഇവരുടെ മാത്രം കാണിക്കുക">${personLabel(p)}</button> ${role(p)}</td>
          <td data-label="ഉപകരണം" class="adm-wrap">${esc(devLabel(p.dev))}${p.devices.size > 1 ? ` <span class="adm-tag">${p.devices.size} ഉപകരണങ്ങൾ</span>` : ''}${p.installed ? ' <span class="adm-tag">ആപ്പ്</span>' : ''}</td>
          <td data-label="സ്ഥലം" class="adm-wrap">${esc(placeLabel(p.geo) || '—')}</td>
          <td data-label="സെഷൻ">${p.sessions.size}</td>
          <td data-label="വായന">${p.reads} · ${fmtDur(p.sec)}</td>
          <td data-label="തിരയൽ">${p.searches}</td>
          <td data-label="ഓഫ്‌ലൈൻ">${p.offline ? `<span class="adm-pill warn">${p.offline}</span>` : '0'}</td>
          <td data-label="അവസാനം">${esc(fmtTime(p.last))}</td></tr>`).join('')}
        </tbody></table>` : '<div class="adm-empty">ഈ കാലയളവിൽ ഒന്നുമില്ല</div>';

      const dayTable = sum.days.length ? `<table class="adm-table"><thead><tr><th>ദിവസം</th><th>ആളുകൾ</th><th>സെഷൻ</th><th>വായിച്ചത്</th><th>വായന സമയം</th><th>തിരയൽ</th><th>ഓഫ്‌ലൈൻ</th></tr></thead><tbody>
        ${sum.days.map((d) => `<tr><td data-label="ദിവസം"><strong>${esc(fmtDay(d.key))}</strong></td><td data-label="ആളുകൾ">${d.people.size}</td><td data-label="സെഷൻ">${d.sessions.size}</td>
          <td data-label="വായിച്ചത്">${d.reads}</td><td data-label="വായന സമയം">${fmtDur(d.sec)}</td><td data-label="തിരയൽ">${d.searches}</td><td data-label="ഓഫ്‌ലൈൻ">${d.offline}</td></tr>`).join('')}
        </tbody></table>` : '';

      const chapterTable = sum.chapters.length ? `<table class="adm-table"><thead><tr><th>അധ്യായം</th><th>തവണ</th><th>ആളുകൾ</th><th>സമയം</th></tr></thead><tbody>
        ${sum.chapters.slice(0, 15).map((c) => `<tr><td data-label="അധ്യായം"><a href="${esc(readerUrl)}#/${encodeURIComponent(c.b)}/${+c.c}">${esc(bookName(c.b))} ${+c.c}</a></td>
          <td data-label="തവണ">${c.n}</td><td data-label="ആളുകൾ">${c.people.size}</td><td data-label="സമയം">${fmtDur(c.sec)}</td></tr>`).join('')}
        </tbody></table>` : '<div class="adm-empty">വായന ഇല്ല</div>';

      const searchTable = sum.searches.length ? `<table class="adm-table"><thead><tr><th>തിരഞ്ഞത്</th><th>തവണ</th><th>ആളുകൾ</th><th>ഫലങ്ങൾ</th></tr></thead><tbody>
        ${sum.searches.slice(0, 15).map((s) => `<tr><td data-label="തിരഞ്ഞത്" class="adm-wrap"><strong>${esc(s.q)}</strong></td><td data-label="തവണ">${s.n}</td><td data-label="ആളുകൾ">${s.people.size}</td>
          <td data-label="ഫലങ്ങൾ">${s.results < 0 ? 'റഫറൻസ്' : s.results === 0 ? '<span class="adm-pill warn">0</span>' : s.results}</td></tr>`).join('')}
        </tbody></table>` : '<div class="adm-empty">തിരയൽ ഇല്ല</div>';

      const timeline = events.length ? `<table class="adm-table adm-timeline"><thead><tr><th>സമയം</th><th>പ്രവർത്തനം</th><th>വിവരം</th><th>ആര്</th><th>ഉപകരണം / സ്ഥലം</th></tr></thead><tbody>
        ${events.slice(0, state.shown).map((e) => `<tr class="${e.e === 'error' ? 'is-error' : ''}">
          <td data-label="സമയം">${esc(fmtSec(e.t))}${e.net ? '' : ' <span class="adm-pill warn" title="ഇന്റർനെറ്റ് ഇല്ലാതിരുന്നപ്പോൾ">ഓഫ്‌ലൈൻ</span>'}</td>
          <td data-label="പ്രവർത്തനം">${esc(EVENT_LABEL[e.e] || e.e)}</td>
          <td data-label="വിവരം" class="adm-wrap">${e.b && e.e !== 'search' ? `<a href="${esc(readerUrl)}#/${encodeURIComponent(e.b)}/${+e.c}${e.v && /^\d+/.test(e.v) ? '/' + parseInt(e.v, 10) : ''}">${esc(eventDetail(e))}</a>` : esc(eventDetail(e))}</td>
          <td data-label="ആര്" class="adm-wrap"><button class="linkish" data-who="${esc(whoKey(e))}">${esc(e.uid ? e.name || e.email : 'സന്ദർശകൻ #' + shortDev(e.device))}</button></td>
          <td data-label="ഉപകരണം" class="adm-wrap"><small>${esc(devLabel(e.dev))}${placeLabel(e.geo) ? '<br>' + esc(placeLabel(e.geo)) : ''}</small></td></tr>`).join('')}
        </tbody></table>
        ${events.length > state.shown ? `<p><button class="btn" id="useShowMore">കൂടുതൽ കാണിക്കുക (${events.length - state.shown} ബാക്കി)</button></p>` : ''}` : '<div class="adm-empty">ഒന്നുമില്ല</div>';

      const personCard = person ? `<div class="adm-card adm-person">
          <div>${personLabel(person)} ${role(person)}</div>
          <dl class="adm-dl">
            ${person.uid ? `<dt>ഇമെയിൽ</dt><dd>${esc(person.email || '—')}</dd>` : ''}
            <dt>ഉപകരണം</dt><dd>${esc(devLabel(person.dev))}${person.dev && person.dev.screen ? ` · ${esc(person.dev.screen)}` : ''}${person.dev && person.dev.installed ? ' · ഇൻസ്റ്റാൾ ചെയ്ത ആപ്പ്' : ''}</dd>
            <dt>ഭാഷ / സമയമേഖല</dt><dd>${esc([person.dev && person.dev.lang, person.dev && person.dev.tz].filter(Boolean).join(' · ') || '—')}</dd>
            <dt>സ്ഥലം</dt><dd>${esc(placeLabel(person.geo) || '—')}${person.geo && person.geo.ip ? ` · IP ${esc(person.geo.ip)}` : ''}${person.geo && person.geo.isp ? ` · ${esc(person.geo.isp)}` : ''}</dd>
            <dt>ഉപകരണങ്ങൾ</dt><dd>${person.devices.size}</dd>
            <dt>ആദ്യം / അവസാനം</dt><dd>${esc(fmtTime(person.first))} → ${esc(fmtTime(person.last))}</dd>
            ${person.dev && person.dev.ua ? `<dt>ബ്രൗസർ വിവരം</dt><dd class="adm-wrap"><small>${esc(person.dev.ua)}</small></dd>` : ''}
          </dl>
          <p><button class="btn sm" data-who="">എല്ലാവരെയും കാണിക്കുക</button></p>
        </div>` : '';

      $('#useOut').innerHTML = `${personCard}<div class="adm-stats">
          ${stat('ആളുകൾ', sum.people.length, `ലോഗിൻ ചെയ്തവർ ${sum.signedIn} · സന്ദർശകർ ${sum.visitors}`)}
          ${stat('സെഷനുകൾ', sum.sessions, `ഇൻസ്റ്റാൾ ചെയ്ത ആപ്പ്: ${sum.installed} പേർ`)}
          ${stat('വായിച്ച അധ്യായങ്ങൾ', sum.reads, 'ആകെ വായന സമയം ' + fmtDur(sum.readSec))}
          ${stat('തിരയലുകൾ', sum.searches.reduce((n, s) => n + s.n, 0), `${sum.searches.length} വ്യത്യസ്ത വാക്കുകൾ`)}
          ${stat('ഓഫ്‌ലൈൻ ആയി ചെയ്തത്', sum.offline, events.length ? `ആകെ ${events.length} പ്രവർത്തനങ്ങളിൽ ${Math.round((sum.offline / events.length) * 100)}%` : '')}
          ${stat('പിശകുകൾ', sum.errors, 'ആപ്പിൽ ഉണ്ടായ JavaScript പിശകുകൾ')}
        </div>
        ${more}
        ${person ? '' : `<h2 class="adm-h2">ആളുകളും ഉപകരണങ്ങളും</h2>${peopleTable}`}
        <h2 class="adm-h2">ദിവസം തോറും</h2>${dayTable || '<div class="adm-empty">ഒന്നുമില്ല</div>'}
        <div class="adm-two">
          <div><h2 class="adm-h2">കൂടുതൽ വായിച്ച അധ്യായങ്ങൾ</h2>${chapterTable}</div>
          <div><h2 class="adm-h2">തിരഞ്ഞ വാക്കുകൾ</h2>${searchTable}</div>
        </div>
        <h2 class="adm-h2">എല്ലാ പ്രവർത്തനങ്ങളും (സമയരേഖ)</h2>${timeline}
        <div class="adm-card adm-purge">
          <strong>പഴയ ലോഗ് മായ്ക്കുക</strong>
          <p class="hint">Firebase-ന്റെ സൗജന്യ പ്ലാനിലെ സ്ഥലം ലാഭിക്കാൻ. മായ്ച്ചത് തിരികെ കിട്ടില്ല — വേണമെങ്കിൽ ആദ്യം CSV ഡൗൺലോഡ് ചെയ്യുക.</p>
          <div class="adm-invite-row">
            <select id="purgeDays" aria-label="എത്ര ദിവസത്തിൽ പഴയത്">${[30, 90, 180, 365].map((d) => `<option value="${d}" ${d === 90 ? 'selected' : ''}>${d} ദിവസത്തിൽ പഴയത്</option>`).join('')}</select>
            <button class="btn danger" id="purgeBtn"><svg><use href="#i-trash"/></svg><span>മായ്ക്കുക</span></button>
          </div>
        </div>`;
    };

    const load = async (more, force) => {
      if (!more) { state.shown = 100; $('#useOut').innerHTML = spinner; }
      try {
        const since = dayStart(state.days);
        const r = more ? await usageMore(since) : await usageFor(since, force);
        if (!still('usage')) return;
        setBatches(r);
        draw();
      } catch (e) {
        if (still('usage')) $('#useOut').innerHTML = failMsg(e);
      }
    };

    usersList().then((users) => {
      users.forEach((u) => state.users.set(u.uid, u));
      if (still('usage') && state.batches.length) draw();
    }).catch(() => {});

    $('#usePeriod').addEventListener('change', (e) => { state.days = +e.target.value; load(false); });
    $('#useWho').addEventListener('change', (e) => { state.who = e.target.value; state.shown = 100; draw(); });
    $('#useType').addEventListener('change', (e) => { state.type = e.target.value; state.shown = 100; draw(); });
    let tt;
    $('#useText').addEventListener('input', (e) => { clearTimeout(tt); tt = setTimeout(() => { state.text = e.target.value; state.shown = 100; draw(); }, 250); });
    $('#useRefresh').addEventListener('click', async () => {
      if (window.Usage) await window.Usage.flush().catch(() => {});
      load(false, true);
    });
    $('#useCsv').addEventListener('click', () => {
      const ev = filtered();
      if (!ev.length) { toast('ഡൗൺലോഡ് ചെയ്യാൻ ഒന്നുമില്ല'); return; }
      usageCsv(ev);
    });
    $('#useOut').addEventListener('click', async (e) => {
      const w = e.target.closest('[data-who]');
      if (w) { state.who = w.dataset.who; state.shown = 100; draw(); $('#secBody').scrollIntoView({ block: 'start' }); return; }
      if (e.target.closest('#useShowMore')) { state.shown += 200; draw(); return; }
      if (e.target.closest('#useMore')) { e.target.closest('#useMore').disabled = true; load(true); return; }
      if (e.target.closest('#purgeBtn')) {
        const days = +$('#purgeDays').value;
        if (!(await confirmBox('പഴയ ലോഗ് മായ്ക്കുക', `${days} ദിവസത്തിൽ മുമ്പ് അപ്‌ലോഡ് ചെയ്ത ഉപയോഗ ലോഗ് എല്ലാം സ്ഥിരമായി മായ്ക്കണോ?`, 'മായ്ക്കുക'))) return;
        try {
          const n = await Cloud.purgeUsage(dayStart(days + 1));
          toast(n ? `${n} ബാച്ചുകൾ മായ്ച്ചു` : 'അത്ര പഴയത് ഒന്നുമില്ല');
          if (n) { usageCache = null; load(false); }
        } catch (err) { cloudError(err); }
      }
    });
    load(false);
  };

  // -- users --
  RENDER.users = async (body) => {
    body.innerHTML = spinner;
    let users;
    try { users = await usersList(true); } catch (e) { if (still('users')) body.innerHTML = failMsg(e); return; }
    if (!still('users')) return;
    body.innerHTML = `<div class="adm-toolbar">
        <label class="adm-search"><svg><use href="#i-search"/></svg><input type="search" id="userSearch" placeholder="പേര് അല്ലെങ്കിൽ ഇമെയിൽ തിരയുക" aria-label="ഉപയോക്താക്കളെ തിരയുക"></label>
        <span class="hint" id="userCount"></span>
      </div>
      <p class="hint">റോൾ മാറ്റം ഉടൻ ബാധകമാകും. <b>തടഞ്ഞു</b> = ലോഗിൻ ചെയ്താലും തിരുത്താനോ സിങ്ക് ചെയ്യാനോ അഡ്മിൻ ഉപകരണങ്ങൾ കാണാനോ കഴിയില്ല. നിങ്ങളുടെയും ഉടമയുടെയും റോൾ ഇവിടെ മാറ്റാനാവില്ല.</p>
      <div id="userTable"></div>`;
    const draw = () => {
      const q = $('#userSearch').value.trim().toLowerCase();
      const list = users.filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
      $('#userCount').textContent = `${list.length} / ${users.length}`;
      $('#userTable').innerHTML = list.length ? `<table class="adm-table"><thead><tr><th>പേര്</th><th>ഇമെയിൽ</th><th>ലോഗിൻ രീതി</th><th>റോൾ</th><th>ചേർന്നത്</th><th>അവസാന ലോഗിൻ</th><th></th></tr></thead><tbody>
        ${list.map((u) => {
          const self = u.uid === Cloud.user.uid;
          const owner = Cloud.isOwnerEmail(u.email);
          // like ownerProfile() in firestore.rules: only the owner's admin profile is protected; an
          // unverified account that merely uses the owner's address can still be blocked
          const locked = self || (owner && u.role === 'admin' && !u.redeemedCode);
          const tag = owner ? ' <span class="adm-tag">ഉടമ</span>' : self ? ' <span class="adm-tag">നിങ്ങൾ</span>' : '';
          return `<tr class="${u.role === 'none' ? 'blocked' : ''}">
            <td data-label="പേര്"><strong>${esc(u.name || '—')}</strong>${tag}</td>
            <td data-label="ഇമെയിൽ" class="adm-wrap">${esc(u.email || '')}</td>
            <td data-label="ലോഗിൻ രീതി">${esc(methodName(u.provider))}</td>
            <td data-label="റോൾ"><select class="u-role" data-uid="${esc(u.uid)}" data-email="${esc(u.email || '')}" aria-label="റോൾ: ${esc(u.email || '')}" ${locked ? 'disabled' : ''}>${roleOptions(u.role, ['reader', 'editor', 'admin', 'none'])}</select></td>
            <td data-label="ചേർന്നത്">${esc(fmtTime(u.createdAt))}</td>
            <td data-label="അവസാന ലോഗിൻ">${esc(fmtTime(u.lastLogin))}</td>
            <td class="adm-act"><a class="btn sm" href="#usage/u:${encodeURIComponent(u.uid)}" title="ഇവർ ആപ്പിൽ ചെയ്തതെല്ലാം"><svg><use href="#i-chart"/></svg><span>ഉപയോഗം</span></a></td></tr>`;
        }).join('')}</tbody></table>` : '<div class="adm-empty">ആരുമില്ല</div>';
    };
    draw();
    $('#userSearch').addEventListener('input', draw);
    $('#userTable').addEventListener('change', async (e) => {
      const sel = e.target.closest('.u-role');
      if (!sel) return;
      const u = users.find((x) => x.uid === sel.dataset.uid);
      if (sel.value === 'none' && !(await confirmBox('ഉപയോക്താവിനെ തടയുക', `${sel.dataset.email} തടയണോ? അവർക്ക് വായിക്കാം, പക്ഷേ തിരുത്താനോ സിങ്ക് ചെയ്യാനോ കഴിയില്ല.`, 'തടയുക'))) {
        sel.value = u.role; return;
      }
      try {
        await Cloud.setRole(sel.dataset.uid, sel.value, sel.dataset.email);
        u.role = sel.value;
        sel.closest('tr').classList.toggle('blocked', sel.value === 'none');
        toast('റോൾ മാറ്റി: ' + ROLE_LABEL[sel.value]);
      } catch (err) { cloudError(err); sel.value = u.role; }
    });
  };

  // -- invites --
  RENDER.invites = async (body) => {
    body.innerHTML = `<form class="adm-card adm-invite" id="inviteForm">
        <p class="hint">ഒരു ഇമെയിലിന് മുൻകൂട്ടി റോൾ നൽകുക. അവർ ആ ഇമെയിലിൽ ലോഗിൻ ചെയ്ത് (ഇമെയിൽ സ്ഥിരീകരിച്ച്) കഴിയുമ്പോൾ റോൾ ലഭിക്കും — Google, GitHub, Microsoft, ഇമെയിൽ ലിങ്ക്, പാസ്‌വേഡ് ഏതുപയോഗിച്ചും.</p>
        <div class="adm-invite-row">
          <input type="email" id="inviteEmail" placeholder="name@example.com" required aria-label="ഇമെയിൽ" autocomplete="off">
          <select id="inviteRole" aria-label="റോൾ">${roleOptions('editor', ['editor', 'admin'])}</select>
          <button class="btn primary" type="submit"><svg><use href="#i-mail"/></svg><span>ക്ഷണിക്കുക</span></button>
        </div>
      </form>
      <div id="inviteList">${spinner}</div>`;
    const load = async () => {
      let list;
      try { list = await Cloud.listInvites(); } catch (e) { if (still('invites')) $('#inviteList').innerHTML = failMsg(e); return; }
      if (!still('invites')) return;
      list.sort((a, b) => tms(b.at) - tms(a.at));
      $('#inviteList').innerHTML = list.length ? `<table class="adm-table"><thead><tr><th>ഇമെയിൽ</th><th>റോൾ</th><th>ക്ഷണിച്ചത്</th><th>സമയം</th><th></th></tr></thead><tbody>
        ${list.map((i) => `<tr>
          <td data-label="ഇമെയിൽ" class="adm-wrap"><strong>${esc(i.email)}</strong></td>
          <td data-label="റോൾ">${esc(ROLE_LABEL[i.role] || i.role)}</td>
          <td data-label="ക്ഷണിച്ചത്" class="adm-wrap">${esc(i.by || '')}</td>
          <td data-label="സമയം">${esc(fmtTime(i.at))}</td>
          <td class="adm-act"><button class="btn sm danger" data-revoke="${esc(i.email)}"><svg><use href="#i-trash"/></svg><span>റദ്ദാക്കുക</span></button></td></tr>`).join('')}
        </tbody></table>` : '<div class="adm-empty">ബാക്കിയുള്ള ക്ഷണങ്ങൾ ഒന്നുമില്ല</div>';
    };
    load();
    $('#inviteForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#inviteEmail').value.trim().toLowerCase();
      if (!EMAIL_RE.test(email)) { toast('ശരിയായ ഇമെയിൽ നൽകുക'); return; }
      try { await Cloud.setInvite(email, $('#inviteRole').value); toast('ക്ഷണിച്ചു: ' + email); $('#inviteEmail').value = ''; } catch (err) { cloudError(err); }
      load();
    });
    $('#inviteList').addEventListener('click', async (e) => {
      const b = e.target.closest('[data-revoke]');
      if (!b) return;
      if (!(await confirmBox('ക്ഷണം റദ്ദാക്കുക', b.dataset.revoke + ' എന്നതിനുള്ള ക്ഷണം റദ്ദാക്കണോ?', 'റദ്ദാക്കുക'))) return;
      try { await Cloud.deleteInvite(b.dataset.revoke); toast('ക്ഷണം റദ്ദാക്കി'); } catch (err) { cloudError(err); }
      load();
    });
  };

  // -- access codes: one-time codes that grant editor / admin --
  // active | used | revoked | expired
  function codeStatus(c) {
    if (c.used) return 'used';
    if (c.revoked) return 'revoked';
    if (tms(c.expiresAt) <= Date.now()) return 'expired';
    return 'active';
  }
  // the reader's address with ?code=, so the link opens the "enter code" dialog with it filled in
  function codeLink(code) {
    const base = new URL('./', location.href).href;
    return base + '?' + (Cloud.emulator ? 'emulator&' : '') + 'code=' + encodeURIComponent(Cloud.fmtCode(code));
  }
  function shareUrl(c) {
    const code = Cloud.fmtCode(c.code);
    const text = `പരിഷ്കരിച്ച മലയാളം ബൈബിൾ — ${ROLE_LABEL[c.role] || c.role} ആക്സസ് കോഡ്: ${code}\n\n`
      + `1. ഈ ലിങ്ക് തുറക്കുക: ${codeLink(c.code)}\n`
      + '2. ലോഗിൻ ചെയ്യുക (അക്കൗണ്ട് ഇല്ലെങ്കിൽ "രജിസ്റ്റർ ചെയ്യുക"; ഇമെയിൽ സ്ഥിരീകരണം വേണ്ട).\n'
      + '3. കോഡ് സ്വയം പൂരിപ്പിക്കും — "കോഡ് ഉപയോഗിക്കുക" അമർത്തുക. (അല്ലെങ്കിൽ ☰ → അക്കൗണ്ട് → "കോഡ് നൽകുക")\n\n'
      + `ഒരു തവണ മാത്രം ഉപയോഗിക്കാം; ${fmtTime(c.expiresAt)} വരെ സാധുത.`;
    return 'https://wa.me/?text=' + encodeURIComponent(text);
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back */ }
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  const detailText = (d) => String(d)
    .replace(/^(editor|admin)\b/, (r) => ROLE_LABEL[r])
    .replace(/openUpload=(true|false)/, (m, v) => 'PDF അപ്‌ലോഡ്: ' + (v === 'true' ? 'ഓൺ' : 'ഓഫ്'))
    .replace(/openEdit=(true|false)/, (m, v) => 'തിരുത്തൽ: ' + (v === 'true' ? 'ഓൺ' : 'ഓഫ്'));
  const codeActions = (c) => `<button class="btn sm" data-copy="${esc(c.code)}" title="കോഡ് പകർത്തുക"><svg><use href="#i-copy"/></svg><span>പകർത്തുക</span></button>
      <a class="btn sm adm-wa" href="${esc(shareUrl(c))}" target="_blank" rel="noopener"><svg><use href="#i-chat"/></svg><span>WhatsApp-ൽ അയയ്ക്കുക</span></a>`;

  RENDER.codes = async (body) => {
    body.innerHTML = `<form class="adm-card adm-invite" id="codeForm">
        <p class="hint">ഒരു തവണ മാത്രം ഉപയോഗിക്കാവുന്ന കോഡ് ഉണ്ടാക്കി ആ വ്യക്തിക്ക് അയയ്ക്കുക (ഉദാ. WhatsApp). അവർ ഏതു രീതിയിലും ലോഗിൻ ചെയ്ത് — ഇമെയിൽ സ്ഥിരീകരണം ആവശ്യമില്ല — ലിങ്ക് തുറക്കുകയോ ☰ → അക്കൗണ്ട് → “കോഡ് നൽകുക”-ൽ കോഡ് നൽകുകയോ ചെയ്താൽ ഉടൻ ആ റോൾ ലഭിക്കും. കോഡ് ഉള്ള ആർക്കും അത് ഉപയോഗിക്കാം; അതിനാൽ ഉദ്ദേശിച്ച ആൾക്ക് മാത്രം അയയ്ക്കുക.</p>
        <div class="adm-invite-row">
          <select id="codeRole" aria-label="റോൾ">${roleOptions('editor', ['editor', 'admin'])}</select>
          <select id="codeExpiry" aria-label="കാലാവധി">${EXPIRY.map(([h, l]) => `<option value="${h}" ${h === 24 ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <input type="text" id="codeNote" maxlength="100" placeholder="ആർക്കാണ്? (ഐച്ഛികം)" aria-label="കുറിപ്പ്: ആർക്കാണ്" autocomplete="off">
          <button class="btn primary" type="submit" id="codeCreate"><svg><use href="#i-ticket"/></svg><span>കോഡ് ഉണ്ടാക്കുക</span></button>
        </div>
      </form>
      <div id="codeNew"></div>
      <h2 class="adm-h2">കോഡുകൾ</h2>
      <div id="codeList">${spinner}</div>`;
    let users = [];
    usersList().then((u) => { users = u; }).catch(() => {});
    const who = (uid) => { const u = users.find((x) => x.uid === uid); return u ? u.email || u.name || uid : uid; };
    const load = async () => {
      let list;
      try {
        [list, users] = await Promise.all([Cloud.listAccessCodes(), usersList().catch(() => users)]);
      } catch (e) { if (still('codes')) $('#codeList').innerHTML = failMsg(e); return; }
      if (!still('codes')) return;
      const label = { active: 'ഉപയോഗിക്കാത്തത്', used: 'ഉപയോഗിച്ചു', expired: 'കാലഹരണപ്പെട്ടു', revoked: 'റദ്ദാക്കി' };
      const pill = { active: 'ok', used: '', expired: 'warn', revoked: 'warn' };
      $('#codeList').innerHTML = list.length ? `<table class="adm-table adm-codes"><thead><tr><th>കോഡ്</th><th>റോൾ</th><th>ആർക്ക്</th><th>ഉണ്ടാക്കിയത്</th><th>കാലാവധി</th><th>നില</th><th></th></tr></thead><tbody>
        ${list.map((c) => {
          const st = codeStatus(c);
          const used = st === 'used' ? `<small class="adm-sub">${esc(who(c.usedBy))} · ${esc(fmtTime(c.usedAt))}</small>` : '';
          return `<tr class="code-${st}" data-code="${esc(c.code)}">
            <td data-label="കോഡ്"><code class="adm-code">${esc(Cloud.fmtCode(c.code))}</code></td>
            <td data-label="റോൾ">${esc(ROLE_LABEL[c.role] || c.role)}</td>
            <td data-label="ആർക്ക്" class="adm-wrap">${esc(c.note || '—')}</td>
            <td data-label="ഉണ്ടാക്കിയത്" class="adm-wrap">${esc(c.createdBy || '')}<small class="adm-sub">${esc(fmtTime(c.createdAt))}</small></td>
            <td data-label="കാലാവധി">${esc(fmtTime(c.expiresAt))}</td>
            <td data-label="നില"><span class="adm-stack"><span class="adm-pill ${pill[st]}">${label[st]}</span>${used}</span></td>
            <td class="adm-act">${st === 'active' ? `<div class="adm-acts">${codeActions(c)}
              <button class="btn sm danger" data-revoke-code="${esc(c.code)}"><svg><use href="#i-trash"/></svg><span>റദ്ദാക്കുക</span></button></div>` : ''}</td></tr>`;
        }).join('')}
        </tbody></table>` : '<div class="adm-empty">കോഡുകൾ ഒന്നുമില്ല</div>';
    };
    load();
    $('#codeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#codeCreate');
      if (btn.disabled) return;
      btn.disabled = true;
      const role = $('#codeRole').value;
      const hours = +$('#codeExpiry').value;
      try {
        const c = await Cloud.createAccessCode(role, hours, $('#codeNote').value);
        if (!still('codes')) return;
        $('#codeNote').value = '';
        const exp = (EXPIRY.find((x) => x[0] === hours) || [0, ''])[1];
        $('#codeNew').innerHTML = `<div class="adm-card adm-newcode" role="status">
            <div class="adm-newcode-head"><strong>പുതിയ കോഡ്</strong> · ${esc(ROLE_LABEL[c.role])} · ${esc(exp)}${c.note ? ' · ' + esc(c.note) : ''}</div>
            <div class="adm-code-big" id="newCode">${esc(Cloud.fmtCode(c.code))}</div>
            <div class="adm-newcode-actions">${codeActions(c)}</div>
            <p class="hint">ഈ കോഡ് ഒരാൾക്ക് ഒരു തവണ മാത്രം; ${esc(fmtTime(c.expiresAt))} വരെ സാധുത. ലിങ്ക്: <code>${esc(codeLink(c.code))}</code></p>
          </div>`;
        toast('കോഡ് ഉണ്ടാക്കി: ' + Cloud.fmtCode(c.code), 4000);
      } catch (err) { cloudError(err); }
      btn.disabled = false;
      load();
    });
    body.onclick = async (e) => {
      const cp = e.target.closest('[data-copy]');
      if (cp) { toast((await copyText(Cloud.fmtCode(cp.dataset.copy))) ? 'കോഡ് പകർത്തി: ' + Cloud.fmtCode(cp.dataset.copy) : 'പകർത്താൻ കഴിഞ്ഞില്ല'); return; }
      const rv = e.target.closest('[data-revoke-code]');
      if (!rv) return;
      const code = rv.dataset.revokeCode;
      if (!(await confirmBox('കോഡ് റദ്ദാക്കുക', `${Cloud.fmtCode(code)} റദ്ദാക്കണോ? ഇനി ആർക്കും അത് ഉപയോഗിക്കാനാവില്ല.`, 'റദ്ദാക്കുക'))) return;
      try {
        await Cloud.revokeAccessCode(code);
        toast('കോഡ് റദ്ദാക്കി');
        const box = $('#newCode');
        if (box && Cloud.normCode(box.textContent) === code) $('#codeNew').innerHTML = '';
      } catch (err) { cloudError(err); }
      load();
    };
  };

  // -- settings: open PDF upload / chapter editing to everyone who is signed in --
  RENDER.settings = (body) => {
    if (!Cloud.settingsReady) { body.innerHTML = spinner; return; }   // redrawn by the 'settings' event
    const s = Cloud.settings;
    const row = (id, on, title, text) => `<label class="adm-switch">
        <input type="checkbox" id="${id}" ${on ? 'checked' : ''}>
        <span><strong>${title}</strong><small>${text}</small></span>
      </label>`;
    body.innerHTML = `<div class="adm-card adm-settings">
        ${row('setUpload', s.openUpload, 'എല്ലാവർക്കും PDF അപ്‌ലോഡ്', 'ലോഗിൻ ചെയ്ത എല്ലാവർക്കും (തടഞ്ഞവർ ഒഴികെ) ☰ → “PDF അപ്‌ലോഡ് ചെയ്യുക” ഉപയോഗിച്ച് അധ്യായങ്ങൾ ചേർക്കാനും നിലവിലുള്ളവ മാറ്റിസ്ഥാപിക്കാനും കഴിയും.')}
        ${row('setEdit', s.openEdit, 'എല്ലാവർക്കും അധ്യായം തിരുത്തൽ', 'ലോഗിൻ ചെയ്ത എല്ലാവർക്കും (തടഞ്ഞവർ ഒഴികെ) ☰ → “ഈ അധ്യായം തിരുത്തുക”, വാക്യം തിരുത്തൽ എന്നിവ ഉപയോഗിക്കാം.')}
      </div>
      <p class="hint">ടിക്ക് ചെയ്യുമ്പോൾ ഉടൻ സേവ് ആകും, തുറന്നിരിക്കുന്ന എല്ലാ പേജുകളിലും ഉടൻ ബാധകമാകും. ലോഗിൻ ചെയ്യാത്തവർക്ക് എപ്പോഴും വായന മാത്രം; തടഞ്ഞവർക്കും ഇത് ബാധകമല്ല. അധ്യായം നീക്കൽ, എല്ലാ തിരുത്തലുകളും മായ്ക്കൽ, ഉപയോക്താക്കൾ, ഈ പോർട്ടൽ എന്നിവ അഡ്മിന് മാത്രം; data.js / ബാക്കപ്പ് / HTML ഡൗൺലോഡ്, യഥാർത്ഥ പാഠം പുനഃസ്ഥാപിക്കൽ എന്നിവ എഡിറ്റർമാർക്കും അഡ്മിൻമാർക്കും മാത്രം. എല്ലാ മാറ്റങ്ങളും പ്രവർത്തന ചരിത്രത്തിൽ കാണാം, “ഉള്ളടക്കം” വിഭാഗത്തിൽ നിന്ന് തിരിച്ചാക്കാം.</p>
      <p class="hint" id="setMeta">${s.updatedBy ? `അവസാനം മാറ്റിയത്: ${esc(s.updatedBy)} · ${esc(fmtTime(s.updatedAt))}` : ''}</p>`;
    const names = { openUpload: 'എല്ലാവർക്കും PDF അപ്‌ലോഡ്', openEdit: 'എല്ലാവർക്കും അധ്യായം തിരുത്തൽ' };
    [['setUpload', 'openUpload'], ['setEdit', 'openEdit']].forEach(([id, key]) => {
      $('#' + id).addEventListener('change', async (e) => {
        const box = e.target;
        const on = box.checked;
        $$('.adm-settings input').forEach((x) => { x.disabled = true; });
        settingsSaving = true;
        try {
          await Cloud.saveSettings({ [key]: on });
          toast(`${names[key]}: ${on ? 'ഓൺ' : 'ഓഫ്'} — സേവ് ചെയ്തു`);
        } catch (err) { box.checked = !on; cloudError(err); }
        settingsSaving = false;
        if (still('settings')) RENDER.settings(body);
      });
    });
  };
  let settingsSaving = false;

  // -- role × permission matrix, generated from Cloud.PERMS --
  RENDER.roles = (body) => {
    const rank = Cloud.ROLE_RANK;
    const cols = [['guest', 'ലോഗിൻ ഇല്ലാതെ', -1], ['none', ROLE_LABEL.none, 0], ['reader', ROLE_LABEL.reader, 1], ['editor', ROLE_LABEL.editor, 2], ['admin', ROLE_LABEL.admin, 3]];
    const tick = (v) => (v === 'open' ? '<span class="yes open" aria-label="എല്ലാവർക്കും തുറന്നിരിക്കുന്നു" title="ക്രമീകരണങ്ങളിൽ എല്ലാവർക്കും തുറന്നിരിക്കുന്നു">✓*</span>'
      : v ? '<span class="yes" aria-label="അനുവദനീയം">✓</span>' : '<span class="no" aria-label="ഇല്ല">—</span>');
    // opened to everyone in ക്രമീകരണങ്ങൾ: readers get it too (not visitors, not blocked users)
    const openTo = (p) => (r) => (r >= rank[Cloud.PERMS[p]] ? true : Cloud.isOpen(p) && r >= rank.reader ? 'open' : false);
    const rows = [
      ['വായിക്കുക, തിരയുക', () => true],
      ['സ്വന്തം ഹൈലൈറ്റ് / കുറിപ്പ് എല്ലാ ഉപകരണങ്ങളിലും (സിങ്ക്)', (r) => r >= rank.reader],
      ...Object.keys(Cloud.PERMS).map((p) => [PERM_LABEL[p] || p, openTo(p), Cloud.PERMS[p]]),
    ];
    const anyOpen = Object.keys(Cloud.OPEN_PERMS).some((p) => Cloud.isOpen(p));
    body.innerHTML = `<div class="adm-scroll"><table class="adm-matrix"><thead><tr><th>അനുമതി</th>${cols.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r[0]}${r[2] ? ` <small class="hint">(${esc(r[2])}+)</small>` : ''}</td>${cols.map((c) => `<td>${tick(r[1](c[2]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${anyOpen ? '<p class="hint">✓* = <a href="#settings">ക്രമീകരണങ്ങളിൽ</a> ലോഗിൻ ചെയ്ത എല്ലാവർക്കും തുറന്നിരിക്കുന്നു.</p>' : ''}
      <p class="hint">ഈ നിയമങ്ങൾ Firebase സെർവറിൽ (firestore.rules) നടപ്പാക്കുന്നു — പേജിന്റെ കോഡ് മാറ്റി മറികടക്കാനാവില്ല. ഉടമയുടെ ഇമെയിൽ (APP_OWNERS) എപ്പോഴും അഡ്മിൻ ആണ്. Firebase ഇല്ലാത്ത ലോക്കൽ മോഡിൽ: ഡിസ്കിൽ നിന്നോ localhost-ൽ നിന്നോ തുറക്കുമ്പോൾ ഉടമയുടെ പാസ്‌കോഡ് നൽകിയാൽ എല്ലാം; പൊതു വെബ്സൈറ്റിൽ എല്ലാവർക്കും വായന മാത്രം.</p>`;
  };

  // -- activity log --
  RENDER.activity = async (body) => {
    body.innerHTML = `<div class="adm-toolbar">
        <select id="actBy" aria-label="ഉപയോക്താവ്"><option value="">എല്ലാ ഉപയോക്താക്കളും</option></select>
        <select id="actAction" aria-label="പ്രവർത്തനം"><option value="">എല്ലാ പ്രവർത്തനങ്ങളും</option>${Object.keys(ACTION_LABEL).map((a) => `<option value="${a}">${ACTION_LABEL[a]}</option>`).join('')}</select>
      </div>
      <div id="actList">${spinner}</div>
      <nav class="adm-pager" id="actPager" aria-label="പേജുകൾ" hidden>
        <button class="btn" id="actPrev"><svg><use href="#i-left"/></svg>മുൻ പേജ്</button>
        <span class="adm-pager-info" id="actInfo" aria-live="polite"></span>
        <button class="btn" id="actNext">അടുത്ത പേജ്<svg><use href="#i-right"/></svg></button>
      </nav>`;
    usersList().then((users) => {
      if (!still('activity')) return;
      $('#actBy').insertAdjacentHTML('beforeend', users.filter((u) => u.email).map((u) => `<option value="${esc(u.email)}">${esc(u.email)}</option>`).join(''));
    }).catch(() => {});
    // cursors[i] is where page i starts (page 0 starts at the top); going back reuses a saved cursor
    const PAGE = 50;
    let cursors = [null], pageNo = 0, hasNext = false, seq = 0;
    const setBusy = (busy) => {
      $('#actPrev').disabled = busy || pageNo === 0;
      $('#actNext').disabled = busy || !hasNext;
    };
    const load = async (to) => {
      const my = ++seq;                          // a newer request (filter change, quick clicks) wins
      setBusy(true);
      $('#actList').innerHTML = spinner;
      try {
        const page = await Cloud.listChanges({ limit: PAGE, by: $('#actBy').value, action: $('#actAction').value, cursor: cursors[to] });
        if (!still('activity') || my !== seq) return;
        pageNo = to;
        hasNext = !!page.cursor;
        cursors = cursors.slice(0, to + 1);
        if (page.cursor) cursors.push(page.cursor);
        $('#actList').innerHTML = activityTable(page.items);
        const from = to * PAGE + 1;
        $('#actInfo').textContent = page.items.length ? `പേജ് ${to + 1} · ${from}–${from + page.items.length - 1}` : '';
        $('#actPager').hidden = to === 0 && !hasNext;
      } catch (e) {
        if (!still('activity') || my !== seq) return;
        $('#actList').innerHTML = failMsg(e);
      }
      setBusy(false);
    };
    const turn = (to) => { load(to).then(() => { if (still('activity')) $('#actList').scrollIntoView({ block: 'start' }); }); };
    const restart = () => { cursors = [null]; pageNo = 0; hasNext = false; load(0); };
    $('#actBy').addEventListener('change', restart);
    $('#actAction').addEventListener('change', restart);
    $('#actPrev').addEventListener('click', () => { if (pageNo > 0) turn(pageNo - 1); });
    $('#actNext').addEventListener('click', () => { if (hasNext) turn(pageNo + 1); });
    load(0);
  };

  // -- content: chapters that differ from the bundled text --
  RENDER.content = async (body) => {
    body.innerHTML = spinner;
    let rows;
    try { rows = cloudMode ? await cloudChapters() : await localChapters(); } catch (e) { if (still('content')) body.innerHTML = failMsg(e); return; }
    if (!still('content')) return;
    const kindLabel = { edited: 'തിരുത്തിയത്', uploaded: 'അപ്‌ലോഡ്', hidden: 'മറച്ചത്' };
    body.innerHTML = `<p class="hint">${cloudMode
      ? 'Firestore-ൽ സൂക്ഷിച്ച തിരുത്തലുകൾ (എല്ലാവർക്കും കാണുന്നത്). "യഥാർത്ഥത്തിലേക്ക്" = ആ അധ്യായത്തിന്റെ തിരുത്തൽ മായ്ച്ച് ആപ്പിലെ യഥാർത്ഥ പാഠം; അപ്‌ലോഡ് ചെയ്ത അധ്യായം പൂർണ്ണമായും നീക്കും.'
      : 'ഈ ബ്രൗസറിൽ സൂക്ഷിച്ച തിരുത്തലുകൾ (ലോക്കൽ മോഡ്). "യഥാർത്ഥത്തിലേക്ക്" = ആ അധ്യായത്തിന്റെ തിരുത്തൽ മായ്ക്കും.'}</p>
      ${rows.length ? `<table class="adm-table"><thead><tr><th>പുസ്തകം</th><th>അധ്യായം</th><th>തരം</th><th>തിരുത്തിയത്</th><th>സമയം</th><th></th></tr></thead><tbody>
      ${rows.map((c) => `<tr>
        <td data-label="പുസ്തകം"><strong>${esc(c.bookName || bookName(c.book))}</strong></td>
        <td data-label="അധ്യായം">${c.kind === 'hidden' ? c.chapter : `<a href="${esc(readerUrl)}#/${encodeURIComponent(c.book)}/${c.chapter}" title="വായനയിൽ തുറക്കുക">${c.chapter} <svg class="adm-ext"><use href="#i-open"/></svg></a>`}</td>
        <td data-label="തരം"><span class="adm-kind k-${c.kind}">${kindLabel[c.kind]}</span></td>
        <td data-label="തിരുത്തിയത്" class="adm-wrap">${esc(c.by || '—')}</td>
        <td data-label="സമയം">${esc(c.at ? fmtTime(c.at) : '—')}</td>
        <td class="adm-act"><button class="btn sm danger" data-revert="${esc(c.book)}|${c.chapter}|${c.kind}"><svg><use href="#${c.kind === 'uploaded' ? 'i-trash' : 'i-reset'}"/></svg><span>${c.kind === 'uploaded' ? 'നീക്കുക' : 'യഥാർത്ഥത്തിലേക്ക്'}</span></button></td></tr>`).join('')}
      </tbody></table>` : '<div class="adm-empty">തിരുത്തിയ അധ്യായങ്ങൾ ഒന്നുമില്ല — എല്ലാം യഥാർത്ഥ പാഠം</div>'}`;
    body.onclick = async (e) => {
      const b = e.target.closest('[data-revert]');
      if (!b) return;
      const [book, ch, kind] = b.dataset.revert.split('|');
      const name = `${bookName(book)} ${ch}`;
      const text = kind === 'uploaded'
        ? `അപ്‌ലോഡ് ചെയ്ത ${name} പൂർണ്ണമായും നീക്കണോ?${cloudMode ? ' എല്ലാ ഉപയോക്താക്കൾക്കും ബാധകം.' : ''}`
        : `${name}-ലെ തിരുത്തലുകൾ മായ്ച്ച് യഥാർത്ഥ പാഠം തിരികെ കൊണ്ടുവരണോ?${cloudMode ? ' എല്ലാ ഉപയോക്താക്കൾക്കും ബാധകം.' : ''}`;
      if (!(await confirmBox(kind === 'uploaded' ? 'അധ്യായം നീക്കുക' : 'യഥാർത്ഥത്തിലേക്ക് മാറ്റുക', text, kind === 'uploaded' ? 'നീക്കുക' : 'മാറ്റുക'))) return;
      try {
        if (cloudMode) await Cloud.revertChapter(book, +ch);
        else revertLocal(book, +ch);
        toast(name + (kind === 'uploaded' ? ' നീക്കി' : ' — യഥാർത്ഥ പാഠം'));
      } catch (err) { cloudError(err); }
      RENDER.content(body);
    };
  };
  async function cloudChapters() {
    const list = await Cloud.listChapters();
    return list.map((c) => ({
      book: c.book, chapter: c.chapter, bookName: c.bookName, by: c.updatedBy, at: c.updatedAt,
      kind: c.deleted ? 'hidden' : c.hasBase ? 'edited' : 'uploaded',
    })).sort((a, b) => tms(b.at) - tms(a.at));
  }
  const loadScript = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
  const readOverlay = () => { try { return JSON.parse(localStorage.getItem('mlb.overlay') || 'null') || { books: {} }; } catch (e) { return { books: {} }; } };
  async function localChapters() {
    if (!window.BIBLE_DATA) await loadScript('js/data.js');   // to tell edits from uploads
    const base = new Map(((window.BIBLE_DATA || {}).books || []).map((b) => [b.id, b]));
    const rows = [];
    for (const [id, ob] of Object.entries(readOverlay().books || {})) {
      for (const [n, items] of Object.entries(ob.chapters || {})) {
        const bb = base.get(id);
        rows.push({ book: id, chapter: +n, bookName: ob.name, kind: items === null ? 'hidden' : bb && bb.chapters[n] ? 'edited' : 'uploaded' });
      }
    }
    const order = (id) => (catById.has(id) ? catById.get(id).order : 1000);
    return rows.sort((a, b) => order(a.book) - order(b.book) || a.chapter - b.chapter);
  }
  function revertLocal(book, ch) {
    if (!LocalOwner.isUnlocked()) throw Object.assign(new Error('locked'), { code: 'permission-denied' });
    const o = readOverlay();
    const ob = o.books[book];
    if (!ob || !ob.chapters) return;
    delete ob.chapters[ch];
    if (!Object.keys(ob.chapters).length) delete o.books[book];
    localStorage.setItem('mlb.overlay', JSON.stringify(o));
  }

  // -- passkeys --
  RENDER.passkeys = async (body) => {
    $('#secActions').innerHTML = Cloud.passkeySupported() && Cloud.PROVIDERS.passkey
      ? '<button class="btn primary" id="pkAdd"><svg><use href="#i-key"/></svg><span>എനിക്ക് പാസ്‌കീ ചേർക്കുക</span></button>' : '';
    const add = $('#pkAdd');
    if (add) {
      add.addEventListener('click', async () => {
        try { await Cloud.registerPasskey('അഡ്മിൻ പോർട്ടൽ · ' + (navigator.platform || 'ഉപകരണം')); toast('പാസ്‌കീ ചേർത്തു'); RENDER.passkeys(body); } catch (err) {
          if (!err || err.code !== 'passkey/cancelled') toast(AuthUI.message(err), 5000);
        }
      });
    }
    body.innerHTML = spinner;
    let keys, users;
    try { [keys, users] = await Promise.all([Cloud.listAllPasskeys(), usersList().catch(() => [])]); } catch (e) { if (still('passkeys')) body.innerHTML = failMsg(e); return; }
    if (!still('passkeys')) return;
    const who = new Map(users.map((u) => [u.uid, u]));
    keys.sort((a, b) => tms(b.createdAt) - tms(a.createdAt));
    body.innerHTML = `<p class="hint">ഓരോ പാസ്‌കീയും ഒരു ഉപകരണത്തിലെ (ഫോൺ, ലാപ്‌ടോപ്പ്, സെക്യൂരിറ്റി കീ) ലോഗിൻ ആണ്. റദ്ദാക്കിയാൽ അത് ഉപയോഗിച്ച് ഇനി ലോഗിൻ ചെയ്യാനാവില്ല.</p>
      ${keys.length ? `<table class="adm-table"><thead><tr><th>ഉപയോക്താവ്</th><th>പേര്</th><th>ചേർത്തത്</th><th>അവസാനം ഉപയോഗിച്ചത്</th><th></th></tr></thead><tbody>
      ${keys.map((k) => { const u = who.get(k.uid); return `<tr>
        <td data-label="ഉപയോക്താവ്" class="adm-wrap"><strong>${esc(u ? u.email || u.name : k.uid)}</strong></td>
        <td data-label="പേര്">${esc(k.name || '—')}</td>
        <td data-label="ചേർത്തത്">${esc(fmtTime(k.createdAt))}</td>
        <td data-label="അവസാനം ഉപയോഗിച്ചത്">${esc(k.lastUsedAt ? fmtTime(k.lastUsedAt) : 'ഇതുവരെ ഇല്ല')}</td>
        <td class="adm-act"><button class="btn sm danger" data-pk="${esc(k.id)}"><svg><use href="#i-trash"/></svg><span>റദ്ദാക്കുക</span></button></td></tr>`; }).join('')}
      </tbody></table>` : '<div class="adm-empty">പാസ്‌കീകൾ ഒന്നുമില്ല</div>'}`;
    body.onclick = async (e) => {
      const b = e.target.closest('[data-pk]');
      if (!b) return;
      if (!(await confirmBox('പാസ്‌കീ റദ്ദാക്കുക', 'ഈ പാസ്‌കീ റദ്ദാക്കണോ? ആ ഉപകരണത്തിൽ നിന്ന് അത് ഉപയോഗിച്ച് ഇനി ലോഗിൻ ചെയ്യാനാവില്ല.', 'റദ്ദാക്കുക'))) return;
      try { await Cloud.deletePasskey(b.dataset.pk); toast('പാസ്‌കീ റദ്ദാക്കി'); } catch (err) { cloudError(err); }
      RENDER.passkeys(body);
    };
  };

  // -- login methods --
  RENDER.methods = async (body) => {
    const P = Cloud.PROVIDERS;
    const rows = [
      ['google', 'Google', 'Firebase → Authentication → Sign-in method → Google'],
      ['github', 'GitHub', 'GitHub OAuth App + Firebase → GitHub'],
      ['microsoft', 'Microsoft', 'Azure App registration + Firebase → Microsoft (tenant: ' + esc(window.MICROSOFT_TENANT || 'common') + ')'],
      ['emailLink', 'ഇമെയിൽ ലിങ്ക് (പാസ്‌വേഡ് ഇല്ലാതെ)', 'Firebase → Email/Password → Email link'],
      ['password', 'ഇമെയിൽ + പാസ്‌വേഡ്', 'Firebase → Email/Password'],
      ['passkey', 'പാസ്‌കീ', 'Cloudflare Pages Function + FIREBASE_SERVICE_ACCOUNT'],
    ];
    const on = (v) => (v ? '<span class="adm-pill ok">ഓൺ</span>' : '<span class="adm-pill">ഓഫ്</span>');
    body.innerHTML = `<table class="adm-table"><thead><tr><th>രീതി</th><th>AUTH_PROVIDERS</th><th>സജ്ജമാക്കേണ്ടത്</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td data-label="രീതി"><strong>${r[1]}</strong></td><td data-label="AUTH_PROVIDERS">${on(P[r[0]])}</td><td data-label="സജ്ജമാക്കേണ്ടത്" class="hint">${r[2]}</td></tr>`).join('')}
      </tbody></table>
      <div class="adm-card"><strong>പാസ്‌കീ സെർവർ</strong> (<code>/api/passkey/challenge</code>): <span id="pkServer"><span class="spin"></span></span></div>
      <div class="adm-card"><strong>സജ്ജീകരണം — ചെക്ക്‌ലിസ്റ്റ്</strong> (വിശദമായി README → “Login and permissions”)
        <ol class="adm-check">
          <li>Firebase പ്രോജക്റ്റ്; <code>app/js/firebase-config.js</code>-ൽ <code>FIREBASE_CONFIG</code>.</li>
          <li>Authentication → Settings → Authorized domains: സൈറ്റിന്റെ ഡൊമെയ്ൻ (ഉദാ. <code>${esc(location.hostname)}</code>).</li>
          <li>Sign-in method: Google; GitHub (OAuth App, callback <code>https://&lt;project&gt;.firebaseapp.com/__/auth/handler</code>); Microsoft (Azure, അതേ redirect URI); Email/Password + Email link.</li>
          <li>ഉപയോഗിക്കാത്ത രീതികൾ <code>window.AUTH_PROVIDERS</code>-ൽ <code>false</code> ആക്കുക.</li>
          <li>പാസ്‌കീ: Firebase → Project settings → Service accounts → Generate new private key; Cloudflare Pages → Settings → Variables and Secrets: <code>FIREBASE_SERVICE_ACCOUNT</code> (JSON), <code>PASSKEY_SECRET</code> (ക്രമരഹിതമായ നീണ്ട വാക്ക്).</li>
          <li><code>firestore.rules</code> Firebase-ൽ പ്രസിദ്ധീകരിക്കുക (ഓരോ മാറ്റത്തിനു ശേഷവും).</li>
        </ol>
      </div>`;
    const out = $('#pkServer');
    let text;
    if (!/^https?:/.test(location.protocol)) text = '<span class="adm-pill">പരിശോധിക്കാനാവില്ല (file://)</span>';
    else {
      try {
        const res = await fetch('/api/passkey/challenge', { cache: 'no-store' });
        const j = await res.json().catch(() => null);
        text = res.ok && j && j.challenge ? '<span class="adm-pill ok">പ്രവർത്തിക്കുന്നു</span>'
          : res.status === 503 ? '<span class="adm-pill warn">ഫംഗ്ഷൻ ഉണ്ട്, പക്ഷേ FIREBASE_SERVICE_ACCOUNT സജ്ജമാക്കിയിട്ടില്ല</span>'
            : `<span class="adm-pill warn">ലഭ്യമല്ല (HTTP ${res.status}) — Cloudflare Pages Functions വിന്യസിച്ചിട്ടുണ്ടോ?</span>`;
      } catch (e) { text = '<span class="adm-pill warn">ബന്ധപ്പെടാനായില്ല</span>'; }
    }
    if (still('methods')) out.innerHTML = text;
  };

  // ---------- start ----------
  // offline: the same service worker as the reader, so a portal opened directly works offline too
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  if (cloudMode) {
    Cloud.on((type, data) => {
      if (type === 'auth') { authKnown = true; evaluate(); }
      else if (type === 'role') {
        evaluate();
        if (!$('#admShell').hidden) toast('നിങ്ങളുടെ റോൾ: ' + (ROLE_LABEL[Cloud.role] || Cloud.role));
      } else if (type === 'settings') {
        // changed here or by another admin: redraw the pages that show it
        if ($('#admShell').hidden || settingsSaving) return;
        if (current === 'settings' || (data && data.changed && current === 'roles')) RENDER[current]($('#secBody'));
      } else if (type === 'error') console.warn('cloud:', data && (data.code || data.message));
    });
    showOnly('boot');
    Cloud.init({ chapters: false }).catch((err) => {
      console.warn('cloud init failed', err);
      $('#admBoot').innerHTML = `<div class="adm-denied-card"><h1>ബന്ധിപ്പിക്കാനായില്ല</h1><p>ഇന്റർനെറ്റ് പരിശോധിച്ച് വീണ്ടും ശ്രമിക്കുക.</p><div class="adm-denied-actions"><button class="btn primary" onclick="location.reload()">വീണ്ടും ശ്രമിക്കുക</button><a class="btn" href="${esc(readerUrl)}">വായനയിലേക്ക് മടങ്ങുക</a></div></div>`;
    });
  } else {
    LocalOwner.on(evaluate);
    evaluate();
  }
})();
