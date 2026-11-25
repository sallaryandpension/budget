"use strict";
/* ui.js: toast, side sheet (modal), confirmation dialog, file download, year bar. */

function toast(t) {
  const el = $('#toast'); el.textContent = t; el.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ---------- Sheet (one at a time) ---------- */
let sheetOnClose = null;
function openSheet(html, onClose) {
  const sh = $('#sheet');
  sh.innerHTML = html;
  $('#modal').classList.remove('hidden'); document.body.classList.add('lock');
  sheetOnClose = onClose || null;
  return sh;
}
function closeSheet() {
  if ($('#modal').classList.contains('hidden')) return;
  $('#modal').classList.add('hidden'); $('#sheet').innerHTML = '';
  if ($('#dlg').classList.contains('hidden')) document.body.classList.remove('lock');
  const f = sheetOnClose; sheetOnClose = null; f && f();
  setTimeout(flushDeferredRender, 0);
}
$('#modal').addEventListener('click', e => {
  if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeSheet();
});

/* ---------- Dialog (above the sheet) → Promise(value) ---------- */
let dlgResolve = null;
function dialog(title, html, buttons) {
  return new Promise(res => {
    if (dlgResolve) dlgResolve(null);
    dlgResolve = res;
    const box = $('#dlgBox');
    box.innerHTML = `<h3>${esc(title)}</h3><div class="dlg-text">${html}</div>
      <div class="dlg-btns">${buttons.map((b, i) => `<button type="button" class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>`;
    $('#dlg').classList.remove('hidden'); document.body.classList.add('lock');
    box.querySelectorAll('[data-i]').forEach(b => b.onclick = () => closeDialog(buttons[+b.dataset.i].value));
    // For a destructive choice the safe button (cancel) gets the focus, so Enter does not delete.
    const first = box.querySelector('.btn.danger') ? box.querySelector('.btn.ghost') : (box.querySelector('.btn:not(.ghost)') || box.querySelector('.btn'));
    first && first.focus();
  });
}
function closeDialog(val) {
  $('#dlg').classList.add('hidden');
  if ($('#modal').classList.contains('hidden')) document.body.classList.remove('lock');
  const r = dlgResolve; dlgResolve = null; r && r(val);
  setTimeout(flushDeferredRender, 0);
}
$('#dlg').addEventListener('click', e => { if (e.target.id === 'dlg') closeDialog(null); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('#dlg').classList.contains('hidden')) closeDialog(null);
  else if (!$('#modal').classList.contains('hidden')) closeSheet();
});
const confirmBox = (title, html, okLabel = 'אישור', danger = false) =>
  dialog(title, html, [{ label: okLabel, value: true, cls: danger ? 'danger' : '' }, { label: 'ביטול', value: false, cls: 'ghost' }]);

/* ---------- Files ---------- */
function downloadFile(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

/* ---------- Year bar (shared by the three reports) ---------- */
function currentYearOf(kind) {
  const ys = yearsList(), y = ui.year[kind];
  return y === 'all' || ys.includes(y) ? y : defaultYear();
}
function displayMonths(kind) {
  const y = currentYearOf(kind), all = allMonths();
  return y === 'all' ? all : all.filter(m => m.startsWith(y));
}
function yearBar(kind) {
  const y = currentYearOf(kind);
  const ys = yearsList();
  const opts = [...ys.map(v => [v, v]), ['all', 'הכל']];
  if (ys.length < 2) opts.pop();          // "all" = the only year
  return `<div class="seg years" data-yearbar="${kind}">${opts.map(([v, t]) =>
    `<button type="button" data-y="${v}" class="${v === y ? 'on' : ''}">${t}</button>`).join('')}</div>`;
}
function bindYearBar(el, kind) {
  const bar = el.querySelector(`[data-yearbar="${kind}"]`);
  bar && bar.addEventListener('click', e => {
    const b = e.target.closest('[data-y]'); if (!b) return;
    ui.year[kind] = b.dataset.y; saveUi(); renderView(kind);
  });
}

/* Redraw after a background update without losing the cell the user is in. */
let renderDeferred = false;
function softRender() {
  const a = document.activeElement;
  if (a && a.matches && a.matches('input.cell') && a.dataset.dirty) { renderDeferred = true; return; }
  if (!$('#modal').classList.contains('hidden') || !$('#dlg').classList.contains('hidden')) { renderDeferred = true; return; }
  const key = a && a.dataset ? a.dataset.key : null;
  const scrollers = $$('.gridwrap').map(w => [w.scrollLeft, w.scrollTop]);
  renderCurrent();
  $$('.gridwrap').forEach((w, i) => { if (scrollers[i]) { w.scrollLeft = scrollers[i][0]; w.scrollTop = scrollers[i][1]; } });
  if (key) { const n = $$('input.cell').find(x => x.dataset.key === key); n && n.focus(); }
}
function flushDeferredRender() { if (renderDeferred) { renderDeferred = false; softRender(); } }
document.addEventListener('focusout', () => setTimeout(flushDeferredRender, 0));
