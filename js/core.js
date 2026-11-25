"use strict";
/* =====================================================================
   core.js: helpers, data model, operations on the data.
   data = {
     version: 1,
     settings: { startMonth: 'YYYY-MM' },
     expenses: { cats:[{id,name,active}], vals:{ 'YYYY-MM': { catId: number } } },
     income:   { cats:[...],               vals:{ ... } },
     invest:   { accs:[{id,name,type,sub,owner,provider,track,open,source,feeDep,feeBal,
                        splitEmp,splitEr,splitSev,note,active}],
                 vals:{ 'YYYY-MM': { accId: { d: deposit, b: balance } } } }
   }
   Every change goes through an "op" (a plain object) so it can be re-applied
   on the latest file from GitHub. See applyOp() and sync.js.
   ===================================================================== */

/* ---------- DOM & small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const r2 = n => Math.round(n * 100) / 100;
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isNum = v => typeof v === 'number' && isFinite(v);
const sum = arr => arr.reduce((s, v) => s + (isNum(v) ? v : 0), 0);

/* ---------- Numbers ---------- */
const NF0 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const NF2 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 2 });
const PF1 = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 });
function money(n, dash = '—') {
  if (!isNum(n)) return dash;
  const k = Math.round(n);
  return (k < 0 ? '-' : '') + '₪' + NF0.format(Math.abs(k));
}
const moneyHtml = (n, dash) => isNum(n) ? `<span class="n">${money(n)}</span>` : (dash ?? '');
const cellText = v => isNum(v) ? NF2.format(v) : '';
const pct = v => isNum(v) ? PF1.format(v) + '%' : '';

/* Parses what the user typed or pasted: "1,234", "₪ 1,234.50", "-300", "1234-", "(300)",
   or a calculation like "120+80+45" or "=3*99.9". Empty → null, invalid → NaN. */
function parseNum(s) {
  if (s == null) return null;
  s = String(s).replace(/[₪\s ‎‏‪-‮,]/g, '').replace(/[×xX]/g, '*').replace(/÷/g, '/');
  if (s === '') return null;
  if (s[0] === '=') s = s.slice(1);
  let neg = false;
  if (/^\([\d.]+\)$/.test(s)) { s = s.slice(1, -1); neg = true; }
  else if (/^[\d.]+-$/.test(s)) { s = s.slice(0, -1); neg = true; }
  const v = evalExpr(s);
  if (!isNum(v)) return NaN;
  return r2(neg ? -v : v);
}
function evalExpr(s) {
  let i = 0;
  const peek = () => s[i];
  function num() {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) throw 0;
    i += m[0].length; return parseFloat(m[0]);
  }
  function factor() {
    const c = peek();
    if (c === '-') { i++; return -factor(); }
    if (c === '+') { i++; return factor(); }
    if (c === '(') { i++; const v = expr(); if (peek() !== ')') throw 0; i++; return v; }
    return num();
  }
  function term() {
    let v = factor();
    while (peek() === '*' || peek() === '/') { const o = s[i++]; const f = factor(); v = o === '*' ? v * f : v / f; }
    return v;
  }
  function expr() {
    let v = term();
    while (peek() === '+' || peek() === '-') { const o = s[i++]; const t = term(); v = o === '+' ? v + t : v - t; }
    return v;
  }
  try { const v = expr(); return i === s.length ? v : null; } catch (e) { return null; }
}

/* ---------- Months ('YYYY-MM' strings compare correctly as text) ---------- */
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const MONTHS_S = ['ינו׳', 'פבר׳', 'מרץ', 'אפר׳', 'מאי', 'יוני', 'יולי', 'אוג׳', 'ספט׳', 'אוק׳', 'נוב׳', 'דצמ׳'];
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
function curMonth() { const d = new Date(); return ym(d.getFullYear(), d.getMonth() + 1); }
function todayStr() { const d = new Date(); return `${curMonth()}-${String(d.getDate()).padStart(2, '0')}`; }
function shiftMonth(m, k) {
  let y = +m.slice(0, 4), mm = +m.slice(5) + k;
  y += Math.floor((mm - 1) / 12);
  mm = (((mm - 1) % 12) + 12) % 12 + 1;
  return ym(y, mm);
}
const monthName = m => MONTHS[+m.slice(5) - 1] + ' ' + m.slice(0, 4);
const monthShort = (m, withYear) => MONTHS_S[+m.slice(5) - 1] + (withYear ? ' ' + m.slice(2, 4) : '');
const monthNum = m => m ? m.slice(5) + '/' + m.slice(0, 4) : '';
function monthRange(a, b) { const out = []; for (let m = a; m <= b && out.length < 1200; m = shiftMonth(m, 1)) out.push(m); return out; }
const validMonth = m => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || '');
const monthsBetween = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5) - +a.slice(5));

