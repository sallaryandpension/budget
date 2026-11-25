"use strict";
/* home.js: main screen. Average and total per component of each report, for a chosen period. */

function periodOptions() {
  const ys = yearsList().slice().reverse();
  return [['12', '12 החודשים האחרונים'], ...ys.map(y => [y, 'שנת ' + y]), ['all', 'כל התקופה']];
}
function periodMonths(p) {
  const all = allMonths(), cur = curMonth();
  if (p === '12') {
    const end = ui.homeSkipCur ? shiftMonth(cur, -1) : cur, from = shiftMonth(end, -11);
    return all.filter(m => m >= from && m <= end);
  }
  const ms = p === 'all' ? all : all.filter(m => m.startsWith(p));
  return ui.homeSkipCur ? ms.filter(m => m !== cur) : ms;
}

/* Average per month = total ÷ number of months that have any data in that report. */
function repStats(r, ms) {
  const active = ms.filter(m => monthHasData(r, m)), n = active.length;
  const rows = data[r].cats.map(c => {
    const s = sum(ms.map(m => data[r].vals[m]?.[c.id]));
    return { name: c.name, sum: s, avg: n ? s / n : 0, inactive: c.active === false };
  }).filter(x => x.sum !== 0);
  rows.sort((a, b) => b.sum - a.sum);
  const total = sum(rows.map(x => x.sum));
  return { n, rows, total, avg: n ? total / n : 0, has: data[r].cats.length > 0 };
}
function invStats(ms) {
  const active = ms.filter(invDepMonth), n = active.length, last = ms[ms.length - 1];
  const bySource = { payroll: 0, bank: 0 }, byType = {};
  const rows = sortedAccs().map(a => {
    const dep = sum(ms.map(m => invCell(m, a.id)?.d));
    const end = last ? lastBal(a.id, last) : null;
    const g = periodGain(a.id, ms);
    bySource[a.source === 'bank' ? 'bank' : 'payroll'] += dep;
    const t = byType[a.type] ||= { dep: 0, end: 0, gain: 0, hasEnd: false };
    t.dep += dep; if (end) { t.end += end.v; t.hasEnd = true; } if (g) t.gain += g.gain;
    return { a, dep, avg: n ? dep / n : 0, end, g };
  }).filter(x => x.dep !== 0 || x.end || x.a.active !== false);
  const dep = sum(rows.map(x => x.dep));
  return { n, rows, dep, avg: n ? dep / n : 0, endSum: sum(rows.map(x => x.end?.v)), anyEnd: rows.some(x => x.end),
    gain: sum(rows.map(x => x.g?.gain)), anyGain: rows.some(x => x.g), bySource, byType, has: data.invest.accs.length > 0 };
}

