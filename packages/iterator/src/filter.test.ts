import { expect, test } from "vitest";

import { filterMap, partition } from "./filter";

test("filterMap() works", () => {
  const result = filterMap([1, 2, 3, 4, 5], (x: number) =>
    x % 2 === 0 ? x * 10 : undefined,
  );
  expect(result).toEqual([20, 40]);
});

test("partition() splits iterable by predicate", () => {
  const [even, odd] = partition([1, 2, 3, 4, 5], (x: number) => x % 2 === 0);
  expect(even).toEqual([2, 4]);
  expect(odd).toEqual([1, 3, 5]);
});

test("partition() handles empty iterable", () => {
  const [truthy, falsy] = partition([], () => true);
  expect(truthy).toEqual([]);
  expect(falsy).toEqual([]);
});

test("partition() handles all true predicate", () => {
  const [truthy, falsy] = partition([1, 2, 3], () => true);
  expect(truthy).toEqual([1, 2, 3]);
  expect(falsy).toEqual([]);
});

test("partition() handles all false predicate", () => {
  const [truthy, falsy] = partition([1, 2, 3], () => false);
  expect(truthy).toEqual([]);
  expect(falsy).toEqual([1, 2, 3]);
});
