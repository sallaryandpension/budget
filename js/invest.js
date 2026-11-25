"use strict";
/* =====================================================================
   invest.js: investments report.
   Each account has a type (pension / hishtalmut / gemel / broker) and, per month,
   a deposit (d) and an end-of-month balance (b). The table shows one of the two.
   The type matters: later stages will apply each product's rules
   (liquidity dates, tax benefits, fees). See funds_info/summary_he.md.
   ===================================================================== */

const typeDot = t => `<i class="dot" style="background:${INV_TYPES[t].color}"></i>`;

function investSpec(f) {
  const months = displayMonths('invest');
  const items = sortedAccs()
    .filter(a => a.active !== false || months.some(m => invCell(m, a.id)))
    .map(a => ({ id: a.id, name: a.name, badge: typeDot(a.type), inactive: a.active === false,
      sub: [INV_TYPES[a.type].short, a.owner].filter(Boolean).join(' · ') }));
  return {
    items, months, flip: monthsAsRows('invest'), mode: f === 'b' ? 'balance' : 'sum', itemLabel: 'חשבון',
    get: (m, id) => invCell(m, id)?.[f],
    carryBefore: (id, m0) => lastBal(id, shiftMonth(m0, -1))?.v ?? null,
    monthActive: invDepMonth,
    commit: list => change({ t: 'inv', list: list.map(([m, id, v]) => [m, id, f, v]) }, { render: false }),
    rerender: () => renderView('invest'),
    onItem: id => openAccount(id),
  };
}

function renderInvest() {
  const el = $('#view-invest');
  if (!data.invest.accs.length) {
    el.innerHTML = `<div class="card setup">
      <h2>📈 יצירת דו״ח השקעות</h2>
      <p>מוסיפים כל חשבון השקעה או חיסכון בנפרד. לכל חשבון יש סוג, כי לכל סוג יש כללים משלו: מתי הכסף נזיל, איך הוא ממוסה ומה דמי הניהול.</p>
      <div class="typegrid">${INV_ORDER.map(t => `<button type="button" class="typecard" data-type="${t}" style="--c:${INV_TYPES[t].color}">
        <b>${INV_TYPES[t].name}</b><span>${INV_TYPES[t].hint}</span><em>+ הוספה</em></button>`).join('')}</div>
      <p class="hint">בכל חודש רושמים שני מספרים לכל חשבון: כמה הופקד באותו חודש, ומה היתרה (השווי) בסוף החודש. לא חייבים למלא יתרה בכל חודש: אפשר פעם ברבעון, לפי הדוח של הקרן.</p>
      ${IMPORT_HINT}
    </div>`;
    bindImportHint(el);
    el.querySelectorAll('[data-type]').forEach(b => b.onclick = () => openAccount(null, b.dataset.type));
    return;
  }
  const f = ui.invMode === 'b' ? 'b' : 'd';
  const spec = investSpec(f);
  el.innerHTML = `
    <div class="pagehead"><h2>📈 דו״ח השקעות</h2>
      <div class="tools">
        <button type="button" class="btn small" data-a="add">+ חשבון</button>
        <button type="button" class="btn small" data-a="bal" title="להזין את היתרה הנוכחית של כל החשבונות בבת אחת">💰 עדכון יתרות</button>
        <button type="button" class="btn ghost small" data-a="ret" title="התשואה השנתית המשוערת של כל חשבון, לתחזיות">📊 תשואה משוערת</button>
        <button type="button" class="btn ghost small" data-a="flip">⇄ ${spec.flip ? 'חודשים בעמודות' : 'חודשים בשורות'}</button>
        <button type="button" class="btn ghost small" data-a="xlout" title="כל הדוחות בקובץ אקסל אחד">⬇ אקסל</button>
        <button type="button" class="btn ghost small" data-a="xlin" title="ייבוא מקובץ אקסל או CSV">⬆ ייבוא</button>
      </div></div>
    <div class="bar2">${yearBar('invest')}
      <div class="seg mode" data-mode>
        <button type="button" data-f="d" class="${f === 'd' ? 'on' : ''}">הפקדות בחודש</button>
        <button type="button" data-f="b" class="${f === 'b' ? 'on' : ''}">יתרה בסוף החודש</button>
      </div></div>
    <p class="hint lead">${f === 'd'
      ? 'כמה הופקד לחשבון באותו חודש. בפנסיה ובהשתלמות: עובד, מעסיק ופיצויים ביחד. משיכה נרשמת כמספר שלילי.'
      : 'השווי של החשבון בסוף החודש, לפי הדוח או האפליקציה של הגוף המנהל. מספיק למלא כשיש נתון חדש.'}</p>
    ${spec.items.length ? `<div class="gridwrap">${gridHtml(spec)}</div><p class="hint" data-info></p>` : '<div class="empty">כל החשבונות סגורים.</div>'}
    ${TIPS_HTML}
    <h3 class="sec">החשבונות</h3>
    <div class="accs">${sortedAccs().map(accCard).join('')}</div>`;
  bindYearBar(el, 'invest');
  mountGrid(el, spec);
  el.querySelector('[data-mode]').onclick = e => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    ui.invMode = b.dataset.f; saveUi(); renderView('invest');
  };
  el.querySelector('[data-a="add"]').onclick = () => openAccount(null);
  el.querySelector('[data-a="bal"]').onclick = () => openBalances();
  el.querySelector('[data-a="ret"]').onclick = () => openReturns();
  el.querySelector('[data-a="flip"]').onclick = () => { ui.flip.invest = !monthsAsRows('invest'); saveUi(); renderView('invest'); };
  el.querySelector('[data-a="xlout"]').onclick = exportExcel;
  el.querySelector('[data-a="xlin"]').onclick = pickExcelFile;
  el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openAccount(b.dataset.edit));
}

