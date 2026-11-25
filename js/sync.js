"use strict";
/* =====================================================================
   sync.js: local storage + GitHub sync.
   The code is public (GitHub Pages); the data lives in a PRIVATE repository
   (e.g. sallaryandpension/budget-data, file budget.json). The token is kept only
   in this browser and is sent only to api.github.com.

   Every change is an op (see applyOp). Ops are queued (also in localStorage, so a
   closed tab does not lose them). After a short pause the queue is pushed: read the
   latest file, apply the ops, write with its sha. If another device wrote in the
   meantime GitHub answers 409/422 and we simply retry, so nothing is overwritten.
   ===================================================================== */
const LS = { data: 'bud_data', cfg: 'bud_gh_cfg', pending: 'bud_pending', ui: 'bud_ui' };
const readJSON = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };

let cfg = readJSON(LS.cfg);                  // { owner, repo, path, token }
let data = normalize(readJSON(LS.data));
let pending = Array.isArray(readJSON(LS.pending)) ? readJSON(LS.pending) : [];
let ui = Object.assign({ year: {}, flip: {}, invMode: 'd', homePeriod: '12', homeSkipCur: false, lastBackup: null },
  readJSON(LS.ui) || {});
let busy = false, etag = null, pumpTimer = null, retryTimer = null, syncState = 'local', syncMsg = '';

const persistLocal = () => localStorage.setItem(LS.data, JSON.stringify(data));
const savePending = () => localStorage.setItem(LS.pending, JSON.stringify(pending));
const saveUi = () => localStorage.setItem(LS.ui, JSON.stringify(ui));
const saveCfg = () => cfg ? localStorage.setItem(LS.cfg, JSON.stringify(cfg)) : localStorage.removeItem(LS.cfg);

/* The one entry point for every change. render:false is used by the table cells,
   which update themselves without rebuilding the page. */
function change(op, opts = {}) {
  applyOp(data, op);
  persistLocal();
  if (cfg) { pending.push(op); savePending(); schedulePump(opts.delay ?? 1500); }
  if (opts.render !== false) renderCurrent();
}

