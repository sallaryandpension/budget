"use strict";
/* install.js: install the site as an app (PWA).
   Chrome / Edge / Android: the browser's own install prompt.
   iPhone / iPad: Safari → Share → Add to Home Screen (there is no prompt there).
   Inside the installed app the button is hidden. */

const UA = navigator.userAgent;
const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const IS_IOS_SAFARI = IS_IOS && /Safari/.test(UA) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|Instagram|FBAN|FBAV|WhatsApp|Line\//.test(UA);
const IS_ANDROID = /Android/.test(UA);
const IS_EDGE = /Edg\//.test(UA);
const IS_FIREFOX = /Firefox\//.test(UA);
const IS_MAC_SAFARI = !IS_IOS && /Macintosh/.test(UA) && /Safari/.test(UA) && !/Chrome|Chromium|Edg\//.test(UA);
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: window-controls-overlay)').matches || navigator.standalone === true;
let installPrompt = null;

function updateInstallButton() {
  const b = $('#installBtn');
  if (b) b.classList.toggle('hidden', isInstalled() || location.protocol !== 'https:');
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; updateInstallButton(); });
window.addEventListener('appinstalled', () => { installPrompt = null; updateInstallButton(); toast('✓ האפליקציה הותקנה'); if (tab === 'settings') renderSettings(); });

async function installApp() {
  if (installPrompt) {
    installPrompt.prompt();
    const r = await installPrompt.userChoice;
    installPrompt = null;
    if (r.outcome === 'accepted') updateInstallButton();
    return;
  }
  openSheet(`<div class="head"><h3>📲 התקנה כאפליקציה</h3><button type="button" class="x" data-close aria-label="סגירה">✕</button></div>
    <div class="steps">${installStepsHtml()}</div>
    <div class="sheet-actions"><button type="button" class="btn" data-close>הבנתי</button></div>`);
}

function installStepsHtml() {
  const share = '<span class="ic">⬆︎</span>';
  if (IS_IOS) return `<ol>
      <li>פותחים את הכתובת ב-<b>Safari</b>.</li>
      <li>לוחצים על כפתור השיתוף ${share} (בתחתית המסך, או למעלה באייפד).</li>
      <li>גוללים ובוחרים <b>הוספה למסך הבית</b>, ואז <b>הוסף</b>.</li>
      <li>מעכשיו פותחים את האפליקציה <b>מהאייקון במסך הבית</b>.</li></ol>
    ${IS_IOS_SAFARI ? '' : '<p class="warn">⚠️ נראה שהדף פתוח בדפדפן אחר או בתוך אפליקציה (וואטסאפ, כרום וכו׳). באייפון אפשר להתקין רק מ-Safari: פותחים את הקישור ב-Safari וחוזרים על השלבים.</p>'}
    <p class="hint">באייפון, האפליקציה שבמסך הבית שומרת נתונים בנפרד מ-Safari, ולכן מזינים בה את ה-Token פעם אחת (⚙️ הגדרות ← סנכרון).</p>`;
  if (IS_ANDROID) return `<ol>
      <li>פותחים את הכתובת ב-<b>Chrome</b>.</li>
      <li>תפריט <b>⋮</b> (למעלה) ← <b>התקנת אפליקציה</b> או <b>הוספה למסך הבית</b>.</li>
      <li>מאשרים. האייקון יופיע במסך הבית וברשימת האפליקציות.</li></ol>`;
  if (IS_MAC_SAFARI) return `<ol>
      <li>בתפריט <b>File</b> (קובץ) בוחרים <b>Add to Dock</b> (הוספה ל-Dock).</li>
      <li>האפליקציה תיפתח בחלון משלה מה-Dock.</li></ol>`;
  if (IS_FIREFOX) return `<p>Firefox במחשב לא תומך בהתקנת אתרים כאפליקציה. פותחים את הכתובת ב-<b>Chrome</b> או ב-<b>Edge</b> ומתקינים משם.</p>`;
  if (IS_EDGE) return `<ol>
      <li>בשורת הכתובת לוחצים על סמל ההתקנה <b>⊕</b> (בצד ימין של השורה), או</li>
      <li>תפריט <b>…</b> ← <b>אפליקציות</b> ← <b>התקנת אתר זה כאפליקציה</b>.</li>
      <li>האפליקציה תיפתח בחלון משלה ותופיע בתפריט התחל. אפשר להצמיד אותה לשורת המשימות.</li></ol>`;
  return `<ol>
      <li>בשורת הכתובת לוחצים על סמל ההתקנה <b>⊕</b> (בצד ימין של השורה), או</li>
      <li>תפריט <b>⋮</b> ← <b>העברה, שמירה ושיתוף</b> ← <b>התקנת הדף כאפליקציה</b>.</li>
      <li>האפליקציה תיפתח בחלון משלה ותופיע בתפריט התחל ובשולחן העבודה. אפשר להצמיד אותה לשורת המשימות.</li></ol>`;
}
