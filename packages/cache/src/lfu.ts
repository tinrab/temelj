import { EntryCountCache, type PolicyCacheOptions } from "./entry-count.ts";

export type LfuCacheOptions<K, V> = PolicyCacheOptions<K, V>;

interface LfuRecord<V> {
  value: V;
  frequency: number;
  sequence: number;
}

export class LfuCache<K, V> extends EntryCountCache<K, V> {
  private readonly records = new Map<K, LfuRecord<V>>();
  private sequence = 0;

  constructor(options: LfuCacheOptions<K, V> = {}) {
    super(options);
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
      this.records.set(key, { value, frequency: 1, sequence: this.sequence++ });
      this.entryCount++;
    } else {
      existing.value = value;
      existing.frequency++;
      existing.sequence = this.sequence++;
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

    record.frequency++;
    record.sequence = this.sequence++;
    this.emitHit(key, record.value);
    return record.value;
  }

  peek(key: K): V | undefined {
    const record = this.records.get(key);
    if (record === undefined) {
      this.emitMiss(key);
      return undefined;
    }

    this.emitHit(key, record.value);
    return record.value;
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
    let evictedKey: K | undefined;
    let evictedRecord: LfuRecord<V> | undefined;
    for (const [key, record] of this.records) {
      if (
        evictedRecord === undefined ||
        record.frequency < evictedRecord.frequency ||
        (record.frequency === evictedRecord.frequency && record.sequence < evictedRecord.sequence)
      ) {
        evictedKey = key;
        evictedRecord = record;
      }
    }

    if (evictedKey === undefined || evictedRecord === undefined) {
      return;
    }

    this.records.delete(evictedKey);
    this.entryCount--;
    this.emitDelete(this.createEviction(evictedKey, evictedRecord.value, "evict"));
  }

  private *iterateEntries(): IterableIterator<readonly [K, V]> {
    const entries = [...this.records].sort(([, left], [, right]) => {
      const frequency = right.frequency - left.frequency;
      return frequency === 0 ? right.sequence - left.sequence : frequency;
    });

    for (const [key, record] of entries) {
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
