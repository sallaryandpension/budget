// Service worker: lets the app open without internet (showing the last saved data).
// App files are always taken from the network first, so updates arrive immediately.
// Requests to api.github.com (the data itself) are never cached here.
const CACHE = 'budget-v12';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './css/app.css?v=12', './js/core.js?v=12', './js/sync.js?v=12', './js/ui.js?v=12', './js/grid.js?v=12', './js/invest.js?v=12', './js/home.js?v=12', './js/charts.js?v=12', './js/analysis.js?v=12', './js/forecast.js?v=12','./js/settings.js?v=12', './js/excel.js?v=12', './js/install.js?v=12', './js/main.js?v=12'];

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
  if (url.pathname.endsWith('/version.json')) return;        // the update check must always reach the server
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('./index.html')))
  );
});