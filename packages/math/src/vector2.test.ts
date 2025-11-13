import { expect, test } from "vitest";

import { vector2 } from "./vector2";

test("vector2 math", () => {
  expect(vector2.add(vector2.of(3, 0), 1, 2)).toEqual(vector2.of(4, 2));
  expect(vector2.subtract(vector2.of(3, 0), 1, 2)).toEqual(vector2.of(2, -2));
  expect(vector2.multiply(vector2.of(3, 0), 2, 3)).toEqual(vector2.of(6, 0));
  expect(vector2.divide(vector2.of(3, 0), 2, 3)).toEqual(vector2.of(1.5, 0));

  expect(vector2.scale(vector2.of(3, 1), 2)).toEqual(vector2.of(6, 2));
});

test("vector2::displayString works", () => {
  expect(vector2.displayString(vector2.of(4, 2))).toStrictEqual(
    "Vector2(4, 2)",
  );
});
