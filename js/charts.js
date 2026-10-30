/* Small inline-SVG charts for the Progress tab: one series each (line or bars), an optional
   dashed goal line, a faint grid, a tap/hover tooltip and a "Show numbers" table.
   Colours come from CSS variables; text stays in the text colours. */
(function (root) {
  'use strict';
  const W = 340; // viewBox width; charts scale to the card
  const PAD = { l: 38, r: 14, t: 16, b: 24 };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (s) => { const [, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
  const toTime = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

  // Round step (1, 2, 2.5, 5 × 10^n) giving about `count` gridlines between lo and hi.
  function ticks(lo, hi, count = 3) {
    const span = hi - lo || Math.abs(hi) || 1;
    const raw = span / (count - 1);
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || 10 * mag;
    const start = Math.floor(lo / step) * step;
    const end = Math.ceil(hi / step) * step;
    const out = [];
    for (let v = start; v <= end + step / 1e6; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }

  function frame({ height, yTicks, fmtTick, goal, goalLabel, label }) {
    const bottom = height - PAD.b;
    const lo = yTicks[0];
    const hi = yTicks[yTicks.length - 1];
    const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (bottom - PAD.t);
    const grid = yTicks.map((v) => `<line class="grid-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>
      <text class="axis-label" x="${PAD.l - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmtTick(v))}</text>`).join('');
    const goalLine = goal != null && goal >= lo && goal <= hi
      ? `<line class="goal-line" x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(goal).toFixed(1)}" y2="${y(goal).toFixed(1)}"/>
         <text class="goal-label" x="${W - PAD.r}" y="${(y(goal) - 5).toFixed(1)}" text-anchor="end">${esc(goalLabel)}</text>`
      : '';
    return { y, bottom, open: `<svg viewBox="0 0 ${W} ${height}" role="img" aria-label="${esc(label)}">${grid}${goalLine}` };
  }

  function wrap(svg, points, label, rows) {
    const table = `<details class="chart-table"><summary>Show numbers</summary><table><tbody>${rows.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</tbody></table></details>`;
    return `<div class="chart" data-points='${esc(JSON.stringify(points))}'>${svg}<div class="chart-tip" hidden></div></div>${table}`;
  }

  // points: [{ x: 'YYYY-MM-DD', y }] oldest first. x is spaced by real dates.
  function line({ points, color, fmtY, height = 170, goal, goalLabel, label }) {
    const ys = points.map((p) => p.y).concat(goal != null ? [goal] : []);
    let lo = Math.min(...ys);
    let hi = Math.max(...ys);
    const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
    lo -= pad;
    hi += pad;
    const yTicks = ticks(lo, hi, 3);
    const f = frame({ height, yTicks, fmtTick: fmtY, goal, goalLabel, label });
    const t0 = toTime(points[0].x);
    const t1 = toTime(points[points.length - 1].x);
    const x = (s) => (points.length === 1 || t1 === t0 ? (PAD.l + W - PAD.r) / 2 : PAD.l + ((toTime(s) - t0) / (t1 - t0)) * (W - PAD.r - PAD.l));
    const xy = points.map((p) => [x(p.x), f.y(p.y)]);
    const path = xy.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
    const dots = points.length <= 24 ? xy.map(([px, py]) => `<circle class="dot" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" style="fill:${color}"/>`).join('') : '';
    const [lx, ly] = xy[xy.length - 1];
    const lastLabel = `<text class="value-label" x="${Math.min(lx, W - PAD.r).toFixed(1)}" y="${(ly - 10).toFixed(1)}" text-anchor="${lx > W - 60 ? 'end' : 'middle'}">${esc(fmtY(points[points.length - 1].y))}</text>`;
    const xLabels = [points[0], points[points.length - 1]].filter((p, i, a) => i === 0 || p.x !== a[0].x)
      .map((p, i) => `<text class="axis-label" x="${x(p.x).toFixed(1)}" y="${height - 6}" text-anchor="${i === 0 ? 'start' : 'end'}">${day(p.x)}</text>`).join('');
    const svg = `${f.open}<path class="series" d="${path}" style="stroke:${color}"/>${dots}${lastLabel}${xLabels}
      <line class="ch-x" x1="0" x2="0" y1="${PAD.t}" y2="${f.bottom}" visibility="hidden"/><circle class="ch-dot" r="5" style="fill:${color}" visibility="hidden"/></svg>`;
    const tip = points.map((p, i) => ({ px: xy[i][0], py: xy[i][1], text: `${day(p.x)}: ${fmtY(p.y)}` }));
    return wrap(svg, tip, label, [...points].reverse().map((p) => [day(p.x), fmtY(p.y)]));
  }

  // Bars from a zero baseline. `dim` marks the last bar as still in progress (this week / today).
  function bars({ points, color, fmtY, fmtX = day, height = 160, goal, goalLabel, label, dim }) {
    const hi = Math.max(...points.map((p) => p.y), goal || 0) * 1.1 || 1;
    const yTicks = ticks(0, hi, 3);
    const f = frame({ height, yTicks, fmtTick: fmtY, goal, goalLabel, label });
    const slot = (W - PAD.l - PAD.r) / points.length;
    const gap = Math.max(2, slot * 0.28);
    const bw = slot - gap;
    const rects = points.map((p, i) => {
      if (!(p.y > 0)) return '';
      const x0 = PAD.l + i * slot + gap / 2;
      const top = f.y(p.y);
      const r = Math.min(4, bw / 2, f.bottom - top);
      const d = `M${x0.toFixed(1)},${f.bottom}V${(top + r).toFixed(1)}Q${x0.toFixed(1)},${top.toFixed(1)} ${(x0 + r).toFixed(1)},${top.toFixed(1)}H${(x0 + bw - r).toFixed(1)}Q${(x0 + bw).toFixed(1)},${top.toFixed(1)} ${(x0 + bw).toFixed(1)},${(top + r).toFixed(1)}V${f.bottom}Z`;
      return `<path class="bar-mark${dim && i === points.length - 1 ? ' dim' : ''}" d="${d}" style="fill:${color}"/>`;
    }).join('');
    const every = Math.ceil(points.length / 4);
    const xLabels = points.map((p, i) => ((points.length - 1 - i) % every === 0
      ? `<text class="axis-label" x="${(PAD.l + (i + 0.5) * slot).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(fmtX(p.x))}</text>` : '')).join('');
    const svg = `${f.open}${rects}${xLabels}<line class="ch-x" x1="0" x2="0" y1="${PAD.t}" y2="${f.bottom}" visibility="hidden"/></svg>`;
    const tip = points.map((p, i) => ({ px: PAD.l + (i + 0.5) * slot, py: f.y(p.y), text: `${fmtX(p.x)}: ${fmtY(p.y)}` }));
    return wrap(svg, tip, label, [...points].reverse().map((p) => [fmtX(p.x), fmtY(p.y)]));
  }

  // Tooltip: the nearest point to the finger / pointer.
  function track(e) {
    const chart = e.target.closest && e.target.closest('.chart');
    if (!chart) return;
    const svg = chart.querySelector('svg');
    const pts = JSON.parse(chart.dataset.points);
    const rect = svg.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const p = pts.reduce((a, b) => (Math.abs(b.px - vx) < Math.abs(a.px - vx) ? b : a));
    const cross = svg.querySelector('.ch-x');
    cross.setAttribute('x1', p.px);
    cross.setAttribute('x2', p.px);
    cross.setAttribute('visibility', 'visible');
    const dot = svg.querySelector('.ch-dot');
    if (dot) {
      dot.setAttribute('cx', p.px);
      dot.setAttribute('cy', p.py);
      dot.setAttribute('visibility', 'visible');
    }
    const tip = chart.querySelector('.chart-tip');
    tip.textContent = p.text;
    tip.hidden = false;
    tip.style.left = `${Math.min(82, Math.max(18, (p.px / W) * 100))}%`;
  }
  function untrack(e) {
    const chart = e.target.closest && e.target.closest('.chart');
    if (!chart || (e.relatedTarget && chart.contains(e.relatedTarget))) return;
    chart.querySelectorAll('.ch-x, .ch-dot').forEach((el) => el.setAttribute('visibility', 'hidden'));
    chart.querySelector('.chart-tip').hidden = true;
  }
  root.document.addEventListener('pointermove', track);
  root.document.addEventListener('pointerdown', track);
  root.document.addEventListener('pointerout', untrack);

  root.GymCharts = { line, bars, ticks };
})(window);