/* ---------- Report definitions ---------- */
const REPORTS = {
  expenses: {
    title: 'הוצאות', icon: '🧾',
    setupText: 'בחרו את קטגוריות ההוצאה שיופיעו בטבלה. אפשר להוסיף, לשנות שם, לסדר ולהסתיר קטגוריות גם אחר כך.',
    suggest: ['שכר דירה / משכנתא', 'ארנונה', 'חשמל', 'מים', 'גז', 'ועד בית', 'אינטרנט וטלוויזיה', 'סלולר',
      'סופר ומכולת', 'אוכל בחוץ ומשלוחים', 'דלק', 'תחבורה ציבורית', 'חניה', 'ביטוח רכב', 'טיפולים ותיקונים לרכב',
      'ביטוח בריאות', 'ביטוח חיים', 'בריאות ותרופות', 'ביגוד והנעלה', 'חינוך (גן / בית ספר)', 'חוגים',
      'בילויים ופנאי', 'חופשות', 'מנויים', 'מתנות ואירועים', 'תרומות', 'טיפוח', 'בית ותחזוקה', 'חיות מחמד',
      'עמלות בנק ואשראי', 'שונות'],
    preselect: ['שכר דירה / משכנתא', 'ארנונה', 'חשמל', 'מים', 'אינטרנט וטלוויזיה', 'סלולר', 'סופר ומכולת',
      'אוכל בחוץ ומשלוחים', 'דלק', 'בריאות ותרופות', 'ביגוד והנעלה', 'בילויים ופנאי', 'שונות'],
  },
  income: {
    title: 'הכנסות', icon: '💼',
    setupText: 'בחרו את מקורות ההכנסה. מומלץ להזין משכורת נטו (מה שנכנס לחשבון). ההפקדות לפנסיה ולהשתלמות נרשמות בדו״ח ההשקעות.',
    suggest: ['משכורת נטו', 'משכורת נטו – בן/בת זוג', 'עבודה נוספת / פרילנס', 'הכנסה משכירות', 'קצבת ילדים',
      'קצבאות ביטוח לאומי', 'החזר מס', 'בונוס / מענק', 'ריבית ודיבידנדים', 'מתנות', 'אחר'],
    preselect: ['משכורת נטו', 'אחר'],
  },
};

/* fees: has management fees; split: deposit rates from salary; term: interest rate and maturity date */
const INV_TYPES = {
  pension: { name: 'קרן פנסיה', short: 'פנסיה', color: '#2f6f5e', source: 'payroll',
    subs: ['קרן פנסיה מקיפה', 'קרן פנסיה כללית (משלימה)', 'ביטוח מנהלים'], fees: true, split: true,
    hint: 'חיסכון לגיל פרישה. נמשך כקצבה חודשית.' },
  hish: { name: 'קרן השתלמות', short: 'השתלמות', color: '#7a52b3', source: 'payroll',
    subs: ['שכיר', 'עצמאי'], fees: true, split: true,
    hint: 'חיסכון לטווח בינוני, בדרך כלל נזיל אחרי 6 שנים.' },
  gemel: { name: 'קופת גמל', short: 'גמל', color: '#c0623b', source: 'payroll',
    subs: ['גמל לתגמולים ופיצויים', 'גמל להשקעה', 'חיסכון לכל ילד'], fees: true, split: true,
    hint: 'גמל לתגמולים, גמל להשקעה או חיסכון לכל ילד.' },
  policy: { name: 'פוליסת חיסכון', short: 'פוליסה', color: '#b5487a', source: 'bank',
    subs: ['פוליסת חיסכון', 'ביטוח חיים משולב חיסכון'], fees: true, split: false,
    hint: 'חיסכון בחברת ביטוח. נזיל בכל עת, מס על הרווח במשיכה.' },
  broker: { name: 'ברוקר / תיק השקעות', short: 'ברוקר', color: '#3b6fb6', source: 'bank',
    subs: ['ברוקר ישראלי', 'ברוקר זר', 'תיק ניירות ערך בבנק', 'תיק מנוהל', 'קרנות נאמנות'], split: false,
    hint: 'חשבון מסחר פרטי או תיק בבנק. אפשר להוסיף כמה שרוצים.' },
  deposit: { name: 'פיקדון / חיסכון בבנק', short: 'פיקדון', color: '#2a8c9c', source: 'bank',
    subs: ['פיקדון שקלי', 'פיקדון צמוד מדד', 'פיקדון במט״ח', 'תוכנית חיסכון', 'פק״מ', 'חשבון חיסכון בריבית'], split: false, term: true,
    hint: 'כסף בבנק לתקופה קבועה, בריבית. נזיל בתום התקופה.' },
  cash: { name: 'עו״ש ומזומן', short: 'עו״ש', color: '#c9a227', source: 'bank',
    subs: ['עו״ש', 'עו״ש במט״ח', 'מזומן'], split: false,
    hint: 'הכסף בחשבון העו״ש ובמזומן. מספיק לעדכן את היתרה מדי פעם.' },
  realestate: { name: 'נדל״ן', short: 'נדל״ן', color: '#a0522d', source: 'bank',
    subs: ['דירה למגורים', 'דירה להשקעה', 'קרקע', 'נדל״ן בחו״ל', 'קרן נדל״ן / ריט'], split: false,
    hint: 'דירה, קרקע או קרן נדל״ן. ביתרה רושמים שווי משוער, ובהפקדות את מה שהושקע.' },
  other: { name: 'השקעה אחרת', short: 'אחר', color: '#7d7d7d', source: 'bank',
    subs: ['קרן כספית', 'מניות / אופציות מהעבודה (RSU)', 'קריפטו', 'זהב', 'מט״ח', 'הלוואות P2P', 'הלוואה שנתתי', 'אחר'], split: false,
    hint: 'קרן כספית, RSU, קריפטו, זהב וכל השקעה אחרת.' },
};
const INV_ORDER = ['pension', 'hish', 'gemel', 'policy', 'broker', 'deposit', 'cash', 'realestate', 'other'];
const SOURCES = { payroll: 'מהמשכורת', bank: 'מחשבון הבנק' };

