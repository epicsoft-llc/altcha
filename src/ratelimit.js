// Sliding window per key, in memory. A refused request is not recorded, so a flood
// cannot keep a key blocked longer than the window, and a key never holds more than
// `limit` timestamps.

export class RateLimiter {
  #hits = new Map();
  #windowMs;

  constructor(windowMs = 3600000) {
    this.#windowMs = windowMs;
    setInterval(() => this.#purge(), 600000).unref();
  }

  get size() {
    return this.#hits.size;
  }

  // true when the key used up its limit - looks only, records nothing
  full(key, limit) {
    const now = Date.now();
    return (this.#hits.get(key) ?? []).filter((t) => now - t < this.#windowMs).length >= limit;
  }

  // limit 0 means unlimited
  allow(key, limit) {
    if (limit === 0) {
      return true;
    }
    const now = Date.now();
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.#windowMs);
    const allowed = recent.length < limit;
    if (allowed) {
      recent.push(now);
    }
    this.#hits.set(key, recent);
    return allowed;
  }

  #purge() {
    const now = Date.now();
    for (const [key, list] of this.#hits) {
      const recent = list.filter((t) => now - t < this.#windowMs);
      if (recent.length === 0) {
        this.#hits.delete(key);
      }
      else {
        this.#hits.set(key, recent);
      }
    }
  }
}