function renderHome() {
  const el = $('#view-home');
  if (isEmptyData(data)) {
    el.innerHTML = `<div class="card welcome">
      <h2>ברוכים הבאים 👋</h2>
      <p>כאן מנהלים את דו״ח ההוצאות, דו״ח ההכנסות ודו״ח ההשקעות במקום באקסל. המסך הזה יציג את הממוצע החודשי והסה״כ של כל רכיב.</p>
      <div class="steps3">
        <a class="step" href="#expenses"><b>1</b><span>🧾 דו״ח הוצאות</span><small>בוחרים קטגוריות וממלאים לפי חודשים</small></a>
        <a class="step" href="#income"><b>2</b><span>💼 דו״ח הכנסות</span><small>משכורת ושאר מקורות ההכנסה</small></a>
        <a class="step" href="#invest"><b>3</b><span>📈 דו״ח השקעות</span><small>פנסיה, השתלמות, גמל וברוקרים</small></a>
      </div>
      ${IMPORT_HINT}
      <p class="hint">${cfg ? '✓ הנתונים מסונכרנים ל-GitHub.' : 'כדי שהנתונים יישמרו ב-repository פרטי ב-GitHub ויהיו זמינים בכל מכשיר: <a href="#settings">⚙️ הגדרות ← סנכרון</a>.'}</p>
    </div>`;
    bindImportHint(el);
    return;
  }
  const opts = periodOptions();
  if (!opts.some(o => o[0] === ui.homePeriod)) ui.homePeriod = '12';
  const ms = periodMonths(ui.homePeriod);
  const E = repStats('expenses', ms), I = repStats('income', ms), V = invStats(ms);
  const net = I.avg - E.avg;
  const range = ms.length ? `${monthName(ms[0])} – ${monthName(ms[ms.length - 1])}` : '';

  const kpi = (cls, label, avg, total, n, extra = '') => `<div class="kpi ${cls}">
      <div class="k-l">${label}</div><div class="k-v">${moneyHtml(avg, '—')}</div>
      <div class="k-s">${n ? `סה״כ ${money(total)} · ${n} חודשים` : 'אין נתונים בתקופה'}</div>${extra}</div>`;
  const statTable = (S, r) => {
    if (!S.has) return `<div class="empty">עדיין לא נוצר דו״ח ${REPORTS[r].title}. <a href="#${r}">ליצירה ←</a></div>`;
    if (!S.rows.length) return '<div class="empty">אין נתונים בתקופה הזו.</div>';
    return `<table class="stat"><thead><tr><th>רכיב</th><th class="n">ממוצע לחודש</th><th class="n">סה״כ</th><th class="bars">חלק</th></tr></thead><tbody>
      ${S.rows.map(x => { const p = S.total ? x.sum / S.total * 100 : 0; return `<tr${x.inactive ? ' class="inactive"' : ''}><td>${esc(x.name)}</td>
        <td class="n">${moneyHtml(x.avg)}</td><td class="n">${moneyHtml(x.sum)}</td>
        <td class="bars"><div class="bar"><i style="width:${Math.max(0, Math.min(100, p))}%"></i></div><small>${PF1.format(p)}%</small></td></tr>`; }).join('')}
      </tbody><tfoot><tr><td>סה״כ</td><td class="n">${moneyHtml(S.avg)}</td><td class="n">${moneyHtml(S.total)}</td><td></td></tr></tfoot></table>
      <p class="hint">ממוצע על ${S.n} חודשים שיש בהם נתונים.</p>`;
  };
  const invTable = () => {
    if (!V.has) return '<div class="empty">עדיין לא נוספו חשבונות השקעה. <a href="#invest">להוספה ←</a></div>';
    return `<div class="tablewrap"><table class="stat inv"><thead><tr><th>חשבון</th><th class="n">הפקדה ממוצעת</th><th class="n">הפקדות בתקופה</th><th class="n">יתרה אחרונה</th><th class="n">רווח / הפסד</th></tr></thead><tbody>
      ${V.rows.map(x => `<tr${x.a.active === false ? ' class="inactive"' : ''}><td>${typeDot(x.a.type)}${esc(x.a.name)} <small class="muted">${INV_TYPES[x.a.type].short}</small></td>
        <td class="n">${moneyHtml(x.avg)}</td><td class="n">${moneyHtml(x.dep)}</td>
        <td class="n">${x.end ? moneyHtml(x.end.v) + `<small class="muted d">${monthNum(x.end.m)}</small>` : '—'}</td>
        <td class="n ${x.g ? (x.g.gain >= 0 ? 'pos' : 'neg') : ''}" ${x.g ? `title="מ-${monthNum(x.g.from)} עד ${monthNum(x.g.to)}"` : ''}>${x.g ? moneyHtml(x.g.gain) : '—'}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>סה״כ</td><td class="n">${moneyHtml(V.avg)}</td><td class="n">${moneyHtml(V.dep)}</td>
        <td class="n">${V.anyEnd ? moneyHtml(V.endSum) : '—'}</td><td class="n ${V.gain >= 0 ? 'pos' : 'neg'}">${V.anyGain ? moneyHtml(V.gain) : '—'}</td></tr></tfoot></table></div>
      <div class="typesum">${INV_ORDER.filter(t => V.byType[t]).map(t => { const x = V.byType[t]; return `<div style="--c:${INV_TYPES[t].color}">
        <span>${INV_TYPES[t].name}</span><b>${x.hasEnd ? money(x.end) : '—'}</b><small>הפקדות בתקופה ${money(x.dep)}</small></div>`; }).join('')}</div>
      <p class="hint">רווח / הפסד = היתרה בסוף התקופה פחות היתרה בתחילתה, פחות ההפקדות שביניהן. הוא מוצג רק כשיש לפחות שתי יתרות.</p>`;
  };

  el.innerHTML = `
    <div class="pagehead"><h2>סיכום</h2>
      <div class="tools"><select id="homePeriod" aria-label="תקופה">${opts.map(([v, t]) => `<option value="${v}" ${v === ui.homePeriod ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="chk"><input type="checkbox" id="homeSkip" ${ui.homeSkipCur ? 'checked' : ''}> בלי החודש הנוכחי</label></div></div>
    <p class="muted range">${range}</p>
    ${!cfg ? `<div class="notice">💾 הנתונים נשמרים כרגע רק בדפדפן הזה. כדי לשמור אותם ב-repository פרטי ב-GitHub: <a href="#settings">⚙️ הגדרות ← סנכרון</a>.</div>` : ''}
    <div class="kpis">
      ${kpi('inc', 'הכנסה ממוצעת לחודש', I.n ? I.avg : null, I.total, I.n)}
      ${kpi('exp', 'הוצאה ממוצעת לחודש', E.n ? E.avg : null, E.total, E.n)}
      ${kpi('net ' + (net >= 0 ? 'pos' : 'neg'), 'נשאר בממוצע (הכנסות פחות הוצאות)', I.n && E.n ? net : null, I.total - E.total, I.n && E.n ? Math.max(I.n, E.n) : 0)}
      ${kpi('inv', 'הפקדה ממוצעת להשקעות', V.n ? V.avg : null, V.dep, V.n,
        V.n ? `<div class="k-s">מהמשכורת ${money(V.n ? V.bySource.payroll / V.n : 0)} · מהבנק ${money(V.n ? V.bySource.bank / V.n : 0)} לחודש</div>` : '')}
    </div>
    <div class="cols2">
      <section class="card"><h3>🧾 הוצאות לפי רכיב <a href="#expenses" class="more">לטבלה ←</a></h3>${statTable(E, 'expenses')}</section>
      <section class="card"><h3>💼 הכנסות לפי רכיב <a href="#income" class="more">לטבלה ←</a></h3>${statTable(I, 'income')}</section>
    </div>
    <section class="card"><h3>📈 השקעות <a href="#invest" class="more">לטבלה ←</a></h3>${invTable()}</section>`;
  $('#homePeriod').onchange = e => { ui.homePeriod = e.target.value; saveUi(); renderHome(); };
  $('#homeSkip').onchange = e => { ui.homeSkipCur = e.target.checked; saveUi(); renderHome(); };
}