function accCard(a) {
  const T = INV_TYPES[a.type];
  const lb = lastBal(a.id, '9999-12');
  const fees = [isNum(a.feeDep) ? `${pct(a.feeDep)} מההפקדה` : '', isNum(a.feeBal) ? `${pct(a.feeBal)} מהצבירה` : ''].filter(Boolean).join(', ');
  const split = [isNum(a.splitEmp) ? `עובד ${pct(a.splitEmp)}` : '', isNum(a.splitEr) ? `מעסיק ${pct(a.splitEr)}` : '', isNum(a.splitSev) ? `פיצויים ${pct(a.splitSev)}` : ''].filter(Boolean).join(' · ');
  const line = (k, v) => v ? `<div><span>${k}</span>${v}</div>` : '';
  return `<div class="acc${a.active === false ? ' off' : ''}" style="--c:${T.color}">
    <div class="acc-h"><b>${esc(a.name)}</b><span class="badge">${T.short}</span></div>
    <div class="acc-b">
      ${line('סוג', esc(a.sub || T.name))}
      ${line('גוף מנהל', esc(a.provider))}
      ${line('מסלול', esc(a.track))}
      ${line('של', esc(a.owner))}
      ${line('נפתח', a.open ? monthNum(a.open) : '')}
      ${line('הפקדות', SOURCES[a.source] || '')}
      ${line('דמי ניהול', fees)}
      ${line('שיעורי הפקדה', split)}
      ${line('תשואה משוערת', isNum(accReturn(a)) ? pct(accReturn(a)) + (isNum(a.ret) ? '' : ' <small class="muted">(ברירת מחדל)</small>') : '')}
      ${line('ריבית שנתית', isNum(a.rate) ? pct(a.rate) : '')}
      ${line('פירעון', a.maturity ? monthNum(a.maturity) : '')}
      ${line('יתרה אחרונה', lb ? `${moneyHtml(lb.v)} <small class="muted">(${monthNum(lb.m)})</small>` : '')}
      ${a.active === false ? '<div><span>מצב</span>סגור</div>' : ''}
    </div>
    ${a.note ? `<div class="acc-note">${esc(a.note)}</div>` : ''}
    <button type="button" class="btn ghost small" data-edit="${a.id}">✎ עריכה</button>
  </div>`;
}

const NAME_HINT = { broker: 'למשל: IBI, Interactive Brokers', deposit: 'למשל: פיקדון לאומי 12 חודשים', policy: 'למשל: פוליסת חיסכון הראל',
  cash: 'למשל: עו״ש לאומי', realestate: 'למשל: דירה בחיפה', other: 'למשל: קרן כספית, ביטקוין, RSU' };
