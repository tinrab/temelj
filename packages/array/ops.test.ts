import { expect, test } from "vitest";

import { combineMerge, equals } from "./ops";

test("equals() works", () => {
  expect(equals([1, 2, 3], [1, 2, 3])).toBe(true);
  expect(equals([1, 2, 3], [1, 2, 3, 4])).toBe(false);
  expect(equals([{ x: 42 }], [{ x: 42 }])).toBe(true);
  expect(equals([1, 2, 3], [1, 4, 9], (a, b) => a ** 2 === b)).toBe(true);
});

test("combineMerge() works", () => {
  expect(combineMerge([1, 2], [3, 4])).toStrictEqual([1, 2, 3, 4]);
  expect(
    combineMerge([{}, { x: 1 }, { a: "a" }], [{ y: 1 }, { x: 2 }, { b: "b" }]),
  ).toStrictEqual([{ y: 1 }, { x: 2 }, { a: "a", b: "b" }]);
});
