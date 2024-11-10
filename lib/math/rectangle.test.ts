import { assert, assertEquals } from "@std/assert";
import { Rectangle } from "~/math/rectangle.ts";
import { Vector2 } from "~/math/vector2.ts";

Deno.test("Rectangle::expand works", () => {
  assertEquals(
    Rectangle.expand(
      Rectangle.ofBounds(2, 0, 10, 5),
      Rectangle.ofBounds(0, 2, 5, 10),
    ),
    Rectangle.ofBounds(0, 0, 12, 12),
  );
});

Deno.test("Rectangle::center works", () => {
  assertEquals(
    Rectangle.center(
      Rectangle.ofBounds(2, 2, 6, 6),
    ),
    Vector2.of(5, 5),
  );
});

Deno.test("Rectangle::overlaps works", () => {
  assert(
    Rectangle.overlaps(
      Rectangle.ofBounds(0, 0, 5, 5),
      Rectangle.ofBounds(3, 3, 4, 4),
    ),
  );
  assert(
    Rectangle.overlaps(
      Rectangle.ofBounds(2, 2, 3, 3),
      Rectangle.ofBounds(0, 0, 10, 10),
    ),
  );

  assert(
    !Rectangle.overlaps(
      Rectangle.ofBounds(0, 0, 1, 1),
      Rectangle.ofBounds(1, 1, 1, 1),
    ),
  );
});
