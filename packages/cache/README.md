<p align="center">
  <h1 align="center" style="text-decoration:none;">@temelj/cache</h1>
  <br/>
  <p align="center">
    A fast in-memory cache.
  </p>
</p>

<p align="center">
  <a href="https://twitter.com/tinrab" rel="nofollow"><img src="https://img.shields.io/badge/created%20by-@tinrab-1d9bf0.svg" alt="Created by Tin Rabzelj"></a>
  <a href="https://jsr.io/@temelj/cache" rel="nofollow"><img src="https://jsr.io/badges/@temelj/cache" alt="jsr"></a>
  <a href="https://opensource.org/licenses/MIT" rel="nofollow"><img src="https://img.shields.io/github/license/tinrab/temelj" alt="License"></a>
</p>

<div align="center">
  <a href="https://jsr.io/@temelj/cache">jsr</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.npmjs.com/package/@temelj/cache">npm</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/tinrab/temelj/issues/new">Issues</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://twitter.com/tinrab">@tinrab</a>
  <br />
</div>

<br/>
<br/>

## Installation

```sh
# npm
$ npm install @temelj/cache
# jsr
$ deno add jsr:@temelj/cache # or jsr add @temelj/cache
```

## Usage

The package includes several caching strategies.
All come with an event system (using [@temelj/event](../event)) and iterator API.

| Strategy      | Class                    | Description                                                                                                                                                                            |
| ------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LRU**       | `LruCache`               | Evicts the least recently accessed items first. Items accessed recently are more likely to be accessed again in the near future.                                                       |
| **Async LRU** | `AsyncLruCache`          | Wraps `LruCache` with an async API and deduplicates concurrent identical requests. Useful for memoizing async operations.                                                              |
| **MRU**       | `MruCache`               | Evicts the most recently used items first. Useful when the most recently accessed items are less likely to be accessed again soon.                                                     |
| **SLRU**      | `SlruCache`              | Segmented LRU divides the cache into a probationary and a protected segment. New items start in the probationary segment and are promoted to the protected segment on a second access. |
| **LFU**       | `LfuCache`               | Evicts the items with the lowest access frequency.                                                                                                                                     |
| **FIFO**      | `FifoCache`              | Evicts the oldest items first, regardless of access patterns or frequency.                                                                                                             |
| **RR**        | `RandomReplacementCache` | Evicts a randomly selected item to make space for new ones. Does not track access patterns.                                                                                            |

All are importable from `@temelj/cache`:

```ts
import {
  LruCache,
  MruCache,
  SlruCache,
  LfuCache,
  FifoCache,
  RandomReplacementCache,
  AsyncLruCache,
} from "@temelj/cache";
```

Example of using `LruCache`.

```ts
import { LruCache } from "@temelj/cache";

const cache = new LruCache<string, number>({ maxEntries: 1000 });

cache.set("key:1", 42);
const value = cache.get("key:1");
cache.has("key:1");
cache.delete("key:1");
cache.clear();
```

Set a default TTL for all entries in milliseconds, or override it per entry.

```ts
const cache = new LruCache<string, number>({ maxEntries: 1000, ttl: 60_000 });

cache.get("key:1"); // alive within 60s of insertion

cache.set("session:1", 1, { ttl: 10_000 }); // override TTL per entry
```

Evict entries when total estimated size exceeds `maxSize`, or when a single entry exceeds `maxEntrySize`.

You can provide a custom `sizeOf` function.
By default it uses `sizeOf` from [@temelj/value](../value).

```ts
const cache = new LruCache<string, number[]>({
  maxEntries: Infinity,
  maxSize: 10_000,
  maxEntrySize: 1_000,
  sizeOf: ({ value }) => value.length,
});

cache.set("a", [1, 2, 3]); // size 3
cache.set("b", new Array(1200)); // rejected — exceeds maxEntrySize
```

React to evictions with the `onEvict` option.

```ts
const cache = new LruCache<string, number>({
  maxEntries: 3,
  onEvict: (eviction) => {
    console.log(eviction.key, eviction.value, eviction.reason);
  },
});
```

Subscribe to cache events with `on`, `once`, and `off`.

```ts
const unsub = cache.on("cache:delete", (event) => {
  console.log(event.key, event.reason);
});

cache.delete("key:1");
unsub();
```

Available events are `cache:hit`, `cache:miss`, `cache:set`, `cache:delete`, `cache:clear`, `cache:resize`, and `cache:change`.
Use `cache:*` or `*` patterns to listen broadly.

```ts
cache.on("cache:*", (event, type) => {
  console.log(type, event);
});

console.log(cache.listenerCount("cache:set"));
cache.clearListeners();
```

Iterate entries from most to least recently used.

```ts
for (const [key, value] of cache) {
  console.log(key, value);
}

for (const key of cache.keys()) {
  console.log(key);
}

for (const value of cache.values()) {
  console.log(value);
}

const snapshot = cache.snapshot();
```

