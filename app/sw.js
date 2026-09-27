/* Offline support: the app shell and Bible text are cached on first visit.
 * Same-origin files use stale-while-revalidate, so after a `git push` the new
 * version is picked up in the background and shown on the next launch.
 * Bump VERSION when the list of files changes. */
const VERSION = 'v6';
const CACHE = 'ml-bible-' + VERSION;
const FONT_CACHE = 'ml-bible-fonts';
const SHELL = [
  './', './index.html', './css/style.css',
  './js/books.js', './js/data.js', './js/parser.js', './js/pdf-extract.js', './js/firebase-config.js', './js/cloud.js', './js/auth-ui.js', './js/app.js',
  './admin.html', './css/admin.css', './js/admin.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cloudflare Pages serves admin.html at /admin (and index.html at /) through a redirect; a
// redirected response can't answer a page navigation, so hand out a clean copy
const clean = (res) => (res && res.redirected
  ? res.blob().then((b) => new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers }))
  : res);

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

  if (url.origin !== self.location.origin) return;
  // server functions (passkey sign-in) are never cached
  if (url.pathname.startsWith('/api/')) return;

  // app files: serve from cache immediately, refresh the cache in the background
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const isAdmin = /\/admin(\.html)?$/.test(url.pathname);
    const hit = await c.match(req, { ignoreSearch: true }) || (isAdmin && req.mode === 'navigate' ? await c.match('./admin.html') : undefined);
    const refresh = fetch(req).then((res) => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(refresh); return clean(hit); }
    const res = await refresh;
    return res || (req.mode === 'navigate' ? clean(await c.match(isAdmin ? './admin.html' : './index.html')) : Response.error());
  }));
});
