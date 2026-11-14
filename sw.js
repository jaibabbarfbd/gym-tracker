// Offline support + opening the app when a reminder notification is tapped.
const CACHE = 'gymtracker-v15';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/data.js',
  'js/logic.js',
  'js/sync.js',
  'js/native.js',
  'js/charts.js',
  'js/scan.js',
  'js/firebase-config.js',
  'js/cloud.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'fonts/manrope-latin.woff2',
  'fonts/manrope-latin-ext.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first so updates show up straight away; cache when offline. `no-cache` makes the browser
// check with the server every time (a quick "not modified" when nothing changed), instead of reusing
// GitHub Pages' 10-minute HTTP cache, which could mix old and new files right after a deploy.
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  // A page navigation can't be copied with new options, so it's fetched by URL.
  const fresh = request.mode === 'navigate' ? fetch(request.url, { cache: 'no-cache' }) : fetch(new Request(request, { cache: 'no-cache' }));
  e.respondWith(
    fresh
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      return open ? open.focus() : self.clients.openWindow('./');
    })
  );
});
