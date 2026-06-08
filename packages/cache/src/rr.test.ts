import { describe, expect, expectTypeOf, test } from "vitest";

import { RandomReplacementCache } from "./mod.ts";

describe("RandomReplacementCache", () => {
  test("evicts a random entry", () => {
    const cache = new RandomReplacementCache<string, number>({
      maxEntries: 3,
      random: () => 0.5,
    });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    cache.set("d", 4);

    expect(cache.has("b")).toBe(false);
    expect([...cache.entries()]).toEqual([
      ["a", 1],
      ["c", 3],
      ["d", 4],
    ]);
    expectTypeOf(cache).toEqualTypeOf<RandomReplacementCache<string, number>>();
  });
});
