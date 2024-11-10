import { assert } from "@std/assert";
import { deepEquals } from "~/value/ops.ts";

Deno.test("deepEquals() works", () => {
  const obj1 = { x: 1, y: 2, a: [1, 2] };
  const obj2 = { x: 1, y: 2, a: [1, 2] };
  const obj3 = { x: 1, y: 2, a: [3, 4] };
  assert(deepEquals(obj1, obj2));
  assert(!deepEquals(obj1, obj3));
});
