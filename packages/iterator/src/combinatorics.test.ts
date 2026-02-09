import { expect, test } from "vitest";

import { cartesianProduct, combinations, permutations } from "./combinatorics";

test("cartesianProduct() generates all pairs", () => {
  const result = cartesianProduct([1, 2], ["a", "b"]);
  expect(result).toEqual([
    [1, "a"],
    [1, "b"],
    [2, "a"],
    [2, "b"],
  ]);
});

test("cartesianProduct() with empty iterables", () => {
  expect(cartesianProduct([], ["a", "b"])).toEqual([]);
  expect(cartesianProduct([1, 2], [])).toEqual([]);
  expect(cartesianProduct([], [])).toEqual([]);
});

test("cartesianProduct() works with generators", () => {
  function* genA() {
    yield 1;
    yield 2;
  }
  function* genB() {
    yield "x";
    yield "y";
  }
  const result = cartesianProduct(genA(), genB());
  expect(result).toEqual([
    [1, "x"],
    [1, "y"],
    [2, "x"],
    [2, "y"],
  ]);
});

test("permutations() generates all orderings", () => {
  const result = permutations([1, 2, 3]);
  expect(result).toHaveLength(6);
  expect(result).toContainEqual([1, 2, 3]);
  expect(result).toContainEqual([1, 3, 2]);
  expect(result).toContainEqual([2, 1, 3]);
  expect(result).toContainEqual([2, 3, 1]);
  expect(result).toContainEqual([3, 1, 2]);
  expect(result).toContainEqual([3, 2, 1]);
});

test("permutations() with single element", () => {
  expect(permutations([42])).toEqual([[42]]);
});

test("permutations() with empty iterable", () => {
  expect(permutations([])).toEqual([]);
});

test("permutations() with two elements", () => {
  const result = permutations(["a", "b"]);
  expect(result).toEqual([
    ["a", "b"],
    ["b", "a"],
  ]);
});

test("combinations() generates all combinations of size n", () => {
  const result = combinations([1, 2, 3], 2);
  expect(result).toEqual([
    [1, 2],
    [1, 3],
    [2, 3],
  ]);
});

test("combinations() with n=0 returns empty combination", () => {
  expect(combinations([1, 2, 3], 0)).toEqual([[]]);
});

test("combinations() with n > length returns empty", () => {
  expect(combinations([1, 2], 3)).toEqual([]);
});

test("combinations() with n=1 returns single elements", () => {
  expect(combinations(["a", "b", "c"], 1)).toEqual([["a"], ["b"], ["c"]]);
});

test("combinations() throws on negative size", () => {
  expect(() => combinations([1, 2, 3], -1)).toThrow(
    "Combination size must be non-negative",
  );
});

test("combinations() with all elements", () => {
  expect(combinations([1, 2, 3], 3)).toEqual([[1, 2, 3]]);
});
