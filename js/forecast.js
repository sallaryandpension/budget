"use strict";
/* =====================================================================
   forecast.js: how much there will be in N years.
   Scenario A: keep depositing like the last 12 months (deposits rise with inflation).
   Scenario B: no new deposits, only the estimated return.
   Per account, month by month:  B(t) = B(t-1) × (1 + r_m) + D × (1 + i_m)^t × (1 − deposit fee)
     r_m = monthly rate of the estimated yearly return (before inflation, after balance fees),
     i_m = monthly inflation. "Today's shekels" divides by (1 + inflation)^years.
   Settings live in data.settings.forecast, so every device sees the same forecast.
   No tax on withdrawal is applied. This is an estimate, not advice.
   ===================================================================== */

const FC_DEFAULTS = { years: 20, infl: 2.5, real: true, birth: null, retAge: 67, dep: {} };
const fcSettings = () => Object.assign({}, FC_DEFAULTS, data.settings.forecast || {}, { dep: Object.assign({}, (data.settings.forecast || {}).dep) });
function saveFc(patch) { change({ t: 'set', k: 'forecast', v: Object.assign(fcSettings(), patch) }, { render: false }); renderForecast(); }

/* Average monthly deposit of an account over the last 12 months that have deposit data. */
function avgDeposit12(a) {
  const cur = curMonth(), ms = monthRange(shiftMonth(cur, -11), cur).filter(invDepMonth);
  return ms.length ? sum(ms.map(m => invCell(m, a.id)?.d)) / ms.length : 0;
}
function projectAccount(a, start, dep, years, infl, withDeposits) {
  const r = accReturn(a), rm = Math.pow(1 + (isNum(r) ? r : 0) / 100, 1 / 12) - 1;
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

function renderForecast() {
  const el = $('#view-forecast');
  const accs = sortedAccs().filter(a => a.active !== false);
  if (!accs.length) {
    el.innerHTML = `<div class="pagehead"><h2>🔮 תחזית</h2></div><div class="card empty">כדי לחשב תחזית צריך חשבונות השקעה עם יתרות. מתחילים ב-<a href="#invest">📈 השקעות</a>.</div>`;
    return;
  }
  const S = fcSettings(), nowY = +curMonth().slice(0, 4);
  const age = isNum(S.birth) ? nowY - S.birth : null;
  const toRet = isNum(age) ? Math.max(1, S.retAge - age) : null;
  const years = S.years === 'ret' ? (toRet || 20) : S.years;
  const defl = y => S.real ? Math.pow(1 + S.infl / 100, y) : 1;     // today's shekels or nominal

  const rows = accs.map(a => {
    const lb = lastBal(a.id, curMonth()), start = lb ? lb.v : 0;
    const avgD = avgDeposit12(a), dep = isNum(S.dep[a.id]) ? S.dep[a.id] : avgD;
    const A = projectAccount(a, start, dep, years, S.infl, true), B = projectAccount(a, start, dep, years, S.infl, false);
    return { a, start, hasBal: !!lb, avgD, dep, ret: accReturn(a), A, B };
  }).filter(x => x.hasBal || x.dep > 0);
  const missingBal = rows.filter(x => !x.hasBal), missingRet = rows.filter(x => !isNum(x.ret));
  const tot = (key, y) => sum(rows.map(x => x[key].yearly[y])) / defl(y);
  const today = sum(rows.map(x => x.start));
  const endA = tot('A', years), endB = tot('B', years);
  const depNow = sum(rows.map(x => x.dep));
  const yearLabels = Array.from({ length: years + 1 }, (_, y) => String(nowY + y));
  const yearTitles = yearLabels.map((l, y) => y === 0 ? `היום (${l})` : `${l} · בעוד ${y} ${y === 1 ? 'שנה' : 'שנים'}${isNum(age) ? ` · גיל ${age + y}` : ''}`);
  // first year each scenario crosses the next round million
  const nextMil = Math.floor(today / 1e6) + 1, milY = Array.from({ length: years + 1 }, (_, y) => y).find(y => tot('A', y) >= nextMil * 1e6);
  const pensionRows = rows.filter(x => x.a.type === 'pension' || (x.a.type === 'gemel' && x.a.sub === 'גמל לתגמולים ופיצויים'));
  const pensionAtRet = isNum(toRet) && toRet <= years ? sum(pensionRows.map(x => x.A.yearly[toRet])) / defl(toRet) : null;
  const yOpts = [5, 10, 15, 20, 25, 30];

  el.innerHTML = `
    <div class="pagehead"><h2>🔮 תחזית</h2></div>
    <div class="card fc-set">
      <div><label for="fcYears">כמה שנים קדימה</label><select id="fcYears">${yOpts.map(v => `<option value="${v}" ${S.years === v ? 'selected' : ''}>${v} שנים</option>`).join('')}
        <option value="ret" ${S.years === 'ret' ? 'selected' : ''} ${isNum(age) ? '' : 'disabled'}>עד גיל ${S.retAge}${isNum(toRet) ? ` (${toRet} שנים)` : ' (צריך שנת לידה)'}</option></select></div>
      <div><label for="fcInfl">אינפלציה שנתית</label><div class="unit"><input id="fcInfl" type="text" inputmode="decimal" value="${S.infl}"><span>%</span></div></div>
      <div><label>להציג</label><div class="seg" id="fcReal"><button type="button" data-r="1" class="${S.real ? 'on' : ''}">בשקלים של היום</button><button type="button" data-r="0" class="${S.real ? '' : 'on'}">בשקלים של אז</button></div></div>
      <div><label for="fcBirth">שנת לידה <small class="muted">(לא חובה)</small></label><input id="fcBirth" type="text" inputmode="numeric" maxlength="4" value="${isNum(S.birth) ? S.birth : ''}" placeholder="למשל 1988"></div>
      <div><label for="fcRet">גיל פרישה</label><input id="fcRet" type="text" inputmode="numeric" maxlength="2" value="${S.retAge}"></div>
    </div>

    <div class="kpis">
      <div class="kpi an"><div class="k-l">היום</div><div class="k-v">${moneyHtml(today)}</div><div class="k-s">${rows.length} חשבונות</div></div>
      <div class="kpi fa"><div class="k-l">בעוד ${years} שנים, אם ממשיכים להפקיד</div><div class="k-v">${moneyHtml(endA)}</div><div class="k-s">הפקדה של ${money(depNow)} לחודש, שעולה עם האינפלציה</div></div>
      <div class="kpi fb"><div class="k-l">בעוד ${years} שנים, בלי הפקדות חדשות</div><div class="k-v">${moneyHtml(endB)}</div><div class="k-s">רק התשואה על מה שיש היום</div></div>
      <div class="kpi an"><div class="k-l">מה ההפקדות מוסיפות</div><div class="k-v">${moneyHtml(endA - endB)}</div><div class="k-s">ההבדל בין שני התרחישים</div></div>
    </div>
    <p class="muted fc-note">${S.real ? `הסכומים <b>בשקלים של היום</b> (אחרי ניכוי אינפלציה של ${PF1.format(S.infl)}% בשנה), כלומר כמה הם שווים בכוח קנייה של היום.` : `הסכומים <b>בשקלים של אז</b> (נומינלי). בגלל האינפלציה, כוח הקנייה שלהם יהיה נמוך יותר.`}
      ${isNum(milY) && milY > 0 ? ` אם ממשיכים להפקיד, השווי יעבור את <b>${money(nextMil * 1e6)}</b> בשנת <b>${nowY + milY}</b>.` : ''}</p>
    ${missingBal.length || missingRet.length ? `<div class="notice">${missingBal.length ? `⚠️ אין יתרה ל: ${missingBal.map(x => esc(x.a.name)).join(', ')}. התחזית שלהם מתחילה מ-0. <a href="#invest">לעדכון יתרות ←</a><br>` : ''}${missingRet.length ? `⚠️ אין תשואה משוערת ל: ${missingRet.map(x => esc(x.a.name)).join(', ')}. חושב להם 0%.` : ''}</div>` : ''}

    <section class="card"><h3>השווי הכולל לאורך השנים</h3><div id="fcLine" class="ch"></div><div id="fcLineX"></div></section>
    <section class="card"><h3>ממה זה מורכב <small class="muted">אם ממשיכים להפקיד, לפי סוג</small></h3><div id="fcStack" class="ch"></div><div id="fcStackX"></div></section>
    ${isNum(pensionAtRet) && pensionRows.length ? `<section class="card"><h3>קצבה משוערת בגיל ${S.retAge}</h3>
      <p>הצבירה בקופות הפנסיה בשנת ${nowY + toRet} צפויה להיות כ-<b class="n">${money(pensionAtRet)}</b>${S.real ? ' (בשקלים של היום)' : ''}. במקדם המרה של 200 (הנחה כללית לפרישה סביב גיל 67), זו קצבה של כ-<b class="n">${money(pensionAtRet / 200)}</b> לחודש, לפני מס.</p>
      <p class="hint">המקדם בפועל נקבע בפרישה, ותלוי בגיל, במין, בשאירים ובקרן (בערך 180–215; לנשים ובפרישה מוקדמת הוא גבוה יותר, ולכן הקצבה נמוכה יותר). בפנסיה מקיפה חלק מההפקדה הולך לביטוח, ולכן הצבירה בפועל תהיה מעט נמוכה יותר.</p></section>` : ''}

    <section class="card"><h3>החשבונות בתחזית <small class="muted">אפשר לשנות כאן את ההפקדה החודשית ואת התשואה</small></h3>
      <div class="tablewrap"><table class="stat fc-table"><thead><tr><th>חשבון</th><th class="n">היום</th><th>הפקדה לחודש</th><th>תשואה שנתית</th><th class="n">בעוד ${years} שנים</th><th class="n">בלי הפקדות</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td>${typeDot(x.a.type)}${esc(x.a.name)}</td>
        <td class="n">${x.hasBal ? moneyHtml(x.start) : '<span class="muted">אין יתרה</span>'}</td>
        <td><div class="unit"><input type="text" inputmode="decimal" data-dep="${x.a.id}" value="${isNum(S.dep[x.a.id]) ? S.dep[x.a.id] : Math.round(x.avgD)}"><span>₪</span></div>
          <small class="muted">${isNum(S.dep[x.a.id]) ? `שונה ידנית · ממוצע: ${money(x.avgD)}` : 'ממוצע 12 החודשים'}</small></td>
        <td><div class="unit"><input type="text" inputmode="decimal" data-ret="${x.a.id}" value="${isNum(x.ret) ? x.ret : ''}" placeholder="—"><span>%</span></div></td>
        <td class="n">${moneyHtml(x.A.yearly[years] / defl(years))}</td>
        <td class="n">${moneyHtml(x.B.yearly[years] / defl(years))}</td></tr>`).join('')}
      </tbody><tfoot><tr><td>סה״כ</td><td class="n">${moneyHtml(today)}</td><td class="n">${moneyHtml(depNow)}</td><td></td><td class="n">${moneyHtml(endA)}</td><td class="n">${moneyHtml(endB)}</td></tr></tfoot></table></div>
      ${Object.keys(S.dep).length ? '<button type="button" class="btn ghost small" id="fcReset">החזרת ההפקדות לממוצע</button>' : ''}
    </section>

    <details class="tips fc-assume" open><summary>ההנחות של התחזית</summary><ul>
      <li>הבסיס הוא היתרה האחרונה שהוזנה לכל חשבון, והתשואה המשוערת שלו (לפני אינפלציה, אחרי דמי ניהול מהצבירה). תשואה משנים כאן או ב-📊 תשואה משוערת.</li>
      <li>ההפקדה החודשית היא כברירת מחדל הממוצע של 12 החודשים האחרונים, והיא עולה כל שנה בגובה האינפלציה. דמי ניהול מהפקדה, אם הוזנו, יורדים ממנה.</li>
      <li>התשואה בפועל משתנה משנה לשנה. כאן היא קבועה, ולכן התוצאה היא קו ממוצע ולא מה שיקרה בדיוק.</li>
      <li>לא מחושב מס במשיכה (רווח הון, מס על קצבה). נדל״ן מחושב לפי עליית ערך בלבד.</li>
      <li>זו הערכה לתכנון, לא ייעוץ השקעות.</li></ul></details>`;

  // charts
  const A = yearLabels.map((_, y) => tot('A', y)), B = yearLabels.map((_, y) => tot('B', y));
  const series = [{ name: 'ממשיכים להפקיד', color: 'var(--s1)', values: A }, { name: 'בלי הפקדות חדשות', color: 'var(--s2)', values: B }];
  lineChart($('#fcLine'), { labels: yearLabels, titles: yearTitles, series });
  $('#fcLineX').innerHTML = legendHtml(series, 'line') + tableHtml(['שנה', ...series.map(s => s.name)], yearLabels.map((l, y) => [yearTitles[y], A[y], B[y]]));
  const types = INV_ORDER.filter(t => rows.some(x => x.a.type === t));
  const stackS = types.map(t => ({ name: INV_TYPES[t].name, color: INV_TYPES[t].color, values: yearLabels.map((_, y) => sum(rows.filter(x => x.a.type === t).map(x => x.A.yearly[y])) / defl(y)) }));
  columnChart($('#fcStack'), { cats: yearLabels, labels: yearLabels, titles: yearTitles, series: stackS, stacked: true });
  $('#fcStackX').innerHTML = legendHtml(stackS) + tableHtml(['שנה', ...stackS.map(s => s.name)], yearLabels.map((l, y) => [yearTitles[y], ...stackS.map(s => s.values[y])]));

  // settings
  $('#fcYears').onchange = e => saveFc({ years: e.target.value === 'ret' ? 'ret' : +e.target.value });
  $('#fcInfl').onchange = e => { const v = parseNum(e.target.value); if (isNum(v) && v >= 0 && v < 30) saveFc({ infl: v }); else { toast('אינפלציה לא תקינה'); e.target.value = S.infl; } };
  $('#fcReal').onclick = e => { const b = e.target.closest('[data-r]'); if (b) saveFc({ real: b.dataset.r === '1' }); };
  $('#fcBirth').onchange = e => { const v = e.target.value.trim(); const n = +v; if (!v) saveFc({ birth: null, years: S.years === 'ret' ? 20 : S.years }); else if (n > 1920 && n <= nowY) saveFc({ birth: n }); else { toast('שנת לידה לא תקינה'); e.target.value = S.birth || ''; } };
  $('#fcRet').onchange = e => { const n = +e.target.value; if (n >= 40 && n <= 80) saveFc({ retAge: n }); else { toast('גיל פרישה לא תקין'); e.target.value = S.retAge; } };
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
