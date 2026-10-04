/* Offline support: the app shell, the Bible text and the Firebase library are cached on first
 * visit, so the reader and the portal open without internet (Firestore keeps its own offline
 * copy of the data, see cloud.js). Same-origin files use stale-while-revalidate, so after a
 * `git push` the new version is picked up in the background (past the browser's HTTP cache)
 * and the open page is told, so it can offer to reload (js/app.js, 'content-updated').
 * Bump VERSION when the list of files changes (and APP_VERSION in js/usage.js with it). */
const VERSION = 'v21';
const CACHE = 'ml-bible-' + VERSION;
const FONT_CACHE = 'ml-bible-fonts';
const LIB_CACHE = 'ml-bible-lib';       // versioned CDN files (the URL changes with the version)
const SHELL = [
  './', './index.html', './css/style.css',
  './js/books.js', './js/data.js', './js/parser.js', './js/pdf-extract.js', './js/docx-extract.js', './js/ocr.js', './js/firebase-config.js', './js/cloud.js', './js/usage.js', './js/auth-ui.js', './js/app.js',
  './admin.html', './css/admin.css', './js/admin.js',
  './app.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png',
];
// the Firebase SDK that cloud.js loads (keep the version in step with SDK there)
const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const LIBS = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'].map((f) => FIREBASE_SDK + f);
// the OCR library of js/ocr.js (camera scan) and the worker / core it loads (keep the version in
// step with LIB there). Not fetched ahead (the core is ~4 MB): cached the first time someone scans.
// Tesseract keeps the Malayalam language data in IndexedDB itself.
const TESSERACT = ['https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/', 'https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/', 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0/'];

// the font stylesheets of index.html and admin.html (keep the URLs identical to the <link> tags)
const FONT_CSS = [
  'https://fonts.googleapis.com/css2?family=Gayathri:wght@400;700&family=Manjari:wght@400;700&family=Noto+Sans+Malayalam:wght@400;600;700;800&family=Noto+Serif+Malayalam:wght@400;600;700;800&display=swap',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+Malayalam:wght@400;600;700;800&display=swap',
];
// font files fetched ahead: the default reading font and the portal font, Malayalam + Latin letters
// only (the other fonts are cached the first time someone picks them — saves mobile data)
const FONT_FAMILIES = ['Noto Serif Malayalam', 'Noto Sans Malayalam'];
const FONT_SUBSETS = ['malayalam', 'latin'];
const addOnce = (c, u) => c.match(u).then((hit) => hit || c.add(new Request(u, { mode: 'cors' })));
async function precacheFonts() {
  const c = await caches.open(FONT_CACHE);
  const files = new Set();
  for (const href of FONT_CSS) {
    let res = await c.match(href);
    if (!res) {
      res = await fetch(href, { mode: 'cors' });
      if (!res.ok) continue;
      await c.put(href, res.clone());
    }
    const css = await res.text();
    for (const m of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
      const fam = (m[2].match(/font-family:\s*'([^']+)'/) || [])[1];
      const url = (m[2].match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/) || [])[1];
      if (url && FONT_SUBSETS.includes(m[1]) && FONT_FAMILIES.includes(fam)) files.add(url);
    }
  }
  await Promise.all([...files].map((u) => addOnce(c, u).catch(() => {})));
}

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    // fresh from the server, not from the browser's HTTP cache (GitHub Pages: 10 minutes)
    caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))),
    // best effort: without it the first offline start can't sign in from the saved session
    caches.open(LIB_CACHE).then((c) => Promise.all(LIBS.map((u) => addOnce(c, u)))).catch(() => {}),
    // best effort: the first page load isn't controlled by the worker yet, so fetch the fonts here
    precacheFonts().catch(() => {}),
  ]).then(() => self.skipWaiting()));
});

// tell the open pages that newer app files / Bible text are in the cache
const announce = () => self.clients.matchAll({ type: 'window' })
  .then((list) => list.forEach((c) => c.postMessage({ type: 'content-updated' })));

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(async (keys) => {
    const old = keys.filter((k) => k !== CACHE && k !== FONT_CACHE && k !== LIB_CACHE);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    // an update (not the first install): the open page still runs the old files
    if (old.some((k) => k.startsWith('ml-bible-v'))) await announce();
  }));
});

// Cloudflare Pages serves admin.html at /admin (and index.html at /) through a redirect; a
// redirected response can't answer a page navigation, so hand out a clean copy
const clean = (res) => (res && res.redirected
  ? res.blob().then((b) => new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers }))
  : res);
// a different file than the cached one (by ETag, else Last-Modified; unknown = unchanged)
const changed = (a, b) => {
  const tag = (r) => r.headers.get('etag') || r.headers.get('last-modified');
  return !!(tag(a) && tag(b) && tag(a) !== tag(b));
};

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: cache-first (they never change for a given URL)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Firebase SDK and the OCR library: cache-first (a versioned URL never changes)
  if (url.href.startsWith(FIREBASE_SDK) || TESSERACT.some((p) => url.href.startsWith(p))) {
    e.respondWith(caches.open(LIB_CACHE).then(async (c) => {
      const hit = await c.match(req, { ignoreVary: true }) || await c.match(url.href);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }

  if (url.origin !== self.location.origin) return;
  // server functions (passkey sign-in) are never cached
  if (url.pathname.startsWith('/api/')) return;

  // the manifest (app name / icons) goes to the network first, so an installed app sees a rename
  if (url.pathname.endsWith('.webmanifest')) {
    e.respondWith(caches.open(CACHE).then((c) => fetch(req)
      .then((res) => { if (res.ok) c.put(req, res.clone()); return res; })
      .catch(() => c.match(req, { ignoreSearch: true }))));
    return;
  }

  // app files: serve from cache immediately, refresh the cache in the background
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const isAdmin = /\/admin(\.html)?$/.test(url.pathname);
    const hit = await c.match(req, { ignoreSearch: true }) || (isAdmin && req.mode === 'navigate' ? await c.match('./admin.html') : undefined);
    // ask the server (a cheap 304 when unchanged) instead of the browser's HTTP cache; a page
    // navigation is left as it is (its redirects must stay as they are)
    const refresh = fetch(req.mode === 'navigate' ? req : new Request(req, { cache: 'no-cache' })).then((res) => {
      if (res.ok) {
        c.put(req, res.clone());
        if (hit && changed(hit, res) && /\.(js|css)$/.test(url.pathname)) announce();
      }
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(refresh); return clean(hit); }
    const res = await refresh;
    return res || (req.mode === 'navigate' ? clean(await c.match(isAdmin ? './admin.html' : './index.html')) : Response.error());
  }));
});
