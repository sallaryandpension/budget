"use strict";
/* =====================================================================
   forecast.js: how much there will be, and when one can stop working.
   Mode 1 (by years):
     • years: the value in N years, keeping deposits (A) vs no new deposits (B).
     • goal:  how many years until a target, counting all money, and counting pension/annuity money
              only from the pension age (before that it cannot be drawn).
   Mode 2 (fire): with a withdrawal rule (e.g. 4%) and a monthly spending, the earliest age to stop
     working: liquid savings must carry the person until the pension starts, and from then on the
     annuity plus the rule must cover the spending. Always in today's shekels.
   Per account, month by month:  B(t) = B(t-1) × (1 + r_m) + D × (1 + i_m)^t × (1 − deposit fee).
   Filters: include real estate / pension funds / provident funds (ui.incl, shared with analysis).
   Settings live in data.settings.forecast, so every device sees the same forecast.
   No tax is applied. This is an estimate for planning, not advice.
   ===================================================================== */

const FC_DEFAULTS = { mode: 'years', years: 20, infl: 2.5, real: true, birth: null, retAge: 67, dep: {}, goal: 2000000, spend: null, swr: 4, coef: 200, depScen: 'all', lastAge: 95, sellRE: false, fireNominal: false };
const SPEND_STEPS = [0, 10, 20, 30, 50];                    // quick "spend more than today" buttons, % above the average
/* Which deposits go on: those from the salary depend on the employer (pension, study fund), the
   personal ones depend on the person (broker, bank). Each account says where its deposits come from. */
const SCEN = { all: 'הכול ממשיך', payroll: 'רק הפקדות מהמשכורת', personal: 'רק הפקדות אישיות', none: 'בלי הפקדות' };
const SCEN_HINT = { all: '', payroll: 'פנסיה, השתלמות וכל מה שיורד מהמשכורת', personal: 'ברוקר, פיקדונות וכל מה שיוצא מחשבון הבנק', none: 'רק התשואה על מה שיש היום' };
const depOn = (a, s) => s === 'all' || (s === 'payroll' && a.source === 'payroll') || (s === 'personal' && a.source !== 'payroll');
const yv = (x, y, s) => (depOn(x.a, s) ? x.A : x.B).yearly[y];      // an account's value in year y under scenario s
const fcSettings = () => { const f = data.settings.forecast || {}; return Object.assign({}, FC_DEFAULTS, f, { dep: Object.assign({}, f.dep) }); };
function saveFc(patch) { change({ t: 'set', k: 'forecast', v: Object.assign(fcSettings(), patch) }, { render: false }); renderForecast(); }
const inclGroups = () => Object.assign({ realestate: true, pension: true, gemel: true }, ui.incl || {});
const accGroup = a => a.type === 'realestate' || a.type === 'pension' || a.type === 'gemel' ? a.type : 'other';
const isIncluded = a => { const g = accGroup(a); return g === 'other' || inclGroups()[g]; };
/* Money paid out only as a monthly pension (annuity): pension funds and provident funds for pension. */
const isAnnuity = a => a.type === 'pension' || (a.type === 'gemel' && a.sub === 'גמל לתגמולים ופיצויים');
const realRate = (a, infl) => (1 + (accReturn(a) ?? 0) / 100) / (1 + infl / 100) - 1;
/* A home you live in cannot pay for retirement (you still need somewhere to live). Other real estate
   counts as money to live on only when the user chose to sell it (S.sellRE). */
const isHome = a => a.type === 'realestate' && a.sub === 'דירה למגורים';
const livesOn = (a, S) => !isAnnuity(a) && !(a.type === 'realestate' && (isHome(a) || !S.sellRE));

function inclFilterHtml(id) {
  const inc = inclGroups();
  return `<div class="incl" id="${id}"><span class="muted">לכלול:</span>
    <label class="chk"><input type="checkbox" data-g="realestate" ${inc.realestate ? 'checked' : ''}> נדל״ן</label>
    <label class="chk"><input type="checkbox" data-g="pension" ${inc.pension ? 'checked' : ''}> קרנות פנסיה</label>
    <label class="chk"><input type="checkbox" data-g="gemel" ${inc.gemel ? 'checked' : ''}> קופות גמל</label></div>`;
}
function bindInclFilter(id, rerender) {
  $(`#${id}`).addEventListener('change', e => {
    const g = e.target.dataset.g; if (!g) return;
    ui.incl = Object.assign(inclGroups(), { [g]: e.target.checked }); saveUi(); rerender();
  });
}

/* Average monthly deposit of an account over the last 12 months that have deposit data. */
function avgDeposit12(a) {
  const cur = curMonth(), ms = monthRange(shiftMonth(cur, -11), cur).filter(invDepMonth);
  return ms.length ? sum(ms.map(m => invCell(m, a.id)?.d)) / ms.length : 0;
}
/* Average monthly expenses over the last 12 full months (the current month is still open). */
function avgSpend12() {
  const cur = curMonth();
  let ms = monthRange(shiftMonth(cur, -12), shiftMonth(cur, -1)).filter(m => monthHasData('expenses', m));
  if (!ms.length) ms = monthRange(shiftMonth(cur, -11), cur).filter(m => monthHasData('expenses', m));
  return ms.length ? sum(ms.map(m => monthTotal('expenses', m))) / ms.length : 0;
}
function projectAccount(a, start, dep, years, infl, withDeposits, rateOverride) {
  const r = isNum(rateOverride) ? rateOverride : accReturn(a), rm = Math.pow(1 + (isNum(r) ? r : 0) / 100, 1 / 12) - 1;
  const im = Math.pow(1 + infl / 100, 1 / 12) - 1, fee = isNum(a.feeDep) ? a.feeDep / 100 : 0;
  let b = start, paid = 0;
  const yearly = [b], paidYearly = [0];
  for (let t = 1; t <= years * 12; t++) {
    const d = withDeposits ? dep * Math.pow(1 + im, t) : 0;
    b = b * (1 + rm) + d * (1 - fee); paid += d;
    if (t % 12 === 0) { yearly.push(b); paidYearly.push(paid); }
  }
  return { yearly, paidYearly };
}
function fcRows(S, years) {
  return sortedAccs().filter(a => a.active !== false && isIncluded(a)).map(a => {
    const lb = lastBal(a.id, curMonth()), start = lb ? lb.v : 0;
    const avgD = avgDeposit12(a), dep = isNum(S.dep[a.id]) ? S.dep[a.id] : avgD;
    return { a, start, hasBal: !!lb, avgD, dep, ret: accReturn(a),
      A: projectAccount(a, start, dep, years, S.infl, true), B: projectAccount(a, start, dep, years, S.infl, false) };
  }).filter(x => x.hasBal || x.dep > 0);
}

