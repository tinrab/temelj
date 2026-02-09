import { expect, test } from "vitest";

import { arrayCombineMerge, arrayEquals } from "./array";

test("arrayEquals() works", () => {
  expect(arrayEquals([1, 2, 3], [1, 2, 3])).toStrictEqual(true);
  expect(arrayEquals([1, 2, 3], [1, 2, 3, 4])).toStrictEqual(false);
  expect(arrayEquals([{ x: 42 }], [{ x: 42 }])).toStrictEqual(true);
  expect(
    arrayEquals([1, 2, 3], [1, 4, 9], (a: number, b: number) => a ** 2 === b),
  ).toStrictEqual(true);
});

test("arrayCombineMerge() works", () => {
  expect(arrayCombineMerge([1, 2], [3, 4])).toStrictEqual([1, 2, 3, 4]);
  expect(
    arrayCombineMerge(
      [{}, { x: 1 }, { a: "a" }],
      [{ y: 1 }, { x: 2 }, { b: "b" }],
    ),
  ).toStrictEqual([{ y: 1 }, { x: 2 }, { a: "a", b: "b" }]);
});
