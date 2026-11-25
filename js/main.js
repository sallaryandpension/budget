"use strict";
/* main.js: tabs (hash routing), start-up, background refresh, service worker. */
const APP_VERSION = 9;   // keep in step with the ?v= in index.html and CACHE in sw.js

const VIEWS = {
  home: renderHome,
  expenses: () => renderReport('expenses'),
  income: () => renderReport('income'),
  invest: renderInvest,
  settings: renderSettings,
};
let tab = 'home';

function route() {
  const t = location.hash.slice(1);
  tab = VIEWS[t] ? t : 'home';
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + tab));
  if (!$('#modal').classList.contains('hidden')) closeSheet();
  renderCurrent();
  window.scrollTo(0, 0);
}
function renderCurrent() { VIEWS[tab](); }
function renderView(k) { if (k === tab) VIEWS[k](); }

window.addEventListener('hashchange', route);
$('#sync').onclick = () => {
  if (!cfg) { location.hash = '#settings'; return; }
  if (pending.length) pump(); else refresh(false);
};

$('#installBtn').onclick = installApp;
updateInstallButton();

setSync(cfg ? (pending.length ? 'pending' : 'loading') : 'local');
route();
if (cfg) { if (pending.length) pump(); else refresh(false); }

/* Pick up changes made on another device. 304 answers are cheap and do not count against the rate limit. */
setInterval(() => { if (cfg && document.visibilityState === 'visible') refresh(true); }, 30000);
document.addEventListener('visibilitychange', () => { if (cfg && document.visibilityState === 'visible') refresh(true); });

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });

/* New version check. An installed app window can stay open for days, and GitHub's CDN keeps the
   main page for up to 10 minutes, so the app asks for version.json itself (a unique URL skips both
   caches) and offers a one-click update. The update opens ./?v=N, a fresh URL, so it cannot get the
   old page back from any cache. */
let newVersion = 0;
async function checkForUpdate() {
  if (location.protocol !== 'https:' || newVersion) return;
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = +(await r.json()).version;
    if (v > APP_VERSION) { newVersion = v; $('#updateBar').classList.remove('hidden'); }
  } catch (e) { }
}
async function applyUpdate() {
  try { const reg = await navigator.serviceWorker?.getRegistration(); if (reg) await reg.update(); } catch (e) { }
  location.replace('./?v=' + newVersion + location.hash);
}
$('#updateBtn').onclick = () => {
  if (cfg && (pending.length || busy)) { toast('רגע, שומר שינויים…'); pump(); setTimeout(applyUpdate, 2500); return; }
  applyUpdate();
};
setTimeout(checkForUpdate, 3000);
setInterval(checkForUpdate, 30 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
