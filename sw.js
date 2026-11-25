// Service worker: lets the app open without internet (showing the last saved data).
// App files are always taken from the network first, so updates arrive immediately.
// Requests to api.github.com (the data itself) are never cached here.
const CACHE = 'budget-v7';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './css/app.css?v=7', './js/core.js?v=7', './js/sync.js?v=7', './js/ui.js?v=7', './js/grid.js?v=7', './js/invest.js?v=7', './js/home.js?v=7', './js/settings.js?v=7', './js/excel.js?v=7', './js/install.js?v=7', './js/main.js?v=7'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      const copy = r.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});