import type { EventHandler, EventPattern, Unsubscribe } from "@temelj/event";

export type CacheDeleteReason = "clear" | "delete" | "evict" | "set" | "stale";

export interface CacheEntry<K, V> {
  readonly key: K;
  readonly value: V;
}

export interface CacheEviction<K, V> extends CacheEntry<K, V> {
  readonly reason: CacheDeleteReason;
  readonly size: number;
}

export interface CacheHitEvent<K, V> extends CacheEntry<K, V> {
  readonly source: "cache";
}

export interface CacheMissEvent<K> {
  readonly key: K;
  readonly source: "cache";
}

export interface CacheSetEvent<K, V> extends CacheEntry<K, V> {
  readonly source: "cache";
  readonly size: number;
  readonly updated: boolean;
}

export interface CacheDeleteEvent<K, V> extends CacheEviction<K, V> {
  readonly source: "cache";
}

export interface CacheClearEvent<K, V> {
  readonly source: "cache";
  readonly entries: readonly CacheEviction<K, V>[];
}

export interface CacheResizeEvent {
  readonly source: "cache";
  readonly maxEntries: number;
  readonly maxSize: number;
  readonly maxEntrySize: number;
}

export type CacheChangeEvent<K, V> =
  | CacheSetEvent<K, V>
  | CacheDeleteEvent<K, V>
  | CacheClearEvent<K, V>
  | CacheResizeEvent;

export interface CacheEventMap<K, V> {
  readonly "cache:hit": CacheHitEvent<K, V>;
  readonly "cache:miss": CacheMissEvent<K>;
  readonly "cache:set": CacheSetEvent<K, V>;
  readonly "cache:delete": CacheDeleteEvent<K, V>;
  readonly "cache:clear": CacheClearEvent<K, V>;
  readonly "cache:resize": CacheResizeEvent;
  readonly "cache:change": CacheChangeEvent<K, V>;
}

export type CacheEventPattern<K, V> = EventPattern<CacheEventMap<K, V>>;

export type CacheEventHandler<
  K,
  V,
  Pattern extends CacheEventPattern<K, V> = CacheEventPattern<K, V>,
> = EventHandler<CacheEventMap<K, V>, Pattern>;

export type CacheSizeOf<K, V> = (entry: CacheEntry<K, V>) => number;

export interface CacheSetOptions {
  /**
   * Time to live in milliseconds for this entry.
   */
  readonly ttl?: number;
}

export interface Cache<K, V> extends Iterable<readonly [K, V]> {
  readonly size: number;
  readonly maxEntries: number;
  readonly calculatedSize: number;
  readonly maxSize: number;

  on<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): Unsubscribe;
  once<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): Unsubscribe;
  off<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
    handler: CacheEventHandler<K, V, Pattern>,
  ): void;
  listeners(): readonly CacheEventHandler<K, V>[];
  listeners<Pattern extends CacheEventPattern<K, V>>(
    pattern: Pattern,
  ): readonly CacheEventHandler<K, V, Pattern>[];
  clearListeners(pattern?: CacheEventPattern<K, V>): void;
  listenerCount(pattern?: CacheEventPattern<K, V>): number;

  set(key: K, value: V, options?: CacheSetOptions): boolean;
  get(key: K): V | undefined;
  peek(key: K): V | undefined;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  pruneExpired(): number;
  entries(): IterableIterator<readonly [K, V]>;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
  snapshot(): readonly CacheEntry<K, V>[];
}
