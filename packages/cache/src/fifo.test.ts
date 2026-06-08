import { describe, expect, expectTypeOf, test } from "vitest";

import { FifoCache, type Cache } from "./mod.ts";

describe("FifoCache", () => {
  test("evicts the oldest inserted entry without refreshing on access", () => {
    const cache: Cache<string, number> = new FifoCache({ maxEntries: 2 });

    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3);

    expect(cache.has("a")).toBe(false);
    expect([...cache.entries()]).toEqual([
      ["b", 2],
      ["c", 3],
    ]);
    expectTypeOf(new FifoCache<string, number>()).toEqualTypeOf<FifoCache<string, number>>();
  });
});
