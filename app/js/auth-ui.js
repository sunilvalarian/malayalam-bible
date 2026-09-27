/*
 * Shared login screen (single sign-on): the reader (index.html) and the administrator portal
 * (admin.html) use this same screen and the same Firebase session, so signing in or out on one
 * page applies to the other as well (Firebase keeps the session per site, not per page).
 * Needs cloud.js. Injects <dialog id="dlgLogin"> into the page; styles are in style.css (.auth-*).
 */
(function () {
  'use strict';

  const Cloud = window.Cloud;
  const LocalOwner = window.LocalOwner;
  const P = (Cloud && Cloud.PROVIDERS) || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const LOGO_GOOGLE = '<svg class="auth-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z"/><path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.3V7.1H2.2a11 11 0 0 0 0 9.9z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3 .6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>';
  const LOGO_GITHUB = '<svg class="auth-logo gh" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';
  const LOGO_MICROSOFT = '<svg class="auth-logo" viewBox="0 0 23 23" aria-hidden="true"><rect x="1" y="1" width="10" height="10" fill="#F25022"/><rect x="12" y="1" width="10" height="10" fill="#7FBA00"/><rect x="1" y="12" width="10" height="10" fill="#00A4EF"/><rect x="12" y="12" width="10" height="10" fill="#FFB900"/></svg>';

  const METHOD_NAME = {
    'google.com': 'Google', 'github.com': 'GitHub', 'microsoft.com': 'Microsoft',
    password: 'ഇമെയിൽ + പാസ്‌വേഡ്', emailLink: 'ഇമെയിൽ ലിങ്ക്', passkey: 'പാസ്‌കീ',
  };
  const methodName = (id) => METHOD_NAME[id] || id || '';

  // Firebase's own e-mails often land in Spam / Promotions: say where to look and who sends them
  const SENDER = (Cloud && Cloud.mailSender) || '';
  const mailHint = () => 'ഇൻബോക്സിൽ കാണുന്നില്ലെങ്കിൽ Spam / Promotions ഫോൾഡറുകൾ നോക്കുക' + (SENDER ? ` — അയയ്ക്കുന്നത് ${SENDER}` : '') + '. എത്താൻ ഒന്നുരണ്ട് മിനിറ്റ് എടുത്തേക്കാം.';
  const isGmail = (email) => /@(gmail|googlemail)\.com$/i.test(email || '');

  function message(e) {
    const c = (e && e.code) || '';
    if (c === 'auth/account-exists-with-different-credential') {
      const pl = (e && e.pendingLink) || (Cloud && Cloud.pendingLink) || {};
      const other = methodName(pl.providerId) || 'ഈ രീതി';
      const methods = (pl.methods || []).filter((m) => m !== pl.providerId).map((m) => methodName(m === 'emailLink' ? 'emailLink' : m));
      const email = pl.email ? ` (${pl.email})` : '';
      return methods.length
        ? `ഈ ഇമെയിലിൽ${email} ഇതിനകം ${methods.join(' / ')} ഉപയോഗിച്ച് അക്കൗണ്ട് ഉണ്ട്. ആദ്യം ആ രീതിയിൽ ലോഗിൻ ചെയ്യുക — അതിനുശേഷം ${other} ഈ അക്കൗണ്ടിലേക്ക് സ്വയം ചേർക്കും.`
        : `ഈ ഇമെയിലിൽ${email} മറ്റൊരു രീതിയിൽ (Google, Microsoft, GitHub, ഇമെയിൽ ലിങ്ക് അല്ലെങ്കിൽ പാസ്‌വേഡ്) ഇതിനകം അക്കൗണ്ട് ഉണ്ട്. ആദ്യം ഉപയോഗിച്ച രീതിയിൽ ലോഗിൻ ചെയ്യുക — അതിനുശേഷം ${other} ഈ അക്കൗണ്ടിലേക്ക് സ്വയം ചേർക്കും.`;
    }
    const map = {
      'auth/invalid-credential': 'ഇമെയിൽ അല്ലെങ്കിൽ പാസ്‌വേഡ് തെറ്റാണ്',
      'auth/invalid-login-credentials': 'ഇമെയിൽ അല്ലെങ്കിൽ പാസ്‌വേഡ് തെറ്റാണ്',
      'auth/wrong-password': 'ഇമെയിൽ അല്ലെങ്കിൽ പാസ്‌വേഡ് തെറ്റാണ്',
      'auth/user-not-found': 'ഈ ഇമെയിലിൽ അക്കൗണ്ട് ഇല്ല — "രജിസ്റ്റർ ചെയ്യുക" തിരഞ്ഞെടുക്കുക',
      'auth/email-already-in-use': 'ഈ ഇമെയിലിൽ ഇതിനകം അക്കൗണ്ട് ഉണ്ട് — ലോഗിൻ ചെയ്യുക',
      'auth/weak-password': 'പാസ്‌വേഡിന് കുറഞ്ഞത് 6 അക്ഷരങ്ങൾ വേണം',
      'auth/invalid-email': 'ശരിയായ ഇമെയിൽ വിലാസം നൽകുക',
      'auth/missing-email': 'ഇമെയിൽ വിലാസം നൽകുക',
      'auth/missing-password': 'പാസ്‌വേഡ് നൽകുക',
      'auth/too-many-requests': 'വളരെയധികം ശ്രമങ്ങൾ — കുറച്ച് കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കുക',
      // Firebase's free plan caps the e-mails it sends per day (e-mail sign-in links: only 5 a day)
      'auth/quota-exceeded': 'ഇന്ന് അയയ്ക്കാവുന്ന ഇമെയിലുകളുടെ പരിധി കഴിഞ്ഞു — Google ഉപയോഗിച്ച് ലോഗിൻ ചെയ്യുക, അല്ലെങ്കിൽ നാളെ വീണ്ടും ശ്രമിക്കുക',
      'auth/network-request-failed': 'നെറ്റ്‌വർക്ക് പ്രശ്നം — ഇന്റർനെറ്റ് പരിശോധിക്കുക',
      'auth/unauthorized-domain': 'ഈ വെബ്സൈറ്റ് Firebase-ൽ അനുവദിച്ചിട്ടില്ല (Authorized domains)',
      'auth/unauthorized-continue-uri': 'ഈ വെബ്സൈറ്റ് Firebase-ൽ അനുവദിച്ചിട്ടില്ല (Authorized domains)',
      'auth/operation-not-allowed': 'ഈ ലോഗിൻ രീതി Firebase-ൽ ഓൺ ചെയ്തിട്ടില്ല — അഡ്മിനെ അറിയിക്കുക',
      'auth/admin-restricted-operation': 'ഈ ലോഗിൻ രീതി Firebase-ൽ ഓൺ ചെയ്തിട്ടില്ല — അഡ്മിനെ അറിയിക്കുക',
      'auth/popup-blocked': 'ബ്രൗസർ ലോഗിൻ വിൻഡോ തടഞ്ഞു — പോപ്പ്-അപ്പുകൾ അനുവദിച്ച് വീണ്ടും ശ്രമിക്കുക',
      'auth/popup-closed-by-user': 'ലോഗിൻ വിൻഡോ അടച്ചു — ലോഗിൻ പൂർത്തിയായില്ല',
      'auth/cancelled-popup-request': 'ലോഗിൻ വിൻഡോ അടച്ചു — ലോഗിൻ പൂർത്തിയായില്ല',
      'auth/user-cancelled': 'ലോഗിൻ റദ്ദാക്കി',
      'auth/user-disabled': 'ഈ അക്കൗണ്ട് പ്രവർത്തനരഹിതമാക്കിയിരിക്കുന്നു',
      'auth/invalid-action-code': 'ഈ ലിങ്ക് കാലഹരണപ്പെട്ടു അല്ലെങ്കിൽ ഇതിനകം ഉപയോഗിച്ചു — പുതിയ ലിങ്ക് അയയ്ക്കുക',
      'auth/expired-action-code': 'ഈ ലിങ്ക് കാലഹരണപ്പെട്ടു — പുതിയ ലിങ്ക് അയയ്ക്കുക',
      'auth/credential-already-in-use': 'ഈ അക്കൗണ്ട് മറ്റൊരു ഉപയോക്താവുമായി ഇതിനകം ബന്ധിപ്പിച്ചിരിക്കുന്നു',
      'auth/provider-already-linked': 'ഈ രീതി ഇതിനകം നിങ്ങളുടെ അക്കൗണ്ടിൽ ചേർത്തിട്ടുണ്ട്',
      'auth/invalid-custom-token': 'പാസ്‌കീ ലോഗിൻ പരാജയപ്പെട്ടു (സെർവർ ക്രമീകരണം പരിശോധിക്കുക)',
      'auth/web-storage-unsupported': 'ഈ ബ്രൗസറിൽ കുക്കികൾ / സ്റ്റോറേജ് തടഞ്ഞിരിക്കുന്നു',
      'permission-denied': 'അനുമതിയില്ല',
      'passkey/unsupported': 'ഈ ബ്രൗസറിൽ പാസ്‌കീ പിന്തുണയില്ല',
      'passkey/cancelled': 'പാസ്‌കീ റദ്ദാക്കി അല്ലെങ്കിൽ സമയം കഴിഞ്ഞു',
      'passkey/insecure': 'പാസ്‌കീക്ക് സുരക്ഷിതമായ വിലാസം (https അല്ലെങ്കിൽ localhost) വേണം',
      'passkey/exists': 'ഈ ഉപകരണത്തിൽ നിങ്ങൾക്ക് ഇതിനകം ഒരു പാസ്‌കീ ഉണ്ട്',
      'passkey/not-configured': 'പാസ്‌കീ ലോഗിൻ ഇതുവരെ സജ്ജമാക്കിയിട്ടില്ല — മറ്റൊരു രീതി ഉപയോഗിക്കുക',
      'passkey/server': 'പാസ്‌കീ സെർവറുമായി ബന്ധപ്പെടാനായില്ല — മറ്റൊരു രീതി ഉപയോഗിക്കുക',
      'passkey/unknown-passkey': 'ഈ പാസ്‌കീ ഇവിടെ രജിസ്റ്റർ ചെയ്തിട്ടില്ല (നീക്കം ചെയ്തിരിക്കാം)',
      'passkey/blocked': 'ഈ അക്കൗണ്ട് അഡ്മിൻ തടഞ്ഞിരിക്കുന്നു',
      'passkey/expired': 'സമയം കഴിഞ്ഞു — വീണ്ടും ശ്രമിക്കുക',
      'passkey/not-signed-in': 'ആദ്യം ലോഗിൻ ചെയ്യുക',
    };
    // with e-mail enumeration protection an unknown address also gives "invalid credential"
    if (/invalid-credential|invalid-login-credentials|wrong-password/.test(c) && state.mode === 'signin') return map[c] + ' — പുതിയ ആളാണെങ്കിൽ മുകളിലെ "രജിസ്റ്റർ ചെയ്യുക" തിരഞ്ഞെടുക്കുക';
    if (map[c]) return map[c];
    if (/^passkey\//.test(c)) return 'പാസ്‌കീ പരിശോധന പരാജയപ്പെട്ടു — വീണ്ടും ശ്രമിക്കുക';
    if (/unavailable|network/.test(c)) return map['auth/network-request-failed'];
    return 'ലോഗിൻ പരാജയപ്പെട്ടു' + (c ? ` (${c})` : '');
  }

  const html = `
<dialog id="dlgLogin" class="auth-screen" aria-labelledby="authTitle">
  <div class="auth-wrap">
    <button type="button" class="auth-close" id="authClose" aria-label="അടയ്ക്കുക"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    <div class="auth-card">
      <h1 class="auth-title" id="authTitle">വീണ്ടും സ്വാഗതം</h1>
      <p class="auth-sub" id="authSwitchRow"><span id="authSwitchText">അക്കൗണ്ട് ഇല്ലേ?</span> <button type="button" class="auth-link" id="authSwitch">രജിസ്റ്റർ ചെയ്യുക</button></p>

      <form class="auth-local" id="localForm" autocomplete="off" novalidate hidden>
        <h2>ഈ കമ്പ്യൂട്ടറിൽ ഉടമയായി തുടരുക</h2>
        <p class="auth-hint" id="localHint"></p>
        <input type="text" name="username" value="local-owner" autocomplete="username" hidden>
        <label class="auth-field"><span id="localPassLabel">പാസ്‌കോഡ്</span><input type="password" id="localPass" autocomplete="current-password" minlength="4" maxlength="200"></label>
        <label class="auth-field" id="localPass2Field" hidden><span>പാസ്‌കോഡ് ഒന്നുകൂടി</span><input type="password" id="localPass2" autocomplete="new-password" maxlength="200"></label>
        <p class="auth-msg error" id="localError" role="alert" hidden></p>
        <button type="submit" class="auth-primary" id="localSubmit">തുറക്കുക</button>
      </form>

      <p class="auth-notice" id="authNotice" hidden></p>
      <form class="auth-form" id="loginForm" novalidate>
        <div class="auth-sso" id="authSso">
          <button type="button" class="auth-google" data-provider="google">${LOGO_GOOGLE}<span>Google ഉപയോഗിച്ച് തുടരുക</span></button>
          <button type="button" class="auth-icon" data-provider="github" aria-label="GitHub ഉപയോഗിച്ച് തുടരുക" title="GitHub">${LOGO_GITHUB}</button>
          <button type="button" class="auth-icon" data-provider="microsoft" aria-label="Microsoft ഉപയോഗിച്ച് തുടരുക" title="Microsoft">${LOGO_MICROSOFT}</button>
        </div>
        <div class="auth-or" id="authOr"><span>അല്ലെങ്കിൽ ഇമെയിൽ ഉപയോഗിച്ച്</span></div>
        <div class="auth-emailbox" id="authEmailBox">
          <label class="auth-field" id="fieldName" hidden><span>പേര് <small>(ഐച്ഛികം)</small></span><input type="text" id="loginName" autocomplete="name" maxlength="100"></label>
          <label class="auth-field"><span>ഇമെയിൽ</span><input type="email" id="loginEmail" placeholder="name@example.com" autocomplete="username email" inputmode="email" autocapitalize="off" spellcheck="false"></label>
          <label class="auth-field" id="fieldPassword" hidden><span>പാസ്‌വേഡ്</span><input type="password" id="loginPassword" autocomplete="current-password" minlength="6"></label>
        </div>
        <p class="auth-msg error" id="loginError" role="alert" hidden></p>
        <p class="auth-msg ok" id="loginInfo" role="status" hidden></p>
        <button type="submit" class="auth-primary" id="loginSubmit">ലോഗിൻ</button>
        <button type="button" class="auth-secondary" id="authPasskey">പാസ്‌കീ ഉപയോഗിച്ച് ലോഗിൻ</button>
        <div class="auth-links" id="authLinks">
          <button type="button" class="auth-link" id="authUsePassword">പാസ്‌വേഡ് ഉപയോഗിക്കുക</button>
          <button type="button" class="auth-link" id="btnForgot" hidden>പാസ്‌വേഡ് മറന്നോ?</button>
        </div>
      </form>
      <a class="auth-back" id="authBack" href="./" hidden>← വായനയിലേക്ക് മടങ്ങുക</a>
    </div>
  </div>
</dialog>`;
  document.body.insertAdjacentHTML('beforeend', html);
  const dlg = $('#dlgLogin');

  const state = {
    mode: 'signin',          // signin | signup
    // e-mail + password first: Firebase's free plan sends only 5 e-mail sign-in links a day (for the whole
    // site), but up to 1000 verification e-mails, so the link is the second choice
    usePassword: !!P.password,
    confirmLink: false,      // opened from an e-mail sign-in link, asking for the address again
    dismissible: true,
    busy: false,
  };
  const hooks = {
    show: (d) => d.showModal(),
    notify: () => {},
    dismissible: true,       // default for open(); the admin portal turns it off
  };

  // which kind of screen: 'cloud' (Firebase), 'owner' (local passcode), 'readonly' (public site, no Firebase)
  const kind = () => (Cloud && Cloud.available ? 'cloud' : LocalOwner && LocalOwner.allowed ? 'owner' : 'readonly');

  function showError(msg, el) {
    el = el || $('#loginError');
    el.textContent = msg || '';
    el.hidden = !msg;
    if (msg) $('#loginInfo').hidden = true;
  }
  function showInfo(msg, hint) {
    const el = $('#loginInfo');
    el.textContent = msg || '';
    if (msg && hint) { const h = document.createElement('small'); h.textContent = hint; el.append(h); }
    el.hidden = !msg;
    if (msg) $('#loginError').hidden = true;
  }

  function render() {
    const k = kind();
    const cloud = k === 'cloud';
    const ready = cloud && Cloud.ready;
    const up = state.mode === 'signup' && cloud;
    $('#authTitle').textContent = state.confirmLink ? 'ലോഗിൻ പൂർത്തിയാക്കുക' : up ? 'അക്കൗണ്ട് ഉണ്ടാക്കുക' : 'വീണ്ടും സ്വാഗതം';
    $('#authSwitchRow').hidden = !cloud || state.confirmLink;
    $('#authSwitchText').textContent = up ? 'അക്കൗണ്ട് ഉണ്ടോ?' : 'അക്കൗണ്ട് ഇല്ലേ?';
    $('#authSwitch').textContent = up ? 'ലോഗിൻ' : 'രജിസ്റ്റർ ചെയ്യുക';
    $('#authClose').hidden = !state.dismissible;
    $('#authBack').hidden = state.dismissible;

    // providers
    const google = !!P.google, github = !!P.github, microsoft = !!P.microsoft;
    $('[data-provider="google"]').hidden = !google;
    $('[data-provider="github"]').hidden = !github;
    $('[data-provider="microsoft"]').hidden = !microsoft;
    const anySso = google || github || microsoft;
    const emailOn = !!(P.emailLink || P.password);
    $('#authSso').hidden = !anySso || state.confirmLink;
    $('#authOr').hidden = !anySso || !emailOn || state.confirmLink;
    $('#authEmailBox').hidden = !emailOn;
    const pw = (state.usePassword || !P.emailLink) && !!P.password && !state.confirmLink;
    $('#fieldPassword').hidden = !pw;
    $('#loginPassword').autocomplete = up ? 'new-password' : 'current-password';
    $('#fieldName').hidden = !up;
    $('#loginSubmit').hidden = !emailOn;
    $('#loginSubmit').textContent = state.confirmLink ? 'ലോഗിൻ പൂർത്തിയാക്കുക' : up ? (pw ? 'അക്കൗണ്ട് ഉണ്ടാക്കുക' : 'ലിങ്ക് അയയ്ക്കുക') : 'ലോഗിൻ';
    const passkeyOn = !!P.passkey && !up && !state.confirmLink && (!cloud || Cloud.passkeySupported());
    $('#authPasskey').hidden = !passkeyOn;
    $('#authUsePassword').hidden = !(P.emailLink && P.password) || state.confirmLink;
    $('#authUsePassword').textContent = state.usePassword ? 'പാസ്‌വേഡ് ഇല്ലാതെ (ഇമെയിൽ ലിങ്ക്)' : 'പാസ്‌വേഡ് ഉപയോഗിക്കുക';
    $('#btnForgot').hidden = !(pw && !up);
    $('#authLinks').hidden = $('#authUsePassword').hidden && $('#btnForgot').hidden;

    // local owner section + notices
    const notice = $('#authNotice');
    const local = $('#localForm');
    local.hidden = k !== 'owner';
    if (k === 'owner') {
      const isSet = LocalOwner.isSet();
      $('#localHint').textContent = isSet
        ? 'ഈ ബ്രൗസറിൽ തിരുത്താനും ഡാറ്റ കൈകാര്യം ചെയ്യാനും നിങ്ങളുടെ പാസ്‌കോഡ് നൽകുക. ബ്രൗസർ അടച്ചാൽ വീണ്ടും ലോക്ക് ആകും.'
        : 'ആദ്യമായി: ഈ ബ്രൗസറിനായി ഒരു പാസ്‌കോഡ് (കുറഞ്ഞത് 4 അക്ഷരം) ഉണ്ടാക്കുക. ഇത് ഈ ബ്രൗസറിൽ മാത്രമാണ് — സെർവർ സുരക്ഷയല്ല; കമ്പ്യൂട്ടർ ഉപയോഗിക്കുന്ന മറ്റുള്ളവരെ തിരുത്തൽ ഉപകരണങ്ങളിൽ നിന്ന് അകറ്റി നിർത്താൻ മാത്രം.';
      $('#localPassLabel').textContent = isSet ? 'പാസ്‌കോഡ്' : 'പുതിയ പാസ്‌കോഡ്';
      $('#localPass').autocomplete = isSet ? 'current-password' : 'new-password';
      $('#localPass2Field').hidden = isSet;
      $('#localSubmit').textContent = isSet ? 'തുറക്കുക' : 'പാസ്‌കോഡ് സജ്ജമാക്കി തുറക്കുക';
    }
    let note = '';
    if (k === 'owner') {
      note = Cloud && Cloud.configured
        ? 'ഓൺലൈൻ ലോഗിൻ (Google, GitHub, Microsoft, ഇമെയിൽ, പാസ്‌കീ) വെബ്സൈറ്റായി (http/https) തുറക്കുമ്പോൾ മാത്രം.'
        : 'ഓൺലൈൻ ലോഗിൻ (Google, GitHub, Microsoft, ഇമെയിൽ, പാസ്‌കീ) Firebase ക്രമീകരിച്ചാൽ മാത്രം — README കാണുക.';
    }
    else if (k === 'readonly') note = 'ലോഗിൻ ഇതുവരെ സജ്ജമാക്കിയിട്ടില്ല. ഇപ്പോൾ എല്ലാവർക്കും വായിക്കാൻ മാത്രം. അഡ്മിൻ Firebase ക്രമീകരണം (app/js/firebase-config.js) ചേർക്കണം — README കാണുക.';
    else if (!ready) note = 'ബന്ധിപ്പിക്കുന്നു…';
    else if (state.confirmLink) note = 'ഇമെയിലിലെ ലിങ്ക് തുറന്നു. സുരക്ഷയ്ക്കായി, ലിങ്ക് അയച്ച ഇമെയിൽ വിലാസം വീണ്ടും നൽകുക.';
    notice.textContent = note;
    notice.hidden = !note;
    notice.classList.toggle('warn', k !== 'cloud');

    // the online sign-in controls work only when Firebase is connected
    const disabled = !ready || state.busy;
    $$('#loginForm button, #loginForm input').forEach((el) => {
      if (el.id === 'authUsePassword' || el.id === 'btnForgot') el.disabled = state.busy || !cloud;
      else el.disabled = disabled;
    });
    $('#loginForm').classList.toggle('off', !cloud);
    $('#authSwitch').disabled = state.busy;
    $$('#localForm button, #localForm input').forEach((el) => { el.disabled = state.busy; });
  }

  async function busy(fn) {
    state.busy = true; render();
    try { await fn(); } finally { state.busy = false; render(); }
  }

  const AuthUI = {
    el: dlg,
    message,
    methodName,
    mailHint,
    configure(o) { Object.assign(hooks, o || {}); },
    get isOpen() { return dlg.open; },
    // opts: { mode: 'signin' | 'signup', dismissible: true, confirmLink: false }
    open(opts) {
      opts = opts || {};
      state.mode = opts.mode || 'signin';
      state.dismissible = opts.dismissible === undefined ? hooks.dismissible : !!opts.dismissible;
      state.confirmLink = !!opts.confirmLink;
      showError(''); showInfo(''); showError('', $('#localError'));
      $('#loginPassword').value = '';
      $('#localPass').value = ''; $('#localPass2').value = '';
      const pl = Cloud && Cloud.pendingLink;
      if (pl && pl.email && !$('#loginEmail').value) $('#loginEmail').value = pl.email;
      if (opts.error) showError(message(opts.error));
      if (opts.info) showInfo(opts.info);
      render();
      if (!dlg.open) hooks.show(dlg);
      setTimeout(() => {
        const k = kind();
        const target = k === 'owner' ? '#localPass' : state.mode === 'signup' ? '#loginName' : '#loginEmail';
        const el = $(target);
        if (el && !el.disabled && matchMedia('(hover: hover)').matches) el.focus();
      }, 80);
    },
    close() { if (dlg.open) dlg.close(); },
    render,
  };

  // ---- events ----
  $('#authClose').addEventListener('click', () => AuthUI.close());
  dlg.addEventListener('cancel', (e) => { if (!state.dismissible) e.preventDefault(); });
  $('#authSwitch').addEventListener('click', () => {
    state.mode = state.mode === 'signup' ? 'signin' : 'signup';
    showError(''); showInfo('');
    render();
  });
  $('#authUsePassword').addEventListener('click', () => {
    state.usePassword = !state.usePassword;
    showError(''); showInfo('');
    render();
    if (state.usePassword) $('#loginPassword').focus();
  });

  $$('[data-provider]').forEach((b) => b.addEventListener('click', () => busy(async () => {
    showError(''); showInfo('');
    try {
      const r = await Cloud.signInWith(b.dataset.provider);
      if (r === null) showInfo('ലോഗിൻ പേജിലേക്ക് പോകുന്നു…');
    } catch (e) {
      if (e && e.code === 'auth/popup-closed-by-user' && !Cloud.pendingLink) return;   // the user closed it
      // account exists with another method: fill in the address for an e-mail / password sign-in
      if (e && e.pendingLink && e.pendingLink.email && !$('#loginEmail').value) $('#loginEmail').value = e.pendingLink.email;
      showError(message(e));
    }
  })));

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    if (state.busy || !(Cloud && Cloud.ready)) return;
    const email = $('#loginEmail').value.trim();
    const name = $('#loginName').value.trim();
    const pw = $('#loginPassword').value;
    const usePw = !$('#fieldPassword').hidden;
    if (!EMAIL_RE.test(email)) { showError('ശരിയായ ഇമെയിൽ വിലാസം നൽകുക'); $('#loginEmail').focus(); return; }
    if (usePw && pw.length < 6) { showError('പാസ്‌വേഡിന് കുറഞ്ഞത് 6 അക്ഷരങ്ങൾ വേണം'); $('#loginPassword').focus(); return; }
    busy(async () => {
      try {
        if (state.confirmLink) {
          await Cloud.completeEmailLink(email);
          state.confirmLink = false;
        } else if (usePw && state.mode === 'signup') {
          await Cloud.signUp(name, email, pw);
          const ve = Cloud.verificationError;
          hooks.notify(ve
            ? `അക്കൗണ്ട് ഉണ്ടാക്കി, പക്ഷേ സ്ഥിരീകരണ ഇമെയിൽ അയയ്ക്കാനായില്ല (${message(ve)}). ☰ → അക്കൗണ്ട് → "ലിങ്ക് വീണ്ടും അയയ്ക്കുക" പിന്നീട് ശ്രമിക്കുക.`
            : `അക്കൗണ്ട് ഉണ്ടാക്കി — സ്ഥിരീകരണ ലിങ്ക് ${email}-ലേക്ക് അയച്ചു. ${mailHint()}`, 12000);
        } else if (usePw) {
          await Cloud.signIn(email, pw);
        } else {
          await Cloud.sendEmailLink(email, state.mode === 'signup' ? name : '');
          showInfo(`ലിങ്ക് അയച്ചു, ഇമെയിൽ പരിശോധിക്കുക (${email}). ആ ലിങ്ക് ഈ ബ്രൗസറിൽ തുറന്നാൽ ലോഗിൻ ആകും.`, mailHint());
        }
      } catch (err) {
        if (err && err.code === 'auth/quota-exceeded' && !usePw && !state.confirmLink) {
          // the day's e-mail sign-in links are used up: offer the password form right here
          const google = P.google ? (isGmail(email) ? 'Gmail വിലാസമായതിനാൽ ഏറ്റവും എളുപ്പം: "Google ഉപയോഗിച്ച് തുടരുക". അല്ലെങ്കിൽ ' : 'Google ഉപയോഗിച്ച് ലോഗിൻ ചെയ്യുക, അല്ലെങ്കിൽ ') : '';
          const pwOk = !!P.password;
          if (pwOk) state.usePassword = true;
          showError(`ഇമെയിൽ ലിങ്കുകളുടെ ഇന്നത്തെ പരിധി കഴിഞ്ഞു (സൗജന്യ പ്ലാനിൽ ദിവസം 5 എണ്ണം മാത്രം). ${google}${pwOk ? (state.mode === 'signup' ? 'ഒരു പാസ്‌വേഡ് നൽകി അക്കൗണ്ട് ഉണ്ടാക്കുക.' : 'പാസ്‌വേഡ് ഉപയോഗിക്കുക — അക്കൗണ്ട് ഇല്ലെങ്കിൽ "രജിസ്റ്റർ ചെയ്യുക".') : 'നാളെ വീണ്ടും ശ്രമിക്കുക.'}`);
          if (pwOk) setTimeout(() => { render(); $('#loginPassword').focus(); }, 0);
          return;
        }
        showError(message(err));
      }
    });
  });

  $('#btnForgot').addEventListener('click', () => {
    const email = $('#loginEmail').value.trim();
    if (!EMAIL_RE.test(email)) { showError('ആദ്യം ഇമെയിൽ നൽകുക'); $('#loginEmail').focus(); return; }
    busy(async () => {
      try {
        await Cloud.resetPassword(email);
        // with e-mail enumeration protection Firebase answers the same whether or not the account exists
        showInfo(`പാസ്‌വേഡ് മാറ്റാനുള്ള ലിങ്ക് ഇമെയിലിൽ അയച്ചു (${email}) — ഈ ഇമെയിലിൽ പാസ്‌വേഡ് അക്കൗണ്ട് ഉണ്ടെങ്കിൽ മാത്രം. ഇല്ലെങ്കിൽ "രജിസ്റ്റർ ചെയ്യുക".`, mailHint());
      } catch (err) { showError(message(err)); }
    });
  });

  $('#authPasskey').addEventListener('click', () => busy(async () => {
    showError(''); showInfo('');
    try { await Cloud.signInPasskey(); } catch (err) { showError(message(err)); }
  }));

  $('#localForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('#localError');
    const pass = $('#localPass').value;
    busy(async () => {
      try {
        if (!LocalOwner.isSet()) {
          if (pass.length < 4) { showError('പാസ്‌കോഡിന് കുറഞ്ഞത് 4 അക്ഷരങ്ങൾ വേണം', err); return; }
          if (pass !== $('#localPass2').value) { showError('രണ്ട് പാസ്‌കോഡുകളും ഒന്നല്ല', err); return; }
          await LocalOwner.setup(pass);
          hooks.notify('പാസ്‌കോഡ് സജ്ജമാക്കി — ഈ ബ്രൗസറിൽ തിരുത്താം');
        } else if (await LocalOwner.unlock(pass)) {
          hooks.notify('തുറന്നു — ഈ ബ്രൗസറിൽ തിരുത്താം');
        } else {
          showError('പാസ്‌കോഡ് തെറ്റാണ്', err);
          $('#localPass').select();
          return;
        }
        AuthUI.close();
      } catch (ex) { showError('പാസ്‌കോഡ് സൂക്ഷിക്കാനായില്ല: ' + (ex.code || ex.message || ''), err); }
    });
  });

  if (Cloud) {
    Cloud.on((type, data) => {
      if (type === 'ready') render();
      else if (type === 'auth' && data) {
        state.confirmLink = false;
        if (dlg.open) AuthUI.close();
      } else if (type === 'authError') {
        if (data && data.code === 'auth/popup-closed-by-user') return;
        AuthUI.open({ error: data, dismissible: dlg.open ? state.dismissible : undefined });
      } else if (type === 'emailLinkNeedsEmail') {
        AuthUI.open({ confirmLink: true, dismissible: dlg.open ? state.dismissible : undefined });
      } else if (type === 'linked') {
        hooks.notify(methodName(data) + ' ഈ അക്കൗണ്ടിലേക്ക് ചേർത്തു — ഇനി അതുപയോഗിച്ചും ലോഗിൻ ചെയ്യാം');
      }
    });
  }

  window.AuthUI = AuthUI;
})();
