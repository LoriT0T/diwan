/* Dīwān — offline shell.
 *
 * Network-first for code, deliberately. Cache-first is the usual PWA default and it is
 * how Compound's installed copies stayed frozen on an old build across four consecutive
 * deploys: the server had the new file, the phone did not, and nothing announced it
 * because the page still worked. Offline still works here, because every successful
 * response is written back on the way past.
 *
 * Note on scope: this worker controls /diwan/ only. The sibling modules this hub imports
 * live at /compound/js/… and /anbiq/js/… and are served by those apps' own workers, or
 * straight from the network. So an app whose worker has never run is simply unreadable
 * offline, and read.js reports that rather than pretending.
 */
const CACHE = 'diwan-v2';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/read.js', './js/rank.js', './js/store.js',
  './js/tasks.js', './js/write.js', './js/voice.js',
  './vendor/adhan.esm.min.js',
  './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* {cache:'reload'} — otherwise addAll refills a bumped cache from the HTTP cache
       with the very files the bump exists to replace. */
    await Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    try {
      const res = await fetch(request);
      if (res && res.ok) {
        const copy = res.clone();
        const key = request.mode === 'navigate' ? './index.html' : request;
        caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
      }
      return res;
    } catch {
      return (await caches.match(request.mode === 'navigate' ? './index.html' : request))
        || (await caches.match('./index.html'));
    }
  })());
});
