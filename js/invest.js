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
    items, months, flip: !!ui.flip.invest, mode: f === 'b' ? 'balance' : 'sum', itemLabel: 'חשבון',
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
  el.querySelector('[data-a="flip"]').onclick = () => { ui.flip.invest = !ui.flip.invest; saveUi(); renderView('invest'); };
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
      ${line('יתרה אחרונה', lb ? `${moneyHtml(lb.v)} <small class="muted">(${monthNum(lb.m)})</small>` : '')}
      ${a.active === false ? '<div><span>מצב</span>סגור</div>' : ''}
    </div>
    ${a.note ? `<div class="acc-note">${esc(a.note)}</div>` : ''}
    <button type="button" class="btn ghost small" data-edit="${a.id}">✎ עריכה</button>
  </div>`;
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
      <input id="aName" value="${esc(f.name || '')}" maxlength="60" placeholder="${f.type === 'broker' ? 'למשל: IBI, Interactive Brokers' : 'למשל: ' + T.short + ' מור – מסלול מניות'}">
      <div class="row">
        <div><label for="aSub">סוג מוצר</label><select id="aSub">${T.subs.map(s => `<option ${s === f.sub ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
        <div><label for="aOwner">של מי</label><input id="aOwner" value="${esc(f.owner || '')}" maxlength="30" list="ownersList" placeholder="למשל: אני"></div>
      </div>
      <datalist id="ownersList">${[...new Set(data.invest.accs.map(a => a.owner).filter(Boolean))].map(o => `<option value="${esc(o)}">`).join('')}</datalist>
      <div class="row">
        <div><label for="aProv">${f.type === 'broker' ? 'בית השקעות / ברוקר' : 'גוף מנהל'}</label><input id="aProv" value="${esc(f.provider || '')}" maxlength="40"></div>
        <div><label for="aTrack">מסלול השקעה</label><input id="aTrack" value="${esc(f.track || '')}" maxlength="40" placeholder="${f.type === 'broker' ? 'למשל: מדדים' : 'למשל: מניות, S&P 500, תלוי גיל'}"></div>
      </div>
      <div class="row">
        <div><label for="aOpen">חודש פתיחה</label><input type="month" id="aOpen" value="${esc(f.open || '')}"></div>
        <div><label>מאיפה מגיעות ההפקדות</label>
          <div class="seg" id="aSource">${Object.entries(SOURCES).map(([k, v]) => `<button type="button" data-s="${k}" class="${k === f.source ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      </div>
      ${f.type === 'hish' ? '<p class="hint">חודש הפתיחה קובע מתי הקרן נזילה (בדרך כלל אחרי 6 שנים).</p>' : ''}
      <p class="hint">${f.source === 'payroll' ? 'ההפקדה יורדת מהמשכורת ברוטו, ולכן היא לא חלק מהנטו שבדו״ח ההכנסות.' : 'ההפקדה יוצאת מחשבון הבנק, כלומר מהכסף שנשאר אחרי ההוצאות.'}</p>
      ${f.type !== 'broker' ? `
        <label>דמי ניהול</label>
        <div class="row"><div><small class="muted">מההפקדה</small>${num('feeDep', '0')}</div><div><small class="muted">מהצבירה (שנתי)</small>${num('feeBal', '0')}</div></div>
        ${T.split ? `<label>שיעורי הפקדה מהשכר (לא חובה)</label>
        <div class="row three"><div><small class="muted">עובד</small>${num('splitEmp', f.type === 'hish' ? '2.5' : '6')}</div>
          <div><small class="muted">מעסיק</small>${num('splitEr', f.type === 'hish' ? '7.5' : '6.5')}</div>
          <div><small class="muted">פיצויים</small>${num('splitSev', f.type === 'hish' ? '' : '8.33')}</div></div>
        <p class="hint">משמש בהמשך לחישוב הטבות המס ולתחזיות. בטבלה רושמים את סך ההפקדה החודשית.</p>` : ''}` : ''}
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
    $('#aSource').onclick = e => { const b = e.target.closest('[data-s]'); if (!b) return; read(); f.source = b.dataset.s; sourceTouched = true; draw(); };
    $('#aSave').onclick = () => {
      read();
      if (!f.name) { $('#aName').focus(); toast('צריך לתת שם לחשבון'); return; }
      if (!f.sub) f.sub = INV_TYPES[f.type].subs[0];
      if (f.type === 'broker') { f.feeDep = f.feeBal = f.splitEmp = f.splitEr = f.splitSev = null; }
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
