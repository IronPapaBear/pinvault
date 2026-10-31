// Offline support: keeps the app (and the optional image AI) on the phone so it works in the parks.
const VERSION = 'pinvault-202610311133';
const APP = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/db.js', 'js/ui.js', 'js/seed.js', 'js/vision.js', 'js/catalog.js', 'js/annotator.js', 'js/ocr.js',
  'js/views/collection.js', 'js/views/board.js', 'js/views/scan.js', 'js/views/live.js', 'js/views/settings.js', 'js/views/sheets.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const RUNTIME = 'pinvault-runtime';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== RUNTIME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The shared layout: always try the network first so friends get updates.
  if (url.origin === location.origin && url.pathname.endsWith('/layout.json')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  // The app itself: network first (so updates arrive), cached copy when offline.
  if (url.origin === location.origin) {
    // Always ask the server whether there's a newer copy (cheap when nothing changed).
    e.respondWith(
      fetch(req, { cache: 'no-cache' }).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
    return;
  }
  // Image AI files (MediaPipe): cache after the first download.
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'storage.googleapis.com') {
    e.respondWith(caches.open(RUNTIME).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
  }
  // Everything else (e.g. set photo downloads) goes straight to the network.
});