const PROVIDER_LABEL = { broker: 'בית השקעות / ברוקר', deposit: 'בנק', policy: 'חברת ביטוח', cash: 'בנק', realestate: 'מיקום', other: 'איפה מוחזק' };
const TRACK_HINT = { broker: 'למשל: מדדים', deposit: 'למשל: 12 חודשים, צמוד, יציאה ביום 90', cash: '', realestate: 'למשל: 4 חדרים, מושכרת', other: '' };
const TRACK_LABEL = { cash: 'הערה קצרה', realestate: 'פרטים' };

/* Update all balances at once, for one month (default: this month). This is how the current
   value of every account is entered: without it the gains cannot be known. */
function openBalances(month) {
  let m = month || curMonth();
  const accs = sortedAccs().filter(a => a.active !== false);
  const draw = () => {
    const sh = openSheet(`<div class="head"><h3>💰 עדכון יתרות</h3><button type="button" class="x" data-close aria-label="סגירה">✕</button></div>
      <p class="muted">מזינים את השווי של כל חשבון, לפי האפליקציה או הדוח של הגוף המנהל. אין צורך למלא את כולם: שדה ריק נשאר כמו שהוא.
        את כל הקופות (פנסיה, השתלמות וגמל) אפשר לראות במקום אחד ב<a href="https://www.swiftness.co.il/savers/" target="_blank" rel="noopener">מסלקה הפנסיונית</a>.</p>
      <label for="balMonth">נכון לסוף החודש</label>
      <input type="month" id="balMonth" value="${m}" style="max-width:200px">
      <div class="balist">${accs.map(a => {
        const own = invCell(m, a.id)?.b, last = lastBal(a.id, m);
        return `<div class="balrow" style="--c:${INV_TYPES[a.type].color}">
          <div class="bn"><b>${esc(a.name)}</b><small>${INV_TYPES[a.type].short}${last && !isNum(own) ? ` · אחרונה: ${money(last.v)} (${monthNum(last.m)})` : ''}</small></div>
          <div class="unit"><input type="text" inputmode="decimal" data-acc="${a.id}" value="${cellText(own)}" placeholder="${last && !isNum(own) ? NF2.format(last.v) : '0'}"><span>₪</span></div></div>`;
      }).join('')}</div>
      <div class="sheet-actions"><button type="button" class="btn ghost" data-close>ביטול</button><button type="button" class="btn" id="balSave">שמירה</button></div>`);
    $('#balMonth').onchange = e => { if (validMonth(e.target.value)) { m = e.target.value; draw(); } };
    $('#balSave').onclick = () => {
      const list = []; let bad = 0;
      sh.querySelectorAll('[data-acc]').forEach(inp => {
        if (inp.value.trim() === '') return;
        const v = parseNum(inp.value);
        if (Number.isNaN(v)) { bad++; inp.classList.add('bad'); return; }
        if (invCell(m, inp.dataset.acc)?.b !== v) list.push([m, inp.dataset.acc, 'b', v]);
      });
      if (bad) { toast('יש ערך לא תקין'); return; }
      if (list.length) change({ t: 'inv', list });
      closeSheet();
      toast(list.length ? `עודכנו ${list.length} יתרות ל${monthName(m)}` : 'לא היה שינוי');
    };
    const first = sh.querySelector('[data-acc]'); first && first.focus();
  };
  if (!accs.length) { toast('עדיין אין חשבונות השקעה'); return; }
  draw();
}

/* Estimated yearly return of every account in one window. Accounts without their own value
   show the default for their type and track, so saving once fills them all in. */