/* ---------- Data model ---------- */
function freshData() {
  return {
    version: 1,
    settings: { startMonth: ym(new Date().getFullYear(), 1) },
    expenses: { cats: [], vals: {} },
    income: { cats: [], vals: {} },
    invest: { accs: [], vals: {} },
  };
}
function cleanVals(vals, fix) {
  const out = {};
  if (vals && typeof vals === 'object') for (const [m, row] of Object.entries(vals)) {
    if (!validMonth(m) || !row || typeof row !== 'object') continue;
    const o = {};
    for (const [k, v] of Object.entries(row)) { const fv = fix(v); if (fv !== undefined) o[k] = fv; }
    if (Object.keys(o).length) out[m] = o;
  }
  return out;
}
const SAFE_ID = /^[\w-]{1,40}$/;          // ids end up in HTML attributes and selectors
const toNum = v => isNum(v) ? v : (typeof v === 'string' && v.trim() !== '' && isNum(+v) ? +v : undefined);
function normalize(d) {
  const f = freshData();
  if (!d || typeof d !== 'object') return f;
  d.settings = Object.assign(f.settings, d.settings && typeof d.settings === 'object' ? d.settings : {});
  if (!validMonth(d.settings.startMonth)) d.settings.startMonth = f.settings.startMonth;
  for (const r of ['expenses', 'income']) {
    const x = d[r] && typeof d[r] === 'object' ? d[r] : {};
    x.cats = Array.isArray(x.cats) ? x.cats.filter(c => c && SAFE_ID.test(c.id) && typeof c.name === 'string') : [];
    x.vals = cleanVals(x.vals, toNum);
    d[r] = x;
  }
  const iv = d.invest && typeof d.invest === 'object' ? d.invest : {};
  iv.accs = Array.isArray(iv.accs) ? iv.accs.filter(a => a && SAFE_ID.test(a.id) && INV_TYPES[a.type] && typeof a.name === 'string') : [];
  iv.vals = cleanVals(iv.vals, v => {
    if (!v || typeof v !== 'object') return;
    const o = {}, dd = toNum(v.d), bb = toNum(v.b);
    if (dd !== undefined) o.d = dd;
    if (bb !== undefined) o.b = bb;
    return Object.keys(o).length ? o : undefined;
  });
  d.invest = iv;
  d.version = 1;
  return d;
}
const isEmptyData = d => !d.expenses.cats.length && !d.income.cats.length && !d.invest.accs.length;

