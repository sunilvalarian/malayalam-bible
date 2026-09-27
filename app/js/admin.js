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
  };
  const PERM_LABEL = {
    edit: 'വാക്യം / അധ്യായം തിരുത്തുക', upload: 'PDF അപ്‌ലോഡ്', restore: 'യഥാർത്ഥ പാഠം / ബാക്കപ്പ് പുനഃസ്ഥാപിക്കുക',
    export: 'data.js, ബാക്കപ്പ്, HTML ഡൗൺലോഡ്', delete: 'അധ്യായം നീക്കുക', reset: 'എല്ലാ തിരുത്തലുകളും മായ്ക്കുക',
    users: 'അഡ്മിൻ പോർട്ടൽ: ഉപയോക്താക്കൾ, റോളുകൾ, ക്ഷണങ്ങൾ, ചരിത്രം, പാസ്‌കീകൾ',
  };
  const SECTIONS = [
    { id: 'dashboard', icon: 'i-grid', title: 'ഡാഷ്‌ബോർഡ്', cloud: true },
    { id: 'users', icon: 'i-users', title: 'ഉപയോക്താക്കൾ', cloud: true },
    { id: 'invites', icon: 'i-mail', title: 'ക്ഷണങ്ങൾ', cloud: true },
    { id: 'roles', icon: 'i-shield', title: 'അനുമതികൾ', cloud: true },
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
  AuthUI.configure({ dismissible: false, notify: (m) => toast(m, 4500) });
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
        <div class="adm-denied-actions">
          <button class="btn" id="deniedLogout"><svg><use href="#i-logout"/></svg><span>ലോഗൗട്ട്</span></button>
          <a class="btn primary" href="${esc(readerUrl)}"><svg><use href="#i-left"/></svg><span>വായനയിലേക്ക് മടങ്ങുക</span></a>
        </div>
      </div>`;
    $('#deniedLogout').addEventListener('click', () => Cloud.signOut());
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
  function route(force) {
    if ($('#admShell').hidden) return;
    const list = sections();
    let id = location.hash.replace(/^#/, '');
    if (!list.some((s) => s.id === id)) id = list[0].id;
    if (id === current && !force) return;
    current = id;
    const sec = SECTIONS.find((s) => s.id === id);
    $$('#admLinks [data-sec]').forEach((a) => a.setAttribute('aria-current', a.dataset.sec === id ? 'page' : 'false'));
    $('#secTitle').textContent = sec.title;
    $('#secActions').innerHTML = '';
    document.title = sec.title + ' · അഡ്മിനിസ്ട്രേറ്റർ പോർട്ടൽ';
    setMenu(false);
    RENDER[id]($('#secBody'));
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

  RENDER.dashboard = async (body) => {
    body.innerHTML = spinner;
    const safe = (p) => p.catch((e) => { console.warn(e); return null; });
    const [users, invites, chapters, passkeys, changes] = await Promise.all([
      safe(Cloud.listUsers()), safe(Cloud.listInvites()), safe(Cloud.listChapters()), safe(Cloud.listAllPasskeys()), safe(Cloud.listChanges({ limit: 10 })),
    ]);
    if (!still('dashboard')) return;
    const byRole = { admin: 0, editor: 0, reader: 0, none: 0 };
    (users || []).forEach((u) => { byRole[u.role] = (byRole[u.role] || 0) + 1; });
    const edited = (chapters || []).filter((c) => !c.deleted && c.hasBase).length;
    const uploaded = (chapters || []).filter((c) => !c.deleted && !c.hasBase).length;
    const hidden = (chapters || []).filter((c) => c.deleted).length;
    const n = (x) => (x == null ? '—' : x);
    const card = (href, label, value, detail) => `<a class="adm-stat" href="#${href}"><span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ''}</a>`;
    body.innerHTML = `<div class="adm-stats">
        ${card('users', 'ഉപയോക്താക്കൾ', n(users && users.length), users ? `അഡ്മിൻ ${byRole.admin} · എഡിറ്റർ ${byRole.editor} · വായനക്കാർ ${byRole.reader} · തടഞ്ഞു ${byRole.none}` : '')}
        ${card('invites', 'ക്ഷണങ്ങൾ (ബാക്കി)', n(invites && invites.length), '')}
        ${card('content', 'തിരുത്തിയ അധ്യായങ്ങൾ', n(chapters && chapters.length), chapters ? `തിരുത്ത് ${edited} · അപ്‌ലോഡ് ${uploaded} · മറച്ചത് ${hidden}` : '')}
        ${card('passkeys', 'പാസ്‌കീകൾ', n(passkeys && passkeys.length), '')}
      </div>
      <h2 class="adm-h2">അവസാന 10 പ്രവർത്തനങ്ങൾ</h2>
      ${changes ? activityTable(changes.items) : failMsg()}
      <p><a class="btn" href="#activity">മുഴുവൻ ചരിത്രം</a></p>`;
  };

  function activityTable(items) {
    if (!items.length) return '<div class="adm-empty">പ്രവർത്തനങ്ങൾ ഒന്നുമില്ല</div>';
    return `<table class="adm-table"><thead><tr><th>സമയം</th><th>പ്രവർത്തനം</th><th>അധ്യായം</th><th>ആര്</th></tr></thead><tbody>
      ${items.map((c) => `<tr>
        <td data-label="സമയം">${esc(fmtTime(c.at))}</td>
        <td data-label="പ്രവർത്തനം">${esc(ACTION_LABEL[c.action] || c.action)}</td>
        <td data-label="അധ്യായം">${c.book && c.book !== '-' ? `<a href="${esc(readerUrl)}#/${encodeURIComponent(c.book)}/${+c.chapter}">${esc(bookName(c.book))} ${+c.chapter}</a>` : '—'}</td>
        <td data-label="ആര്">${esc(c.by || '')}</td></tr>`).join('')}
      </tbody></table>`;
  }

  // -- users --
  RENDER.users = async (body) => {
    body.innerHTML = spinner;
    let users;
    try { users = await Cloud.listUsers(); } catch (e) { if (still('users')) body.innerHTML = failMsg(e); return; }
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
      $('#userTable').innerHTML = list.length ? `<table class="adm-table"><thead><tr><th>പേര്</th><th>ഇമെയിൽ</th><th>ലോഗിൻ രീതി</th><th>റോൾ</th><th>ചേർന്നത്</th><th>അവസാനം കണ്ടത്</th></tr></thead><tbody>
        ${list.map((u) => {
          const self = u.uid === Cloud.user.uid;
          const owner = Cloud.isOwnerEmail(u.email);
          const locked = self || owner;
          const tag = owner ? ' <span class="adm-tag">ഉടമ</span>' : self ? ' <span class="adm-tag">നിങ്ങൾ</span>' : '';
          return `<tr class="${u.role === 'none' ? 'blocked' : ''}">
            <td data-label="പേര്"><strong>${esc(u.name || '—')}</strong>${tag}</td>
            <td data-label="ഇമെയിൽ" class="adm-wrap">${esc(u.email || '')}</td>
            <td data-label="ലോഗിൻ രീതി">${esc(methodName(u.provider))}</td>
            <td data-label="റോൾ"><select class="u-role" data-uid="${esc(u.uid)}" data-email="${esc(u.email || '')}" aria-label="റോൾ: ${esc(u.email || '')}" ${locked ? 'disabled' : ''}>${roleOptions(u.role, ['reader', 'editor', 'admin', 'none'])}</select></td>
            <td data-label="ചേർന്നത്">${esc(fmtTime(u.createdAt))}</td>
            <td data-label="അവസാനം കണ്ടത്">${esc(fmtTime(u.lastLogin))}</td></tr>`;
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

  // -- role × permission matrix, generated from Cloud.PERMS --
  RENDER.roles = (body) => {
    const rank = Cloud.ROLE_RANK;
    const cols = [['guest', 'ലോഗിൻ ഇല്ലാതെ', -1], ['none', ROLE_LABEL.none, 0], ['reader', ROLE_LABEL.reader, 1], ['editor', ROLE_LABEL.editor, 2], ['admin', ROLE_LABEL.admin, 3]];
    const tick = (v) => (v ? '<span class="yes" aria-label="അനുവദനീയം">✓</span>' : '<span class="no" aria-label="ഇല്ല">—</span>');
    const rows = [
      ['വായിക്കുക, തിരയുക', () => true],
      ['സ്വന്തം ഹൈലൈറ്റ് / കുറിപ്പ് എല്ലാ ഉപകരണങ്ങളിലും (സിങ്ക്)', (r) => r >= rank.reader],
      ...Object.keys(Cloud.PERMS).map((p) => [PERM_LABEL[p] || p, (r) => r >= rank[Cloud.PERMS[p]], Cloud.PERMS[p]]),
    ];
    body.innerHTML = `<div class="adm-scroll"><table class="adm-matrix"><thead><tr><th>അനുമതി</th>${cols.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r[0]}${r[2] ? ` <small class="hint">(${esc(r[2])}+)</small>` : ''}</td>${cols.map((c) => `<td>${tick(r[1](c[2]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="hint">ഈ നിയമങ്ങൾ Firebase സെർവറിൽ (firestore.rules) നടപ്പാക്കുന്നു — പേജിന്റെ കോഡ് മാറ്റി മറികടക്കാനാവില്ല. ഉടമയുടെ ഇമെയിൽ (APP_OWNERS) എപ്പോഴും അഡ്മിൻ ആണ്. Firebase ഇല്ലാത്ത ലോക്കൽ മോഡിൽ: ഡിസ്കിൽ നിന്നോ localhost-ൽ നിന്നോ തുറക്കുമ്പോൾ ഉടമയുടെ പാസ്‌കോഡ് നൽകിയാൽ എല്ലാം; പൊതു വെബ്സൈറ്റിൽ എല്ലാവർക്കും വായന മാത്രം.</p>`;
  };

  // -- activity log --
  RENDER.activity = async (body) => {
    body.innerHTML = `<div class="adm-toolbar">
        <select id="actBy" aria-label="ഉപയോക്താവ്"><option value="">എല്ലാ ഉപയോക്താക്കളും</option></select>
        <select id="actAction" aria-label="പ്രവർത്തനം"><option value="">എല്ലാ പ്രവർത്തനങ്ങളും</option>${Object.keys(ACTION_LABEL).map((a) => `<option value="${a}">${ACTION_LABEL[a]}</option>`).join('')}</select>
      </div>
      <div id="actList">${spinner}</div>
      <p class="adm-more"><button class="btn" id="actMore" hidden>കൂടുതൽ കാണിക്കുക</button></p>`;
    Cloud.listUsers().then((users) => {
      if (!still('activity')) return;
      $('#actBy').insertAdjacentHTML('beforeend', users.filter((u) => u.email).map((u) => `<option value="${esc(u.email)}">${esc(u.email)}</option>`).join(''));
    }).catch(() => {});
    let cursor = null, items = [];
    const load = async (more) => {
      if (!more) { items = []; cursor = null; $('#actList').innerHTML = spinner; }
      $('#actMore').disabled = true;
      try {
        const page = await Cloud.listChanges({ limit: 50, by: $('#actBy').value, action: $('#actAction').value, cursor: more ? cursor : null });
        if (!still('activity')) return;
        items = items.concat(page.items);
        cursor = page.cursor;
        $('#actList').innerHTML = activityTable(items);
        $('#actMore').hidden = !cursor;
      } catch (e) { if (still('activity')) $('#actList').innerHTML = failMsg(e); }
      $('#actMore').disabled = false;
    };
    $('#actBy').addEventListener('change', () => load(false));
    $('#actAction').addEventListener('change', () => load(false));
    $('#actMore').addEventListener('click', () => load(true));
    load(false);
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
    try { [keys, users] = await Promise.all([Cloud.listAllPasskeys(), Cloud.listUsers().catch(() => [])]); } catch (e) { if (still('passkeys')) body.innerHTML = failMsg(e); return; }
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
  if (cloudMode) {
    Cloud.on((type, data) => {
      if (type === 'auth') { authKnown = true; evaluate(); }
      else if (type === 'role') {
        evaluate();
        if (!$('#admShell').hidden) toast('നിങ്ങളുടെ റോൾ: ' + (ROLE_LABEL[Cloud.role] || Cloud.role));
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
