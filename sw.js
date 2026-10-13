// App-shell service worker: makes the app open offline. Music itself is stored in IndexedDB
// (only when the user allows downloads), never in this cache.
// Bump VERSION when shipping changes so clients pick them up.

const VERSION = 'v5';
const CACHE = `music-box-${VERSION}`;
const SHELL = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/downloads.js',
  './js/icons.js',
  './js/lcd.js',
  './js/player.js',
  './js/skins.js',
  './js/skin-generator.js',
  './js/skin-corpus.js',
  './js/store.js',
  './js/util.js',
  './js/visualizer.js',
  './js/providers/index.js',
  './js/providers/gdrive.js',
  './js/providers/dropbox.js',
  './js/providers/local.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// Our own files: the page and config.js are network-first (so edits to your keys apply right away),
// everything else is stale-while-revalidate. Cross-origin requests (Google, Dropbox) are left alone.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const navigate = req.mode === 'navigate';
  // Navigations (including the ?code=… return from Dropbox) all map to the cached shell.
  const key = navigate ? './index.html' : req;
  const networkFirst = navigate || url.pathname.endsWith('/config.js');

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (networkFirst) {
      try {
        return await network;
      } catch (err) {
        const cached = await cache.match(key);
        if (cached) return cached;
        throw err;
      }
    }
    const cached = await cache.match(key);
    if (cached) {
      event.waitUntil(network.catch(() => {}));
      return cached;
    }
    return network;
  })());
});
