"use strict";
/* =====================================================================
   grid.js: the Excel-like monthly table, shared by expenses, income and investments.
   spec = {
     items:[{id,name,sub,badge,inactive}], months:['YYYY-MM'], flip (months as rows),
     mode:'sum' | 'balance', itemLabel,
     get(m,id) → number|undefined, monthActive(m) → bool, carryBefore(id, m0) → number|null (balance),
     commit([[m,id,v],...]), rerender(), onItem(id)
   }
   Keys: Enter / ↓ next row, Shift+Enter / ↑ previous row, Tab next column, Esc undo the cell.
   Paste a block copied from Excel into a cell → it spreads over the cells like in Excel.
   ===================================================================== */

function gridHtml(spec) {
  const { items, months, flip } = spec;
  const cur = curMonth(), bal = spec.mode === 'balance';
  const withYear = new Set(months.map(m => m.slice(0, 4))).size > 1;
  const mh = m => `<span class="mh">${monthShort(m, withYear)}</span>`;
  const itemH = it => `<button type="button" class="ih" data-item="${esc(it.id)}" title="עריכה">
      <span class="nm">${it.badge || ''}${esc(it.name)}</span>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</button>`;
  const input = (m, it, r, c) => {
    const v = spec.get(m, it.id);
    return `<td class="${m === cur ? 'cur' : ''}"><input class="cell" inputmode="decimal" autocomplete="off" spellcheck="false"
      data-m="${m}" data-i="${esc(it.id)}" data-r="${r}" data-c="${c}" data-key="${m}|${esc(it.id)}" value="${cellText(v)}"
      aria-label="${esc(it.name)} ${monthName(m)}"></td>`;
  };
  const colTotLabel = bal ? 'סה״כ יתרות' : 'סה״כ לחודש';
  let h = `<table class="grid${flip ? ' flip' : ''}${bal ? ' bal' : ''}">`;
  if (!flip) {
    h += `<thead><tr><th class="corner">${esc(spec.itemLabel)}</th>${months.map(m => `<th class="${m === cur ? 'cur' : ''}">${mh(m)}</th>`).join('')}
      ${bal ? '<th class="agg">יתרה אחרונה</th>' : '<th class="agg">ממוצע</th><th class="agg">סה״כ</th>'}</tr></thead><tbody>`;
    items.forEach((it, r) => {
      h += `<tr class="${it.inactive ? 'inactive' : ''}"><th class="rowh">${itemH(it)}</th>${months.map((m, c) => input(m, it, r, c)).join('')}
        ${bal ? `<td class="agg" data-t="last:${esc(it.id)}"></td>` : `<td class="agg" data-t="avg:${esc(it.id)}"></td><td class="agg" data-t="sum:${esc(it.id)}"></td>`}</tr>`;
    });
    h += `</tbody><tfoot><tr><th class="rowh">${colTotLabel}</th>${months.map(m => `<td data-t="col:${m}" class="${m === cur ? 'cur' : ''}"></td>`).join('')}
      ${bal ? '<td class="agg" data-t="glast"></td>' : '<td class="agg" data-t="gavg"></td><td class="agg" data-t="gsum"></td>'}</tr></tfoot>`;
  } else {
    h += `<thead><tr><th class="corner">חודש</th>${items.map(it => `<th class="colh${it.inactive ? ' inactive' : ''}">${itemH(it)}</th>`).join('')}
      <th class="agg">${colTotLabel}</th></tr></thead><tbody>`;
    months.forEach((m, r) => {
      h += `<tr class="${m === cur ? 'cur' : ''}"><th class="rowh">${mh(m)}</th>${items.map((it, c) => input(m, it, r, c)).join('')}
        <td class="agg" data-t="col:${m}"></td></tr>`;
    });
    h += '<tfoot>';
    if (bal) h += `<tr><th class="rowh">יתרה אחרונה</th>${items.map(it => `<td data-t="last:${esc(it.id)}"></td>`).join('')}<td class="agg" data-t="glast"></td></tr>`;
    else h += `<tr class="two"><th class="rowh">ממוצע</th>${items.map(it => `<td data-t="avg:${esc(it.id)}"></td>`).join('')}<td class="agg" data-t="gavg"></td></tr>
      <tr><th class="rowh">סה״כ</th>${items.map(it => `<td data-t="sum:${esc(it.id)}"></td>`).join('')}<td class="agg" data-t="gsum"></td></tr>`;
    h += '</tfoot>';
  }
  return h + '</table>';
}

