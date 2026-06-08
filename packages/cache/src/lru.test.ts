import { describe, expect, expectTypeOf, test, vi } from "vitest";

import { AsyncLruCache, LruCache, memoizeLru, type Cache } from "./mod.ts";

describe("LruCache", () => {
  test("stores and reads values", () => {
    const cache = new LruCache<string, number>({ maxEntries: 2 });

    expect(cache.set("a", 1)).toBe(true);
    expect(cache.get("a")).toBe(1);
    expect(cache.has("a")).toBe(true);
    expect(cache.peek("missing")).toBeUndefined();
    expectTypeOf(cache).toEqualTypeOf<LruCache<string, number>>();
  });

  test("evicts the least recently used entry by maxEntries", () => {
    const evictions: string[] = [];
    const cache = new LruCache<string, number>({
      maxEntries: 2,
      onEvict: (event) => evictions.push(`${event.reason}:${event.key}`),
    });

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.has("b")).toBe(false);
    expect([...cache.keys()]).toEqual(["c", "a"]);
    expect(evictions).toEqual(["evict:b"]);
  });

  test("keeps a single-entry cache consistent after repeated evictions", () => {
    const cache = new LruCache<string, number>({ maxEntries: 1 });

    expect(cache.set("a", 1)).toBe(true);
    expect(cache.set("b", 2)).toBe(true);
    expect(cache.set("c", 3)).toBe(true);

    expect(cache.size).toBe(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
    expect([...cache.entries()]).toEqual([["c", 3]]);
  });

  test("peek does not refresh recency", () => {
    const cache = new LruCache<string, number>({ maxEntries: 2 });

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.peek("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.has("a")).toBe(false);
    expect([...cache.keys()]).toEqual(["c", "b"]);
  });

  test("evicts by calculated size", () => {
    const cache = new LruCache<string, string>({
      maxEntries: Number.POSITIVE_INFINITY,
      maxSize: 3,
      sizeOf: ({ value }) => value.length,
    });

    expect(cache.set("a", "aa")).toBe(true);
    expect(cache.set("b", "b")).toBe(true);
    expect(cache.calculatedSize).toBe(3);
    expect(cache.set("c", "cc")).toBe(true);

    expect([...cache.entries()]).toEqual([
      ["c", "cc"],
      ["b", "b"],
    ]);
    expect(cache.calculatedSize).toBe(3);
  });

  test("rejects oversized entries without storing them", () => {
    const evictions: string[] = [];
    const cache = new LruCache<string, string>({
      maxSize: 4,
      sizeOf: ({ value }) => value.length,
      onEvict: (event) => evictions.push(`${event.reason}:${event.key}`),
    });

    expect(cache.set("a", "ok")).toBe(true);
    expect(cache.set("a", "large")).toBe(false);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.calculatedSize).toBe(0);
    expect(evictions).toEqual(["set:a"]);
  });

  test("expires values by ttl", () => {
    vi.useFakeTimers();
    try {
      const evictions: string[] = [];
      const cache = new LruCache<string, number>({
        maxEntries: 2,
        ttl: 100,
        onEvict: (event) => evictions.push(`${event.reason}:${event.key}`),
      });

      cache.set("a", 1);
      vi.advanceTimersByTime(99);
      expect(cache.get("a")).toBe(1);

      vi.advanceTimersByTime(1);
      expect(cache.size).toBe(0);
      expect(cache.get("a")).toBeUndefined();
      expect(evictions).toEqual(["stale:a"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("supports per-entry ttl and explicit pruning", () => {
    vi.useFakeTimers();
    try {
      const cache = new LruCache<string, number>({ maxEntries: 4 });

      cache.set("a", 1, { ttl: 10 });
      cache.set("b", 2);
      vi.advanceTimersByTime(10);

      expect(cache.pruneExpired()).toBe(1);
      expect(cache.snapshot()).toEqual([{ key: "b", value: 2 }]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("deletes, clears, and reports reasons", () => {
    const evictions: string[] = [];
    const cache = new LruCache<string, number>({
      maxEntries: 3,
      onEvict: (event) => evictions.push(`${event.reason}:${event.key}`),
    });

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.delete("a")).toBe(true);
    expect(cache.delete("missing")).toBe(false);
    cache.clear();

    expect(cache.size).toBe(0);
    expect(cache.calculatedSize).toBe(0);
    expect(evictions).toEqual(["delete:a", "clear:b"]);
  });

  test("emits typed cache events", () => {
    const cache = new LruCache<string, number>({ maxEntries: 2 });
    const events: string[] = [];

    const unsubscribe = cache.on("cache:*", (event, type) => {
      if ("key" in event) {
        events.push(`${type}:${String(event.key)}`);
      } else {
        events.push(type);
      }
    });

    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("missing")).toBeUndefined();
    expect(cache.listenerCount("cache:*")).toBe(1);
    unsubscribe();
    cache.set("b", 2);

    expect(events).toEqual(["cache:set:a", "cache:change:a", "cache:hit:a", "cache:miss:missing"]);
  });

  test("can be resized after creation", () => {
    const cache = new LruCache<string, number>({ maxEntries: 4, sizeOf: () => 1 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.resize({ maxEntries: 2 });

    expect([...cache.keys()]).toEqual(["c", "b"]);
    expect(cache.maxEntries).toBe(2);
  });

  test("initial entries are ordered from least to most recent", () => {
    const cache: Cache<string, number> = new LruCache({
      maxEntries: 2,
      entries: [
        ["a", 1],
        ["b", 2],
      ],
    });

    expect([...cache]).toEqual([
      ["b", 2],
      ["a", 1],
    ]);
  });

  test("validates limits and size hooks", () => {
    expect(() => new LruCache({ maxEntries: 0 })).toThrow(RangeError);
    expect(() => new LruCache({ maxSize: 0 })).toThrow(RangeError);
    expect(() => new LruCache({ ttl: -1 })).toThrow(RangeError);

    const cache = new LruCache<string, number>({ sizeOf: () => Number.NaN });
    expect(() => cache.set("a", 1)).toThrow(RangeError);
  });
});

describe("AsyncLruCache", () => {
  test("deduplicates concurrent loads and stores loaded values", async () => {
    let calls = 0;
    const cache = new AsyncLruCache<string, number>({
      maxEntries: 2,
      async loader(key) {
        calls++;
        await Promise.resolve();
        return key.length;
      },
    });

    const [first, second] = await Promise.all([cache.get("abc"), cache.get("abc")]);

    expect(first).toBe(3);
    expect(second).toBe(3);
    expect(calls).toBe(1);
    expect(cache.pending).toBe(0);
    expect(await cache.get("abc")).toBe(3);
    expect(calls).toBe(1);
  });

  test("supports per-call loaders and abortable waiters", async () => {
    let resolve: ((value: number) => void) | undefined;
    const cache = new AsyncLruCache<string, number>();
    const controller = new AbortController();
    const promise = cache.getOrLoad(
      "a",
      () =>
        new Promise<number>((done) => {
          resolve = done;
        }),
      { signal: controller.signal },
    );

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });

    resolve?.(1);
    await expect(cache.getOrLoad("a", async () => 2)).resolves.toBe(1);
  });

  test("does not start loaders for pre-aborted calls", async () => {
    let calls = 0;
    const cache = new AsyncLruCache<string, number>();
    const controller = new AbortController();

    controller.abort();

    await expect(
      cache.getOrLoad(
        "a",
        async () => {
          calls++;
          return 1;
        },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(calls).toBe(0);
  });
});

describe("memoizeLru", () => {
  test("memoizes async functions and deduplicates concurrent calls", async () => {
    let calls = 0;
    const add = memoizeLru(
      async (left: number, right: number) => {
        calls++;
        return left + right;
      },
      { maxEntries: 2 },
    );

    await expect(Promise.all([add(1, 2), add(1, 2)])).resolves.toEqual([3, 3]);
    await expect(add(1, 2)).resolves.toBe(3);
    expect(calls).toBe(1);
  });
});
