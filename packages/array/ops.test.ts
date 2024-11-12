import { assert, assertEquals } from "@std/assert";

import { combineMerge, equals } from "./ops.ts";

Deno.test("equals() works", () => {
  assert(equals([1, 2, 3], [1, 2, 3]));
  assert(!equals([1, 2, 3], [1, 2, 3, 4]));
  assert(equals([{ x: 42 }], [{ x: 42 }]));
  assert(equals([1, 2, 3], [1, 4, 9], (a, b) => (a ** 2) === b));
});

Deno.test("combineMerge() works", () => {
  assertEquals(
    combineMerge([1, 2], [3, 4]),
    [1, 2, 3, 4],
  );
  assertEquals(
    combineMerge([{}, { x: 1 }, { a: "a" }], [{ y: 1 }, { x: 2 }, { b: "b" }]),
    [{ y: 1 }, { x: 2 }, { a: "a", b: "b" }],
  );
});
