import { createPubSub } from "@temelj/event";
import { sizeOf } from "@temelj/value";

import type {
  Cache,
  CacheClearEvent,
  CacheDeleteReason,
  CacheEntry,
  CacheEventHandler,
  CacheEventMap,
  CacheEventPattern,
  CacheEviction,
  CacheResizeEvent,
  CacheSetEvent,
  CacheSetOptions,
  CacheSizeOf,
} from "./types.ts";

type AnyCacheEventHandler<K, V> = (
  payload: unknown,
  event: string,
) => ReturnType<CacheEventHandler<K, V>>;

interface OnceSubscription<K, V> {
  readonly pattern: CacheEventPattern<K, V>;
  readonly handler: unknown;
  readonly wrapper: AnyCacheEventHandler<K, V>;
  active: boolean;
}

export interface LruCacheOptions<K, V> {
  readonly maxEntries?: number;
  readonly maxSize?: number;
  readonly maxEntrySize?: number;
  readonly ttl?: number;
  readonly sizeOf?: CacheSizeOf<K, V>;
  readonly onEvict?: (eviction: CacheEviction<K, V>) => void;
  readonly entries?: Iterable<readonly [K, V]>;
}

const EMPTY_VALUE = -1;

export class LruCache<K, V> implements Cache<K, V> {
  private records: Map<K, number>;
  private entryKeys: K[];
  private entryVals: V[];
  private next: number[];
  private prev: number[];
  private readonly pubsub = createPubSub<CacheEventMap<K, V>>();
  private readonly sizeOf: CacheSizeOf<K, V> | undefined;
  private readonly onEvict: ((eviction: CacheEviction<K, V>) => void) | undefined;
  private readonly onceSubscriptions: OnceSubscription<K, V>[] = [];
  private readonly freeSlots: number[] = [];
  private sizes: number[] | undefined;
  private expires: number[] | undefined;
  private entryCount = 0;
  private calculatedSizeValue = 0;
  private listenerCountValue = 0;
  private countOnly: boolean;
  private maxEntriesValue: number;
  private maxSizeValue: number;
  private maxEntrySizeValue: number;
  private ttlValue: number | undefined;
  private head: number = EMPTY_VALUE;
  private tail: number = EMPTY_VALUE;

  constructor(options: LruCacheOptions<K, V> = {}) {
    this.maxEntriesValue = validateLimit(options.maxEntries ?? 1000, "maxEntries");
    this.maxSizeValue = validateLimit(options.maxSize ?? Number.POSITIVE_INFINITY, "maxSize");
    this.maxEntrySizeValue = validateLimit(
      options.maxEntrySize ?? this.maxSizeValue,
      "maxEntrySize",
    );
    this.ttlValue = validateTtl(options.ttl, "ttl");
    this.sizeOf =
      options.sizeOf ??
      (options.maxSize !== undefined || options.maxEntrySize !== undefined
        ? defaultSizeOf
        : undefined);
    this.onEvict = options.onEvict;
    this.countOnly =
      this.ttlValue === undefined &&
      this.sizeOf === undefined &&
      this.maxSizeValue === Number.POSITIVE_INFINITY &&
      this.maxEntrySizeValue === Number.POSITIVE_INFINITY &&
      this.onEvict === undefined;

    this.records = new Map<K, number>();

    if (this.countOnly) {
      const cap = this.maxEntriesValue;
      // eslint-disable-next-line unicorn/no-new-array
      this.entryKeys = new Array<K>(cap);
      // eslint-disable-next-line unicorn/no-new-array
      this.entryVals = new Array<V>(cap);
      // eslint-disable-next-line unicorn/no-new-array
      this.next = new Array<number>(cap);
      // eslint-disable-next-line unicorn/no-new-array
      this.prev = new Array<number>(cap);
    } else {
      this.entryKeys = [] as K[];
      this.entryVals = [] as V[];
      this.next = [] as number[];
      this.prev = [] as number[];
    }

    if (this.sizeOf !== undefined) {
      this.sizes = [];
    }

    if (this.ttlValue !== undefined) {
      this.expires = [];
    }

    for (const [key, value] of options.entries ?? []) {
      this.set(key, value);
    }
  }

  get size(): number {
    this.pruneExpired();
    return this.entryCount;
  }

  get maxEntries(): number {
    return this.maxEntriesValue;
  }

