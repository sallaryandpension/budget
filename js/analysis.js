"use strict";
/* =====================================================================
   analysis.js: the analysis report. One period filter on top; every figure and
   chart below uses the same months.
   Colors: income = slot 3 (aqua), expenses = slot 2 (orange), investments = slot 1 (blue),
   gains/losses = the diverging pair (blue / red), investment types = their fixed slots.
   ===================================================================== */

const C = { inc: 'var(--c-inc)', exp: 'var(--c-exp)', inv: 'var(--c-inv)', pos: 'var(--c-pos)', neg: 'var(--c-neg)', other: 'var(--c-other)', left: 'var(--c-left)' };

function monthTotal(r, m) { const row = data[r].vals[m]; return row && Object.keys(row).length ? sum(Object.values(row)) : null; }
function monthDeposits(m, source) {
  if (!invDepMonth(m)) return null;
  let s = 0;
  for (const a of data.invest.accs) { if (source && (a.source === 'bank' ? 'bank' : 'payroll') !== source) continue; const v = invCell(m, a.id)?.d; if (isNum(v)) s += v; }
  return s;
}
/* Total balance of each investment type at the end of month m (last known balance carried forward). */
function typeBalances(m) {
  const out = {};
  for (const a of data.invest.accs) { if (!isIncluded(a)) continue; const b = lastBal(a.id, m); if (b) out[a.type] = (out[a.type] || 0) + b.v; }
  return out;
}

let anResizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(anResizeTimer); anResizeTimer = setTimeout(() => { if (tab === 'analysis') renderAnalysis(); }, 200); });

