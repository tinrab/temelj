import { assert, assertEquals } from "@std/assert";

import { recordEquals, recordMerge } from "./record.ts";

Deno.test("recordEquals() works", () => {
  assert(recordEquals({ a: 1, b: 2 }, { a: 1, b: 2 }));

  assert(!recordEquals({ a: 1 }, { a: 3 }));
});

Deno.test("recordMerge() works", () => {
  const obj1 = { x: 1, y: 2, a: [1, 2] };
  const obj2 = { z: 3, w: 4, a: [3, 4] };
  const obj3 = { s: "foo" };
  assertEquals(recordMerge<unknown>([obj1, obj2, obj3]), {
    x: 1,
    y: 2,
    z: 3,
    w: 4,
    a: [1, 2, 3, 4],
    s: "foo",
  });
});
