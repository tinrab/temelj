import { describe, expect, expectTypeOf, test } from "vitest";

import { SlruCache } from "./mod.ts";

describe("SlruCache", () => {
  test("promotes probationary hits into the protected segment", () => {
    const cache = new SlruCache<string, number>({
      maxEntries: 3,
      protectedEntries: 1,
    });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    cache.set("d", 4);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
    expect([...cache.entries()]).toEqual([
      ["a", 1],
      ["d", 4],
      ["c", 3],
    ]);
    expect(cache.protectedEntries).toBe(1);
    expectTypeOf(cache).toEqualTypeOf<SlruCache<string, number>>();
  });

  test("demotes protected LRU entries when the protected segment overflows", () => {
    const cache = new SlruCache<string, number>({
      maxEntries: 4,
      protectedEntries: 1,
    });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    cache.set("d", 4);
    cache.set("e", 5);

    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(false);

    cache.set("f", 6);

    expect(cache.has("a")).toBe(false);
    expect([...cache.keys()]).toEqual(["b", "f", "e", "d"]);
  });
});
