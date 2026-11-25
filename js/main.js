"use strict";
/* main.js: tabs (hash routing), start-up, background refresh, service worker. */
const APP_VERSION = 6;   // keep in step with the ?v= in index.html and CACHE in sw.js

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
