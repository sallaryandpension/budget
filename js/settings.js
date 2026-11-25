"use strict";
/* settings.js: GitHub sync, start month, backup / restore, reset. */

const GH_DEFAULTS = { owner: 'sallaryandpension', repo: 'budget-data', path: 'budget.json' };

function renderSettings() {
  const el = $('#view-settings');
  const c = cfg || {};
  el.innerHTML = `
    <div class="pagehead"><h2>⚙️ הגדרות</h2></div>
    <div class="settings">
    <section class="card">
      <h3>☁️ סנכרון ל-GitHub (repository פרטי)</h3>
      <p class="muted">הקוד של האפליקציה גלוי, אבל הנתונים נשמרים בקובץ אחד ב-repository <b>פרטי</b>. כל שמירה נרשמת כ-commit, כך שיש היסטוריה מלאה ואפשר לשחזר כל גרסה. ה-Token נשמר רק בדפדפן הזה ונשלח רק ל-api.github.com.</p>
      <div class="status s-${syncState}">${cfg ? `מחובר ל-<b class="ltr">${esc(cfg.owner)}/${esc(cfg.repo)}</b> · <span class="ltr">${esc(cfg.path)}</span><br>${SYNC_TEXT[syncState]}${syncMsg ? ' – ' + esc(syncMsg) : ''}` : 'לא מחובר. הנתונים נשמרים רק בדפדפן הזה.'}</div>
      <div class="row">
        <div><label for="ghOwner">owner</label><input id="ghOwner" dir="ltr" autocomplete="off" value="${esc(c.owner || GH_DEFAULTS.owner)}"></div>
        <div><label for="ghRepo">repository (פרטי)</label><input id="ghRepo" dir="ltr" autocomplete="off" value="${esc(c.repo || GH_DEFAULTS.repo)}"></div>
      </div>
      <div class="row">
        <div><label for="ghPath">שם הקובץ</label><input id="ghPath" dir="ltr" autocomplete="off" value="${esc(c.path || GH_DEFAULTS.path)}"></div>
        <div><label for="ghToken">Token</label><input id="ghToken" dir="ltr" type="password" autocomplete="off" placeholder="${cfg ? '•••••• (שמור)' : 'github_pat_…'}"></div>
      </div>
      <div class="row btns">
        <button type="button" class="btn" id="ghConnect">${cfg ? 'שמירה וחיבור מחדש' : 'חיבור'}</button>
        ${cfg ? '<button type="button" class="btn ghost" id="ghSyncNow">סנכרון עכשיו</button><button type="button" class="btn ghost" id="ghDisconnect">ניתוק</button>' : ''}
      </div>
      <details class="tips"><summary>איך יוצרים Token?</summary><ol>
        <li>ב-GitHub: תמונת הפרופיל ← <b>Settings ← Developer settings ← Personal access tokens ← Fine-grained tokens ← Generate new token</b>.</li>
        <li><b>Repository access:</b> בוחרים <b>Only select repositories</b> ואת <span class="ltr">budget-data</span> בלבד.</li>
        <li><b>Permissions ← Repository permissions ← Contents:</b> <b>Read and write</b>.</li>
        <li>מעתיקים את המפתח (מתחיל ב-<span class="ltr">github_pat_</span>) ומדביקים כאן. בכל מכשיר מזינים אותו פעם אחת.</li></ol></details>
    </section>

    <section class="card">
      <h3>📅 תקופה</h3>
      <label for="stStart">החודש הראשון בטבלאות</label>
      <div class="row"><input type="month" id="stStart" value="${data.settings.startMonth}"><span></span></div>
      <p class="hint">הטבלאות מתחילות בחודש הזה (או בחודש המוקדם ביותר שיש בו נתונים) ומסתיימות בחודש הנוכחי.</p>
    </section>

    <section class="card">
      <h3>💾 גיבוי ושחזור</h3>
      <p class="muted">${cfg ? 'GitHub שומר את כל הגרסאות. גיבוי לקובץ הוא שכבת הגנה נוספת.' : 'בלי סנכרון, הנתונים נמצאים רק בדפדפן הזה. מומלץ לייצא גיבוי מדי פעם.'}
        ${ui.lastBackup ? `<br>גיבוי אחרון לקובץ: ${esc(ui.lastBackup)}` : ''}</p>
      <div class="row btns">
        <button type="button" class="btn ghost" id="expJson">⬇ גיבוי (JSON)</button>
        <button type="button" class="btn ghost" id="impJson">⬆ שחזור מגיבוי</button>
        <input type="file" id="impFile" accept=".json,application/json" hidden>
      </div>
    </section>

    <section class="card">
      <h3>📊 אקסל</h3>
      <p class="muted">הורדה: קובץ אחד עם גיליון לכל דוח (הוצאות, הכנסות, הפקדות ויתרות), עם כל הקטגוריות והחודשים. אפשר למלא אותו באקסל ולייבא בחזרה.
        ייבוא: מהקובץ הזה, או ישירות מקובץ אקסל משלכם. האפליקציה מזהה את החודשים ומציגה מסך שבו בוחרים לאן כל עמודה נכנסת.</p>
      <div class="row btns">
        <button type="button" class="btn ghost" id="xlOut">⬇ הורדת קובץ אקסל</button>
        <button type="button" class="btn ghost" id="xlIn">⬆ ייבוא מאקסל או CSV</button>
      </div>
    </section>

    <section class="card">
      <h3>📲 התקנה כאפליקציה</h3>
      ${isInstalled()
        ? '<p class="muted">✓ האפליקציה מותקנת ופתוחה כרגע כאפליקציה.</p>'
        : `<p class="muted">אפשר להתקין את האתר כאפליקציה: במחשב היא נפתחת בחלון משלה, עם אייקון בתפריט התחל ובשורת המשימות. בטלפון היא מופיעה במסך הבית. הנתונים זהים, כי כולם מסונכרנים ל-GitHub.</p>
           <button type="button" class="btn" id="instNow">📲 התקנה</button>`}
    </section>

    <section class="card">
      <h3>🗑 איפוס</h3>
      <p class="muted">מוחק את כל הדוחות והנתונים${cfg ? ' (גם בקובץ ב-GitHub, שם הגרסאות הקודמות נשארות בהיסטוריה)' : ''}.</p>
      <button type="button" class="btn danger" id="resetAll">מחיקת כל הנתונים</button>
    </section>
    <p class="muted center">גרסה ${APP_VERSION}</p>
    </div>`;

  $('#ghConnect').onclick = async () => {
    const owner = $('#ghOwner').value.trim(), repo = $('#ghRepo').value.trim(), path = $('#ghPath').value.trim() || GH_DEFAULTS.path;
    const token = $('#ghToken').value.trim() || (cfg && cfg.token) || '';
    if (!owner || !repo) { toast('צריך owner ו-repository'); return; }
    if (!token) { $('#ghToken').focus(); toast('צריך להדביק Token'); return; }
    const btn = $('#ghConnect'); btn.disabled = true; btn.textContent = 'מתחבר…';
    try {
      await ghConnect({ owner, repo, path, token });
      toast('מחובר ✓'); renderSettings();
    } catch (e) {
      if (e.message !== 'בוטל') toast('⚠️ ' + e.message);
      btn.disabled = false; btn.textContent = cfg ? 'שמירה וחיבור מחדש' : 'חיבור';
    }
  };
  if (cfg) {
    $('#ghSyncNow').onclick = async () => { if (pending.length) await pump(); else await refresh(false); renderSettings(); };
    $('#ghDisconnect').onclick = async () => {
      const ok = await confirmBox('ניתוק מ-GitHub', `<p>הנתונים יישארו בדפדפן הזה, אבל שינויים חדשים לא יישמרו ב-GitHub.${pending.length ? ' <b>יש שינויים שעוד לא נשמרו ב-GitHub, והם יישארו רק כאן.</b>' : ''}</p>`, 'ניתוק');
      if (ok) { ghDisconnect(); renderSettings(); toast('נותק'); }
    };
  }
  $('#stStart').onchange = e => {
    if (validMonth(e.target.value)) { change({ t: 'set', k: 'startMonth', v: e.target.value }); toast('נשמר'); }
  };
  $('#expJson').onclick = () => {
    downloadFile(`budget-backup-${todayStr()}.json`, JSON.stringify(data, null, 1), 'application/json');
    ui.lastBackup = todayStr(); saveUi(); renderSettings();
  };
  $('#impJson').onclick = () => $('#impFile').click();
  $('#impFile').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    let d;
    try { d = JSON.parse(await file.text()); } catch (err) { toast('⚠️ הקובץ אינו JSON תקין'); return; }
    if (!d || typeof d !== 'object' || !('expenses' in d || 'income' in d || 'invest' in d)) { toast('⚠️ זה לא קובץ גיבוי של האפליקציה'); return; }
    const n = normalize(clone(d));
    const ok = await confirmBox('שחזור מגיבוי', `<p>הקובץ מכיל ${n.expenses.cats.length} קטגוריות הוצאה, ${n.income.cats.length} קטגוריות הכנסה ו-${n.invest.accs.length} חשבונות השקעה.</p><p><b>כל הנתונים הנוכחיים יוחלפו בתוכן הקובץ.</b></p>`, 'שחזור', true);
    if (ok) { change({ t: 'replace', data: n }); toast('הנתונים שוחזרו'); }
  };
  if ($('#instNow')) $('#instNow').onclick = installApp;
  $('#xlOut').onclick = exportExcel;
  $('#xlIn').onclick = pickExcelFile;
  $('#resetAll').onclick = async () => {
    const ok = await confirmBox('מחיקת כל הנתונים', '<p>כל הדוחות, הקטגוריות, החשבונות והנתונים יימחקו. מומלץ לייצא גיבוי לפני כן.</p>', 'מחיקה', true);
    if (ok) { change({ t: 'replace', data: freshData() }); toast('כל הנתונים נמחקו'); location.hash = '#home'; }
  };
}
