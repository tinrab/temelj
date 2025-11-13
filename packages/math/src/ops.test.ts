import { expect, test } from "vitest";

import { clamp, clampWithOverflow } from "./ops";

test("clamp() works", () => {
  expect(clamp(5, 0, 10)).toStrictEqual(5);
  expect(clamp(12, 0, 10)).toStrictEqual(10);
  expect(clamp(-2, 0, 10)).toStrictEqual(0);
});

test("clampWithOverflow() works", () => {
  expect(clampWithOverflow(5, 0, 10)).toStrictEqual(5);
  expect(clampWithOverflow(12, 0, 10)).toStrictEqual(2);
  expect(clampWithOverflow(-2, 0, 10)).toStrictEqual(8);
});