/* ov = a value being typed but not saved yet, so totals follow the typing live. */
function gridTotals(spec, ov) {
  const get = (m, id) => (ov && ov.m === m && ov.id === id) ? ov.v : spec.get(m, id);
  const { items, months } = spec, out = {}, eff = {};
  if (spec.mode === 'balance') {
    const col = {}, colAny = {};
    for (const it of items) {
      let last = months.length ? spec.carryBefore(it.id, months[0]) : null;
      for (const m of months) {
        const v = get(m, it.id); if (isNum(v)) last = v;
        if (isNum(last)) { eff[m + '|' + it.id] = last; col[m] = (col[m] || 0) + last; colAny[m] = true; }
      }
      out['last:' + it.id] = moneyHtml(last);
    }
    for (const m of months) out['col:' + m] = colAny[m] ? moneyHtml(col[m]) : '';
    const lm = months[months.length - 1];
    out.glast = lm && colAny[lm] ? moneyHtml(col[lm]) : '';
    return { out, eff };
  }
  const active = months.filter(m => spec.monthActive(m) || (ov && ov.m === m && isNum(ov.v)));
  const n = active.length, col = {};
  let g = 0;
  for (const it of items) {
    let s = 0, any = false;
    for (const m of months) { const v = get(m, it.id); if (isNum(v)) { s += v; col[m] = (col[m] || 0) + v; any = true; } }
    g += s;
    out['sum:' + it.id] = any ? moneyHtml(s) : '';
    out['avg:' + it.id] = any && n ? moneyHtml(s / n) : '';
  }
  for (const m of months) out['col:' + m] = active.includes(m) ? moneyHtml(col[m] || 0) : '';
  out.gsum = n ? moneyHtml(g) : '';
  out.gavg = n ? moneyHtml(g / n) : '';
  return { out, eff, n };
}

function fillTotals(table, spec, ov) {
  const t = gridTotals(spec, ov);
  for (const el of table.querySelectorAll('[data-t]')) el.innerHTML = t.out[el.dataset.t] ?? '';
  if (spec.mode === 'balance') for (const inp of table.querySelectorAll('input.cell')) {
    const e = t.eff[inp.dataset.key];
    inp.placeholder = isNum(e) ? NF2.format(e) : '';
  }
  const info = table.closest('.view')?.querySelector('[data-info]');
  if (info) info.textContent = spec.mode === 'balance'
    ? 'תא ריק מציג באפור את היתרה האחרונה הידועה, והיא נכללת בסיכום.'
    : t.n ? `הממוצע מחושב על ${t.n} חודשים שיש בהם נתונים${t.n < spec.months.length ? ` (מתוך ${spec.months.length} המוצגים)` : ''}. תא ריק נחשב 0.`
      : 'עדיין אין נתונים בתקופה המוצגת.';
}

