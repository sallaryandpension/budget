"use strict";
/* =====================================================================
   charts.js: small charts without a library, built to the dataviz rules:
   thin marks (bars <= 24px), 4px rounded data-end and a square baseline, 2px surface
   gaps between stacked segments, hairline grid, one y-axis, a legend for 2+ series,
   a hover/focus tooltip per month (every series at that month), and a table view
   under every chart. Colors are CSS variables, so light and dark mode switch by themselves.
     columnChart : columns per month, grouped / stacked / one series colored by sign
     rankBars    : ranked horizontal bars (HTML), optionally diverging around zero
     segBar      : one whole split into parts (tall segmented bar)
   ===================================================================== */

const SVGNS = 'http://www.w3.org/2000/svg';
function compactMoney(v) {
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1e6) return s + '₪' + (a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return s + '₪' + Math.round(a / 1e3) + 'K';
  return s + '₪' + NF0.format(Math.round(a));
}
/* One style per axis: compact (₪5K, ₪10K) as soon as the axis reaches 10,000, full figures below it. */
function axisFormatter(ticks) {
  const top = Math.max(...ticks.map(Math.abs));
  const [div, unit] = top >= 1e6 ? [1e6, 'M'] : top >= 1e4 ? [1e3, 'K'] : [1, ''];
  return t => t === 0 ? '₪0' : (t < 0 ? '-' : '') + '₪' + (div === 1 ? NF0 : NF2).format(Math.abs(t) / div) + unit;
}
function niceTicks(min, max, count = 4) {
  if (min === max) max = min + 1;
  const step0 = (max - min) / count, mag = Math.pow(10, Math.floor(Math.log10(step0))), r = step0 / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step, ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return { lo, hi, ticks };
}
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
/* A bar with a 4px rounded data-end and a square end on the baseline. */
function barPath(x, w, yBase, yEnd) {
  const h = Math.abs(yEnd - yBase); if (h < 0.5 || w < 0.5) return '';
  const r = Math.min(4, w / 2, h);
  if (yEnd < yBase) return `M${x},${yBase}V${yEnd + r}Q${x},${yEnd} ${x + r},${yEnd}H${x + w - r}Q${x + w},${yEnd} ${x + w},${yEnd + r}V${yBase}Z`;
  return `M${x},${yBase}V${yEnd - r}Q${x},${yEnd} ${x + r},${yEnd}H${x + w - r}Q${x + w},${yEnd} ${x + w},${yEnd - r}V${yBase}Z`;
}