function openReturns() {
  const accs = sortedAccs().filter(a => a.active !== false);
  if (!accs.length) { toast('עדיין אין חשבונות השקעה'); return; }
  const presetOpts = '<option value="">בחירה מהירה…</option>' + RETURN_PRESETS.map(([n, v]) => `<option value="${v}">${esc(n)} (${pct(v)})</option>`).join('');
  const sh = openSheet(`<div class="head"><h3>📊 תשואה שנתית משוערת</h3><button type="button" class="x" data-close aria-label="סגירה">✕</button></div>
    <p class="muted">הערכה כללית לטווח ארוך לכל חשבון, לפני אינפלציה ואחרי דמי ניהול. התחזיות ישתמשו בה. הערכים שמולאו מראש הם ברירות מחדל לפי סוג החשבון והמסלול, ואפשר לשנות כל אחד. זו הנחת עבודה ולא המלצת השקעה.</p>
    <div class="balist">${accs.map(a => {
      const own = isNum(a.ret), v = own ? a.ret : suggestReturn(a);
      return `<div class="balrow" style="--c:${INV_TYPES[a.type].color}">
        <div class="bn"><b>${esc(a.name)}</b><small>${INV_TYPES[a.type].short}${a.track ? ' · ' + esc(a.track) : ''}${!own && isNum(v) ? ' · ברירת מחדל' : ''}</small></div>
        <select class="retpick" aria-label="בחירה מהירה">${presetOpts}</select>
        <div class="unit"><input type="text" inputmode="decimal" data-acc="${a.id}" value="${isNum(v) ? v : ''}" placeholder="—"><span>%</span></div></div>`;
    }).join('')}</div>
    <p class="hint">בנדל״ן יש שתי הערכות לטווח ארוך: לפי 20 השנים האחרונות ${PF1.format(RE_20Y)}% בשנה (2006–2026: עלייה של 4.1% בשנה מעל האינפלציה), ולפי הטווח הארוך, מאז 1960, ${PF1.format(RE_LONG)}% בשנה (2.9% מעל האינפלציה, לפי בנק ישראל). בשתיהן נוספה אינפלציה צפויה של 2.5%. ברירת המחדל היא הטווח הארוך, והתחזית מציגה את שתיהן. זו עליית הערך בלבד: שכר דירה נרשם בהכנסות. בקריפטו אין ברירת מחדל.</p>
    <div class="sheet-actions"><button type="button" class="btn ghost" data-close>ביטול</button><button type="button" class="btn" id="retSave">שמירה</button></div>`);
  sh.querySelectorAll('.retpick').forEach(s => s.onchange = () => {
    if (s.value !== '') s.closest('.balrow').querySelector('[data-acc]').value = s.value;
    s.value = '';
  });
  $('#retSave').onclick = () => {
    let bad = 0, n = 0;
    const patches = [];
    sh.querySelectorAll('[data-acc]').forEach(inp => {
      const v = inp.value.trim() === '' ? null : parseNum(inp.value);
      if (Number.isNaN(v)) { bad++; inp.classList.add('bad'); return; }
      const a = data.invest.accs.find(x => x.id === inp.dataset.acc);
      if ((a.ret ?? null) !== v) patches.push([a.id, v]);
    });
    if (bad) { toast('יש ערך לא תקין'); return; }
    for (const [id, v] of patches) { change({ t: 'accSet', id, patch: { ret: v } }, { render: false }); n++; }
    closeSheet(); renderCurrent();
    toast(n ? `עודכנו ${n} חשבונות` : 'לא היה שינוי');
  };
}

