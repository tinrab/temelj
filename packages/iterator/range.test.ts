import { expect, test } from "vitest";

import {
  flattenNumericRange,
  isNumericRangeDecreasing,
  isNumericRangeIncreasing,
  NumericRangeError,
  NumericRangeIterator,
  parseNumericRange,
  reverseNumericRange,
} from "./range";

test("numeric range - parse", () => {
  expect(parseNumericRange("2,3,4")).toStrictEqual([2, 3, 4]);

  expect(parseNumericRange("2..5")).toStrictEqual([{ from: 2, to: 4 }]);
  expect(parseNumericRange("2..=5")).toStrictEqual([{ from: 2, to: 5 }]);
  expect(parseNumericRange("-5..=0")).toStrictEqual([{ from: -5, to: 0 }]);
  expect(parseNumericRange("1..-3")).toStrictEqual([{ from: 1, to: -2 }]);

  expect(() => parseNumericRange("1,a")).toThrow(NumericRangeError);

  expect(() => parseNumericRange("3...5")).toThrow(NumericRangeError);
});

test("numeric range - flatten", () => {
  expect(flattenNumericRange(parseNumericRange("2,3,5..8"))).toStrictEqual([
    2, 3, 5, 6, 7,
  ]);
});

test("numeric range - validation", () => {
  expect(isNumericRangeIncreasing(parseNumericRange("1,2,3..5"))).toBe(true);
  expect(isNumericRangeIncreasing(parseNumericRange("-5,-4,-2..0"))).toBe(true);
  expect(isNumericRangeIncreasing(parseNumericRange("1..3,5..8"))).toBe(true);

  expect(isNumericRangeIncreasing(parseNumericRange("5,4"))).toBe(false);
  expect(isNumericRangeIncreasing(parseNumericRange("5..3"))).toBe(false);
  expect(isNumericRangeIncreasing(parseNumericRange("1,2,0"))).toBe(false);
  expect(isNumericRangeIncreasing(parseNumericRange("1,2,5..3"))).toBe(false);
  expect(isNumericRangeIncreasing(parseNumericRange("-2,-3"))).toBe(false);
  expect(isNumericRangeIncreasing(parseNumericRange("0..-2"))).toBe(false);

  expect(isNumericRangeDecreasing(parseNumericRange("5,4,3..1"))).toBe(true);
  expect(isNumericRangeDecreasing(parseNumericRange("-2,-3,-4..-10"))).toBe(
    true,
  );
  expect(isNumericRangeDecreasing(parseNumericRange("8..5,3..1"))).toBe(true);

  expect(isNumericRangeDecreasing(parseNumericRange("4,5"))).toBe(false);
  expect(isNumericRangeDecreasing(parseNumericRange("3..5"))).toBe(false);
  expect(isNumericRangeDecreasing(parseNumericRange("2,1,5"))).toBe(false);
  expect(isNumericRangeDecreasing(parseNumericRange("5,4,3..5"))).toBe(false);
  expect(isNumericRangeDecreasing(parseNumericRange("-3,-2"))).toBe(false);
  expect(isNumericRangeDecreasing(parseNumericRange("-2..0"))).toBe(false);
});

test("numeric range - reverse", () => {
  expect(reverseNumericRange(parseNumericRange("1,2,3"))).toStrictEqual(
    parseNumericRange("3,2,1"),
  );
  expect(reverseNumericRange(parseNumericRange("1..5"))).toStrictEqual(
    parseNumericRange("4..=1"),
  );

  expect(reverseNumericRange(parseNumericRange("10,9,8,5..=1"))).toStrictEqual(
    parseNumericRange("1..=5,8,9,10"),
  );
});

test("numeric range - iterator", () => {
  expect(
    Array.from(new NumericRangeIterator(parseNumericRange("1..=3"))),
  ).toStrictEqual([1, 2, 3]);
  expect(
    Array.from(new NumericRangeIterator(parseNumericRange("1..=2,5..8"))),
  ).toStrictEqual([1, 2, 5, 6, 7]);
  expect(
    Array.from(new NumericRangeIterator(parseNumericRange("-5..-2,-2..0"))),
  ).toStrictEqual([-5, -4, -3, -2, -1]);
  expect(
    Array.from(new NumericRangeIterator(parseNumericRange("3..0"))),
  ).toStrictEqual([3, 2, 1]);
});
