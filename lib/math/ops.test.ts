import { assertEquals } from "@std/assert";
import { clampWithOverflow } from "~/math/ops.ts";
import { clamp } from "~/math/ops.ts";

Deno.test("clamp() works", () => {
  assertEquals(clamp(5, 0, 10), 5);
  assertEquals(clamp(12, 0, 10), 10);
  assertEquals(clamp(-2, 0, 10), 0);
});

Deno.test("clampWithOverflow() works", () => {
  assertEquals(clampWithOverflow(5, 0, 10), 5);
  assertEquals(clampWithOverflow(12, 0, 10), 2);
  assertEquals(clampWithOverflow(-2, 0, 10), 8);
});
