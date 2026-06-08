import { describe, expect, expectTypeOf, test } from "vitest";

import { LfuCache } from "./mod.ts";

describe("LfuCache", () => {
  test("evicts the least frequently used entry", () => {
    const cache = new LfuCache<string, number>({ maxEntries: 3 });

    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBe(2);
    cache.set("d", 4);

    expect(cache.has("c")).toBe(false);
    expect([...cache.keys()]).toEqual(["a", "b", "d"]);
    expectTypeOf(cache).toEqualTypeOf<LfuCache<string, number>>();
  });
});
