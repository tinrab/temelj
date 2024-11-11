import { assertEquals } from "@std/assert";
import { Vector2 } from "./vector2.ts";

Deno.test("Vector2 math", () => {
  assertEquals(Vector2.add(Vector2.of(3, 0), 1, 2), Vector2.of(4, 2));
  assertEquals(Vector2.subtract(Vector2.of(3, 0), 1, 2), Vector2.of(2, -2));
  assertEquals(Vector2.multiply(Vector2.of(3, 0), 2, 3), Vector2.of(6, 0));
  assertEquals(Vector2.divide(Vector2.of(3, 0), 2, 3), Vector2.of(1.5, 0));

  assertEquals(Vector2.scale(Vector2.of(3, 1), 2), Vector2.of(6, 2));
});

Deno.test("Vector2::displayString works", () => {
  assertEquals(Vector2.displayString(Vector2.of(4, 2)), "Vector2(4, 2)");
});
