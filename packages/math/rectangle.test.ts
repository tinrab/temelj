import { expect, test } from "vitest";

import { rectangle } from "./rectangle";
import { vector2 } from "./vector2";

test("rectangle::expand works", () => {
  expect(
    rectangle.expand(
      rectangle.ofBounds(2, 0, 10, 5),
      rectangle.ofBounds(0, 2, 5, 10),
    ),
    rectangle.ofBounds(0, 0, 12, 12),
  );
});

test("rectangle::center works", () => {
  expect(rectangle.center(rectangle.ofBounds(2, 2, 6, 6)), vector2.of(5, 5));
});

test("rectangle::overlaps works", () => {
  expect(
    rectangle.overlaps(
      rectangle.ofBounds(0, 0, 5, 5),
      rectangle.ofBounds(3, 3, 4, 4),
    ),
  );
  expect(
    rectangle.overlaps(
      rectangle.ofBounds(2, 2, 3, 3),
      rectangle.ofBounds(0, 0, 10, 10),
    ),
  );

  expect(
    !rectangle.overlaps(
      rectangle.ofBounds(0, 0, 1, 1),
      rectangle.ofBounds(1, 1, 1, 1),
    ),
  );
});
