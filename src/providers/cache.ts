// Best-effort warm-instance caches, bounded in memory. Cold starts simply re-fetch.
export class TtlCache<T> {
  private entries = new Map<string, { value: T; saved: number }>();
  private pending = new Map<string, Promise<T>>();
  get(key: string, maxAgeMs: number): T | undefined {
    const entry = this.entries.get(key);
    return entry && Date.now() - entry.saved <= maxAgeMs
      ? entry.value
      : undefined;
  }
  async resolve(
    key: string,
    ttlMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get(key, ttlMs);
    if (cached !== undefined) return cached;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const promise = load()
      .then((value) => {
        if (this.entries.size >= 500)
          this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(key, { value, saved: Date.now() });
        return value;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
}