/* ---------- GitHub API ---------- */
const ghBase = () => `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
const ghUrl = () => `${ghBase()}/contents/${cfg.path.split('/').map(encodeURIComponent).join('/')}`;
const ghHeaders = () => ({ 'Authorization': 'Bearer ' + cfg.token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
function b64encode(str) {
  const bytes = new TextEncoder().encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, '')); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
async function errText(r) {
  let m = ''; try { m = (await r.json()).message; } catch (e) { }
  if (r.status === 401) return 'ה-Token לא תקין או שפג תוקפו';
  if (r.status === 403) return 'אין הרשאה (צריך Contents: Read and write). ' + m;
  if (r.status === 404) return 'ה-repository לא נמצא, או שה-Token לא נותן גישה אליו';
  return `GitHub ${r.status}: ${m}`;
}
async function ghCheckRepo() {
  const r = await fetch(ghBase(), { headers: ghHeaders(), cache: 'no-store' });
  if (!r.ok) throw new Error(await errText(r));
  const j = await r.json();
  return { isPrivate: !!j.private };
}
async function ghFetch(conditional) {
  const h = ghHeaders(); if (conditional && etag) h['If-None-Match'] = etag;
  const r = await fetch(ghUrl() + '?t=' + Date.now(), { headers: h, cache: 'no-store' });
  if (r.status === 304) return { notModified: true };
  if (r.status === 404) return { d: null, sha: null };
  if (!r.ok) throw new Error(await errText(r));
  etag = r.headers.get('ETag');
  const j = await r.json();
  let parsed = null;
  try { parsed = JSON.parse(b64decode(j.content) || 'null'); } catch (e) { throw new Error('קובץ הנתונים ב-GitHub פגום (JSON לא תקין)'); }
  return { d: normalize(parsed), sha: j.sha };
}
async function ghPut(d, sha, msg) {
  const body = { message: msg, content: b64encode(JSON.stringify(d, null, 1)) };
  if (sha) body.sha = sha;
  const r = await fetch(ghUrl(), { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, ghHeaders()), body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (!r.ok) throw new Error(await errText(r));
  etag = null;
  return { sha: (await r.json()).content.sha };
}

/* ---------- Push queue ---------- */
function schedulePump(ms) {
  clearTimeout(pumpTimer); clearTimeout(retryTimer);
  if (!busy) setSync('pending');
  pumpTimer = setTimeout(pump, ms);
}
async function pump() {
  if (!cfg || busy || !pending.length) return;
  busy = true; setSync('saving');
  const batch = pending.slice();
  let ok = false, err = null;
  for (let i = 0; i < 6 && !ok; i++) {
    try {
      const res = await ghFetch(false);
      const d = res.d || freshData();
      for (const op of batch) applyOp(d, op);
      const put = await ghPut(d, res.sha, opLabel(batch));
      if (put.conflict) { await sleep(400 + Math.random() * 900); continue; }
      ok = true;
      pending.splice(0, batch.length); savePending();
      const nd = clone(d);
      for (const op of pending) applyOp(nd, op);   // changes typed while we were saving
      adopt(nd);
    } catch (e) { err = e; break; }
  }
  busy = false;
  if (!ok) {
    const offline = err instanceof TypeError;      // fetch() failed: no connection
    setSync('error', offline ? 'אין חיבור לאינטרנט. השינויים שמורים במכשיר ויישלחו כשהחיבור יחזור.'
      : err ? err.message : 'התנגשות חוזרת עם מכשיר אחר');
    retryTimer = setTimeout(pump, 30000);
    return;
  }
  if (pending.length) schedulePump(400); else setSync('ok');
}
/* Take a newer copy of the data and redraw only if something visible changed. */
function adopt(nd) {
  const changed = JSON.stringify(nd) !== JSON.stringify(data);
  data = nd; persistLocal();
  if (changed) softRender();
}
async function refresh(silent) {
  if (!cfg) { setSync('local'); return; }
  if (busy || pending.length) { if (pending.length) schedulePump(300); return; }
  if (!silent) setSync('loading');
  try {
    const res = await ghFetch(true);
    if (busy || pending.length) return;
    if (!res.notModified && res.d) adopt(res.d);
    setSync('ok');
  } catch (e) { setSync('error', e.message); }
}

/* Connect: if the file does not exist yet, upload what is here.
   If both sides have data, the user chooses which one to keep. */
async function ghConnect(newCfg) {
  const prev = cfg, prevEtag = etag;
  cfg = newCfg; etag = null;
  try {
    const info = await ghCheckRepo();
    if (!info.isPrivate) {
      const go = await dialog('ה-repository ציבורי!', `<p>ה-repository <b>${esc(cfg.repo)}</b> גלוי לכולם. הנתונים הכספיים צריכים להישמר ב-repository <b>פרטי</b>.</p>`,
        [{ label: 'ביטול', value: false, cls: 'ghost' }, { label: 'להמשיך בכל זאת', value: true, cls: 'danger' }]);
      if (!go) throw new Error('בוטל');
    }
    const res = await ghFetch(false);
    if (!res.d) {
      await ghPut(data, null, 'יצירת קובץ הנתונים');
    } else if (isEmptyData(res.d)) {
      if (!isEmptyData(data)) await ghPut(data, res.sha, 'העלאת הנתונים מהמכשיר');
      else data = res.d;
    } else if (isEmptyData(data) || JSON.stringify(res.d) === JSON.stringify(data)) {
      data = res.d;
    } else {
      const pick = await dialog('יש נתונים בשני המקומות', '<p>בקובץ ב-GitHub כבר יש נתונים, וגם במכשיר הזה יש נתונים. מה לשמור?</p><p class="muted">מה שלא נבחר יוחלף. היסטוריית GitHub שומרת את כל הגרסאות הקודמות של הקובץ.</p>',
        [{ label: 'הנתונים מ-GitHub', value: 'remote' }, { label: 'הנתונים מהמכשיר הזה', value: 'local', cls: 'ghost' }, { label: 'ביטול', value: null, cls: 'ghost' }]);
      if (!pick) throw new Error('בוטל');
      if (pick === 'remote') data = res.d;
      else await ghPut(data, res.sha, 'העלאת הנתונים מהמכשיר');
    }
    pending = []; savePending(); saveCfg(); persistLocal(); setSync('ok');
    return true;
  } catch (e) {
    cfg = prev; etag = prevEtag;
    throw e;
  }
}
function ghDisconnect() {
  cfg = null; saveCfg(); pending = []; savePending(); etag = null;
  clearTimeout(pumpTimer); clearTimeout(retryTimer);
  setSync('local');
}

/* ---------- Status chip ---------- */
const SYNC_TEXT = { local: '💻 שמור במכשיר בלבד', ok: '✓ מסונכרן', pending: '✎ ממתין לשמירה', saving: '⏳ שומר…', loading: '⏳ טוען…', error: '⚠️ שגיאת סנכרון' };
function setSync(state, msg) {
  syncState = state; syncMsg = msg || '';
  const el = $('#sync'); if (!el) return;
  el.textContent = SYNC_TEXT[state];
  el.title = msg || (state === 'local' ? 'הנתונים נשמרים רק בדפדפן הזה. אפשר לחבר סנכרון ל-GitHub בהגדרות.' : '');
  el.className = 'sync s-' + state;
}

window.addEventListener('beforeunload', e => {
  if (cfg && (pending.length || busy)) { e.preventDefault(); e.returnValue = ''; }
});
