// A small Prometheus registry: counters, gauges and histograms with labels, rendered
// in the text exposition format. Values live in memory and start at zero with the
// process, as Prometheus expects of a counter.

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function labelText(names, values) {
  if (names.length === 0) {
    return '';
  }
  return '{' + names.map((name, i) => `${name}="${escapeLabel(values[i])}"`).join(',') + '}';
}

function number(value) {
  return Number.isFinite(value) ? String(value) : value > 0 ? '+Inf' : value < 0 ? '-Inf' : 'NaN';
}

class Metric {
  constructor(type, name, help, labelNames) {
    this.type = type;
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.series = new Map();
  }

  key(labels) {
    return JSON.stringify(this.labelNames.map((name) => String(labels[name] ?? '')));
  }

  header() {
    return [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} ${this.type}`];
  }
}

export class Counter extends Metric {
  constructor(name, help, labelNames = []) {
    super('counter', name, help, labelNames);
  }

  inc(labels = {}, amount = 1) {
    const key = this.key(labels);
    this.series.set(key, (this.series.get(key) ?? 0) + amount);
  }

  render() {
    const lines = this.header();
    for (const [key, value] of this.series) {
      lines.push(`${this.name}${labelText(this.labelNames, JSON.parse(key))} ${number(value)}`);
    }
    return lines;
  }
}

// A gauge either holds what was set, or asks `collect` for its series at scrape time.
export class Gauge extends Metric {
  constructor(name, help, labelNames = [], collect = null) {
    super('gauge', name, help, labelNames);
    this.collect = collect;
  }

  set(labels, value) {
    this.series.set(this.key(labels), value);
  }

  render() {
    if (this.collect !== null) {
      this.series.clear();
      for (const [labels, value] of this.collect()) {
        this.set(labels, value);
      }
    }
    const lines = this.header();
    for (const [key, value] of this.series) {
      lines.push(`${this.name}${labelText(this.labelNames, JSON.parse(key))} ${number(value)}`);
    }
    return lines;
  }
}

export class Histogram extends Metric {
  constructor(name, help, labelNames, buckets) {
    super('histogram', name, help, labelNames);
    this.buckets = [...buckets].sort((a, b) => a - b);
  }

  observe(labels, value) {
    const key = this.key(labels);
    let entry = this.series.get(key);
    if (entry === undefined) {
      entry = { counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, entry);
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) {
        entry.counts[i] += 1;
      }
    }
    entry.sum += value;
    entry.count += 1;
  }

  render() {
    const lines = this.header();
    for (const [key, entry] of this.series) {
      const values = JSON.parse(key);
      const names = [...this.labelNames, 'le'];
      this.buckets.forEach((bound, i) => {
        lines.push(`${this.name}_bucket${labelText(names, [...values, number(bound)])} ${entry.counts[i]}`);
      });
      lines.push(`${this.name}_bucket${labelText(names, [...values, '+Inf'])} ${entry.count}`);
      lines.push(`${this.name}_sum${labelText(this.labelNames, values)} ${number(entry.sum)}`);
      lines.push(`${this.name}_count${labelText(this.labelNames, values)} ${entry.count}`);
    }
    return lines;
  }
}

export class Registry {
  #metrics = [];

  register(metric) {
    this.#metrics.push(metric);
    return metric;
  }

  render() {
    return this.#metrics.flatMap((metric) => metric.render()).join('\n') + '\n';
  }
}