function mountGrid(root, spec) {
  const table = root.querySelector('table.grid');
  if (!table) return;
  fillTotals(table, spec);
  const cellAt = (r, c) => table.querySelector(`input.cell[data-r="${r}"][data-c="${c}"]`);

  function commitCell(inp) {
    const v = parseNum(inp.value);
    if (Number.isNaN(v)) { inp.classList.add('bad'); toast('ערך לא תקין. אפשר מספר או חישוב, למשל 120+80'); return false; }
    delete inp.dataset.dirty; inp.classList.remove('bad');
    inp.value = cellText(v);
    const old = spec.get(inp.dataset.m, inp.dataset.i);
    if ((old ?? null) === (v ?? null)) { fillTotals(table, spec); return true; }
    spec.commit([[inp.dataset.m, inp.dataset.i, v]]);
    fillTotals(table, spec);
    return true;
  }

  table.addEventListener('focusin', e => { if (e.target.matches('input.cell')) e.target.select(); });
  table.addEventListener('input', e => {
    const inp = e.target; if (!inp.matches('input.cell')) return;
    inp.dataset.dirty = '1';
    const v = parseNum(inp.value);
    inp.classList.toggle('bad', Number.isNaN(v));
    if (!Number.isNaN(v)) fillTotals(table, spec, { m: inp.dataset.m, id: inp.dataset.i, v });
  });
  table.addEventListener('change', e => { if (e.target.matches('input.cell')) commitCell(e.target); });
  table.addEventListener('keydown', e => {
    const inp = e.target; if (!inp.matches('input.cell')) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      inp.value = cellText(spec.get(inp.dataset.m, inp.dataset.i));
      delete inp.dataset.dirty; inp.classList.remove('bad'); fillTotals(table, spec); inp.select();
      return;
    }
    let dr = 0;
    if (e.key === 'Enter') dr = e.shiftKey ? -1 : 1;
    else if (e.key === 'ArrowDown') dr = 1;
    else if (e.key === 'ArrowUp') dr = -1;
    if (!dr) return;
    e.preventDefault();
    if (!commitCell(inp)) return;
    const next = cellAt(+inp.dataset.r + dr, +inp.dataset.c);
    next && next.focus();
  });
  table.addEventListener('paste', e => {
    const inp = e.target; if (!inp.matches('input.cell')) return;
    const text = (e.clipboardData || window.clipboardData).getData('text') || '';
    const body = text.replace(/\r/g, '').replace(/\n+$/, '');
    if (!/[\t\n]/.test(body)) return;                 // one value → normal paste
    e.preventDefault();
    const rows = body.split('\n').map(l => l.split('\t'));
    const r0 = +inp.dataset.r, c0 = +inp.dataset.c, list = [];
    let bad = 0, outside = 0;
    rows.forEach((row, i) => row.forEach((s, j) => {
      const t = cellAt(r0 + i, c0 + j);
      if (!t) { if (s.trim()) outside++; return; }
      const v = parseNum(s);
      if (Number.isNaN(v)) { bad++; return; }
      list.push([t.dataset.m, t.dataset.i, v]);
    }));
    delete inp.dataset.dirty;
    if (list.length) spec.commit(list);
    spec.rerender();
    let msg = `הודבקו ${list.length} תאים`;
    if (bad) msg += ` · ${bad} ערכים לא מספריים דולגו`;
    if (outside) msg += ` · ${outside} ערכים מחוץ לטבלה`;
    toast(msg);
    const again = $$('input.cell').find(x => x.dataset.key === inp.dataset.key);   // the table was rebuilt
    again && again.focus();
  });
  table.addEventListener('click', e => {
    const b = e.target.closest('[data-item]');
    if (b && spec.onItem) spec.onItem(b.dataset.item);
  });
  // When the table is wider than the screen, scroll so the current month sits right next to the
  // names column (the browser stops at the end, so on a wide screen earlier months stay visible).
  // With no current month in view, go to the end. In RTL the end is the most negative scrollLeft.
  const wrap = table.closest('.gridwrap');
  if (wrap && !spec.flip && wrap.scrollWidth > wrap.clientWidth) {
    const th = table.querySelector('thead th.cur'), corner = table.querySelector('thead .corner');
    if (th && corner) wrap.scrollLeft += th.getBoundingClientRect().right - corner.getBoundingClientRect().left;
    else wrap.scrollLeft = -wrap.scrollWidth;
  }
  // Months as rows: scroll down so the current month (or the last one) sits just above the totals.
  if (wrap && spec.flip && wrap.scrollHeight > wrap.clientHeight) {
    const tr = table.querySelector('tbody tr.cur') || table.querySelector('tbody tr:last-child');
    const foot = table.tFoot ? table.tFoot.getBoundingClientRect().height : 0;
    const below = tr ? tr.getBoundingClientRect().bottom - (wrap.getBoundingClientRect().bottom - foot) : 0;
    if (below > 0) wrap.scrollTop += below + 4;
  }
}

/* ---------- Expenses / income report page ---------- */
function reportSpec(r) {
  const months = displayMonths(r);
  const items = data[r].cats
    .filter(c => c.active !== false || months.some(m => isNum(data[r].vals[m]?.[c.id])))
    .map(c => ({ id: c.id, name: c.name, inactive: c.active === false }));
  return {
    items, months, flip: monthsAsRows(r), mode: 'sum', itemLabel: 'קטגוריה',
    get: (m, id) => data[r].vals[m]?.[id],
    monthActive: m => monthHasData(r, m),
    commit: list => change({ t: 'cells', r, list }, { render: false }),
    rerender: () => renderView(r),
    onItem: id => openCatManager(r, id),
  };
}

const TIPS_HTML = `<details class="tips"><summary>איך ממלאים מהר</summary><ul>
  <li><b>Enter</b> או <b>↓</b> עוברים לתא הבא למטה, <b>Tab</b> לתא הבא בשורה, ו-<b>Esc</b> מבטל את מה שהוקלד בתא.</li>
  <li>אפשר להקליד חישוב, למשל <span class="ltr">120+80+45</span>, והתא ישמור את התוצאה.</li>
  <li>מעתיקים טווח תאים מאקסל ומדביקים בתא הראשון: הערכים מתפזרים על הטבלה כמו באקסל.</li>
  <li>תא ריק נחשב 0. הממוצע מחושב רק על החודשים שיש בהם נתונים כלשהם.</li>
  <li>לחיצה על שם של שורה פותחת את העריכה שלה. הכפתור ⇄ מחליף בין חודשים בעמודות לחודשים בשורות.</li></ul></details>`;

