import { EntryCountCache, type EntryRecord, type PolicyCacheOptions } from "./entry-count.ts";

export interface RandomReplacementCacheOptions<K, V> extends PolicyCacheOptions<K, V> {
  readonly random?: () => number;
}

export class RandomReplacementCache<K, V> extends EntryCountCache<K, V> {
  private readonly records = new Map<K, EntryRecord<V>>();
  private readonly random: () => number;

  constructor(options: RandomReplacementCacheOptions<K, V> = {}) {
    super(options);
    this.random = options.random ?? Math.random;
    for (const [key, value] of options.entries ?? []) {
      this.set(key, value);
    }
  }

  set(key: K, value: V): boolean {
    const existing = this.records.get(key);
    const updated = existing !== undefined;
    if (existing === undefined && this.entryCount >= this.maxEntriesValue) {
      this.evictOne();
    }

    if (existing === undefined) {
      this.records.set(key, { value });
      this.entryCount++;
    } else {
      existing.value = value;
    }

    this.emitSet({ key, value, source: "cache", size: 1, updated });
    return true;
  }

  get(key: K): V | undefined {
    const record = this.records.get(key);
    if (record === undefined) {
      this.emitMiss(key);
      return undefined;
    }

    this.emitHit(key, record.value);
    return record.value;
  }

  peek(key: K): V | undefined {
    return this.get(key);
  }

  has(key: K): boolean {
    return this.records.has(key);
  }

  delete(key: K): boolean {
    const record = this.records.get(key);
    if (record === undefined) {
      return false;
    }

    this.records.delete(key);
    this.entryCount--;
    this.emitDelete(this.createEviction(key, record.value, "delete"));
    return true;
  }

  clear(): void {
    const entries = [...this.records].map(([key, record]) =>
      this.createEviction(key, record.value, "clear"),
    );
    this.records.clear();
    this.entryCount = 0;
    for (const eviction of entries) {
      this.onEvict?.(eviction);
    }
    if (entries.length > 0) {
      this.emitClear({ source: "cache", entries });
    }
  }

  entries(): IterableIterator<readonly [K, V]> {
    return this.iterateEntries();
  }

  keys(): IterableIterator<K> {
    return this.iterateKeys();
  }

  values(): IterableIterator<V> {
    return this.iterateValues();
  }

  [Symbol.iterator](): IterableIterator<readonly [K, V]> {
    return this.entries();
  }

  protected evictOverflow(): void {
    while (this.entryCount > this.maxEntriesValue) {
      this.evictOne();
    }
  }

  private evictOne(): void {
    const index = Math.floor(this.random() * this.entryCount);
    const key = [...this.records.keys()][Math.min(index, this.entryCount - 1)];
    if (key === undefined) {
      return;
    }

    const record = this.records.get(key)!;
    this.records.delete(key);
    this.entryCount--;
    this.emitDelete(this.createEviction(key, record.value, "evict"));
  }

  private *iterateEntries(): IterableIterator<readonly [K, V]> {
    for (const [key, record] of this.records) {
      yield [key, record.value] as const;
    }
  }

  private *iterateKeys(): IterableIterator<K> {
    for (const [key] of this) {
      yield key;
    }
  }

  private *iterateValues(): IterableIterator<V> {
    for (const [, value] of this) {
      yield value;
    }
  }
}
