import { describe, expect, expectTypeOf, test } from "vitest";

import { MruCache } from "./mod.ts";

describe("MruCache", () => {
  test("evicts the most recently used entry", () => {
    const evictions: string[] = [];
    const cache = new MruCache<string, number>({
      maxEntries: 2,
      onEvict: (event) => evictions.push(`${event.reason}:${event.key}`),
    });

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.has("a")).toBe(false);
    expect([...cache.entries()]).toEqual([
      ["c", 3],
      ["b", 2],
    ]);
    expect(evictions).toEqual(["evict:a"]);
    expectTypeOf(cache).toEqualTypeOf<MruCache<string, number>>();
  });
});