  get calculatedSize(): number {
    this.pruneExpired();
    return this.calculatedSizeValue;
  }

  get maxSize(): number {
    return this.maxSizeValue;
  }

  on<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): () => void {
    this.listenerCountValue++;
    const unsubscribe = this.pubsub.on(pattern, handler);
    let active = true;
    return () => {
      if (!active) {
        return;
      }
      active = false;
      this.listenerCountValue--;
      unsubscribe();
    };
  }

  once<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): () => void {
    this.listenerCountValue++;
    const subscription: OnceSubscription<K, V> = {
      pattern,
      handler,
      wrapper: (event, type) => {
        if (subscription.active) {
          subscription.active = false;
          this.listenerCountValue--;
        }
        // @ts-ignore
        return handler(event, type);
      },
      active: true,
    };
    this.onceSubscriptions.push(subscription);
    const unsubscribe = this.pubsub.once(pattern, subscription.wrapper);

    return () => {
      if (!subscription.active) {
        return;
      }
      subscription.active = false;
      this.listenerCountValue--;
      unsubscribe();
    };
  }

  off<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): void {
    const subscription = this.findActiveOnceSubscription(pattern, handler);
    if (subscription !== undefined) {
      subscription.active = false;
      this.listenerCountValue--;
      this.pubsub.off(pattern, subscription.wrapper);
      return;
    }

    const before = this.pubsub.listenerCount(pattern);
    this.pubsub.off(pattern, handler);
    const removed = before - this.pubsub.listenerCount(pattern);
    this.listenerCountValue -= removed;
  }

  listeners(): readonly CacheEventHandler<K, V>[];
  listeners<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
  ): readonly CacheEventHandler<K, V, Pattern>[];
  listeners(pattern?: CacheEventPattern<K, V>): readonly CacheEventHandler<K, V>[] {
    return pattern === undefined ? this.pubsub.listeners() : this.pubsub.listeners(pattern);
  }

  clearListeners(pattern?: CacheEventPattern<K, V>): void {
    const removed =
      pattern === undefined ? this.listenerCountValue : this.pubsub.listenerCount(pattern);
    this.pubsub.clear(pattern);
    this.listenerCountValue -= removed;
    for (const subscription of this.onceSubscriptions) {
      if (subscription.active && (pattern === undefined || subscription.pattern === pattern)) {
        subscription.active = false;
      }
    }
  }

  listenerCount(pattern?: CacheEventPattern<K, V>): number {
    return this.pubsub.listenerCount(pattern);
  }

  set(key: K, value: V, options?: CacheSetOptions): boolean {
    if (options === undefined && this.countOnly && this.listenerCountValue === 0) {
      return this.setFast(key, value);
    }

    const ttl = validateTtl(options?.ttl ?? this.ttlValue, "ttl");
    const now = ttl === undefined ? 0 : Date.now();
    const expiresAt = ttl === undefined ? Number.POSITIVE_INFINITY : now + ttl;
    const nextSize = this.sizeOf === undefined ? 1 : this.sizeOf({ key, value });

    if (!Number.isFinite(nextSize) || nextSize < 0) {
      throw new RangeError("Cache entry size must be a finite non-negative number");
    }

    const existing = this.records.get(key);
    const updated = existing !== undefined;

    if (
      nextSize > this.maxEntrySizeValue ||
      nextSize > this.maxSizeValue ||
      (ttl !== undefined && expiresAt <= now)
    ) {
      if (existing !== undefined) {
        this.removeAt(existing, "set");
      }
      return false;
    }

    if (existing !== undefined) {
      this.calculatedSizeValue += nextSize - (this.getSize(existing) as number);
      this.setSize(existing, nextSize);
      this.entryVals[existing] = value;
      this.setExpires(existing, expiresAt);
      this.moveToTail(existing);
      this.evictOverflow();
    } else {
      while (
        this.head !== EMPTY_VALUE &&
        (this.entryCount >= this.maxEntriesValue ||
          this.calculatedSizeValue + nextSize > this.maxSizeValue)
      ) {
        this.removeAt(this.head, "evict");
      }

      const slot = this.allocSlot();
      this.entryKeys[slot] = key;
      this.entryVals[slot] = value;
      this.setSize(slot, nextSize);
      this.setExpires(slot, expiresAt);
      this.records.set(key, slot);
      this.append(slot);
      this.entryCount++;
      this.calculatedSizeValue += nextSize;
    }

    this.emitSet({ key, value, source: "cache", size: nextSize, updated });
    return true;
  }

  private setFast(key: K, value: V): boolean {
    const existing = this.records.get(key);

    if (existing !== undefined) {
      this.entryVals[existing] = value;
      if (existing !== this.tail) {
        const p = this.prev[existing];
        const n = this.next[existing];
        if (p !== EMPTY_VALUE) {
          this.next[p] = n;
        } else {
          this.head = n;
        }
        if (n !== EMPTY_VALUE) {
          this.prev[n] = p;
        } else {
          this.tail = p;
        }
        this.prev[existing] = this.tail;
        if (this.tail !== EMPTY_VALUE) {
          this.next[this.tail] = existing;
        } else {
          this.head = existing;
        }
        this.tail = existing;
      }
      return true;
    }

    if (this.entryCount >= this.maxEntriesValue) {
      const slot = this.head;
      this.records.delete(this.entryKeys[slot]);
      const nextHead = this.next[slot];
      this.head = nextHead;
      if (nextHead !== EMPTY_VALUE) {
        this.prev[nextHead] = EMPTY_VALUE;
      } else {
        this.tail = EMPTY_VALUE;
      }
      this.entryKeys[slot] = key;
      this.entryVals[slot] = value;
      this.records.set(key, slot);
      this.prev[slot] = this.tail;
      this.next[slot] = EMPTY_VALUE;
      if (this.tail !== EMPTY_VALUE) {
        this.next[this.tail] = slot;
      } else {
        this.head = slot;
      }
      this.tail = slot;
      this.calculatedSizeValue++;
      return true;
    }

    const slot = this.freeSlots.length > 0 ? this.freeSlots.pop()! : this.entryCount;
    this.entryKeys[slot] = key;
    this.entryVals[slot] = value;
    this.records.set(key, slot);
    this.prev[slot] = this.tail;
    this.next[slot] = EMPTY_VALUE;
    if (this.tail !== EMPTY_VALUE) {
      this.next[this.tail] = slot;
    } else {
      this.head = slot;
    }
    this.tail = slot;
    this.entryCount++;
    this.calculatedSizeValue++;
    return true;
  }

  get(key: K): V | undefined {
    const slot = this.records.get(key);
    if (slot === undefined) {
      this.emitMiss(key);
      return undefined;
    }

    if (this.countOnly && this.listenerCountValue === 0) {
      if (slot !== this.tail) {
        const p = this.prev[slot];
        const n = this.next[slot];
        if (p !== EMPTY_VALUE) {
          this.next[p] = n;
        } else {
          this.head = n;
        }
        if (n !== EMPTY_VALUE) {
          this.prev[n] = p;
        } else {
          this.tail = p;
        }
        this.prev[slot] = this.tail;
        if (this.tail !== EMPTY_VALUE) {
          this.next[this.tail] = slot;
        } else {
          this.head = slot;
        }
        this.tail = slot;
      }
      return this.entryVals[slot];
    }

    if (this.isExpired(slot)) {
      this.removeAt(slot, "stale");
      this.emitMiss(key);
      return undefined;
    }

    this.moveToTail(slot);
    this.emitHit(slot);
    return this.entryVals[slot];
  }

  peek(key: K): V | undefined {
    const slot = this.records.get(key);
    if (slot === undefined) {
      this.emitMiss(key);
      return undefined;
    }

    if (this.isExpired(slot)) {
      this.removeAt(slot, "stale");
      this.emitMiss(key);
      return undefined;
    }

    this.emitHit(slot);
    return this.entryVals[slot];
  }

  has(key: K): boolean {
    const slot = this.records.get(key);
    if (slot === undefined) {
      return false;
    }

    if (this.isExpired(slot)) {
      this.removeAt(slot, "stale");
      return false;
    }

    return true;
  }

  delete(key: K): boolean {
    const slot = this.records.get(key);
    if (slot === undefined) {
      return false;
    }

    this.removeAt(slot, "delete");
    return true;
  }

  clear(): void {
    const entries: CacheEviction<K, V>[] = [];
    let slot = this.head;
    while (slot !== EMPTY_VALUE) {
      const eviction = this.createEviction(slot, "clear");
      entries.push(eviction);
      this.onEvict?.(eviction);
      slot = this.next[slot];
    }
    this.records.clear();
    this.head = EMPTY_VALUE;
    this.tail = EMPTY_VALUE;
    this.freeSlots.length = 0;
    this.entryCount = 0;
    this.calculatedSizeValue = 0;
    if (entries.length > 0) {
      this.emitClear({ source: "cache", entries });
    }
  }

  pruneExpired(): number {
    let deleted = 0;
    let slot = this.head;
    while (slot !== EMPTY_VALUE) {
      const next = this.next[slot];
      if (this.isExpired(slot)) {
        this.removeAt(slot, "stale");
        deleted++;
      }
      slot = next;
    }
    return deleted;
  }

  resize(options: Pick<LruCacheOptions<K, V>, "maxEntries" | "maxEntrySize" | "maxSize">): void {
    if (options.maxEntries !== undefined) {
      this.maxEntriesValue = validateLimit(options.maxEntries, "maxEntries");
    }
    if (options.maxSize !== undefined) {
      this.maxSizeValue = validateLimit(options.maxSize, "maxSize");
    }
    if (options.maxEntrySize !== undefined) {
      this.maxEntrySizeValue = validateLimit(options.maxEntrySize, "maxEntrySize");
    }
    this.countOnly =
      this.ttlValue === undefined &&
      this.sizeOf === undefined &&
      this.maxSizeValue === Number.POSITIVE_INFINITY &&
      this.maxEntrySizeValue === Number.POSITIVE_INFINITY &&
      this.onEvict === undefined;

    this.emitResize({
      source: "cache",
      maxEntries: this.maxEntriesValue,
      maxSize: this.maxSizeValue,
      maxEntrySize: this.maxEntrySizeValue,
    });

    let slot = this.head;
    while (slot !== EMPTY_VALUE) {
      const next = this.next[slot];
      if (this.getSize(slot) > this.maxEntrySizeValue || this.getSize(slot) > this.maxSizeValue) {
        this.removeAt(slot, "evict");
      }
      slot = next;
    }
    this.evictOverflow();
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

  snapshot(): readonly CacheEntry<K, V>[] {
    this.pruneExpired();
    return [...this].map(([key, value]) => ({ key, value }));
  }

  [Symbol.iterator](): IterableIterator<readonly [K, V]> {
    return this.entries();
  }

  private allocSlot(): number {
    if (this.freeSlots.length > 0) {
      return this.freeSlots.pop()!;
    }
    const slot = this.entryKeys.length;
    this.entryKeys.push(undefined as unknown as K);
    this.entryVals.push(undefined as unknown as V);
    this.next.push(EMPTY_VALUE);
    this.prev.push(EMPTY_VALUE);
    return slot;
  }

  private append(slot: number): void {
    this.prev[slot] = this.tail;
    if (this.tail !== EMPTY_VALUE) {
      this.next[this.tail] = slot;
    } else {
      this.head = slot;
    }
    this.tail = slot;
  }

  private unlink(slot: number): void {
    const p = this.prev[slot];
    const n = this.next[slot];

    if (p !== EMPTY_VALUE) {
      this.next[p] = n;
    } else {
      this.head = n;
    }

    if (n !== EMPTY_VALUE) {
      this.prev[n] = p;
    } else {
      this.tail = p;
    }

    this.prev[slot] = EMPTY_VALUE;
    this.next[slot] = EMPTY_VALUE;
  }

  private moveToTail(slot: number): void {
    if (slot === this.tail) {
      return;
    }

    const p = this.prev[slot];
    const n = this.next[slot];
    if (p !== EMPTY_VALUE) {
      this.next[p] = n;
    } else {
      this.head = n;
    }
    if (n !== EMPTY_VALUE) {
      this.prev[n] = p;
    } else {
      this.tail = p;
    }
    this.prev[slot] = this.tail;
    if (this.tail !== EMPTY_VALUE) {
      this.next[this.tail] = slot;
    } else {
      this.head = slot;
    }
    this.tail = slot;
  }

  private removeAt(slot: number, reason: CacheDeleteReason): void {
    const key = this.entryKeys[slot];
    if (!this.records.delete(key)) {
      return;
    }

    const value = this.entryVals[slot];
    const size = this.getSize(slot);

    this.unlink(slot);
    this.entryCount--;
    this.calculatedSizeValue -= size;

    this.entryKeys[slot] = undefined as unknown as K;
    this.entryVals[slot] = undefined as unknown as V;
    this.freeSlots.push(slot);

    this.emitDelete({ key, value, reason, size });
  }

  private evictOverflow(): void {
    while (
      this.head !== EMPTY_VALUE &&
      (this.entryCount > this.maxEntriesValue || this.calculatedSizeValue > this.maxSizeValue)
    ) {
      this.removeAt(this.head, "evict");
    }
  }

  private isExpired(slot: number): boolean {
    if (this.expires === undefined) {
      return false;
    }
    return this.expires[slot] !== Number.POSITIVE_INFINITY && this.expires[slot] <= Date.now();
  }

  private getSize(slot: number): number {
    if (this.sizes !== undefined) {
      return this.sizes[slot];
    }
    return 1;
  }

  private setSize(slot: number, size: number): void {
    if (this.sizes !== undefined) {
      this.sizes[slot] = size;
    }
  }

  private setExpires(slot: number, expiresAt: number): void {
    if (this.expires === undefined) {
      this.expires = [];
    }
    while (this.expires.length <= slot) {
      this.expires.push(Number.POSITIVE_INFINITY);
    }
    this.expires[slot] = expiresAt;
  }

  private emitHit(slot: number): void {
    if (!this.hasListeners()) {
      return;
    }
    this.pubsub.emit("cache:hit", {
      key: this.entryKeys[slot],
      value: this.entryVals[slot],
      source: "cache",
    });
  }

  private emitMiss(key: K): void {
    if (!this.hasListeners()) {
      return;
    }
    this.pubsub.emit("cache:miss", { key, source: "cache" });
  }

  private emitSet(event: CacheSetEvent<K, V>): void {
    if (!this.hasListeners()) {
      return;
    }
    this.pubsub.emit("cache:set", event);
    this.pubsub.emit("cache:change", event);
  }

  private emitClear(event: CacheClearEvent<K, V>): void {
    if (!this.hasListeners()) {
      return;
    }
    this.pubsub.emit("cache:clear", event);
    this.pubsub.emit("cache:change", event);
  }

  private emitResize(event: CacheResizeEvent): void {
    if (!this.hasListeners()) {
      return;
    }
    this.pubsub.emit("cache:resize", event);
    this.pubsub.emit("cache:change", event);
  }

  private emitDelete(eviction: CacheEviction<K, V>): void {
    const hasListeners = this.hasListeners();
    if (this.onEvict === undefined && !hasListeners) {
      return;
    }

    this.onEvict?.(eviction);
    if (!hasListeners) {
      return;
    }

    const event = { ...eviction, source: "cache" as const };
    this.pubsub.emit("cache:delete", event);
    this.pubsub.emit("cache:change", event);
  }

  private hasListeners(): boolean {
    return this.listenerCountValue > 0;
  }

  private findActiveOnceSubscription<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): OnceSubscription<K, V> | undefined {
    return this.onceSubscriptions.find(
      (subscription) =>
        subscription.active && subscription.pattern === pattern && subscription.handler === handler,
    );
  }

  private createEviction(slot: number, reason: CacheDeleteReason): CacheEviction<K, V> {
    return {
      key: this.entryKeys[slot],
      value: this.entryVals[slot],
      reason,
      size: this.getSize(slot),
    };
  }

  private *iterateEntries(): IterableIterator<readonly [K, V]> {
    let slot = this.tail;
    while (slot !== EMPTY_VALUE) {
      const current = slot;
      slot = this.prev[current];
      if (this.isExpired(current)) {
        this.removeAt(current, "stale");
        continue;
      }
      yield [this.entryKeys[current], this.entryVals[current]] as const;
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

function defaultSizeOf<K, V>(entry: CacheEntry<K, V>): number {
  return sizeOf(entry.key) + sizeOf(entry.value);
}

function validateLimit(value: number, name: string): number {
  if (value === Number.POSITIVE_INFINITY) {
    return value;
  }

  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`Cache ${name} must be a positive safe integer or Infinity`);
  }

  return value;
}

function validateTtl(value: number | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`Cache ${name} must be a finite non-negative number`);
  }

  return value;
}
