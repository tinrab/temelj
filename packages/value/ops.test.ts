import { assert, assertEquals } from "@std/assert";

import { deepEquals, primitivize } from "./ops.ts";

Deno.test("deepEquals() works", () => {
  const obj1 = { x: 1, y: 2, a: [1, 2] };
  const obj2 = { x: 1, y: 2, a: [1, 2] };
  const obj3 = { x: 1, y: 2, a: [3, 4] };
  assert(deepEquals(obj1, obj2));
  assert(!deepEquals(obj1, obj3));
});

Deno.test("primitivize() works", () => {
  assertEquals(
    primitivize({
      x: 42,
      entries: new Map([
        ["a", 1],
        ["b", 2],
      ]),
      items: new Set([1, 2, 3]),
    }),
    {
      x: 42,
      entries: {
        a: 1,
        b: 2,
      },
      items: [1, 2, 3],
    },
  );
});