## Benchmarks

Run benchmarks with:

```sh
$ pnpm --filter @temelj/cache bench
```

Results:

### set — sequential writes up to capacity

| Task name                | Latency avg (µs) | Throughput avg (ops/s) | vs baseline |
| ------------------------ | ---------------- | ---------------------- | ----------- |
| @temelj/cache (LruCache) | 2791             | 399                    | —           |
| lru-cache                | 4673             | 219                    | -45.0% 🥇   |
| quick-lru                | 2433             | 492                    | +23.4%      |
| mnemonist (LRUCache)     | 3335             | 313                    | -21.6% 🥇   |

### get (hit) — sequential reads of existing keys

| Task name                | Latency avg (µs) | Throughput avg (ops/s) | vs baseline |
| ------------------------ | ---------------- | ---------------------- | ----------- |
| @temelj/cache (LruCache) | 736.2            | 1361                   | —           |
| lru-cache                | 743.2            | 1348                   | -0.9% 🥇    |
| quick-lru                | 4062             | 264                    | -80.6% 🥇   |
| mnemonist (LRUCache)     | 538.8            | 1864                   | +37.0%      |

### get (miss) — sequential reads of missing keys

| Task name                | Latency avg (µs) | Throughput avg (ops/s) | vs baseline |
| ------------------------ | ---------------- | ---------------------- | ----------- |
| @temelj/cache (LruCache) | 96.5             | 10373                  | —           |
| lru-cache                | 114.3            | 8756                   | -15.6% 🥇   |
| quick-lru                | 148.2            | 6752                   | -34.9% 🥇   |
| mnemonist (LRUCache)     | 2465             | 406                    | -96.1% 🥇   |

### update — overwrite values for existing keys

| Task name                | Latency avg (µs) | Throughput avg (ops/s) | vs baseline |
| ------------------------ | ---------------- | ---------------------- | ----------- |
| @temelj/cache (LruCache) | 967.1            | 1036                   | —           |
| lru-cache                | 1151             | 888                    | -14.3% 🥇   |
| quick-lru                | 2134             | 532                    | -48.6% 🥇   |
| mnemonist (LRUCache)     | 586.0            | 1775                   | +71.3%      |

### mixed — 50/50 get hit + update

| Task name                | Latency avg (µs) | Throughput avg (ops/s) | vs baseline |
| ------------------------ | ---------------- | ---------------------- | ----------- |
| @temelj/cache (LruCache) | 887.8            | 1128                   | —           |
| lru-cache                | 1098             | 923                    | -18.1% 🥇   |
| quick-lru                | 2422             | 431                    | -61.8% 🥇   |
| mnemonist (LRUCache)     | 560.7            | 1793                   | +59.0%      |

### eviction — write 2x capacity (forces evictions)

| Task name                | Latency avg (µs) | Throughput avg (ops/s) | vs baseline |
| ------------------------ | ---------------- | ---------------------- | ----------- |
| @temelj/cache (LruCache) | 12305            | 82                     | —           |
| lru-cache                | 15996            | 64                     | -22.4% 🥇   |
| quick-lru                | 11500            | 93                     | +13.6%      |
| mnemonist (LRUCache)     | 14446            | 71                     | -13.9% 🥇   |

### zigzag — alternating head/tail reads

| Task name                | Latency avg (µs) | Throughput avg (ops/s) | vs baseline |
| ------------------------ | ---------------- | ---------------------- | ----------- |
| @temelj/cache (LruCache) | 1671             | 599                    | —           |
| lru-cache                | 2120             | 475                    | -20.8% 🥇   |
| quick-lru                | 7155             | 147                    | -75.5% 🥇   |
| mnemonist (LRUCache)     | 1244             | 829                    | +38.3%      |

### delete — remove existing keys

| Task name                      | Latency avg (µs) | Throughput avg (ops/s) | vs baseline |
| ------------------------------ | ---------------- | ---------------------- | ----------- |
| @temelj/cache (LruCache)       | 9164             | 114                    | —           |
| lru-cache                      | 10418            | 98                     | -14.3% 🥇   |
| quick-lru                      | 7417             | 142                    | +24.4%      |
| mnemonist (LRUCacheWithDelete) | 9598             | 106                    | -6.6% 🥇    |

### has — check existing keys

| Task name                | Latency avg (µs) | Throughput avg (ops/s) | vs baseline |
| ------------------------ | ---------------- | ---------------------- | ----------- |
| @temelj/cache (LruCache) | 10.2             | 98293                  | —           |
| lru-cache                | 656.4            | 1527                   | -98.4% 🥇   |
| quick-lru                | 819.9            | 1222                   | -98.8% 🥇   |
| mnemonist (LRUCache)     | 424.8            | 2364                   | -97.6% 🥇   |

## About

This package is part of [Temelj](https://github.com/tinrab/temelj) - a core library for TypeScript.
