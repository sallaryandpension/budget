"use strict";
/* =====================================================================
   excel.js: export every report to one .xlsx workbook, and import from .xlsx / .csv.
   No libraries: an .xlsx file is a zip of XML files. Export writes uncompressed
   ("stored") zip entries; import inflates with the browser's DecompressionStream.

   Import works with the exported template AND with a home-made budget sheet:
   it finds the months (a row or a column of dates / month names), takes every other
   column (or row) as an item, recognizes calculated columns (formulas that refer to
   other cells, totals, averages) and lets the user choose, per item, where it goes.
   ===================================================================== */

/* ---------- zip ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

function zipStore(files, type) {            // files: [{ name, text }]
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name), dat = enc.encode(f.text), crc = crc32(dat), size = dat.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, dat);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type });
}

async function unzip(buf) {
  const dv = new DataView(buf), len = buf.byteLength;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('הקובץ אינו קובץ אקסל תקין (xlsx)');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {}, dec = new TextDecoder();
  for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commLen = dv.getUint16(p + 32, true);
    files[dec.decode(new Uint8Array(buf, p + 46, nameLen))] = { method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), lho: dv.getUint32(p + 42, true) };
    p += 46 + nameLen + extraLen + commLen;
  }
  return {
    async text(name) {
      const f = files[name]; if (!f) return null;
      const start = f.lho + 30 + dv.getUint16(f.lho + 26, true) + dv.getUint16(f.lho + 28, true);
      const raw = new Uint8Array(buf, start, f.csize);
      let bytes;
      if (f.method === 0) bytes = raw;
      else if (f.method === 8) {
        if (typeof DecompressionStream === 'undefined') throw new Error('הדפדפן הזה לא יודע לפתוח קובצי אקסל. נסו Chrome, Edge או Safari עדכני');
        bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      } else throw new Error('שיטת דחיסה לא נתמכת בקובץ');
      return new TextDecoder().decode(bytes);
    },
  };
}

/* ---------- export ---------- */
const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
function colName(i) { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = Math.floor((i - 1) / 26); } return s; }

