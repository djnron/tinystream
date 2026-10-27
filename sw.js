// App-shell service worker: makes the app open offline. Music itself is stored in IndexedDB
// (only when the user allows downloads), never in this cache.
// Bump VERSION when shipping changes so clients pick them up.

const VERSION = 'v34';
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
  './js/pictures.js',
  './js/studio.js',
  './js/cover.js',
  './js/skin-generator.js',
  './js/skin-art.js',
  './js/share.js',
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

// ---------- streaming ----------
// Songs that need a sign-in header (Google Drive) can't be given to the <audio> element as a plain
// address. The page registers the real address and headers here, then plays "./__stream/<id>"; this
// worker adds the headers and passes the browser's byte-range requests through, so songs start
// playing straight away and seeking works. Nothing is cached; the details live only in memory.
const streams = new Map(); // id -> { url, headers, at }

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg?.type !== 'stream' || !/^[\w-]{8,64}$/.test(msg.id || '') || !/^https:\/\/[^/]+\.(googleapis|dropboxusercontent)\.com\//.test(msg.url || '')) return;
  streams.set(msg.id, { url: msg.url, headers: msg.headers || {}, at: Date.now() });
  for (const [id, s] of streams) if (Date.now() - s.at > 6 * 3600e3) streams.delete(id);
  event.ports[0]?.postMessage('ok');
});

async function stream(id, req) {
  const s = streams.get(id);
  if (!s) return new Response('', { status: 404 });
  const headers = new Headers(s.headers);
  const range = req.headers.get('range');
  if (range) headers.set('Range', range);
  const res = await fetch(s.url, { headers, signal: req.signal });
  const out = new Headers();
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const v = res.headers.get(k);
    if (v) out.set(k, v);
  }
  if (res.status === 206 && !out.has('content-range') && range) {
    // The range wasn't exposed to us; describe it from the request so seeking still works.
    const start = Number(/bytes=(\d+)-/.exec(range)?.[1] || 0);
    const len = Number(res.headers.get('content-length'));
    if (len) out.set('content-range', `bytes ${start}-${start + len - 1}/*`);
  }
  if (!out.has('accept-ranges')) out.set('accept-ranges', 'bytes');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}

// Our own files: the page and config.js are network-first (so edits to your keys apply right away),
// everything else is stale-while-revalidate. Cross-origin requests (Google, Dropbox) are left alone.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  const streamId = /\/__stream\/([\w-]+)$/.exec(url.pathname)?.[1];
  if (streamId) {
    event.respondWith(stream(streamId, req));
    return;
  }
  // Server pages (shared-record links at /r, the preview picture at /api/...) aren't part of the app.
  if (/\/(r|api\/.*)$/.test(url.pathname)) return;
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
