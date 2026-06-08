import { createPubSub } from "@temelj/event";

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
} from "./types.ts";

export interface PolicyCacheOptions<K, V> {
  readonly maxEntries?: number;
  readonly onEvict?: (eviction: CacheEviction<K, V>) => void;
  readonly entries?: Iterable<readonly [K, V]>;
}

export interface EntryRecord<V> {
  value: V;
}

export abstract class EntryCountCache<K, V> implements Cache<K, V> {
  protected readonly pubsub = createPubSub<CacheEventMap<K, V>>();
  protected readonly onEvict: ((eviction: CacheEviction<K, V>) => void) | undefined;
  protected maxEntriesValue: number;
  protected entryCount = 0;

  constructor(options: PolicyCacheOptions<K, V> = {}) {
    this.maxEntriesValue = validateLimit(options.maxEntries ?? 1000, "maxEntries");
    this.onEvict = options.onEvict;
  }

  get size(): number {
    return this.entryCount;
  }

  get maxEntries(): number {
    return this.maxEntriesValue;
  }

  get calculatedSize(): number {
    return this.entryCount;
  }

  get maxSize(): number {
    return Number.POSITIVE_INFINITY;
  }

  on<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): () => void {
    return this.pubsub.on(pattern, handler);
  }

  once<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): () => void {
    return this.pubsub.once(pattern, handler);
  }

  off<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): void {
    this.pubsub.off(pattern, handler);
  }

  listeners(): readonly CacheEventHandler<K, V>[];
  listeners<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
  ): readonly CacheEventHandler<K, V, Pattern>[];
  listeners(pattern?: CacheEventPattern<K, V>): readonly CacheEventHandler<K, V>[] {
    return pattern === undefined ? this.pubsub.listeners() : this.pubsub.listeners(pattern);
  }

  clearListeners(pattern?: CacheEventPattern<K, V>): void {
    this.pubsub.clear(pattern);
  }

  listenerCount(pattern?: CacheEventPattern<K, V>): number {
    return this.pubsub.listenerCount(pattern);
  }

  abstract set(key: K, value: V, options?: CacheSetOptions): boolean;
  abstract get(key: K): V | undefined;
  abstract peek(key: K): V | undefined;
  abstract has(key: K): boolean;
  abstract delete(key: K): boolean;
  abstract clear(): void;
  abstract entries(): IterableIterator<readonly [K, V]>;
  abstract keys(): IterableIterator<K>;
  abstract values(): IterableIterator<V>;
  abstract [Symbol.iterator](): IterableIterator<readonly [K, V]>;

  pruneExpired(): number {
    return 0;
  }

  snapshot(): readonly CacheEntry<K, V>[] {
    return [...this].map(([key, value]) => ({ key, value }));
  }

  resize(options: Pick<PolicyCacheOptions<K, V>, "maxEntries">): void {
    if (options.maxEntries !== undefined) {
      this.maxEntriesValue = validateLimit(options.maxEntries, "maxEntries");
      this.evictOverflow();
    }

    this.emitResize({
      source: "cache",
      maxEntries: this.maxEntriesValue,
      maxSize: this.maxSize,
      maxEntrySize: this.maxSize,
    });
  }

  protected abstract evictOverflow(): void;

  protected emitHit(key: K, value: V): void {
    this.pubsub.emit("cache:hit", { key, value, source: "cache" });
  }

  protected emitMiss(key: K): void {
    this.pubsub.emit("cache:miss", { key, source: "cache" });
  }

  protected emitSet(event: CacheSetEvent<K, V>): void {
    this.pubsub.emit("cache:set", event);
    this.pubsub.emit("cache:change", event);
  }

  protected emitDelete(eviction: CacheEviction<K, V>): void {
    this.onEvict?.(eviction);
    const event = { ...eviction, source: "cache" as const };
    this.pubsub.emit("cache:delete", event);
    this.pubsub.emit("cache:change", event);
  }

  protected emitClear(event: CacheClearEvent<K, V>): void {
    this.pubsub.emit("cache:clear", event);
    this.pubsub.emit("cache:change", event);
  }

  protected emitResize(event: CacheResizeEvent): void {
    this.pubsub.emit("cache:resize", event);
    this.pubsub.emit("cache:change", event);
  }

  protected createEviction(key: K, value: V, reason: CacheDeleteReason): CacheEviction<K, V> {
    return { key, value, reason, size: 1 };
  }
}

export function firstKey<K>(values: Map<K, unknown>): K | undefined {
  return values.keys().next().value as K | undefined;
}

export function lastKey<K>(values: Map<K, unknown>): K | undefined {
  let found: K | undefined;
  for (const key of values.keys()) {
    found = key;
  }
  return found;
}

export function validateLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`Cache ${name} must be a positive safe integer`);
  }

  return value;
}