/* rows: arrays of string | number | null. Row 1 is the bold header; `frozen` label columns stay in view. */
function sheetXml(rows, frozen, widths) {
  const width = Math.max(...rows.map(r => r.length));
  let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
  x += `<sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane xSplit="${frozen}" ySplit="1" topLeftCell="${colName(frozen)}2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>`;
  x += '<sheetFormatPr defaultRowHeight="15"/><cols>';
  widths.forEach((w, i) => { x += `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`; });
  if (width > widths.length) x += `<col min="${widths.length + 1}" max="${width}" width="13" customWidth="1"/>`;
  x += '</cols><sheetData>';
  rows.forEach((row, r) => {
    x += `<row r="${r + 1}">`;
    row.forEach((v, c) => {
      if (v == null || v === '') return;
      const ref = colName(c) + (r + 1), s = r === 0 ? ' s="1"' : (c < frozen ? ' s="2"' : '');
      if (typeof v === 'number' && isFinite(v)) x += `<c r="${ref}"${s}><v>${v}</v></c>`;
      else x += `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
    });
    x += '</row>';
  });
  return x + '</sheetData></worksheet>';
}
function buildXlsx(sheets) {                 // sheets: [{ name, xml }]
  const NS = 'http://schemas.openxmlformats.org';
  const files = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="${NS}/spreadsheetml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${NS}/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="${NS}/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EFE9"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: s.xml })),
  ];
  return zipStore(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

const XL_SHEETS = { expenses: 'הוצאות', income: 'הכנסות', dep: 'השקעות - הפקדות', bal: 'השקעות - יתרות' };
function exportMonths() {
  const [a, b] = rangeBounds(), dec = curMonth().slice(0, 4) + '-12';
  return monthRange(a, b > dec ? b : dec);    // through December, so the file can keep being filled
}
function exportExcel() {
  const months = exportMonths(), heads = months.map(monthName), sheets = [];
  for (const r of ['expenses', 'income']) {
    const cats = data[r].cats.length ? data[r].cats : REPORTS[r].suggest.map(name => ({ name }));
    const rows = [['קטגוריה', ...heads], ...cats.map(c => [c.name, ...months.map(m => c.id ? data[r].vals[m]?.[c.id] ?? null : null)])];
    sheets.push({ name: XL_SHEETS[r], xml: sheetXml(rows, 1, [30]) });
  }
  const accs = sortedAccs();
  const list = accs.length ? accs : INV_ORDER.map(t => ({ name: INV_TYPES[t].name, type: t }));
  for (const f of ['d', 'b']) {
    const rows = [['חשבון', 'סוג', ...heads], ...list.map(a => [a.name, INV_TYPES[a.type].name, ...months.map(m => a.id ? invCell(m, a.id)?.[f] ?? null : null)])];
    sheets.push({ name: XL_SHEETS[f === 'd' ? 'dep' : 'bal'], xml: sheetXml(rows, 2, [26, 18]) });
  }
  downloadFile(`budget-${todayStr()}.xlsx`, buildXlsx(sheets));
  toast('הקובץ ירד. אפשר למלא אותו באקסל ולייבא בחזרה');
}

/* ---------- read .xlsx / .csv into grids ---------- */
// cell = { v: string|number, ref: formula that refers to other cells, date: date-formatted number }
const BUILTIN_DATE_FMTS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81]);
const isDateCode = code => /[dmy]/i.test(code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, ''));
const xmlDoc = t => new DOMParser().parseFromString(t, 'application/xml');
const cellIndex = ref => { let n = 0; for (const ch of ref) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) break; n = n * 26 + c - 64; } return n - 1; };

async function readXlsx(buf) {
  const z = await unzip(buf);
  const shared = [];
  const sst = await z.text('xl/sharedStrings.xml');
  if (sst) for (const si of xmlDoc(sst).getElementsByTagName('si'))
    shared.push([...si.getElementsByTagName('t')].filter(t => t.parentNode.nodeName !== 'rPh').map(t => t.textContent).join(''));
  const dateStyle = [];
  const st = await z.text('xl/styles.xml');
  if (st) {
    const doc = xmlDoc(st), custom = {};
    for (const nf of doc.getElementsByTagName('numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || '';
    const xfs = doc.getElementsByTagName('cellXfs')[0];
    if (xfs) [...xfs.getElementsByTagName('xf')].forEach((xf, i) => {
      const id = +xf.getAttribute('numFmtId');
      dateStyle[i] = BUILTIN_DATE_FMTS.has(id) || (custom[id] != null && isDateCode(custom[id]));
    });
  }
  const wb = xmlDoc(await z.text('xl/workbook.xml'));
  const rels = xmlDoc(await z.text('xl/_rels/workbook.xml.rels'));
  const target = {};
  for (const r of rels.getElementsByTagName('Relationship')) target[r.getAttribute('Id')] = r.getAttribute('Target');
  const out = [];
  for (const s of wb.getElementsByTagName('sheet')) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let path = target[rid]; if (!path) continue;
    path = path.startsWith('/') ? path.slice(1) : 'xl/' + path.replace(/^\.\//, '');
    const xml = await z.text(path); if (!xml) continue;
    const grid = [];
    for (const row of xmlDoc(xml).getElementsByTagName('row')) {
      const r = +row.getAttribute('r') - 1;
      const line = grid[r] = [];
      let auto = 0;
      for (const c of row.getElementsByTagName('c')) {
        const refAttr = c.getAttribute('r'), ci = refAttr ? cellIndex(refAttr) : auto;
        auto = ci + 1;
        const t = c.getAttribute('t'), vEl = c.getElementsByTagName('v')[0], fEl = c.getElementsByTagName('f')[0];
        let v = vEl ? vEl.textContent : null;
        if (t === 's') v = shared[+v] ?? '';
        else if (t === 'inlineStr') v = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (t === 'e' || t === 'b') v = null;
        else if (t !== 'str' && v != null && v !== '' && isFinite(+v)) v = +v;
        if (v == null || v === '') continue;
        const ftext = fEl ? fEl.textContent : '';
        const ref = !!fEl && (/\$?[A-Z]{1,3}\$?\d+/.test(ftext) || (fEl.getAttribute('t') === 'shared' && !ftext));
        line[ci] = { v, ref, date: typeof v === 'number' && !!dateStyle[+c.getAttribute('s') || 0] };
      }
    }
    out.push({ name: s.getAttribute('name') || 'גיליון', grid });
  }
  return out;
}
function decodeText(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch (e) { return new TextDecoder('windows-1255').decode(buf); }   // Excel "CSV" on a Hebrew Windows
}
function readCsv(text, name) {
  const first = text.split(/\r?\n/, 1)[0];
  const delim = ['\t', ';', ','].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const grid = []; let row = [], cur = '', q = false;
  const push = () => { const s = cur.trim(); if (s !== '') row[row.length] = { v: s, ref: false, date: false }; else row.length++; cur = ''; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) push();
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; push(); grid.push(row); row = []; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { push(); grid.push(row); }
  return [{ name, grid }];
}

/* ---------- find months and items in a grid ---------- */
const HEB_MONTHS = { 'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'מרס': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6, 'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12,
  'ינו': 1, 'פבר': 2, 'אפר': 4, 'יונ': 6, 'יול': 7, 'אוג': 8, 'ספט': 9, 'אוק': 10, 'נוב': 11, 'דצמ': 12 };
const ENG_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const fullYear = s => s.length === 2 ? 2000 + +s : +s;
const okMonth = (y, m) => m >= 1 && m <= 12 && (y === null || (y > 1950 && y < 2150)) ? { y, m } : null;
function parseMonthText(s) {
  s = String(s).replace(/[‎‏‪-‮]/g, '').trim();
  let x;
  if ((x = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(s))) return okMonth(+x[1], +x[2]);
  if ((x = /^\d{1,2}[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(s))) return okMonth(fullYear(x[2]), +x[1]);
  if ((x = /^(\d{1,2})[-/.](\d{4}|\d{2})$/.exec(s))) return okMonth(fullYear(x[2]), +x[1]);
  const t = s.toLowerCase().replace(/[׳'"״.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if ((x = /^([א-ת]+|[a-z]+)(?:[ -]+(\d{4}|\d{2}))?$/.exec(t))) {
    const w = x[1];
    let m = HEB_MONTHS[w] || 0;
    if (!m && /^[a-z]+$/.test(w) && w.length >= 3) { const i = ENG_MONTHS.indexOf(w.slice(0, 3)); if (i >= 0 && ('january february march april may june july august september october november december sept'.split(' ').some(n => n.startsWith(w)))) m = i + 1; }
    if (m) return okMonth(x[2] ? fullYear(x[2]) : null, m);
  }
  return null;
}
function serialMonth(n) {
  if (n < 20000 || n > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * 86400000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}
const monthOf = cell => !cell ? null : typeof cell.v === 'number' ? (cell.date ? serialMonth(cell.v) : null) : parseMonthText(cell.v);
const TOTAL_RE = /סה.?כ|סכ.?ה|סך הכל|סיכום|ממוצע|מצטבר|אחוז|total|sum|average|%/i;
const cellNum = cell => !cell ? null : typeof cell.v === 'number' ? cell.v : (() => { const n = parseNum(cell.v); return Number.isNaN(n) ? null : n; })();

function analyzeSheet(sh) {
  const g = sh.grid, rowCount = {}, colCount = {};
  g.forEach((row, r) => row && row.forEach((cell, c) => { if (monthOf(cell)) { rowCount[r] = (rowCount[r] || 0) + 1; colCount[c] = (colCount[c] || 0) + 1; } }));
  const best = o => Object.entries(o).reduce((b, [k, n]) => n > b.n ? { i: +k, n } : b, { i: -1, n: 0 });
  const br = best(rowCount), bc = best(colCount);
  if (Math.max(br.n, bc.n) < 2) return { name: sh.name, error: 'לא נמצאה שורה או עמודה של חודשים' };
  const byRows = bc.n > br.n;                         // months run down a column
  const at = (line, slot) => byRows ? g[line]?.[slot] : g[slot]?.[line];
  const axis = byRows ? bc.i : br.i;
  const width = g.reduce((w, r) => Math.max(w, r ? r.length : 0), 0);   // reduce skips the missing rows
  const maxLine = byRows ? g.length : width;
  const maxSlot = byRows ? width : g.length;
  const lines = [];                                  // the month lines
  for (let l = 0; l < maxLine; l++) { const mo = monthOf(byRows ? g[l]?.[axis] : g[axis]?.[l]); if (mo) lines.push({ l, ...mo }); }
  // Header line = the line before the first month line with the most text (the item names).
  // A line titled "סוג" (the account type column of the exported template) is kept apart.
  let head = -1, headN = 0, typeLine = -1;
  for (let l = 0; l < lines[0].l; l++) {
    if (String(at(l, axis)?.v ?? '').trim() === 'סוג') { typeLine = l; continue; }
    let n = 0; for (let s = 0; s < maxSlot; s++) { const c = at(l, s); if (c && typeof c.v === 'string' && !monthOf(c)) n++; }
    if (n >= headN && n > 0) { head = l; headN = n; }
  }
  const items = [], seen = {};
  for (let s = 0; s < maxSlot; s++) {
    if (s === axis) continue;
    const vals = {}; let n = 0, refs = 0, total = 0;
    lines.forEach((ln, i) => {
      const c = at(ln.l, s), v = cellNum(c);
      if (v == null) return;
      vals[i] = v; n++; total += v; if (c.ref) refs++;
    });
    if (!n) continue;
    const hc = head >= 0 ? at(head, s) : null;
    let name = hc && hc.v !== '' ? String(hc.v).trim() : (byRows ? `עמודה ${colName(s)}` : `שורה ${s + 1}`);
    const k = normName(name);
    if (seen[k]) name += ` (${++seen[k]})`; else seen[k] = 1;   // two columns called "אחר" stay apart unless the user merges them
    const typeText = typeLine >= 0 ? String(at(typeLine, s)?.v ?? '') : '';
    items.push({ slot: s, name, vals, n, total, derived: refs / n >= 0.5 || TOTAL_RE.test(name), typeText: typeText.trim() });
  }
  return { name: sh.name, byRows, lines, items };
}
/* Months written without a year ("ינואר", "פברואר"…) get one: the year in the sheet name, or the user's
   answer; the year goes up whenever the month number goes down (e.g. a Sep–Aug sheet). */
function resolveYears(an, baseYear) {
  let y = baseYear, prev = 0;
  for (const ln of an.lines) {
    if (ln.y != null) { y = ln.y; prev = ln.m; ln.key = ym(ln.y, ln.m); continue; }
    if (prev && ln.m < prev) y++;
    prev = ln.m; ln.key = ym(y, ln.m);
  }
}

/* ---------- import screen ---------- */
const TARGETS = [['expenses', 'הוצאות'], ['income', 'הכנסות'], ['dep', 'השקעות: הפקדה'], ['bal', 'השקעות: יתרה'], ['skip', 'לא לייבא']];
const normName = s => String(s || '').replace(/[״"''׳`]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
function guessTarget(sheetName, name) {
  if (/יתר/.test(sheetName)) return 'bal';
  if (/הפקד|השקע/.test(sheetName)) return 'dep';
  if (/הכנס/.test(sheetName)) return 'income';
  if (/הוצא/.test(sheetName)) return 'expenses';
  if (/עו"ש|עו״ש|יתרת? בנק/.test(name)) return 'bal';
  if (/גמל|השתלמות|פנסי|השקעה|ברוקר|תיק השקעות|מניות|פיקדון|פקדון|פק"מ|פק״מ|פוליס|קריפטו|ביטקוין|קרן כספית|נדל"ן|נדל״ן|RSU/.test(name)) return 'dep';
  if (/משכורת|שכר|הכנסה|החזר|קצב|מענק|בונוס|דיבידנד|ריבית/.test(name)) return 'income';
  return 'expenses';
}
function guessType(name, typeText) {
  for (const t of INV_ORDER) if (typeText && (typeText === INV_TYPES[t].name || typeText === INV_TYPES[t].short)) return t;
  const s = name + ' ' + (typeText || '');
  return /פנסי|מנהלים/.test(s) ? 'pension' : /השתלמות/.test(s) ? 'hish' : /גמל/.test(s) ? 'gemel'
    : /פוליס/.test(s) ? 'policy' : /פיקדון|פקדון|פק"מ|פק״מ|חיסכון בבנק|תוכנית חיסכון/.test(s) ? 'deposit'
    : /עו"ש|עו״ש|עוש|מזומן/.test(s) ? 'cash' : /נדל|דירה|קרקע|ריט/.test(s) ? 'realestate'
    : /קריפטו|ביטקוין|זהב|קרן כספית|מט"ח|מט״ח|RSU/.test(s) ? 'other' : 'broker';
}
function existingFor(target) {
  if (target === 'expenses' || target === 'income') return data[target].cats.map(c => ({ id: c.id, name: c.name }));
  if (target === 'dep' || target === 'bal') return data.invest.accs.map(a => ({ id: a.id, name: a.name }));
  return [];
}

function pickExcelFile() {
  let inp = $('#xlFile');
  if (!inp) {
    inp = document.createElement('input');
    inp.type = 'file'; inp.id = 'xlFile'; inp.hidden = true; inp.accept = '.xlsx,.xlsm,.csv,.txt';
    document.body.appendChild(inp);
    inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (f) importFile(f); };
  }
  inp.click();
}

async function importFile(file) {
  let sheets;
  try {
    const buf = await file.arrayBuffer();
    if (/\.xls$/i.test(file.name)) throw new Error('קובצי ‎.xls‎ ישנים לא נתמכים. שמרו את הקובץ באקסל בפורמט ‎.xlsx‎ ונסו שוב');
    const isZip = buf.byteLength > 4 && new DataView(buf).getUint32(0, true) === 0x04034b50;
    sheets = isZip ? await readXlsx(buf) : readCsv(decodeText(buf), file.name.replace(/\.[^.]+$/, ''));
  } catch (e) { toast('⚠️ ' + (e.message || 'לא הצלחתי לקרוא את הקובץ')); return; }
  const analyses = sheets.map(analyzeSheet);
  const ok = analyses.filter(a => !a.error && a.items.length);
  if (!ok.length) { toast('⚠️ לא מצאתי בקובץ טבלה עם חודשים'); return; }
  for (const an of ok) {
    if (an.lines.some(l => l.y == null)) {
      const inName = /(19|20)\d{2}/.exec(an.name);
      let y = inName ? +inName[0] : null;
      if (!y) {
        const cy = +curMonth().slice(0, 4);
        y = await dialog('באיזו שנה?', `<p>בגיליון <b>${esc(an.name)}</b> החודשים כתובים בלי שנה. מאיזו שנה הוא מתחיל?</p>`,
          [cy, cy - 1, cy - 2, cy - 3].map(v => ({ label: String(v), value: v, cls: v === cy ? '' : 'ghost' })));
        if (!y) return;
      }
      resolveYears(an, y);
    } else resolveYears(an, 0);
    for (const it of an.items) {
      // A name the app already has decides the target (e.g. "שכירות" that was put under income last time).
      const known = ['expenses', 'income', 'dep'].filter(t => existingFor(t).some(x => normName(x.name) === normName(it.name)));
      const guess = guessTarget(an.name, it.name);
      it.target = it.derived ? 'skip' : known.length === 1 ? (known[0] === 'dep' && guess === 'bal' ? 'bal' : known[0]) : guess;
      it.type = guessType(it.name, it.typeText);
      const ex = existingFor(it.target).find(x => normName(x.name) === normName(it.name));
      it.as = ex ? ex.name : it.name;
    }
  }
  openImportSheet(file.name, ok, analyses.filter(a => a.error).map(a => a.name));
}

/* Builds the list of changes from the current choices (also used for the live summary). */
function planImport(sheets, withFuture) {
  const plan = { newCats: { expenses: [], income: [] }, newAccs: [], cells: { expenses: [], income: [] }, inv: [], overwrite: 0, count: 0, months: new Set(), future: 0 };
  const cur = curMonth();
  const acc = {};                                     // target|name|month → summed value (same name = merged)
  const byName = {};
  for (const an of sheets) for (const it of an.items) {
    if (it.target === 'skip' || !it.as.trim()) continue;
    const key = it.target + '|' + normName(it.as);
    byName[key] ||= { target: it.target, name: it.as.trim(), type: it.type };
    for (const [i, v] of Object.entries(it.vals)) {
      const m = an.lines[i].key;
      if (m > cur && !withFuture) { plan.future++; continue; }   // planned payments in months that have not come yet
      acc[key + '|' + m] = (acc[key + '|' + m] || 0) + v;
    }
  }
  const idFor = {};
  for (const [key, x] of Object.entries(byName)) {
    const ex = existingFor(x.target).find(e => normName(e.name) === normName(x.name));
    if (ex) { idFor[key] = ex.id; continue; }
    if (x.target === 'expenses' || x.target === 'income') {
      const cat = { id: uid(), name: x.name, active: true };
      plan.newCats[x.target].push(cat); idFor[key] = cat.id;
    } else {
      const other = (x.target === 'dep' ? 'bal' : 'dep') + '|' + normName(x.name);
      if (idFor[other]) { idFor[key] = idFor[other]; continue; }     // deposits and balances of the same new account
      const T = INV_TYPES[x.type];
      const a = { id: uid(), name: x.name, type: x.type, sub: T.subs[0], source: T.source, active: true };
      plan.newAccs.push(a); idFor[key] = a.id;
    }
  }
  for (const [k, v0] of Object.entries(acc)) {
    const v = r2(v0), cut = k.lastIndexOf('|'), key = k.slice(0, cut), m = k.slice(cut + 1);
    const { target } = byName[key], id = idFor[key];
    plan.count++; plan.months.add(m);
    if (target === 'expenses' || target === 'income') {
      const old = data[target].vals[m]?.[id];
      if (isNum(old) && old !== v) plan.overwrite++;
      plan.cells[target].push([m, id, v]);
    } else {
      const f = target === 'dep' ? 'd' : 'b', old = invCell(m, id)?.[f];
      if (isNum(old) && old !== v) plan.overwrite++;
      plan.inv.push([m, id, f, v]);
    }
  }
  return plan;
}

function openImportSheet(fileName, sheets, skipped) {
  const optList = cur => TARGETS.map(([v, t]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${t}</option>`).join('');
  const typeList = cur => INV_ORDER.map(t => `<option value="${t}" ${t === cur ? 'selected' : ''}>${INV_TYPES[t].name}</option>`).join('');
  const sh = openSheet(`<div class="head"><h3>⬆ ייבוא מאקסל</h3><button type="button" class="x" data-close aria-label="סגירה">✕</button></div>
    <p class="muted">${esc(fileName)}. לכל ${sheets.some(s => s.byRows) ? 'עמודה' : 'שורה'} בחרו לאן היא נכנסת. עמודות של חישובים (סכומים, ממוצעים, נוסחאות שמחשבות מעמודות אחרות) מסומנות ״לא לייבא״ כדי שלא ייספרו פעמיים.</p>
    ${skipped.length ? `<p class="hint">גיליונות בלי חודשים דולגו: ${skipped.map(esc).join(', ')}</p>` : ''}
    ${sheets.map((an, si) => `<section class="imp-sheet">
      <h4>גיליון ״${esc(an.name)}״ <small class="muted">· ${an.byRows ? 'החודשים בשורות' : 'החודשים בעמודות'} · ${an.lines.length} חודשים (${monthName(an.lines[0].key)} – ${monthName(an.lines[an.lines.length - 1].key)})</small></h4>
      <div class="tablewrap"><table class="imp"><thead><tr><th>${an.byRows ? 'עמודה' : 'שורה'} באקסל</th><th class="n">חודשים</th><th class="n">סה״כ</th><th>לאן</th><th>שם באפליקציה</th></tr></thead><tbody>
      ${an.items.map((it, ii) => `<tr data-s="${si}" data-i="${ii}" class="${it.target === 'skip' ? 'off' : ''}">
        <td>${esc(it.name)}${it.derived ? ' <span class="tag">חישוב</span>' : ''}</td>
        <td class="n">${it.n}</td><td class="n">${moneyHtml(it.total)}</td>
        <td><select class="tgt">${optList(it.target)}</select></td>
        <td class="asc"><input class="as" value="${esc(it.as)}" maxlength="60"><select class="typ" title="סוג החשבון">${typeList(it.type)}</select><span class="state"></span></td></tr>`).join('')}
      </tbody></table></div></section>`).join('')}
    <datalist id="impNames"></datalist>
    <label class="chk imp-future hidden"><input type="checkbox" id="impFuture"> לייבא גם חודשים עתידיים (אחרי ${monthName(curMonth())})</label>
    <div class="imp-sum" id="impSum"></div>
    <p class="hint">ערכים קיימים באפליקציה באותו חודש ובאותה קטגוריה יוחלפו. תאים ריקים לא משנים כלום. שתי עמודות עם אותו שם ואותו יעד מתאחדות (הסכומים מתחברים).</p>
    <div class="sheet-actions"><button type="button" class="btn ghost" data-close>ביטול</button><button type="button" class="btn" id="impGo">ייבוא</button></div>`);
  sh.classList.add('wide');
  const refresh = () => {
    sh.querySelectorAll('tr[data-s]').forEach(tr => {
      const it = sheets[+tr.dataset.s].items[+tr.dataset.i];
      tr.classList.toggle('off', it.target === 'skip');
      const ex = existingFor(it.target).some(x => normName(x.name) === normName(it.as));
      const inv = it.target === 'dep' || it.target === 'bal';
      tr.querySelector('.typ').hidden = !inv || ex;
      tr.querySelector('.as').disabled = it.target === 'skip';
      tr.querySelector('.state').textContent = it.target === 'skip' ? '' : ex ? 'קיים' : 'חדש';
      tr.querySelector('.state').className = 'state ' + (ex ? 'old' : 'new');
    });
    const withFuture = $('#impFuture').checked;
    const p = planImport(sheets, withFuture);
    const nc = p.newCats.expenses.length + p.newCats.income.length;
    const ms = [...p.months].sort();
    $('.imp-future').classList.toggle('hidden', !p.future && !withFuture);
    $('#impSum').innerHTML = p.count
      ? `ייובאו <b>${p.count}</b> ערכים ב-${ms.length} חודשים (${monthName(ms[0])} – ${monthName(ms[ms.length - 1])}).
         ${nc ? `קטגוריות חדשות: ${nc}.` : ''} ${p.newAccs.length ? `חשבונות השקעה חדשים: ${p.newAccs.length}.` : ''}
         ${p.overwrite ? `<b>${p.overwrite}</b> ערכים קיימים יוחלפו.` : ''}
         ${p.future ? `${p.future} ערכים בחודשים עתידיים לא ייובאו.` : ''}`
      : 'לא נבחר שום דבר לייבוא.';
    $('#impGo').disabled = !p.count;
  };
  sh.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-s]'); if (!tr) return;
    const it = sheets[+tr.dataset.s].items[+tr.dataset.i];
    if (e.target.matches('.tgt')) {
      it.target = e.target.value;
      const ex = existingFor(it.target).find(x => normName(x.name) === normName(it.as));
      if (ex) { it.as = ex.name; tr.querySelector('.as').value = ex.name; }
    } else if (e.target.matches('.typ')) it.type = e.target.value;
    else if (e.target.matches('.as')) it.as = e.target.value.trim();
    refresh();
  });
  sh.addEventListener('input', e => {
    if (!e.target.matches('.as')) return;
    const tr = e.target.closest('tr[data-s]'), it = sheets[+tr.dataset.s].items[+tr.dataset.i];
    it.as = e.target.value; refresh();
  });
  sh.addEventListener('focusin', e => {          // suggest the existing names of the chosen target
    if (!e.target.matches('.as')) return;
    const tr = e.target.closest('tr[data-s]'), it = sheets[+tr.dataset.s].items[+tr.dataset.i];
    $('#impNames').innerHTML = existingFor(it.target).map(x => `<option value="${esc(x.name)}">`).join('');
    e.target.setAttribute('list', 'impNames');
  });
  $('#impFuture').onchange = refresh;
  $('#impGo').onclick = () => {
    const p = planImport(sheets, $('#impFuture').checked);
    if (!p.count) return;
    for (const r of ['expenses', 'income']) if (p.newCats[r].length) change({ t: 'catsAdd', r, cats: p.newCats[r] }, { render: false });
    for (const a of p.newAccs) change({ t: 'accAdd', acc: a }, { render: false });
    for (const r of ['expenses', 'income']) if (p.cells[r].length) change({ t: 'cells', r, list: p.cells[r] }, { render: false });
    if (p.inv.length) change({ t: 'inv', list: p.inv }, { render: false });
    const first = [...p.months].sort()[0];
    if (first < data.settings.startMonth) change({ t: 'set', k: 'startMonth', v: first }, { render: false });
    closeSheet();
    toast(`יובאו ${p.count} ערכים ✓`);
    if (location.hash === '#home' || !location.hash) renderCurrent(); else location.hash = '#home';
  };
  refresh();
}