/* Add / edit account */
function openAccount(id, presetType) {
  const acc = id ? data.invest.accs.find(a => a.id === id) : null;
  const f = acc ? clone(acc) : { type: presetType || 'broker', active: true };
  if (!f.source) f.source = INV_TYPES[f.type].source;
  let sourceTouched = !!acc;
  const num = (k, ph) => `<div class="unit"><input type="text" inputmode="decimal" data-k="${k}" value="${isNum(f[k]) ? f[k] : ''}" placeholder="${ph || ''}"><span>%</span></div>`;
  const draw = () => {
    const T = INV_TYPES[f.type];
    const sh = openSheet(`<div class="head"><h3>${acc ? 'עריכת חשבון' : 'חשבון השקעה חדש'}</h3><button type="button" class="x" data-close aria-label="סגירה">✕</button></div>
      <label>סוג</label>
      <div class="seg wrap" id="accType">${INV_ORDER.map(t => `<button type="button" data-t="${t}" class="${t === f.type ? 'on' : ''}">${INV_TYPES[t].name}</button>`).join('')}</div>
      <label for="aName">שם החשבון *</label>
      <input id="aName" value="${esc(f.name || '')}" maxlength="60" placeholder="${NAME_HINT[f.type] || 'למשל: ' + T.short + ' מור – מסלול מניות'}">
      <div class="row">
        <div><label for="aSub">סוג מוצר</label><select id="aSub">${T.subs.map(s => `<option ${s === f.sub ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div><label for="aOwner">של מי</label><input id="aOwner" value="${esc(f.owner || '')}" maxlength="30" list="ownersList" placeholder="למשל: אני"></div>
      </div>
      <datalist id="ownersList">${[...new Set(data.invest.accs.map(a => a.owner).filter(Boolean))].map(o => `<option value="${esc(o)}">`).join('')}</datalist>
      <div class="row">
        <div><label for="aProv">${PROVIDER_LABEL[f.type] || 'גוף מנהל'}</label><input id="aProv" value="${esc(f.provider || '')}" maxlength="40"></div>
        <div><label for="aTrack">${T.term ? 'תנאים' : TRACK_LABEL[f.type] || 'מסלול השקעה'}</label><input id="aTrack" value="${esc(f.track || '')}" maxlength="40" placeholder="${TRACK_HINT[f.type] || 'למשל: מניות, S&P 500, תלוי גיל'}"></div>
      </div>
      <div class="row">
        <div><label for="aOpen">חודש פתיחה</label><input type="month" id="aOpen" value="${esc(f.open || '')}"></div>
        <div><label>מאיפה מגיעות ההפקדות</label>
          <div class="seg" id="aSource">${Object.entries(SOURCES).map(([k, v]) => `<button type="button" data-s="${k}" class="${k === f.source ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      </div>
      ${f.type === 'hish' ? '<p class="hint">חודש הפתיחה קובע מתי הקרן נזילה (בדרך כלל אחרי 6 שנים).</p>' : ''}
      <p class="hint">${f.source === 'payroll' ? 'ההפקדה יורדת מהמשכורת ברוטו, ולכן היא לא חלק מהנטו שבדו״ח ההכנסות.' : 'ההפקדה יוצאת מחשבון הבנק, כלומר מהכסף שנשאר אחרי ההוצאות.'}</p>
      <label>תשואה שנתית משוערת</label>
      <div class="retrow">${num('ret', isNum(suggestReturn(f)) ? String(suggestReturn(f)) : '')}
        <small class="muted">${isNum(suggestReturn(f)) ? `ריק = ברירת המחדל לסוג הזה (${pct(suggestReturn(f))})` : 'אין ברירת מחדל לסוג הזה'}</small></div>
      <div class="chips small" id="retChips">${RETURN_PRESETS.map(([n, v]) => `<button type="button" class="chip${f.ret === v ? ' on' : ''}" data-ret="${v}">${esc(n)} ${pct(v)}</button>`).join('')}</div>
      <p class="hint">הערכה כללית לטווח ארוך, לפני אינפלציה ואחרי דמי ניהול. היא משמשת לתחזיות, ואפשר לשנות אותה בכל זמן.${f.type === 'realestate' ? ` בנדל״ן זו עליית הערך בלבד (שכר דירה נרשם בדו״ח ההכנסות). יש שתי הערכות: לפי 20 השנים האחרונות ${PF1.format(RE_20Y)}%, ולפי הטווח הארוך (מ-1960) ${PF1.format(RE_LONG)}%.` : ''}</p>
      ${T.fees ? `
        <label>דמי ניהול</label>
        <div class="row"><div><small class="muted">מההפקדה</small>${num('feeDep', '0')}</div><div><small class="muted">מהצבירה (שנתי)</small>${num('feeBal', '0')}</div></div>` : ''}
      ${T.split ? `<label>שיעורי הפקדה מהשכר (לא חובה)</label>
        <div class="row three"><div><small class="muted">עובד</small>${num('splitEmp', f.type === 'hish' ? '2.5' : '6')}</div>
          <div><small class="muted">מעסיק</small>${num('splitEr', f.type === 'hish' ? '7.5' : '6.5')}</div>
          <div><small class="muted">פיצויים</small>${num('splitSev', f.type === 'hish' ? '' : '8.33')}</div></div>
        <p class="hint">משמש בהמשך לחישוב הטבות המס ולתחזיות. בטבלה רושמים את סך ההפקדה החודשית.</p>` : ''}
      ${T.term ? `<div class="row">
          <div><label>ריבית שנתית</label>${num('rate', 'למשל 4')}</div>
          <div><label for="aMat">מועד פירעון</label><input type="month" id="aMat" value="${esc(f.maturity || '')}"></div></div>
        <p class="hint">את הקרן שהופקדה רושמים כהפקדה בחודש הפתיחה, ואת השווי (קרן + ריבית) רושמים ביתרות.</p>` : ''}
      <label for="aNote">הערות</label>
      <textarea id="aNote" rows="2" maxlength="300">${esc(f.note || '')}</textarea>
      ${acc ? `<label class="chk"><input type="checkbox" id="aActive" ${f.active !== false ? 'checked' : ''}> החשבון פעיל (חשבון סגור מוסתר מהטבלה, והנתונים שלו נשמרים)</label>` : ''}
      <div class="sheet-actions row">
        ${acc ? '<button type="button" class="btn danger" id="aDel">מחיקה</button>' : ''}
        <button type="button" class="btn" id="aSave">${acc ? 'שמירה' : 'הוספה'}</button>
      </div>`);
    const read = () => {
      f.name = $('#aName').value.trim(); f.sub = $('#aSub').value; f.owner = $('#aOwner').value.trim();
      f.provider = $('#aProv').value.trim(); f.track = $('#aTrack').value.trim();
      f.open = validMonth($('#aOpen').value) ? $('#aOpen').value : '';
      f.note = $('#aNote').value.trim();
      if ($('#aMat')) f.maturity = validMonth($('#aMat').value) ? $('#aMat').value : '';
      sh.querySelectorAll('[data-k]').forEach(i => { const v = parseNum(i.value); f[i.dataset.k] = isNum(v) ? v : null; });
      if ($('#aActive')) f.active = $('#aActive').checked;
    };
    $('#accType').onclick = e => {
      const b = e.target.closest('[data-t]'); if (!b || b.dataset.t === f.type) return;
      read(); f.type = b.dataset.t; f.sub = INV_TYPES[f.type].subs[0];
      if (!sourceTouched) f.source = INV_TYPES[f.type].source;
      draw();
    };
    $('#aSub').onchange = () => {
      if (!sourceTouched) { read(); f.source = (f.sub === 'גמל להשקעה' || f.sub === 'עצמאי') ? 'bank' : INV_TYPES[f.type].source; draw(); }
    };
    $('#retChips').onclick = e => {
      const b = e.target.closest('[data-ret]'); if (!b) return;
      sh.querySelector('[data-k="ret"]').value = b.dataset.ret;
      sh.querySelectorAll('#retChips .chip').forEach(c => c.classList.toggle('on', c === b));
    };
    $('#aSource').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; read(); f.source = b.dataset.s; sourceTouched = true; draw(); };
    $('#aSave').onclick = () => {
      read();
      if (!f.name) { $('#aName').focus(); toast('צריך לתת שם לחשבון'); return; }
      if (!f.sub) f.sub = INV_TYPES[f.type].subs[0];
      const T = INV_TYPES[f.type];               // drop fields that do not belong to this type
      if (!T.fees) f.feeDep = f.feeBal = null;
      if (!T.split) f.splitEmp = f.splitEr = f.splitSev = null;
      if (!T.term) { f.rate = null; f.maturity = ''; }
      if (acc) { const { id: _, ...patch } = f; change({ t: 'accSet', id: acc.id, patch }); toast('נשמר'); }
      else { change({ t: 'accAdd', acc: Object.assign({ id: uid() }, f) }); toast('החשבון נוסף'); }
      closeSheet();
    };
    if (acc) $('#aDel').onclick = async () => {
      const n = Object.values(data.invest.vals).filter(r => r[acc.id]).length;
      const ok = await confirmBox('מחיקת חשבון', n
        ? `<p>לחשבון <b>${esc(acc.name)}</b> יש נתונים ב-${n} חודשים, והם יימחקו.</p><p class="muted">אם החשבון נסגר, עדיף לסמן אותו כלא פעיל ולשמור את ההיסטוריה.</p>`
        : `<p>למחוק את <b>${esc(acc.name)}</b>?</p>`, 'מחיקה', true);
      if (ok) { closeSheet(); change({ t: 'accDel', id: acc.id }); toast('החשבון נמחק'); }
    };
    if (!acc) $('#aName').focus();
  };
  draw();
}