/* Mode 2: stop working k years from now. Real terms (today's shekels), yearly steps.
   Liquid money pays the spending until the pension age; there the annuity money becomes a monthly
   pension (balance ÷ coefficient). Retiring at k is possible when all three hold:
     1. the liquid money lasts until the pension age (the bridge),
     2. the rule at the pension age: liquid × rate ≥ what the pension does not cover,
     3. the money does not run out before the age it has to last to (S.lastAge, default 95).
   Every account is followed on its own: liquid accounts grow at their own rate and the spending is
   taken from them in proportion to their size; the home and real estate that is not sold keep
   growing and are never touched; annuity money grows until it becomes the pension. */
function firePlan(rows, S, age, H, k) {
  const dR = y => Math.pow(1 + S.infl / 100, y);
  const liq = rows.filter(x => livesOn(x.a, S)), ann = rows.filter(x => isAnnuity(x.a));
  const keep = rows.filter(x => !livesOn(x.a, S) && !isAnnuity(x.a));
  const annual = 12 * S.spendNow, P = S.retAge, swr = S.swr / 100, sc = S.depScen;
  const at = x => yv(x, k, sc) / dR(k);
  let Li = liq.map(at), pen = ann.map(at), kv = keep.map(at);
  const Lret = sum(Li);
  let annuity = 0, converted = false, LatP = null, penAtP = null, bridgeOk = true, runOut = null;
  const path = [];
  for (let y = k; y <= H; y++) {
    const ageY = age + y;
    if (!converted && ageY >= P) { penAtP = pen.slice(); annuity = sum(pen) / S.coef; pen = pen.map(() => 0); converted = true; LatP = sum(Li); }
    path.push({ y, L: sum(Li), Li: Li.slice(), pen: sum(pen), penI: pen.slice(), keep: kv.slice() });
    if (y === H) break;                                       // the money has to last until this age, not through it
    Li = Li.map((v, i) => v * (1 + realRate(liq[i].a, S.infl)));
    const before = sum(Li), after = before - (annual - 12 * annuity);
    if (before > 0) Li = Li.map(v => v / before * after);     // the spending comes out in proportion to each account
    else if (Li.length) Li[0] += after - before;
    pen = pen.map((p, i) => p * (1 + realRate(ann[i].a, S.infl)));
    kv = kv.map((v, i) => v * (1 + realRate(keep[i].a, S.infl)));
    if (after < 0 && runOut === null) { runOut = ageY + 1; if (!converted) bridgeOk = false; }
  }
  if (LatP === null) LatP = sum(Li);
  const needAfter = Math.max(0, annual - 12 * annuity);
  const ruleOk = bridgeOk && LatP >= 0 && (needAfter === 0 || LatP * swr >= needAfter);
  const lasts = runOut === null;                              // H ends at the age the money has to last to
  return { k, age: age + k, Lret, annuity, LatP, penAtP, needAfter, bridgeOk, ruleOk, lasts, ok: ruleOk && lasts, runOut, path, liq, ann, keep };
}
/* An account's value in year y of a plan (today's shekels); for annuity money after the pension age: null. */
function planValue(plan, x, y, S) {
  if (y < plan.k) return yv(x, y, S.depScen) / Math.pow(1 + S.infl / 100, y);
  const p = plan.path[y - plan.k]; if (!p) return null;
  let i = plan.liq.indexOf(x); if (i >= 0) return p.Li[i];
  i = plan.keep.indexOf(x); if (i >= 0) return p.keep[i];
  i = plan.ann.indexOf(x); if (i >= 0) return plan.age + (y - plan.k) >= S.retAge ? null : p.penI[i];
  return null;
}

