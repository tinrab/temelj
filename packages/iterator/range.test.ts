import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  flattenNumericRange,
  isNumericRangeDecreasing,
  isNumericRangeIncreasing,
  NumericRangeError,
  NumericRangeIterator,
  parseNumericRange,
  reverseNumericRange,
} from "./range.ts";

Deno.test("numeric range - parse", () => {
  assertEquals(parseNumericRange("2,3,4"), [2, 3, 4]);

  assertEquals(parseNumericRange("2..5"), [{ from: 2, to: 4 }]);
  assertEquals(parseNumericRange("2..=5"), [{ from: 2, to: 5 }]);
  assertEquals(parseNumericRange("-5..=0"), [{ from: -5, to: 0 }]);
  assertEquals(parseNumericRange("1..-3"), [{ from: 1, to: -2 }]);

  assertThrows(
    () => parseNumericRange("1,a"),
    NumericRangeError,
    "Invalid integer 'a'",
  );

  assertThrows(
    () => parseNumericRange("3...5"),
    NumericRangeError,
    "Invalid integer '3...5'",
  );
});

Deno.test("numeric range - flatten", () => {
  assertEquals(
    flattenNumericRange(parseNumericRange("2,3,5..8")),
    [2, 3, 5, 6, 7],
  );
});

Deno.test("numeric range - validation", () => {
  assert(isNumericRangeIncreasing(parseNumericRange("1,2,3..5")));
  assert(isNumericRangeIncreasing(parseNumericRange("-5,-4,-2..0")));
  assert(isNumericRangeIncreasing(parseNumericRange("1..3,5..8")));

  assert(!isNumericRangeIncreasing(parseNumericRange("5,4")));
  assert(!isNumericRangeIncreasing(parseNumericRange("5..3")));
  assert(!isNumericRangeIncreasing(parseNumericRange("1,2,0")));
  assert(!isNumericRangeIncreasing(parseNumericRange("1,2,5..3")));
  assert(!isNumericRangeIncreasing(parseNumericRange("-2,-3")));
  assert(!isNumericRangeIncreasing(parseNumericRange("0..-2")));

  assert(isNumericRangeDecreasing(parseNumericRange("5,4,3..1")));
  assert(isNumericRangeDecreasing(parseNumericRange("-2,-3,-4..-10")));
  assert(isNumericRangeDecreasing(parseNumericRange("8..5,3..1")));

  assert(!isNumericRangeDecreasing(parseNumericRange("4,5")));
  assert(!isNumericRangeDecreasing(parseNumericRange("3..5")));
  assert(!isNumericRangeDecreasing(parseNumericRange("2,1,5")));
  assert(!isNumericRangeDecreasing(parseNumericRange("5,4,3..5")));
  assert(!isNumericRangeDecreasing(parseNumericRange("-3,-2")));
  assert(!isNumericRangeDecreasing(parseNumericRange("-2..0")));
});

Deno.test("numeric range - reverse", () => {
  assertEquals(
    reverseNumericRange(parseNumericRange("1,2,3")),
    parseNumericRange("3,2,1"),
  );
  assertEquals(
    reverseNumericRange(parseNumericRange("1..5")),
    parseNumericRange("4..=1"),
  );

  assertEquals(
    reverseNumericRange(parseNumericRange("10,9,8,5..=1")),
    parseNumericRange("1..=5,8,9,10"),
  );
});

Deno.test("numeric range - iterator", () => {
  assertEquals(
    Array.from(new NumericRangeIterator(parseNumericRange("1..=3"))),
    [1, 2, 3],
  );
  assertEquals(
    Array.from(new NumericRangeIterator(parseNumericRange("1..=2,5..8"))),
    [1, 2, 5, 6, 7],
  );
  assertEquals(
    Array.from(new NumericRangeIterator(parseNumericRange("-5..-2,-2..0"))),
    [-5, -4, -3, -2, -1],
  );
  assertEquals(
    Array.from(new NumericRangeIterator(parseNumericRange("3..0"))),
    [3, 2, 1],
  );
});
