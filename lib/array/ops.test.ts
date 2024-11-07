import { assert, assertEquals } from "@std/assert";
import { collectMap, deepEquals } from "./ops.ts";

Deno.test("deepEquals() works", () => {
  assert(deepEquals([1, 2, 3], [1, 2, 3]));
  assert(deepEquals([{ x: 42 }], [{ x: 42 }]));

  assert(!deepEquals([1, 2, 3], [1, 2, 3, 4]));

  assert(deepEquals([1, 2, 3], [1, 4, 9], (a, b) => (a ** 2) === b));
});

Deno.test("collectMap() works", () => {
  assertEquals(
    collectMap([1, 2, 3], (item) => item * 2),
    { 2: 1, 4: 2, 6: 3 },
  );
});