function renderAnalysis() {
  const el = $('#view-analysis');
  if (isEmptyData(data)) {
    el.innerHTML = `<div class="pagehead"><h2>📊 ניתוח</h2></div><div class="card empty">אין עדיין נתונים לניתוח. מתחילים בדו״חות <a href="#expenses">ההוצאות</a>, <a href="#income">ההכנסות</a> ו<a href="#invest">ההשקעות</a>, או ב<a href="#settings">ייבוא מאקסל</a>.</div>`;
    return;
  }
  const opts = periodOptions();
  if (!opts.some(o => o[0] === ui.anPeriod)) ui.anPeriod = '12';
  const ms = periodMonths(ui.anPeriod, !!ui.anSkipCur);
  const multiYear = new Set(ms.map(m => m.slice(0, 4))).size > 1;
  const labels = ms.map(m => monthShort(m, multiYear)), titles = ms.map(monthName);

  // ---- numbers per month ----
  const I = ms.map(m => monthTotal('income', m)), E = ms.map(m => monthTotal('expenses', m));
  const DB = ms.map(m => monthDeposits(m, 'bank')), DP = ms.map(m => monthDeposits(m, 'payroll'));
  const N = ms.map((m, i) => isNum(I[i]) && isNum(E[i]) ? I[i] - E[i] : null);
  const avg = arr => { const v = arr.filter(isNum); return v.length ? sum(v) / v.length : null; };
  const both = ms.map((m, i) => isNum(I[i]) && isNum(E[i]));
  const sIb = sum(I.filter((v, i) => both[i])), sEb = sum(E.filter((v, i) => both[i]));
  const saveRate = sIb > 0 ? (sIb - sEb) / sIb * 100 : null;
  const avgI = avg(I), avgE = avg(E), avgDB = avg(DB) ?? 0, avgDP = avg(DP) ?? 0;
  const left = isNum(avgI) && isNum(avgE) ? avgI - avgE - avgDB : null;
  const last = ms[ms.length - 1], before = ms.length ? shiftMonth(ms[0], -1) : null;
  const nwEnd = last ? sum(Object.values(typeBalances(last))) : 0;
  const nwStartObj = before ? typeBalances(before) : {}, hasStart = Object.keys(nwStartObj).length > 0;
  const nwStart = sum(Object.values(nwStartObj));
  const gains = sortedAccs().filter(a => tracksGain(a) && isIncluded(a)).map(a => ({ a, g: periodGain(a.id, ms) })).filter(x => x.g);
  const gainSum = sum(gains.map(x => x.g.gain));
  const range = ms.length ? `${monthName(ms[0])} – ${monthName(last)}` : '';

  const tile = (label, value, sub) => `<div class="kpi an"><div class="k-l">${label}</div><div class="k-v">${value}</div><div class="k-s">${sub}</div></div>`;
  el.innerHTML = `
    <div class="pagehead"><h2>📊 ניתוח</h2>
      <div class="tools"><select id="anPeriod" aria-label="תקופה">${opts.map(([v, t]) => `<option value="${v}" ${v === ui.anPeriod ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="anSkip" ${ui.anSkipCur ? 'checked' : ''}> בלי החודש הנוכחי</label></div></div>
    <p class="muted range">${range}</p>
    ${inclFilterHtml('anIncl')}
    <div class="kpis">
      ${tile('שיעור חיסכון ממוצע', isNum(saveRate) ? `<span class="n">${PF1.format(saveRate)}%</span>` : '—', 'מההכנסה נשאר אחרי ההוצאות')}
      ${tile('נשאר בחשבון בחודש ממוצע', isNum(left) ? moneyHtml(left) : '—', 'הכנסות פחות הוצאות ופחות השקעות מהבנק')}
      ${tile('שווי הנכסים', nwEnd ? moneyHtml(nwEnd) : '—', nwEnd && hasStart ? `${nwEnd - nwStart >= 0 ? 'עלייה' : 'ירידה'} של ${money(Math.abs(nwEnd - nwStart))} בתקופה` : 'לפי היתרות האחרונות שהוזנו')}
      ${tile('רווח מהשקעות בתקופה', gains.length ? moneyHtml(gainSum) : '—', gains.length ? 'שינוי בשווי פחות ההפקדות' : 'צריך לפחות שתי יתרות לחשבון')}
    </div>

    <section class="card"><h3>הכנסות מול הוצאות בכל חודש</h3><div id="chFlow" class="ch"></div><div id="chFlowX"></div></section>
    <section class="card"><h3>כמה נשאר בכל חודש <small class="muted">הכנסות פחות הוצאות</small></h3><div id="chNet" class="ch"></div><div id="chNetX"></div></section>
    <section class="card"><h3>לאן הולכת ההכנסה בחודש ממוצע</h3><div id="chWhere"></div>
      <p class="hint">${avgDP ? `בנוסף הופקדו בממוצע ${money(avgDP)} לחודש לחיסכון ישירות מהמשכורת (פנסיה, השתלמות וכו׳), עוד לפני שהמשכורת הגיעה לחשבון.` : 'הפקדות שיורדות ישירות מהמשכורת לא נכללות כאן, כי הן לא חלק מהנטו.'}</p></section>
    <div class="cols2">
      <section class="card"><h3>הוצאות לפי קטגוריה <small class="muted">ממוצע לחודש</small></h3><div id="chCats"></div></section>
      <section class="card"><h3>רווח או הפסד לפי חשבון <small class="muted">בתקופה</small></h3><div id="chGains"></div></section>
    </div>
    <section class="card"><h3>מגמת ההוצאות <small class="muted">5 הקטגוריות הגדולות וכל השאר</small></h3><div id="chTrend" class="ch"></div><div id="chTrendX"></div></section>
    <section class="card"><h3>שווי החסכונות וההשקעות לאורך זמן <small class="muted">לפי סוג, בסוף כל חודש</small></h3><div id="chNW" class="ch"></div><div id="chNWX"></div></section>
    <p class="hint">הגרפים מציגים את הנתונים שהוזנו. רחפו (או עברו עם Tab) על חודש כדי לראות את כל הערכים שלו, ופתחו ״הצגה כטבלה״ לכל המספרים.</p>`;
  $('#anPeriod').onchange = e => { ui.anPeriod = e.target.value; saveUi(); renderAnalysis(); };
  $('#anSkip').onchange = e => { ui.anSkipCur = e.target.checked; saveUi(); renderAnalysis(); };
  bindInclFilter('anIncl', renderAnalysis);

  const noData = (id, text) => { $(id).innerHTML = `<div class="empty">${text}</div>`; };

  // 1. income vs expenses (grouped columns)
  if (I.some(isNum) || E.some(isNum)) {
    const series = [{ name: 'הכנסות', color: C.inc, values: I }, { name: 'הוצאות', color: C.exp, values: E }];
    columnChart($('#chFlow'), { cats: ms, labels, titles, series });
    $('#chFlowX').innerHTML = legendHtml(series) + tableHtml(['חודש', 'הכנסות', 'הוצאות', 'נשאר'], ms.map((m, i) => [titles[i], I[i], E[i], N[i]]));
  } else noData('#chFlow', 'אין הכנסות או הוצאות בתקופה.');

  // 2. what was left each month (one series, color by sign)
  if (N.some(isNum)) {
    columnChart($('#chNet'), { cats: ms, labels, titles, series: [{ name: 'נשאר', values: N }], polarity: { pos: C.pos, neg: C.neg } });
    $('#chNetX').innerHTML = `<div class="ch-legend"><span><i class="rect" style="background:${C.pos}"></i>נשאר כסף</span><span><i class="rect" style="background:${C.neg}"></i>גירעון</span></div>`;
  } else noData('#chNet', 'צריך הכנסות והוצאות באותם חודשים.');

  // 3. where income goes in an average month (one whole, split)
  if (isNum(avgI) && avgI > 0 && isNum(avgE)) {
    const parts = [{ label: 'הוצאות', value: avgE, color: C.exp }, { label: 'השקעות מחשבון הבנק', value: avgDB, color: C.inv }];
    if (left > 0) parts.push({ label: 'נשאר בחשבון', value: left, color: C.left });
    segBar($('#chWhere'), parts, Math.max(avgI, avgE + avgDB));
    if (left < 0) $('#chWhere').insertAdjacentHTML('beforeend', `<p class="warn-line">⚠️ בממוצע יוצא ${money(-left)} בחודש יותר ממה שנכנס.</p>`);
    $('#chWhere').insertAdjacentHTML('afterbegin', `<p class="muted seg-cap">הכנסה ממוצעת: <b class="n">${money(avgI)}</b> לחודש</p>`);
  } else noData('#chWhere', 'צריך הכנסות והוצאות בתקופה.');

  // 4. expenses by category (ranked bars, one hue)
  const E2 = repStats('expenses', ms);
  if (E2.rows.length) rankBars($('#chCats'), E2.rows.map(x => ({ label: x.name, value: x.avg, note: E2.total ? PF1.format(x.sum / E2.total * 100) + '%' : '' })), { color: C.exp });
  else noData('#chCats', 'אין הוצאות בתקופה.');

  // 5. gains per account (diverging)
  if (gains.length) rankBars($('#chGains'), gains.sort((x, y) => y.g.gain - x.g.gain).map(x => ({ label: x.a.name, value: x.g.gain })), { diverging: { pos: C.pos, neg: C.neg } });
  else noData('#chGains', 'צריך לפחות שתי יתרות לחשבון (למשל בתחילת התקופה ועכשיו). מעדכנים ב-📈 השקעות ← 💰 עדכון יתרות.');

  // 6. expense trend: the 5 biggest categories over ALL data keep their color whatever the period; the rest → "אחר"
  const allTotals = data.expenses.cats.map(c => ({ c, t: sum(Object.values(data.expenses.vals).map(r => r[c.id])) })).filter(x => x.t > 0).sort((a, b) => b.t - a.t);
  const top = allTotals.slice(0, 5).map(x => x.c), topIds = new Set(top.map(c => c.id));
  if (E.some(isNum)) {
    const series = top.map((c, j) => ({ name: c.name, color: `var(--s${j + 1})`, values: ms.map(m => monthHasData('expenses', m) ? (data.expenses.vals[m]?.[c.id] || 0) : null) }));
    const rest = ms.map(m => monthHasData('expenses', m) ? sum(Object.entries(data.expenses.vals[m]).filter(([id]) => !topIds.has(id)).map(([, v]) => v)) : null);
    if (rest.some(v => v)) series.push({ name: 'אחר', color: C.other, values: rest });
    columnChart($('#chTrend'), { cats: ms, labels, titles, series, stacked: true });
    $('#chTrendX').innerHTML = legendHtml(series) + tableHtml(['חודש', ...series.map(s => s.name)], ms.map((m, i) => [titles[i], ...series.map(s => s.values[i])]));
  } else noData('#chTrend', 'אין הוצאות בתקופה.');

  // 7. asset value over time, stacked by type (fixed color per type). Real estate is left out of the
  //    chart (one apartment would dwarf everything else) and shown as a line of text instead.
  const withBal = t => data.invest.accs.some(a => a.type === t && Object.values(data.invest.vals).some(r => isNum(r[a.id]?.b)));
  const types = INV_ORDER.filter(t => t !== 'realestate' && withBal(t) && (accGroup({ type: t }) === 'other' || inclGroups()[t]));
  const reNow = last ? typeBalances(last).realestate : null;
  if (types.length) {
    const bal = ms.map(m => typeBalances(m));
    const series = types.map(t => ({ name: INV_TYPES[t].name, color: INV_TYPES[t].color, values: bal.map(b => isNum(b[t]) ? b[t] : null) }));
    columnChart($('#chNW'), { cats: ms, labels, titles, series, stacked: true });
    $('#chNWX').innerHTML = legendHtml(series)
      + (isNum(reNow) ? `<p class="hint">נדל״ן לא נכלל בגרף, כי השווי שלו גדול בהרבה ומסתיר את השאר. השווי המשוער שלו: <b class="n">${money(reNow)}</b> (נכלל ב״שווי הנכסים״ למעלה).</p>` : '')
      + tableHtml(['חודש', ...series.map(s => s.name), 'סה״כ'], ms.map((m, i) => [titles[i], ...series.map(s => s.values[i]), sum(series.map(s => s.values[i]))]));
  } else if (isNum(reNow)) noData('#chNW', `יש רק נדל״ן (שווי משוער ${money(reNow)}). חשבונות אחרים יופיעו כאן כשיוזנו להם יתרות.`);
  else noData('#chNW', 'עדיין אין יתרות. מזינים ב-📈 השקעות ← 💰 עדכון יתרות.');
}
