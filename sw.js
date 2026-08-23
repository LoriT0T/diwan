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
const CACHE = 'diwan-v13';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/read.js', './js/rank.js', './js/store.js',
  './js/tasks.js', './js/write.js', './js/voice.js',
  './js/cloud.js', './js/shred.js', './js/sync.js', './js/remind.js', './js/session.js', './js/push.js',
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

/* ══════════════════════════════════════════════════════════════════
   PUSH

   The only part of Dīwān that runs when nothing is open. On iOS this works at all
   only for a web app added to the Home Screen — in a Safari tab, never — and there
   are no action buttons available, so the notification's whole job is to say the
   thing and land you in the right place when tapped.
   ══════════════════════════════════════════════════════════════════ */

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data && e.data.text() }; }
  const title = d.title || 'Dīwān';
  e.waitUntil((async () => {
    await self.registration.showNotification(title, {
      body: d.body || '',
      tag: d.tag || 'diwan',
      renotify: d.renotify !== false,
      data: { url: d.url || './' },
      icon: './icon-192.png',
      badge: './icon-192.png'
    });
    /* The count on the app icon, which iOS honours for installed web apps. */
    if (typeof d.badge === 'number' && self.registration.navigationPreload !== undefined) {
      try { if (navigator.setAppBadge) d.badge > 0 ? navigator.setAppBadge(d.badge) : navigator.clearAppBadge(); }
      catch { /* not installed */ }
    }
  })());
});

/* Tapping focuses an open Dīwān and routes it, rather than opening a second copy —
   a notification that spawns duplicate tabs is worse than one that does nothing. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes('/diwan/')) {
        await c.focus();
        try { c.postMessage({ type: 'navigate', url: target }); } catch { /* older client */ }
        return;
      }
    }
    await self.clients.openWindow(new URL(target, self.location.href).href);
  })());
});