/* ---------- Operations (each one can be re-applied on a newer copy of the data) ---------- */
function setVal(vals, m, k, v) {
  if (v == null) {
    if (vals[m]) { delete vals[m][k]; if (!Object.keys(vals[m]).length) delete vals[m]; }
    return;
  }
  (vals[m] ||= {})[k] = v;
}
function setInv(vals, m, a, f, v) {
  const row = vals[m] ||= {};
  const cell = row[a] ||= {};
  if (v == null) delete cell[f]; else cell[f] = v;
  if (!Object.keys(cell).length) delete row[a];
  if (!Object.keys(row).length) delete vals[m];
}
function reorder(list, ids) {
  const by = new Map(list.map(x => [x.id, x]));
  const out = ids.map(id => by.get(id)).filter(Boolean);
  for (const x of list) if (!ids.includes(x.id)) out.push(x);
  return out;
}
function applyOp(d, op) {
  switch (op.t) {
    case 'cells': for (const [m, c, v] of op.list) setVal(d[op.r].vals, m, c, v); break;
    case 'inv': for (const [m, a, f, v] of op.list) setInv(d.invest.vals, m, a, f, v); break;
    case 'catsAdd': for (const cat of op.cats) if (!d[op.r].cats.some(c => c.id === cat.id)) d[op.r].cats.push(cat); break;
    case 'catSet': { const c = d[op.r].cats.find(c => c.id === op.id); if (c) Object.assign(c, op.patch); break; }
    case 'catDel':
      d[op.r].cats = d[op.r].cats.filter(c => c.id !== op.id);
      for (const m of Object.keys(d[op.r].vals)) setVal(d[op.r].vals, m, op.id, null);
      break;
    case 'catOrder': d[op.r].cats = reorder(d[op.r].cats, op.ids); break;
    case 'accAdd': if (!d.invest.accs.some(a => a.id === op.acc.id)) d.invest.accs.push(op.acc); break;
    case 'accSet': { const a = d.invest.accs.find(a => a.id === op.id); if (a) Object.assign(a, op.patch); break; }
    case 'accDel':
      d.invest.accs = d.invest.accs.filter(a => a.id !== op.id);
      for (const m of Object.keys(d.invest.vals)) {
        delete d.invest.vals[m][op.id];
        if (!Object.keys(d.invest.vals[m]).length) delete d.invest.vals[m];
      }
      break;
    case 'set': d.settings[op.k] = op.v; break;
    case 'replace': {
      const n = normalize(clone(op.data));
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, n);
      break;
    }
  }
}
function opLabel(ops) {
  const names = { cells: 'עדכון נתונים', inv: 'עדכון השקעות', catsAdd: 'הוספת קטגוריות', catSet: 'עריכת קטגוריה',
    catDel: 'מחיקת קטגוריה', catOrder: 'סידור קטגוריות', accAdd: 'הוספת חשבון השקעה', accSet: 'עריכת חשבון השקעה',
    accDel: 'מחיקת חשבון השקעה', set: 'שינוי הגדרות', replace: 'טעינת נתונים מגיבוי' };
  const kinds = [...new Set(ops.map(o => names[o.t] || 'עדכון'))];
  return kinds.slice(0, 3).join(', ');
}

/* ---------- Queries ---------- */
const valsOf = r => data[r].vals;
function monthHasData(r, m) { const row = valsOf(r)[m]; return !!row && Object.keys(row).length > 0; }
/* A month counts for the average deposit only if some deposit was entered in it
   (a month with balances only, e.g. the opening balance, does not). */
function invDepMonth(m) { const row = data.invest.vals[m]; return !!row && Object.values(row).some(c => isNum(c.d)); }
function rangeBounds() {
  let a = data.settings.startMonth, b = curMonth();
  for (const r of ['expenses', 'income', 'invest'])
    for (const m of Object.keys(valsOf(r))) { if (m < a) a = m; if (m > b) b = m; }
  return [a, b];
}
const allMonths = () => { const [a, b] = rangeBounds(); return monthRange(a, b); };
const yearsList = () => [...new Set(allMonths().map(m => m.slice(0, 4)))];
function defaultYear() { const ys = yearsList(), y = curMonth().slice(0, 4); return ys.includes(y) ? y : ys[ys.length - 1]; }
const sortedAccs = () => INV_ORDER.flatMap(t => data.invest.accs.filter(a => a.type === t));
const invCell = (m, id) => data.invest.vals[m]?.[id];
function lastBal(id, m) {           // last balance entered at or before month m → {m, v}
  let bm = null, bv = null;
  for (const k in data.invest.vals) {
    if (k > m) continue;
    const c = data.invest.vals[k][id];
    if (c && isNum(c.b) && (bm === null || k > bm)) { bm = k; bv = c.b; }
  }
  return bm ? { m: bm, v: bv } : null;
}
/* Gain in a period = end balance − start balance − deposits in between.
   Start = the last balance before the period (or the first one inside it). */
function periodGain(id, ms) {
  if (!ms.length) return null;
  let base = lastBal(id, shiftMonth(ms[0], -1));
  if (!base) {
    const f = ms.find(m => isNum(invCell(m, id)?.b));
    if (!f) return null;
    base = { m: f, v: invCell(f, id).b };
  }
  const end = lastBal(id, ms[ms.length - 1]);
  if (!end || end.m <= base.m) return null;
  let dep = 0;
  for (const m in data.invest.vals) if (m > base.m && m <= end.m) { const v = invCell(m, id)?.d; if (isNum(v)) dep += v; }
  return { gain: end.v - base.v - dep, from: base.m, to: end.m };
}