function renderForecast() {
  const el = $('#view-forecast');
  if (!sortedAccs().some(a => a.active !== false)) {
    el.innerHTML = `<div class="pagehead"><h2>🔮 תחזית</h2></div><div class="card empty">כדי לחשב תחזית צריך חשבונות השקעה עם יתרות. מתחילים ב-<a href="#invest">📈 השקעות</a>.</div>`;
    return;
  }
  const S = fcSettings(), nowY = +curMonth().slice(0, 4);
  const age = isNum(S.birth) ? nowY - S.birth : null;
  const toRet = isNum(age) ? Math.max(1, S.retAge - age) : null;
  const mode = S.mode, sc = SCEN[S.depScen] ? S.depScen : 'all';
  S.depScen = sc;
  const real = mode === 'fire' ? true : S.real;
  const defl = y => real ? Math.pow(1 + S.infl / 100, y) : 1;
  const ageTxt = y => isNum(age) ? ` · גיל ${age + y}` : '';
  const yOpts = [5, 10, 15, 20, 25, 30];
  const avgSpend = avgSpend12();
  S.spendNow = isNum(S.spend) ? S.spend : avgSpend;

  const H = mode === 'years' ? (S.years === 'ret' ? (toRet || 20) : S.years)
    : mode === 'goal' ? 60 : (isNum(age) ? Math.max(1, S.lastAge - age) : 1);
  const rows = fcRows(S, H);
  const missingBal = rows.filter(x => !x.hasBal), missingRet = rows.filter(x => !isNum(x.ret));
  const today = sum(rows.map(x => x.start));
  const depPay = sum(rows.filter(x => x.a.source === 'payroll').map(x => x.dep)), depOwn = sum(rows.filter(x => x.a.source !== 'payroll').map(x => x.dep));
  const depScenSeg = `<div class="fc-scen"><span class="muted">הפקדות מעכשיו:</span><div class="seg wrap" id="fcScen">${Object.entries(SCEN).map(([k, t]) =>
    `<button type="button" data-s="${k}" class="${k === sc ? 'on' : ''}" title="${esc(SCEN_HINT[k])}">${t}${k === 'payroll' ? ` (${money(depPay)})` : k === 'personal' ? ` (${money(depOwn)})` : ''}</button>`).join('')}</div>
    <small class="muted">לפי השדה ״מאיפה מגיעות ההפקדות״ בכל חשבון: מהמשכורת ${money(depPay)} לחודש (תלוי במעסיק), מחשבון הבנק ${money(depOwn)} לחודש (תלוי בך).</small></div>`;
  const excluded = ['realestate', 'pension', 'gemel'].filter(g => !inclGroups()[g]).map(g => ({ realestate: 'נדל״ן', pension: 'קרנות פנסיה', gemel: 'קופות גמל' }[g]));

  // ---------- controls ----------
  const modeSeg = `<div class="seg fc-mode" id="fcMode">
      <button type="button" data-m="years" class="${mode !== 'fire' ? 'on' : ''}">מצב 1: לפי שנים</button>
      <button type="button" data-m="fire" class="${mode === 'fire' ? 'on' : ''}">מצב 2: מתי אפשר לפרוש</button></div>
    ${mode !== 'fire' ? `<div class="seg fc-sub" id="fcSub">
      <button type="button" data-m="years" class="${mode === 'years' ? 'on' : ''}">כמה יהיה בעוד X שנים</button>
      <button type="button" data-m="goal" class="${mode === 'goal' ? 'on' : ''}">תוך כמה זמן אגיע ליעד</button></div>` : ''}`;
  const fInfl = `<div><label for="fcInfl">אינפלציה שנתית</label><div class="unit"><input id="fcInfl" type="text" inputmode="decimal" value="${S.infl}"><span>%</span></div></div>`;
  const fReal = `<div><label>להציג</label><div class="seg" id="fcReal"><button type="button" data-r="1" class="${S.real ? 'on' : ''}">בשקלים של היום</button><button type="button" data-r="0" class="${S.real ? '' : 'on'}">בשקלים של אז</button></div></div>`;
  const fBirth = `<div><label for="fcBirth">שנת לידה ${mode === 'fire' ? '' : '<small class="muted">(לא חובה)</small>'}</label><input id="fcBirth" type="text" inputmode="numeric" maxlength="4" value="${isNum(S.birth) ? S.birth : ''}" placeholder="למשל 1988"></div>`;
  const fRet = `<div><label for="fcRet">גיל קבלת הפנסיה</label><input id="fcRet" type="text" inputmode="numeric" maxlength="2" value="${S.retAge}"></div>`;
  let fields = '';
  if (mode === 'years') fields = `<div><label for="fcYears">כמה שנים קדימה</label><select id="fcYears">${yOpts.map(v => `<option value="${v}" ${S.years === v ? 'selected' : ''}>${v} שנים</option>`).join('')}
      <option value="ret" ${S.years === 'ret' ? 'selected' : ''} ${isNum(age) ? '' : 'disabled'}>עד גיל ${S.retAge}${isNum(toRet) ? ` (${toRet} שנים)` : ' (צריך שנת לידה)'}</option></select></div>${fInfl}${fReal}${fBirth}${fRet}`;
  else if (mode === 'goal') fields = `<div><label for="fcGoal">היעד</label><div class="unit"><input id="fcGoal" type="text" inputmode="decimal" value="${cellText(S.goal)}"><span>₪</span></div></div>${fInfl}${fReal}${fBirth}${fRet}`;
  else {
    const stepOn = p => p === 0 ? !isNum(S.spend) : isNum(S.spend) && avgSpend > 0 && Math.round(avgSpend * (1 + p / 100)) === Math.round(S.spend);
    fields = `<div class="fc-spend"><label for="fcSpend">הוצאה חודשית בפרישה</label><div class="unit"><input id="fcSpend" type="text" inputmode="decimal" value="${S.spendNow > 0 ? NF0.format(Math.round(S.spendNow)) : ''}" placeholder="למשל 12,000"><span>₪</span></div>
      ${avgSpend > 0 ? `<div class="chips small" id="fcSpendSteps">${SPEND_STEPS.map(p => `<button type="button" class="chip${stepOn(p) ? ' on' : ''}" data-p="${p}">${p ? `+${p}%` : 'ממוצע'}</button>`).join('')}</div>
      <small class="muted">ממוצע ההוצאות ב-12 החודשים האחרונים: ${money(avgSpend)}${isNum(S.spend) ? '' : ' (ברירת המחדל)'}</small>` : '<small class="muted">אין עדיין הוצאות בדו״ח, אז צריך להזין סכום.</small>'}</div>
    <div><label for="fcSwr">כלל משיכה</label><select id="fcSwr">${[3, 3.5, 4, 4.5, 5].map(v => `<option value="${v}" ${S.swr === v ? 'selected' : ''}>חוק ה-${PF1.format(v)}%</option>`).join('')}</select></div>
    <div><label for="fcLast">הכסף צריך להחזיק עד גיל</label><input id="fcLast" type="text" inputmode="numeric" maxlength="3" value="${S.lastAge}"></div>
    ${fBirth}${fRet}${fInfl}
    <div><label>נדל״ן</label><div class="seg" id="fcSellRE"><button type="button" data-v="0" class="${S.sellRE ? '' : 'on'}">בלי למכור נדל״ן</button><button type="button" data-v="1" class="${S.sellRE ? 'on' : ''}">מוכרים נדל״ן להשקעה</button></div>
      <small class="muted">דירת המגורים לא נמכרת אף פעם.</small></div>
    <div><label>סכומים</label><div class="seg" id="fcFireNom"><button type="button" data-v="0" class="${S.fireNominal ? '' : 'on'}">במחירי היום</button><button type="button" data-v="1" class="${S.fireNominal ? 'on' : ''}">במחירי העתיד</button></div>
      <small class="muted">החישוב תמיד במחירי היום. ״במחירי העתיד״ רק מוסיף אינפלציה לכל סכום לפי השנה שלו.</small></div>`;
  }

  let body = '';
  // ---------- mode 1a: value in N years ----------
  if (mode === 'years') {
    const years = H;
    const tot = (s, y, filter = () => true) => sum(rows.filter(filter).map(x => yv(x, y, s))) / defl(y);
    const endA = tot(sc, years), endB = tot('none', years), annA = tot(sc, years, x => isAnnuity(x.a));
    const depNow = sum(rows.filter(x => depOn(x.a, sc)).map(x => x.dep));
    const nextMil = Math.floor(today / 1e6) + 1;
    const milY = Array.from({ length: years + 1 }, (_, y) => y).find(y => tot(sc, y) >= nextMil * 1e6);
    const pensionRows = rows.filter(x => isAnnuity(x.a));
    const pensionAtRet = isNum(toRet) && toRet <= years ? sum(pensionRows.map(x => yv(x, toRet, sc))) / defl(toRet) : null;
    const reRows = rows.filter(x => x.a.type === 'realestate');
    const reAt = rate => sum(reRows.map(x => projectAccount(x.a, x.start, x.dep, years, S.infl, depOn(x.a, sc), rate).yearly[years])) / defl(years);
    const reSet = sum(reRows.map(x => yv(x, years, sc))) / defl(years);
    const reRates = [...new Set(reRows.map(x => accReturn(x.a)))];
    body = `
      <div class="kpis">
        <div class="kpi an"><div class="k-l">היום</div><div class="k-v">${moneyHtml(today)}</div><div class="k-s">${rows.length} חשבונות</div></div>
        <div class="kpi fa"><div class="k-l">בעוד ${years} שנים · ${SCEN[sc]}</div><div class="k-v">${moneyHtml(endA)}</div><div class="k-s">${annA ? `מזה בפנסיה ובגמל לקצבה ${money(annA)}, נזיל רק מגיל ${S.retAge}` : `הפקדה של ${money(depNow)} לחודש, שעולה עם האינפלציה`}</div></div>
        <div class="kpi fb"><div class="k-l">בעוד ${years} שנים, בלי הפקדות בכלל</div><div class="k-v">${moneyHtml(endB)}</div><div class="k-s">רק התשואה על מה שיש היום</div></div>
        <div class="kpi an"><div class="k-l">מה ההפקדות מוסיפות</div><div class="k-v">${moneyHtml(endA - endB)}</div><div class="k-s">הפקדה של ${money(depNow)} לחודש</div></div>
      </div>
      <p class="muted fc-note">${real ? `הסכומים <b>בשקלים של היום</b> (אחרי ניכוי אינפלציה של ${PF1.format(S.infl)}% בשנה).` : `הסכומים <b>בשקלים של אז</b> (נומינלי).`}
        ${isNum(milY) && milY > 0 ? ` אם ממשיכים להפקיד, השווי יעבור את <b>${money(nextMil * 1e6)}</b> בשנת <b>${nowY + milY}</b>.` : ''}</p>
      ${reRows.length ? `<section class="card re2"><h3>🏠 שתי הערכות לנדל״ן <small class="muted">בעוד ${years} שנים${real ? ', בשקלים של היום' : ''}</small></h3>
        <div class="re2-grid">${[[`לפי 20 השנים האחרונות (${PF1.format(RE_20Y)}% בשנה)`, reAt(RE_20Y)], [`לפי הטווח הארוך, מ-1960 (${PF1.format(RE_LONG)}% בשנה)`, reAt(RE_LONG)],
          [`מה שמוגדר עכשיו${reRates.length === 1 && isNum(reRates[0]) ? ` (${pct(reRates[0])})` : ''}`, reSet]].map(([l, v]) =>
          `<div><span>${l}</span><b class="n">${money(v)}</b><small>סה״כ כל החשבונות: ${money(endA - reSet + v)}</small></div>`).join('')}</div>
        <p class="hint">היום הנדל״ן שווה ${money(sum(reRows.map(x => x.start)))}. <b>20 שנה:</b> בין 2006 ל-2026 מחירי הדירות עלו בממוצע 6.0% בשנה, 4.1% מעל האינפלציה (סדרת מחירי הדיור של BIS לישראל, לפי מדד הלמ״ס). <b>טווח ארוך:</b> מאז 1960 המחיר הריאלי עלה בכ-2.9% בשנה (בנק ישראל, יכין וגמרסני 2021). לשיעור הריאלי נוספה אינפלציה צפויה של 2.5%. בטווח של 10 שנים העלייה הייתה 4.3% בשנה (2.3% ריאלי).</p></section>` : ''}
      <section class="card"><h3>השווי הכולל לאורך השנים <small class="muted">כל תרחישי ההפקדה</small></h3><div id="fcLine" class="ch"></div><div id="fcLineX"></div></section>
      <section class="card"><h3>ממה זה מורכב <small class="muted">${SCEN[sc]}, לפי סוג</small></h3><div id="fcStack" class="ch"></div><div id="fcStackX"></div></section>
      ${isNum(pensionAtRet) && pensionRows.length ? `<section class="card"><h3>קצבה משוערת בגיל ${S.retAge}</h3>
        <p>הצבירה בפנסיה ובגמל לקצבה בשנת ${nowY + toRet} צפויה להיות כ-<b class="n">${money(pensionAtRet)}</b>${real ? ' (בשקלים של היום)' : ''}. במקדם המרה של ${S.coef}, זו קצבה של כ-<b class="n">${money(pensionAtRet / S.coef)}</b> לחודש, לפני מס.</p>
        <p class="hint">המקדם בפועל נקבע בפרישה, ותלוי בגיל, במין, בשאירים ובקרן (בערך 180–215; לנשים ובפרישה מוקדמת הוא גבוה יותר, ולכן הקצבה נמוכה יותר).</p></section>` : ''}`;
    el._draw = () => {
      const labels = Array.from({ length: years + 1 }, (_, y) => String(nowY + y));
      const titles = labels.map((l, y) => y === 0 ? `היום (${l})` : `${l} · בעוד ${y} ${y === 1 ? 'שנה' : 'שנים'}${ageTxt(y)}`);
      // every deposit scenario as its own line; the two partial ones only when both kinds of deposits exist
      const scens = depPay > 0 && depOwn > 0 ? ['all', 'payroll', 'personal', 'none'] : ['all', 'none'];
      const series = scens.map((s, j) => ({ name: SCEN[s], color: `var(--s${j + 1})`, values: labels.map((_, y) => tot(s, y)) }));
      lineChart($('#fcLine'), { labels, titles, series });
      $('#fcLineX').innerHTML = legendHtml(series, 'line') + tableHtml(['שנה', ...series.map(s => s.name)], labels.map((l, y) => [titles[y], ...series.map(s => s.values[y])]));
      const types = INV_ORDER.filter(t => rows.some(x => x.a.type === t));
      const stackS = types.map(t => ({ name: INV_TYPES[t].name, color: INV_TYPES[t].color, values: labels.map((_, y) => tot(sc, y, x => x.a.type === t)) }));
      columnChart($('#fcStack'), { cats: labels, labels, titles, series: stackS, stacked: true });
      $('#fcStackX').innerHTML = legendHtml(stackS) + tableHtml(['שנה', ...stackS.map(s => s.name)], labels.map((l, y) => [titles[y], ...stackS.map(s => s.values[y])]));
    };
  }

  // ---------- mode 1b: years until a goal ----------
  if (mode === 'goal') {
    const G = S.goal;
    const totAll = y => sum(rows.map(x => yv(x, y, sc))) / defl(y);
    const locked = (x, y) => isAnnuity(x.a) && (!isNum(age) || age + y < S.retAge);
    const totAvail = y => sum(rows.filter(x => !locked(x, y)).map(x => yv(x, y, sc))) / defl(y);
    const first = f => { for (let y = 0; y <= H; y++) if (f(y) >= G) return y; return null; };
    const yAll = first(totAll), yAvail = first(totAvail), hasAnn = rows.some(x => isAnnuity(x.a));
    const when = y => y === null ? `<div class="k-v">לא בתוך ${H} שנה</div><div class="k-s">גם בהפקדות של היום</div>`
      : y === 0 ? `<div class="k-v">כבר עכשיו</div><div class="k-s">השווי היום כבר מעל היעד</div>`
      : `<div class="k-v">בעוד ${y} ${y === 1 ? 'שנה' : 'שנים'}</div><div class="k-s">בשנת ${nowY + y}${isNum(age) ? `, בגיל ${age + y}` : ''}</div>`;
    body = `
      <div class="kpis">
        <div class="kpi an"><div class="k-l">היעד</div><div class="k-v">${moneyHtml(G)}</div><div class="k-s">${real ? 'בשקלים של היום' : 'בשקלים של אז'}</div></div>
        <div class="kpi fa"><div class="k-l">${hasAnn ? 'כולל הפנסיה וגמל לקצבה' : 'מגיעים ליעד'}</div>${when(yAll)}</div>
        ${hasAnn ? `<div class="kpi fb"><div class="k-l">בלי כספי הפנסיה${isNum(age) ? ` (עד גיל ${S.retAge})` : ''}</div>${when(yAvail)}</div>` : ''}
        <div class="kpi an"><div class="k-l">היום</div><div class="k-v">${moneyHtml(today)}</div><div class="k-s">${G > today ? `חסרים ${money(G - today)}` : 'מעל היעד'}</div></div>
      </div>
      <p class="muted fc-note">${hasAnn ? (isNum(age) ? `כספי פנסיה וגמל לקצבה לא נזילים עד גיל ${S.retAge}, ולכן בחישוב ״בלי כספי הפנסיה״ הם נספרים רק מהגיל הזה.` : 'כדי לדעת מתי כספי הפנסיה משתחררים, צריך להזין שנת לידה. בינתיים ״בלי כספי הפנסיה״ לא סופר אותם בכלל.') : ''}
        ההפקדות: ${SCEN[sc]}${sc === 'none' ? '' : ' (לפי ממוצע 12 החודשים האחרונים)'}.</p>
      <section class="card"><h3>הדרך ליעד</h3><div id="fcGoalCh" class="ch"></div><div id="fcGoalX"></div></section>`;
    el._draw = () => {
      const last = Math.min(H, Math.max(10, (yAll ?? 30) + 3, (yAvail ?? 0) + 3));
      const labels = Array.from({ length: last + 1 }, (_, y) => String(nowY + y));
      const titles = labels.map((l, y) => y === 0 ? `היום (${l})` : `${l} · בעוד ${y} שנים${ageTxt(y)}`);
      const series = [{ name: hasAnn ? 'כולל הפנסיה' : 'השווי הכולל', color: 'var(--s1)', values: labels.map((_, y) => totAll(y)) }];
      if (hasAnn) series.push({ name: 'בלי כספי הפנסיה עד גיל הפרישה', color: 'var(--s2)', values: labels.map((_, y) => totAvail(y)) });
      const vl = isNum(age) && toRet <= last ? [{ i: toRet, label: `גיל ${S.retAge}` }] : [];
      lineChart($('#fcGoalCh'), { labels, titles, series, ref: { value: G, label: 'היעד' }, vlines: vl });
      $('#fcGoalX').innerHTML = legendHtml(series, 'line') + tableHtml(['שנה', ...series.map(s => s.name)], labels.map((l, y) => [titles[y], ...series.map(s => s.values[y])]));
    };
  }

  // ---------- mode 2: when can I stop working ----------
  if (mode === 'fire') {
    if (!isNum(age)) body = `<div class="card empty">כדי לחשב מתי אפשר לפרוש צריך להזין שנת לידה (למעלה).</div>`;
    else if (!(S.spendNow > 0)) body = `<div class="card empty">צריך הוצאה חודשית בפרישה: מזינים אותה למעלה, או ממלאים את דו״ח ההוצאות.</div>`;
    else {
      const P = S.retAge;
      const kMax = Math.min(H - 1, Math.max(0, P - age) + 13);
      let best = null;
      for (let k = 0; k <= kMax; k++) { const p = firePlan(rows, S, age, H, k); if (p.ok) { best = p; break; } }
      const fireNum = 12 * S.spendNow / (S.swr / 100);
      // The plan is computed in today's prices. "Prices at the time" only adds inflation to each amount for its own year.
      const fy = y => S.fireNominal ? Math.pow(1 + S.infl / 100, y) : 1, kP = P - age;
      const priceTxt = y => S.fireNominal ? `בשקלים של שנת ${nowY + y}` : 'בשקלים של היום';
      const hasAnn = rows.some(x => isAnnuity(x.a));
      const show = best || firePlan(rows, S, age, H, kMax);
      const bridgeYears = Math.max(0, P - show.age);
      const sumLine = best ? `
          <p class="fire-story">אפשר להפסיק לעבוד בגיל <b>${best.age}</b> (שנת ${nowY + best.k})${best.k === 0 ? ', כלומר כבר עכשיו' : ''}.
          ${bridgeYears ? `מגיל ${best.age} עד ${P} (${bridgeYears} שנים) חיים מהחסכונות הנזילים: <b class="n">${money(best.Lret * fy(best.k))}</b> ביום הפרישה.` : ''}
          ${hasAnn ? `מגיל ${P} הקצבה המשוערת היא <b class="n">${money(best.annuity * fy(kP))}</b> לחודש` : `אין כספי פנסיה בחישוב`}${best.needAfter > 0 ? `, ואת ${money(best.needAfter / 12 * fy(kP))} החסרים לחודש מושכים מהחסכונות: בגיל ${P} נשארים בהם <b class="n">${money(best.LatP * fy(kP))}</b>, ו-${PF1.format(S.swr)}% מהם בשנה הם ${money(best.LatP * S.swr / 100 / 12 * fy(kP))} לחודש.` : ', והיא מכסה את כל ההוצאה.'}</p>
          <p class="muted">${S.fireNominal ? `הסכומים בשקלים של השנה שבה הם קורים, כלומר כולל אינפלציה של ${PF1.format(S.infl)}% בשנה. ההחלטה עצמה זהה, כי החישוב נעשה במחירי היום.` :'כל הסכומים <b>במחירי היום</b>: ההוצאה, היתרות והקצבה מנוכים מאינפלציה, כך שאפשר להשוות אותם ישירות למה שאתה מוציא היום.'}</p>
          <p class="muted">לפי ההנחות, הכסף מחזיק לפחות עד גיל ${S.lastAge}, ${S.lastAge - best.age} שנים אחרי הפרישה.</p>`
        : `<p class="warn-line">⚠️ לפי ההנחות, גם בגיל ${show.age} עוד אי אפשר לפרוש עם הוצאה של ${money(S.spendNow)} לחודש, בחוק ה-${PF1.format(S.swr)}% ועם כסף שמחזיק עד גיל ${S.lastAge}. אפשר להוריד את ההוצאה, להגדיל הפקדות, לבחור כלל משיכה אחר או גיל יעד נמוך יותר.</p>`;
      // candidate ages table
      const ages = [...new Set([best ? best.age - 3 : null, best ? best.age - 1 : null, best?.age, 50, 55, 60, 62, 65, P].filter(v => isNum(v) && v >= age && v <= age + kMax))].sort((a, b) => a - b);
      const cand = ages.map(a => firePlan(rows, S, age, H, a - age));
      body = `
        <div class="kpis">
          <div class="kpi fa"><div class="k-l">אפשר להפסיק לעבוד</div><div class="k-v">${best ? `בגיל ${best.age}` : '—'}</div><div class="k-s">${best ? `שנת ${nowY + best.k}, בעוד ${best.k} שנים` : `לא עד גיל ${show.age}`}</div></div>
          <div class="kpi an"><div class="k-l">הוצאה חודשית בפרישה</div><div class="k-v">${moneyHtml(S.spendNow * fy(show.k))}</div><div class="k-s">${priceTxt(show.k)}</div></div>
          <div class="kpi an"><div class="k-l">היעד לפי חוק ה-${PF1.format(S.swr)}% (בלי פנסיה)</div><div class="k-v">${moneyHtml(fireNum * fy(show.k))}</div><div class="k-s">${PF1.format(100 / S.swr)} שנות הוצאה · ${priceTxt(show.k)}</div></div>
          <div class="kpi fb"><div class="k-l">קצבה משוערת מגיל ${P}</div><div class="k-v">${hasAnn ? moneyHtml(show.annuity * fy(kP)) : '—'}</div><div class="k-s">${hasAnn ? `מקדם ${S.coef}, לפני מס · ${priceTxt(kP)}` : 'אין פנסיה בחישוב'}</div></div>
        </div>
        <section class="card">${sumLine}
          ${rows.some(x => x.a.type === 'realestate') ? `<p class="hint">🏠 ${S.sellRE
            ? `דירת המגורים לא נמכרת ולא נספרת. נדל״ן להשקעה${rows.some(x => x.a.type === 'realestate' && !isHome(x.a)) ? '' : ' (אין כרגע)'} נספר ככסף שאפשר לחיות ממנו, כאילו מוכרים אותו.`
            : 'בלי למכור נדל״ן: הדירות לא נספרות ככסף לחיות ממנו. אם יש שכר דירה מנכס להשקעה, הוא ימשיך להיכנס, ואפשר להוריד אותו מההוצאה החודשית.'} את סוג הנכס (דירה למגורים או להשקעה) משנים בעריכת החשבון.</p>` : ''}</section>
        <section class="card"><h3>החסכונות לאורך החיים <small class="muted">${S.fireNominal ? 'בשקלים של כל שנה' : 'בשקלים של היום'}</small></h3><div id="fcFire" class="ch"></div><div id="fcFireX"></div></section>
        <section class="card"><h3>מה אם פורשים בגיל אחר</h3><div class="tablewrap"><table class="stat"><thead><tr><th>גיל פרישה</th><th class="n">נזיל ביום הפרישה</th><th>מחזיק עד גיל ${P}?</th><th class="n">נשאר בגיל ${P}</th><th>חוק ה-${PF1.format(S.swr)}%</th><th>מחזיק עד גיל ${S.lastAge}?</th></tr></thead><tbody>
          ${cand.map(c => `<tr${best && c.age === best.age ? ' class="hl"' : ''}><td>${c.age}</td><td class="n">${moneyHtml(c.Lret * fy(c.k))}</td><td>${c.age >= P ? '—' : c.bridgeOk ? '✓ כן' : '✗ לא'}</td>
            <td class="n">${c.bridgeOk ? moneyHtml(c.LatP * fy(kP)) : '—'}</td><td>${c.ruleOk ? '✓ מתקיים' : '✗ לא מתקיים'}</td><td>${c.lasts ? '✓ כן' : `✗ נגמר בגיל ${c.runOut}`}</td></tr>`).join('')}
          </tbody></table></div></section>
        ${itemsTable()}`;
      // Every item (the home included) today, at retirement, at the pension age and at the last age.
      function itemsTable() {
        const cols = [{ y: 0, t: `היום (גיל ${age})` }, { y: show.k, t: `בפרישה (גיל ${show.age})` }];
        if (kP > show.k && kP < H) cols.push({ y: kP, t: `בגיל הקצבה (${P})`, pension: true });
        cols.push({ y: H, t: `בגיל ${S.lastAge}` });
        const uniq = cols.filter((c, i) => cols.findIndex(d => d.y === c.y) === i);
        const role = x => isAnnuity(x.a) ? 'קצבה' : isHome(x.a) ? 'דירת מגורים' : x.a.type === 'realestate' && !S.sellRE ? 'לא נמכר' : 'נזיל';
        const cell = (x, c) => {
          const ia = show.ann.indexOf(x);
          if (ia >= 0 && show.penAtP && (c.pension || (c.y >= show.k && age + c.y >= P))) {
            const bal = show.penAtP[ia] * fy(kP), ann = bal / S.coef;
            return c.pension ? `${moneyHtml(bal)}<small class="muted d">← קצבה ${money(ann)} לחודש</small>` : `<span class="muted">קצבה ${money(ann)} לחודש</span>`;
          }
          const v = planValue(show, x, c.y, S);
          return isNum(v) ? moneyHtml(Math.max(0, v) * fy(c.y)) : '—';
        };
        const total = (c, f = () => true) => sum(rows.filter(f).map(x => {
          if (show.ann.includes(x) && age + c.y >= P && !c.pension) return 0;
          if (show.ann.includes(x) && c.pension && show.penAtP) return show.penAtP[show.ann.indexOf(x)];
          return Math.max(0, planValue(show, x, c.y, S) || 0);
        })) * fy(c.y);
        return `<section class="card"><h3>כמה שווה כל פריט <small class="muted">${S.fireNominal ? 'בשקלים של כל שנה' : 'במחירי היום'}, אם פורשים בגיל ${show.age}</small></h3>
          <div class="tablewrap"><table class="stat items"><thead><tr><th>פריט</th>${uniq.map(c => `<th class="n">${c.t}</th>`).join('')}</tr></thead><tbody>
          ${rows.map(x => `<tr><td>${typeDot(x.a.type)}${esc(x.a.name)} <small class="muted">${role(x)}</small></td>${uniq.map(c => `<td class="n">${cell(x, c)}</td>`).join('')}</tr>`).join('')}
          </tbody><tfoot>
            <tr><td>סה״כ</td>${uniq.map(c => `<td class="n">${moneyHtml(total(c))}</td>`).join('')}</tr>
            <tr class="sub"><td>מזה זמין למחיה</td>${uniq.map(c => `<td class="n">${moneyHtml(total(c, x => show.liq.includes(x)))}</td>`).join('')}</tr>
          </tfoot></table></div>
          <p class="hint">״נזיל״ = הכסף שממנו חיים אחרי הפרישה; ההוצאה יורדת מכל חשבון לפי גודלו. ״דירת מגורים״ ו״לא נמכר״ ממשיכים לעלות בערך ולא נוגעים בהם. כספי ״קצבה״ הופכים בגיל ${P} לקצבה חודשית, ולכן אחרי הגיל הזה הם לא נספרים בסה״כ.</p></section>`;
      }
      el._draw = () => {
        const labels = [], titles = [], liqV = [], penV = [];
        for (let y = 0; y <= H; y++) {
          labels.push(String(age + y)); titles.push(`גיל ${age + y} · שנת ${nowY + y}`);
          if (y < show.k) {
            liqV.push(sum(rows.filter(x => livesOn(x.a, S)).map(x => yv(x, y, sc))) / defl(y) * fy(y));
            penV.push(sum(rows.filter(x => isAnnuity(x.a)).map(x => yv(x, y, sc))) / defl(y) * fy(y));
          } else {
            const p = show.path[y - show.k];
            liqV.push(p.L * fy(y)); penV.push(age + y >= P ? null : p.pen * fy(y));
          }
        }
        const series = [{ name: 'חסכונות נזילים', color: 'var(--s1)', values: liqV }];
        if (hasAnn) series.push({ name: 'פנסיה וגמל לקצבה (עד הקצבה)', color: 'var(--s3)', values: penV });
        const vl = [{ i: show.k, label: `פרישה ${show.age}` }]; if (P - age !== show.k && P - age <= H) vl.push({ i: P - age, label: `קצבה ${P}` });
        lineChart($('#fcFire'), { labels, titles, series, vlines: vl });
        $('#fcFireX').innerHTML = legendHtml(series, 'line') + tableHtml(['גיל', ...series.map(s => s.name)], labels.map((l, i) => [titles[i], ...series.map(s => s.values[i])]));
      };
    }
  }

  const tableYears = mode === 'years' ? H : null;
  el.innerHTML = `
    <div class="pagehead"><h2>🔮 תחזית</h2>${modeSeg}</div>
    <div class="card fc-set">${fields}${depScenSeg}</div>
    ${inclFilterHtml('fcIncl')}
    ${excluded.length ? `<p class="muted fc-note">לא נכללים: ${excluded.join(', ')}.</p>` : ''}
    ${missingBal.length || missingRet.length ? `<div class="notice">${missingBal.length ? `⚠️ אין יתרה ל: ${missingBal.map(x => esc(x.a.name)).join(', ')}. החישוב שלהם מתחיל מ-0. <a href="#invest">לעדכון יתרות ←</a><br>` : ''}${missingRet.length ? `⚠️ אין תשואה משוערת ל: ${missingRet.map(x => esc(x.a.name)).join(', ')}. חושב להם 0%.` : ''}</div>` : ''}
    ${body}
    <section class="card"><h3>החשבונות בחישוב <small class="muted">אפשר לשנות כאן את ההפקדה החודשית ואת התשואה</small></h3>
      <div class="tablewrap"><table class="stat fc-table"><thead><tr><th>חשבון</th><th class="n">היום</th><th>הפקדה לחודש</th><th>תשואה שנתית</th>${tableYears ? `<th class="n">בעוד ${tableYears} שנים</th><th class="n">בלי הפקדות</th>` : ''}</tr></thead><tbody>
      ${rows.map(x => `<tr><td>${typeDot(x.a.type)}${esc(x.a.name)}${isAnnuity(x.a) ? ' <small class="muted">קצבה</small>' : ''}</td>
        <td class="n">${x.hasBal ? moneyHtml(x.start) : '<span class="muted">אין יתרה</span>'}</td>
        <td><div class="unit"><input type="text" inputmode="decimal" data-dep="${x.a.id}" value="${isNum(S.dep[x.a.id]) ? S.dep[x.a.id] : Math.round(x.avgD)}"><span>₪</span></div>
          <small class="muted">${isNum(S.dep[x.a.id]) ? `שונה ידנית · ממוצע: ${money(x.avgD)}` : 'ממוצע 12 החודשים'}</small></td>
        <td><div class="unit"><input type="text" inputmode="decimal" data-ret="${x.a.id}" value="${isNum(x.ret) ? x.ret : ''}" placeholder="—"><span>%</span></div></td>
        ${tableYears ? `<td class="n">${moneyHtml(yv(x, tableYears, sc) / defl(tableYears))}</td><td class="n">${moneyHtml(x.B.yearly[tableYears] / defl(tableYears))}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>
      ${Object.keys(S.dep).length ? '<button type="button" class="btn ghost small" id="fcReset">החזרת ההפקדות לממוצע</button>' : ''}
    </section>
    <details class="tips fc-assume"><summary>ההנחות של התחזית</summary><ul>
      <li>הבסיס הוא היתרה האחרונה שהוזנה לכל חשבון, והתשואה המשוערת שלו (לפני אינפלציה, אחרי דמי ניהול מהצבירה).</li>
      <li>ההפקדה החודשית היא כברירת מחדל הממוצע של 12 החודשים האחרונים, והיא עולה כל שנה בגובה האינפלציה. דמי ניהול מהפקדה, אם הוזנו, יורדים ממנה.</li>
      <li>התשואה בפועל משתנה משנה לשנה. כאן היא קבועה, ולכן התוצאה היא קו ממוצע.</li>
      <li>במצב 2: מהפרישה כבר אין הפקדות. ההוצאה קבועה בשקלים של היום. כספי פנסיה וגמל לקצבה הופכים לקצבה בגיל קבלת הפנסיה (צבירה ÷ ${S.coef}). נדל״ן לא נמכר כברירת מחדל. אפשר לבחור ״מוכרים נדל״ן להשקעה״, ואז הוא נספר ככסף לחיות ממנו. דירת המגורים לא נספרת אף פעם.</li>
      <li>לא מחושב מס (רווח הון, מס על קצבה). זו הערכה לתכנון, לא ייעוץ השקעות.</li></ul></details>`;
  if (el._draw) { el._draw(); el._draw = null; }

  // ---------- events ----------
  $('#fcMode').onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; const m = b.dataset.m; if (m === 'fire' ? mode !== 'fire' : mode === 'fire') saveFc({ mode: m === 'fire' ? 'fire' : 'years' }); };
  if ($('#fcSub')) $('#fcSub').onclick = e => { const b = e.target.closest('[data-m]'); if (b && b.dataset.m !== mode) saveFc({ mode: b.dataset.m }); };
  bindInclFilter('fcIncl', renderForecast);
  $('#fcScen').onclick = e => { const b = e.target.closest('[data-s]'); if (b && b.dataset.s !== sc) saveFc({ depScen: b.dataset.s }); };
  const num = (id, f) => { const i = $(id); if (i) i.onchange = () => f(i.value.trim(), parseNum(i.value)); };
  if ($('#fcYears')) $('#fcYears').onchange = e => saveFc({ years: e.target.value === 'ret' ? 'ret' : +e.target.value });
  num('#fcInfl', (s, v) => { if (isNum(v) && v >= 0 && v < 30) saveFc({ infl: v }); else { toast('אינפלציה לא תקינה'); renderForecast(); } });
  num('#fcGoal', (s, v) => { if (isNum(v) && v > 0) saveFc({ goal: v }); else { toast('יעד לא תקין'); renderForecast(); } });
  num('#fcSpend', (s, v) => { if (s === '') saveFc({ spend: null }); else if (isNum(v) && v > 0) saveFc({ spend: v }); else { toast('הוצאה לא תקינה'); renderForecast(); } });
  if ($('#fcSwr')) $('#fcSwr').onchange = e => saveFc({ swr: +e.target.value });
  if ($('#fcFireNom')) $('#fcFireNom').onclick = e => { const b = e.target.closest('[data-v]'); if (b && (b.dataset.v === '1') !== S.fireNominal) saveFc({ fireNominal: b.dataset.v === '1' }); };
  if ($('#fcSellRE')) $('#fcSellRE').onclick = e => { const b = e.target.closest('[data-v]'); if (b && (b.dataset.v === '1') !== S.sellRE) saveFc({ sellRE: b.dataset.v === '1' }); };
  if ($('#fcSpendSteps')) $('#fcSpendSteps').onclick = e => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    const p = +b.dataset.p; saveFc({ spend: p === 0 ? null : Math.round(avgSpend * (1 + p / 100)) });
  };
  num('#fcLast', s => { const n = +s; if (n >= (isNum(age) ? age + 2 : 60) && n <= 120) saveFc({ lastAge: n }); else { toast('גיל לא תקין'); renderForecast(); } });
  if ($('#fcReal')) $('#fcReal').onclick = e => { const b = e.target.closest('[data-r]'); if (b) saveFc({ real: b.dataset.r === '1' }); };
  num('#fcBirth', s => { const n = +s; if (!s) saveFc({ birth: null, years: S.years === 'ret' ? 20 : S.years }); else if (n > 1920 && n <= nowY) saveFc({ birth: n }); else { toast('שנת לידה לא תקינה'); renderForecast(); } });
  num('#fcRet', s => { const n = +s; if (n >= 50 && n <= 80) saveFc({ retAge: n }); else { toast('גיל לא תקין'); renderForecast(); } });
  el.querySelectorAll('[data-dep]').forEach(inp => inp.onchange = () => {
    const v = parseNum(inp.value), dep = Object.assign({}, S.dep);
    if (inp.value.trim() === '' || v === null) delete dep[inp.dataset.dep];
    else if (isNum(v) && v >= 0) dep[inp.dataset.dep] = v;
    else { toast('ערך לא תקין'); return; }
    saveFc({ dep });
  });
  el.querySelectorAll('[data-ret]').forEach(inp => inp.onchange = () => {
    const v = inp.value.trim() === '' ? null : parseNum(inp.value);
    if (Number.isNaN(v)) { toast('ערך לא תקין'); return; }
    change({ t: 'accSet', id: inp.dataset.ret, patch: { ret: v } }, { render: false }); renderForecast();
  });
  if ($('#fcReset')) $('#fcReset').onclick = () => saveFc({ dep: {} });
}
window.addEventListener('resize', () => { clearTimeout(renderForecast._t); renderForecast._t = setTimeout(() => { if (tab === 'forecast') renderForecast(); }, 200); });
