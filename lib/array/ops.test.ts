import { assert } from "@std/assert";

import { equals } from "./ops.ts";
import { deepEquals } from "../value/ops.ts";

Deno.test("equals() works", () => {
  assert(equals([1, 2, 3], [1, 2, 3]));
  assert(!equals([1, 2, 3], [1, 2, 3, 4]));

  assert(equals([{ x: 42 }], [{ x: 42 }], deepEquals));
  assert(equals([1, 2, 3], [1, 4, 9], (a, b) => (a ** 2) === b));
});