function renderReport(r) {
  const el = $('#view-' + r), meta = REPORTS[r];
  if (!data[r].cats.length) return renderSetup(r);
  const spec = reportSpec(r);
  el.innerHTML = `
    <div class="pagehead"><h2>${meta.icon} דו״ח ${meta.title}</h2>
      <div class="tools">
        <button type="button" class="btn ghost small" data-a="cats">✎ קטגוריות</button>
        <button type="button" class="btn ghost small" data-a="flip">⇄ ${spec.flip ? 'חודשים בעמודות' : 'חודשים בשורות'}</button>
        <button type="button" class="btn ghost small" data-a="xlout" title="כל הדוחות בקובץ אקסל אחד">⬇ אקסל</button>
        <button type="button" class="btn ghost small" data-a="xlin" title="ייבוא מקובץ אקסל או CSV">⬆ ייבוא</button>
      </div></div>
    ${yearBar(r)}
    ${spec.items.length ? `<div class="gridwrap">${gridHtml(spec)}</div><p class="hint" data-info></p>` : '<div class="empty">כל הקטגוריות מוסתרות. אפשר להפעיל אותן ב״קטגוריות״.</div>'}
    ${TIPS_HTML}`;
  bindYearBar(el, r);
  mountGrid(el, spec);
  el.querySelector('[data-a="cats"]').onclick = () => openCatManager(r);
  el.querySelector('[data-a="flip"]').onclick = () => { ui.flip[r] = !monthsAsRows(r); saveUi(); renderView(r); };
  el.querySelector('[data-a="xlout"]').onclick = exportExcel;
  el.querySelector('[data-a="xlin"]').onclick = pickExcelFile;
}
const IMPORT_HINT = `<div class="import-cta">📊 יש לכם כבר טבלה באקסל? <button type="button" class="btn ghost small" data-xlin>⬆ ייבוא מאקסל</button>
  <button type="button" class="btn ghost small" data-xlout>⬇ קובץ אקסל למילוי</button></div>`;
function bindImportHint(el) {
  el.querySelectorAll('[data-xlin]').forEach(b => b.onclick = pickExcelFile);
  el.querySelectorAll('[data-xlout]').forEach(b => b.onclick = exportExcel);
}

/* First time: choose categories. */
const setupState = {};
function renderSetup(r) {
  const el = $('#view-' + r), meta = REPORTS[r];
  const st = setupState[r] ||= { sel: new Set(meta.preselect), extra: [], start: data.settings.startMonth };
  const names = [...meta.suggest, ...st.extra];
  el.innerHTML = `<div class="card setup">
    <h2>${meta.icon} יצירת דו״ח ${meta.title}</h2>
    <p>${meta.setupText}</p>
    <div class="chips">${names.map(n => `<button type="button" class="chip ${st.sel.has(n) ? 'on' : ''}" data-n="${esc(n)}">${st.sel.has(n) ? '✓ ' : ''}${esc(n)}</button>`).join('')}</div>
    <div class="addrow"><input id="setupAdd" placeholder="קטגוריה נוספת…" maxlength="60"><button type="button" class="btn small" id="setupAddBtn">הוספה</button></div>
    <div class="setup-foot">
      <div><label for="setupStart">החודש הראשון בטבלה</label>
        <input type="month" id="setupStart" value="${st.start}"></div>
      <button type="button" class="btn big" id="setupGo" ${st.sel.size ? '' : 'disabled'}>יצירת הטבלה (${st.sel.size} קטגוריות)</button>
    </div>
    <p class="hint">החודש הראשון משותף לכל הדוחות. הטבלה מתארכת לבד בכל חודש חדש.</p>
    ${IMPORT_HINT}
  </div>`;
  bindImportHint(el);
  el.querySelector('.chips').onclick = e => {
    const b = e.target.closest('[data-n]'); if (!b) return;
    const n = b.dataset.n; st.sel.has(n) ? st.sel.delete(n) : st.sel.add(n); renderSetup(r);
  };
  const add = () => {
    const v = $('#setupAdd').value.trim(); if (!v) return;
    if (!names.includes(v)) st.extra.push(v);
    st.sel.add(v); renderSetup(r); $('#setupAdd').focus();
  };
  $('#setupAddBtn').onclick = add;
  $('#setupAdd').onkeydown = e => { if (e.key === 'Enter') add(); };
  $('#setupStart').onchange = e => { if (validMonth(e.target.value)) st.start = e.target.value; };
  $('#setupGo').onclick = () => {
    const cats = names.filter(n => st.sel.has(n)).map(n => ({ id: uid(), name: n, active: true }));
    if (!cats.length) return;
    if (validMonth(st.start) && st.start !== data.settings.startMonth) change({ t: 'set', k: 'startMonth', v: st.start }, { render: false });
    delete setupState[r];
    change({ t: 'catsAdd', r, cats });
    toast(`נוצרה טבלת ${meta.title} עם ${cats.length} קטגוריות`);
  };
}

