import { assertEquals } from "@std/assert";

import { collectMap } from "./ops.ts";

Deno.test("collectMap() works", () => {
  assertEquals(
    collectMap([1, 2, 3], (item) => item * 2),
    { 2: 1, 4: 2, 6: 3 },
  );
});
