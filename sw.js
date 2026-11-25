// Service worker: lets the app open without internet (showing the last saved data).
// App files are always taken from the network first, so updates arrive immediately.
// Requests to api.github.com (the data itself) are never cached here.
const CACHE = 'budget-v4';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './css/app.css?v=4', './js/core.js?v=4', './js/sync.js?v=4', './js/ui.js?v=4', './js/grid.js?v=4', './js/invest.js?v=4', './js/home.js?v=4', './js/settings.js?v=4', './js/excel.js?v=4', './js/install.js?v=4', './js/main.js?v=4'];

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