/* Category manager: rename, show/hide, reorder, delete, add. */
function openCatManager(r, focusId) {
  const meta = REPORTS[r];
  const draw = () => {
    const cats = data[r].cats;
    const sh = openSheet(`<div class="head"><h3>קטגוריות ${meta.title}</h3><button type="button" class="x" data-close aria-label="סגירה">✕</button></div>
      <div class="catman">${cats.map((c, i) => `
        <div class="catrow ${c.active === false ? 'off' : ''}" data-id="${c.id}">
          <input class="nm" value="${esc(c.name)}" maxlength="60" aria-label="שם הקטגוריה">
          <label class="chk"><input type="checkbox" class="act" ${c.active !== false ? 'checked' : ''}> מוצגת</label>
          <button type="button" class="ib" data-mv="-1" ${i ? '' : 'disabled'} title="למעלה">↑</button>
          <button type="button" class="ib" data-mv="1" ${i < cats.length - 1 ? '' : 'disabled'} title="למטה">↓</button>
          <button type="button" class="ib del" title="מחיקה">🗑</button>
        </div>`).join('')}</div>
      <div class="addrow"><input id="cmAdd" placeholder="קטגוריה חדשה…" maxlength="60"><button type="button" class="btn small" id="cmAddBtn">הוספה</button></div>
      <p class="hint">קטגוריה מוסתרת לא מופיעה בטבלה, אבל הנתונים שלה נשמרים ומוצגים בשנים שיש בהן נתונים.</p>
      <div class="sheet-actions"><button type="button" class="btn" data-close>סיום</button></div>`, () => renderView(r));
    sh.querySelectorAll('.catrow').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('.nm').onchange = e => {
        const v = e.target.value.trim();
        if (v) change({ t: 'catSet', r, id, patch: { name: v } }, { render: false }); else e.target.value = data[r].cats.find(c => c.id === id).name;
      };
      row.querySelector('.act').onchange = e => { change({ t: 'catSet', r, id, patch: { active: e.target.checked } }, { render: false }); row.classList.toggle('off', !e.target.checked); };
      row.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => {
        const ids = data[r].cats.map(c => c.id), i = ids.indexOf(id), j = i + +b.dataset.mv;
        [ids[i], ids[j]] = [ids[j], ids[i]];
        change({ t: 'catOrder', r, ids }, { render: false }); draw();
      });
      row.querySelector('.del').onclick = async () => {
        const c = data[r].cats.find(c => c.id === id);
        const n = Object.values(data[r].vals).filter(row => isNum(row[id])).length;
        const ok = await confirmBox('מחיקת קטגוריה', n
          ? `<p>בקטגוריה <b>${esc(c.name)}</b> יש נתונים ב-${n} חודשים. המחיקה תמחק גם אותם.</p><p class="muted">אם הקטגוריה פשוט לא רלוונטית יותר, עדיף להסתיר אותה ולשמור את הנתונים.</p>`
          : `<p>למחוק את <b>${esc(c.name)}</b>?</p>`, 'מחיקה', true);
        if (ok) { change({ t: 'catDel', r, id }, { render: false }); draw(); }
      };
    });
    const add = () => {
      const v = $('#cmAdd').value.trim(); if (!v) return;
      change({ t: 'catsAdd', r, cats: [{ id: uid(), name: v, active: true }] }, { render: false });
      draw(); $('#cmAdd').focus();
    };
    $('#cmAddBtn').onclick = add;
    $('#cmAdd').onkeydown = e => { if (e.key === 'Enter') add(); };
    if (focusId) { const row = sh.querySelector(`.catrow[data-id="${focusId}"]`); if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('.nm').focus(); } focusId = null; }
  };
  draw();
}