function legendHtml(series, shape = 'rect') {
  if (series.length < 2) return '';
  return `<div class="ch-legend">${series.map(s => `<span><i class="${shape}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}
function tableHtml(head, rows) {
  return `<details class="ch-table"><summary>הצגה כטבלה</summary><div class="tablewrap"><table class="stat"><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map((c, i) => `<td${i ? ' class="n"' : ''}>${i ? (isNum(c) ? money(c) : '—') : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
}

/* Tooltip shared by a chart host. rows: [{name, color, value}] → value first (strong), name after. */
function showTip(host, x, title, rows, fmt) {
  let tip = host.querySelector('.ch-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'ch-tip'; host.appendChild(tip); }
  tip.replaceChildren();
  const t = document.createElement('div'); t.className = 't'; t.textContent = title; tip.appendChild(t);
  for (const r of rows) {
    const row = document.createElement('div'); row.className = 'r';
    const key = document.createElement('i'); key.style.background = r.color;
    const v = document.createElement('b'); v.textContent = isNum(r.value) ? fmt(r.value) : '—';
    const n = document.createElement('span'); n.textContent = r.name;
    row.append(key, v, n); tip.appendChild(row);
  }
  tip.style.display = 'block';
  const hw = host.clientWidth, tw = tip.offsetWidth;
  tip.style.left = Math.max(4, Math.min(hw - tw - 4, x - tw / 2)) + 'px';
}
const hideTip = host => { const t = host.querySelector('.ch-tip'); if (t) t.style.display = 'none'; };

/* Columns per category (month).
   series: [{ name, color, values:[number|null] }]; stacked: segments on top of each other;
   polarity: { pos, neg } colors one series by sign (above / below zero). */
function columnChart(host, { cats, labels, titles, series, stacked = false, polarity = null, height = 210, fmt = money }) {
  host.classList.add('ch-host');
  const W = Math.max(300, host.clientWidth), padL = 58, padR = 10, padT = 12, axisH = 26;
  const plotW = W - padL - padR, H = padT + height + axisH, n = cats.length, bw = plotW / n;
  let min = 0, max = 0;
  cats.forEach((_, i) => {
    if (stacked) {
      let p = 0, q = 0; for (const s of series) { const v = s.values[i]; if (isNum(v)) v >= 0 ? p += v : q += v; }
      max = Math.max(max, p); min = Math.min(min, q);
    } else for (const s of series) { const v = s.values[i]; if (isNum(v)) { max = Math.max(max, v); min = Math.min(min, v); } }
  });
  const { lo, hi, ticks } = niceTicks(min, max);
  const y = v => padT + (hi - v) / (hi - lo || 1) * height;
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const tickText = axisFormatter(ticks);
  for (const t of ticks) {                                    // hairline grid + y labels
    svg.appendChild(svgEl('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: t === 0 ? 'ch-axis' : 'ch-grid' }));
    const lab = svgEl('text', { x: padL - 8, y: y(t) + 4, 'text-anchor': 'end', class: 'ch-tick' }); lab.textContent = tickText(t); svg.appendChild(lab);
  }
  const k = stacked || polarity ? 1 : series.length;
  const barW = Math.max(2, Math.min(24, (bw * (k > 1 ? 0.78 : 0.62) - 2 * (k - 1)) / k));
  const groupW = k * barW + 2 * (k - 1);
  const bands = svgEl('g'), marks = svgEl('g');
  svg.append(bands, marks);
  cats.forEach((c, i) => {
    const bx = padL + i * bw, x0 = bx + (bw - groupW) / 2;
    bands.appendChild(svgEl('rect', { x: bx, y: padT, width: bw, height, class: 'ch-band', 'data-i': i }));
    if (stacked) {
      let up = 0, down = 0;
      const segs = series.map(s => ({ s, v: s.values[i] })).filter(o => isNum(o.v) && o.v !== 0);
      const lastUp = segs.filter(o => o.v > 0).pop(), lastDown = segs.filter(o => o.v < 0).pop();
      for (const o of segs) {
        const from = o.v > 0 ? up : down, to = from + o.v;
        let yb = y(from), ye = y(to);
        if (from !== 0) yb += o.v > 0 ? -2 : 2;               // 2px surface gap between segments
        const end = o === lastUp || o === lastDown;
        const d = end ? barPath(x0, barW, yb, ye) : `M${x0},${Math.min(yb, ye)}h${barW}v${Math.abs(ye - yb)}h${-barW}Z`;
        if (d && Math.abs(ye - yb) > 0.5) marks.appendChild(svgEl('path', { d, style: `fill:${o.s.color}` }));
        if (o.v > 0) up = to; else down = to;
      }
    } else series.forEach((s, j) => {
      const v = s.values[i]; if (!isNum(v) || v === 0) return;
      const color = polarity ? (v >= 0 ? polarity.pos : polarity.neg) : s.color;
      marks.appendChild(svgEl('path', { d: barPath(x0 + j * (barW + 2), barW, y(0), y(v)), style: `fill:${color}` }));
    });
  });
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 46))));
  cats.forEach((c, i) => {                                    // x labels, thinned so they never collide
    if (i % every) return;
    const t = svgEl('text', { x: padL + i * bw + bw / 2, y: padT + height + 17, 'text-anchor': 'middle', class: 'ch-tick' });
    t.textContent = labels[i]; svg.appendChild(t);
  });
  host.replaceChildren(svg);
  // Hover / focus: the whole month band is the hit target; the tooltip lists every series.
  const tipRows = i => polarity
    ? [{ name: series[0].name, value: series[0].values[i], color: isNum(series[0].values[i]) && series[0].values[i] < 0 ? polarity.neg : polarity.pos }]
    : series.map(s => ({ name: s.name, value: s.values[i], color: s.color }));
  bands.querySelectorAll('.ch-band').forEach(b => {
    const i = +b.dataset.i;
    b.setAttribute('tabindex', '0');
    b.setAttribute('aria-label', `${titles[i]}: ` + tipRows(i).map(r => `${r.name} ${isNum(r.value) ? fmt(r.value) : 'אין נתון'}`).join(', '));
    const on = () => { bands.querySelectorAll('.on').forEach(x => x.classList.remove('on')); b.classList.add('on'); showTip(host, padL + i * bw + bw / 2, titles[i], tipRows(i), fmt); };
    b.addEventListener('pointerenter', on); b.addEventListener('focus', on);
    b.addEventListener('blur', () => { b.classList.remove('on'); hideTip(host); });
  });
  svg.addEventListener('pointerleave', () => { bands.querySelectorAll('.on').forEach(x => x.classList.remove('on')); hideTip(host); });
}

/* Ranked horizontal bars, largest first. items: [{ label, value, color?, note? }].
   diverging: bars grow both ways from a center zero line (gains and losses). */
function rankBars(host, items, { color, diverging = null, fmt = money } = {}) {
  host.classList.add('ch-host');
  const maxAbs = Math.max(1e-9, ...items.map(it => Math.abs(it.value)));
  host.innerHTML = `<div class="rb${diverging ? ' div' : ''}">${items.map((it, i) => {
    const w = Math.abs(it.value) / maxAbs * (diverging ? 50 : 100);
    const c = diverging ? (it.value >= 0 ? diverging.pos : diverging.neg) : (it.color || color);
    const side = diverging ? (it.value >= 0 ? 'pos' : 'neg') : 'pos';
    return `<div class="rb-row" data-i="${i}">
      <span class="rb-l">${esc(it.label)}</span>
      <span class="rb-t"><i class="${side}" style="width:${w}%;background:${c}"></i></span>
      <span class="rb-v n">${fmt(it.value)}${it.note ? ` <small>${esc(it.note)}</small>` : ''}</span></div>`;
  }).join('')}</div>`;
}

/* One whole split into parts (<= 6). parts: [{ label, value, color }]. Shares print inside a block
   only where they fit; the legend names every part with its amount. */
function segBar(host, parts, total, { fmt = money } = {}) {
  host.classList.add('ch-host');
  const shown = parts.filter(p => p.value > 0);
  host.innerHTML = `<div class="seg-bar">${shown.map((p, i) => {
    const share = p.value / total * 100;
    return `<span class="sb" style="flex:${p.value};background:${p.color}" tabindex="0" data-i="${i}" aria-label="${esc(p.label)}: ${fmt(p.value)} (${PF1.format(share)}%)">${share >= 9 ? `<em${p.dark ? ' class="dk"' : ''}>${PF1.format(share)}%</em>` : ''}</span>`;
  }).join('')}</div>
  <div class="ch-legend">${parts.map(p => `<span><i class="rect" style="background:${p.color}"></i>${esc(p.label)} <b class="n">${fmt(p.value)}</b></span>`).join('')}</div>`;
  host.querySelectorAll('.sb').forEach(b => {
    const p = shown[+b.dataset.i];
    const on = () => showTip(host, b.offsetLeft + b.offsetWidth / 2, p.label, [{ name: `${PF1.format(p.value / total * 100)}% מההכנסה`, value: p.value, color: p.color }], fmt);
    b.addEventListener('pointerenter', on); b.addEventListener('focus', on);
    b.addEventListener('pointerleave', () => hideTip(host)); b.addEventListener('blur', () => hideTip(host));
  });
}
