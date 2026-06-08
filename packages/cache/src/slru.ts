import {
  EntryCountCache,
  firstKey,
  validateLimit,
  type EntryRecord,
  type PolicyCacheOptions,
} from "./entry-count.ts";

export interface SlruCacheOptions<K, V> extends PolicyCacheOptions<K, V> {
  /**
   * Maximum entries retained in the protected segment.
   *
   * Defaults to half of `maxEntries`.
   */
  readonly protectedEntries?: number;
}

export class SlruCache<K, V> extends EntryCountCache<K, V> {
  private readonly probation = new Map<K, EntryRecord<V>>();
  private readonly protected = new Map<K, EntryRecord<V>>();
  private protectedEntriesValue: number;

  constructor(options: SlruCacheOptions<K, V> = {}) {
    super(options);
    this.protectedEntriesValue = validateProtectedEntries(
      options.protectedEntries ?? Math.max(1, Math.floor(this.maxEntriesValue / 2)),
      this.maxEntriesValue,
    );
    for (const [key, value] of options.entries ?? []) {
      this.set(key, value);
    }
  }

  get protectedEntries(): number {
    return this.protectedEntriesValue;
  }

  set(key: K, value: V): boolean {
    const protectedRecord = this.protected.get(key);
    if (protectedRecord !== undefined) {
      protectedRecord.value = value;
      this.protected.delete(key);
      this.protected.set(key, protectedRecord);
      this.emitSet({ key, value, source: "cache", size: 1, updated: true });
      return true;
    }

    const probationRecord = this.probation.get(key);
    if (probationRecord !== undefined) {
      probationRecord.value = value;
      this.probation.delete(key);
      this.probation.set(key, probationRecord);
      this.emitSet({ key, value, source: "cache", size: 1, updated: true });
      return true;
    }

    while (this.entryCount >= this.maxEntriesValue) {
      this.evictOne();
    }

    this.probation.set(key, { value });
    this.entryCount++;
    this.emitSet({ key, value, source: "cache", size: 1, updated: false });
    return true;
  }

  get(key: K): V | undefined {
    const protectedRecord = this.protected.get(key);
    if (protectedRecord !== undefined) {
      this.protected.delete(key);
      this.protected.set(key, protectedRecord);
      this.emitHit(key, protectedRecord.value);
      return protectedRecord.value;
    }

    const probationRecord = this.probation.get(key);
    if (probationRecord === undefined) {
      this.emitMiss(key);
      return undefined;
    }

    this.probation.delete(key);
    this.promote(key, probationRecord);
    this.emitHit(key, probationRecord.value);
    return probationRecord.value;
  }

  peek(key: K): V | undefined {
    const record = this.protected.get(key) ?? this.probation.get(key);
    if (record === undefined) {
      this.emitMiss(key);
      return undefined;
    }

    this.emitHit(key, record.value);
    return record.value;
  }

  has(key: K): boolean {
    return this.protected.has(key) || this.probation.has(key);
  }

  delete(key: K): boolean {
    const protectedRecord = this.protected.get(key);
    if (protectedRecord !== undefined) {
      this.protected.delete(key);
      this.entryCount--;
      this.emitDelete(this.createEviction(key, protectedRecord.value, "delete"));
      return true;
    }

    const probationRecord = this.probation.get(key);
    if (probationRecord === undefined) {
      return false;
    }

    this.probation.delete(key);
    this.entryCount--;
    this.emitDelete(this.createEviction(key, probationRecord.value, "delete"));
    return true;
  }

  clear(): void {
    const entries = [...this.protected, ...this.probation].map(([key, record]) =>
      this.createEviction(key, record.value, "clear"),
    );
    this.protected.clear();
    this.probation.clear();
    this.entryCount = 0;
    for (const eviction of entries) {
      this.onEvict?.(eviction);
    }
    if (entries.length > 0) {
      this.emitClear({ source: "cache", entries });
    }
  }

  resize(options: Pick<SlruCacheOptions<K, V>, "maxEntries" | "protectedEntries">): void {
    if (options.maxEntries !== undefined) {
      this.maxEntriesValue = validateLimit(options.maxEntries, "maxEntries");
    }
    this.protectedEntriesValue = validateProtectedEntries(
      options.protectedEntries ?? Math.min(this.protectedEntriesValue, this.maxEntriesValue),
      this.maxEntriesValue,
    );

    while (this.protected.size > this.protectedEntriesValue) {
      this.demoteProtectedLru();
    }
    this.evictOverflow();
    this.emitResize({
      source: "cache",
      maxEntries: this.maxEntriesValue,
      maxSize: this.maxSize,
      maxEntrySize: this.maxSize,
    });
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

  private promote(key: K, record: EntryRecord<V>): void {
    this.protected.set(key, record);
    if (this.protected.size > this.protectedEntriesValue) {
      this.demoteProtectedLru();
    }
  }

  private demoteProtectedLru(): void {
    const key = firstKey(this.protected);
    if (key === undefined) {
      return;
    }

    const record = this.protected.get(key)!;
    this.protected.delete(key);
    this.probation.set(key, record);
  }

  private evictOne(): void {
    let key = firstKey(this.probation);
    let records = this.probation;
    if (key === undefined) {
      key = firstKey(this.protected);
      records = this.protected;
    }
    if (key === undefined) {
      return;
    }

    const record = records.get(key)!;
    records.delete(key);
    this.entryCount--;
    this.emitDelete(this.createEviction(key, record.value, "evict"));
  }

  private *iterateEntries(): IterableIterator<readonly [K, V]> {
    for (const [key, record] of [...this.protected].reverse()) {
      yield [key, record.value] as const;
    }
    for (const [key, record] of [...this.probation].reverse()) {
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

function validateProtectedEntries(value: number, maxEntries: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maxEntries) {
    throw new RangeError("Cache protectedEntries must be between 1 and maxEntries");
  }

  return value;
}
