// Multi-series line chart in plain SVG: one y-axis, hairline grid, 2px lines, end
// values as direct labels, a crosshair with one tooltip for every series, keyboard
// navigation. Text is always set with textContent.

const SVG = 'http://www.w3.org/2000/svg';
const PLOT_HEIGHT = 220;
const AXIS_BAND = 26;
const TOP = 10;
const LEFT = 44;
const RIGHT = 96;
const LABEL_GAP = 14;

// Styles go through CSSOM: the admin CSP blocks style attributes, not style properties.
function svg(tag, attributes = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'style') {
      for (const [property, css] of Object.entries(value)) {
        node.style.setProperty(property, css);
      }
    }
    else {
      node.setAttribute(key, String(value));
    }
  }
  return node;
}

// 0 plus four clean steps (1/2/5 x 10^n) that cover the maximum
function niceScale(max) {
  if (max <= 0) {
    return { top: 4, step: 1 };
  }
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * power).find((s) => s >= raw);
  return { top: step * 4, step };
}

const integer = new Intl.NumberFormat('en');

export class LineChart {
  #root;
  #data = null;
  #hidden = new Set();
  #index = null;
  #width = 0;

  // series: [{ key, label, color }] - color is a CSS custom property name
  constructor(root, { series, formatTick, formatRange, describe }) {
    this.#root = root;
    this.series = series;
    this.formatTick = formatTick;
    this.formatRange = formatRange;
    this.describe = describe;

    root.classList.add('chart');
    root.tabIndex = 0;
    root.setAttribute('role', 'img');
    this.svg = svg('svg', { class: 'chart-svg', 'aria-hidden': 'true' });
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'chart-tooltip';
    this.tooltip.hidden = true;
    root.append(this.svg, this.tooltip);

    root.addEventListener('pointermove', (e) => this.#pointer(e));
    root.addEventListener('pointerleave', () => this.#show(null));
    root.addEventListener('keydown', (e) => this.#key(e));
    root.addEventListener('focus', () => {
      if (this.#index === null && this.#data !== null) {
        this.#show(this.#data.points.length - 1);
      }
    });
    root.addEventListener('blur', () => this.#show(null));
    new ResizeObserver(() => this.#render()).observe(root);
  }

  get hidden() {
    return this.#hidden;
  }

  toggle(key) {
    if (this.#hidden.has(key)) {
      this.#hidden.delete(key);
    }
    else {
      this.#hidden.add(key);
    }
    this.#render();
  }

  update(data) {
    this.#data = data;
    this.#render();
  }

  #visible() {
    return this.series.filter((s) => !this.#hidden.has(s.key));
  }

  #geometry() {
    const points = this.#data.points;
    const plotWidth = Math.max(60, this.#width - LEFT - RIGHT);
    const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;
    const max = Math.max(0, ...this.#visible().flatMap((s) => points.map((p) => p[s.key])));
    const scale = niceScale(max);
    const x = (i) => LEFT + i * step;
    const y = (v) => TOP + PLOT_HEIGHT - (v / scale.top) * PLOT_HEIGHT;
    return { points, plotWidth, step, scale, x, y };
  }

  #render() {
    this.#width = this.#root.clientWidth;
    if (this.#data === null || this.#width === 0) {
      return;
    }
    const height = TOP + PLOT_HEIGHT + AXIS_BAND;
    this.svg.setAttribute('viewBox', `0 0 ${this.#width} ${height}`);
    this.svg.setAttribute('height', String(height));
    this.svg.replaceChildren();
    const g = this.#geometry();
    const { points, x, y, scale } = g;

    // grid and y ticks
    for (let v = 0; v <= scale.top; v += scale.step) {
      const yy = Math.round(y(v)) + 0.5;
      this.svg.append(svg('line', { x1: LEFT, x2: LEFT + g.plotWidth, y1: yy, y2: yy, class: v === 0 ? 'chart-baseline' : 'chart-grid' }));
      const label = svg('text', { x: LEFT - 8, y: yy + 4, class: 'chart-tick', 'text-anchor': 'end' });
      label.textContent = integer.format(v);
      this.svg.append(label);
    }

    // x ticks: about one per 110px, always the first and the last bucket
    const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(g.plotWidth / 110))));
    for (let i = 0; i < points.length; i += every) {
      const anchor = i === 0 ? 'start' : 'middle';
      const label = svg('text', { x: x(i), y: TOP + PLOT_HEIGHT + 18, class: 'chart-tick', 'text-anchor': anchor });
      label.textContent = this.formatTick(points[i].t);
      this.svg.append(label);
    }

    // Lines, then end markers on top. A bucket that is still filling up would read as
    // a collapse at the right edge: it is drawn faint, and the end markers and labels
    // belong to the last complete bucket.
    const last = points.length - 1;
    const lastFull = this.#data.partial && last > 0 ? last - 1 : last;
    const path = (s, from, to) => points.slice(from, to + 1)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(from + i).toFixed(1)},${y(p[s.key]).toFixed(1)}`).join('');
    const ends = [];
    for (const s of this.#visible()) {
      this.svg.append(svg('path', { d: path(s, 0, lastFull), class: 'chart-line', style: { stroke: `var(${s.color})` } }));
      if (lastFull < last) {
        this.svg.append(svg('path', { d: path(s, lastFull, last), class: 'chart-line partial', style: { stroke: `var(${s.color})` } }));
      }
      ends.push({ s, cx: x(lastFull), cy: y(points[lastFull][s.key]), value: points[lastFull][s.key] });
    }
    for (const end of ends) {
      this.svg.append(svg('circle', { cx: end.cx, cy: end.cy, r: 4, class: 'chart-dot', style: { fill: `var(${end.s.color})` } }));
    }

    // End labels only where they do not collide - colliding ones are left to the
    // legend and the tooltip instead of being pushed away from their line.
    const placed = [];
    for (const end of [...ends].sort((a, b) => a.cy - b.cy)) {
      if (placed.every((yy) => Math.abs(yy - end.cy) >= LABEL_GAP)) {
        placed.push(end.cy);
        const label = svg('text', { x: x(last) + 10, y: end.cy + 4, class: 'chart-end' });
        const value = svg('tspan', { class: 'chart-end-value' });
        value.textContent = integer.format(end.value);
        const name = svg('tspan', { dx: 4 });
        name.textContent = end.s.short ?? end.s.label;
        label.append(value, name);
        this.svg.append(label);
      }
    }

    this.crosshair = svg('line', { y1: TOP, y2: TOP + PLOT_HEIGHT, class: 'chart-crosshair', visibility: 'hidden' });
    this.markers = svg('g');
    this.svg.append(this.crosshair, this.markers);
    this.#root.setAttribute('aria-label', this.describe(this.#data));
    this.#show(this.#index);
  }

  #pointer(event) {
    if (this.#data === null) {
      return;
    }
    const g = this.#geometry();
    const box = this.#root.getBoundingClientRect();
    const px = event.clientX - box.left;
    if (px < LEFT - 10 || px > LEFT + g.plotWidth + 10) {
      this.#show(null);
      return;
    }
    const i = g.step === 0 ? 0 : Math.round((px - LEFT) / g.step);
    this.#show(Math.min(g.points.length - 1, Math.max(0, i)));
  }

  #key(event) {
    if (this.#data === null) {
      return;
    }
    const last = this.#data.points.length - 1;
    const moves = { ArrowLeft: -1, ArrowRight: 1 };
    if (event.key in moves) {
      this.#show(Math.min(last, Math.max(0, (this.#index ?? last) + moves[event.key])));
    }
    else if (event.key === 'Home') {
      this.#show(0);
    }
    else if (event.key === 'End') {
      this.#show(last);
    }
    else if (event.key === 'Escape') {
      this.#show(null);
    }
    else {
      return;
    }
    event.preventDefault();
  }

  #show(index) {
    this.#index = index;
    if (this.crosshair === undefined) {
      return;
    }
    this.markers.replaceChildren();
    if (index === null || this.#data === null) {
      this.crosshair.setAttribute('visibility', 'hidden');
      this.tooltip.hidden = true;
      return;
    }
    const g = this.#geometry();
    const point = g.points[index];
    const cx = g.x(index);
    this.crosshair.setAttribute('x1', String(cx));
    this.crosshair.setAttribute('x2', String(cx));
    this.crosshair.setAttribute('visibility', 'visible');

    const rows = [];
    for (const s of this.#visible()) {
      this.markers.append(svg('circle', { cx, cy: g.y(point[s.key]), r: 4, class: 'chart-dot', style: { fill: `var(${s.color})` } }));
      const row = document.createElement('div');
      row.className = 'tip-row';
      const key = document.createElement('span');
      key.className = 'line-key';
      key.style.background = `var(${s.color})`;
      const value = document.createElement('strong');
      value.textContent = integer.format(point[s.key]);
      const name = document.createElement('span');
      name.textContent = s.label;
      row.append(key, value, name);
      rows.push(row);
    }
    const head = document.createElement('div');
    head.className = 'tip-head';
    const running = this.#data.partial && index === g.points.length - 1;
    head.textContent = this.formatRange(point.t, point.t + this.#data.bucketSeconds) + (running ? ' · still running' : '');
    this.tooltip.replaceChildren(head, ...rows);
    this.tooltip.hidden = false;

    // keep the tooltip inside the chart, on the side away from the crosshair
    const width = this.tooltip.offsetWidth;
    const left = cx + 14 + width > this.#width ? cx - 14 - width : cx + 14;
    this.tooltip.style.left = `${Math.max(0, left)}px`;
    this.tooltip.style.top = `${TOP}px`;
  }
}

// Small trend line for a stat tile: de-emphasised line, the last value marked.
export function sparkline(values, color) {
  const width = 96;
  const height = 28;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const yy = (v) => 3 + (height - 6) * (1 - v / max);
  const root = svg('svg', { viewBox: `0 0 ${width + 6} ${height}`, class: 'sparkline', 'aria-hidden': 'true' });
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${yy(v).toFixed(1)}`).join('');
  root.append(svg('path', { d, class: 'sparkline-line' }));
  if (values.length > 0) {
    root.append(svg('circle', { cx: (values.length - 1) * step, cy: yy(values[values.length - 1]), r: 3, class: 'chart-dot', style: { fill: `var(${color})` } }));
  }
  return root;
}
