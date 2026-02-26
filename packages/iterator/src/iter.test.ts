import { expect, test } from "vitest";

import {
  all,
  any,
  chunk,
  collectMap,
  count,
  difference,
  find,
  first,
  flatten,
  groupBy,
  intersection,
  isEmpty,
  last,
  maxBy,
  minBy,
  skip,
  skipWhile,
  take,
  takeWhile,
  union,
  unique,
  window,
  zip,
} from "./iter";

test("collectMap() works", () => {
  expect(collectMap([1, 2, 3], (item: number) => item * 2)).toEqual({
    2: 1,
    4: 2,
    6: 3,
  });
});

test("minBy() finds minimum element", () => {
  expect(minBy([3, 1, 4, 1, 5], (x: number) => x)).toBe(1);
  expect(minBy([5, 4, 3, 2, 1], (x: number) => x)).toBe(1);

  const users = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
    { name: "Charlie", age: 35 },
  ];
  expect(minBy(users, (u: { name: string; age: number }) => u.age)).toEqual({
    name: "Bob",
    age: 25,
  });
});

test("minBy() returns undefined for empty iterable", () => {
  expect(minBy([], (x: number) => x)).toBeUndefined();
});

test("maxBy() finds maximum element", () => {
  expect(maxBy([3, 1, 4, 1, 5], (x: number) => x)).toBe(5);
  expect(maxBy([1, 2, 3, 4, 5], (x: number) => x)).toBe(5);

  const users = [
    { name: "Alice", age: 30 },
    { name: "Bob", age: 25 },
    { name: "Charlie", age: 35 },
  ];
  expect(maxBy(users, (u: { name: string; age: number }) => u.age)).toEqual({
    name: "Charlie",
    age: 35,
  });
});

test("maxBy() returns undefined for empty iterable", () => {
  expect(maxBy([], (x: number) => x)).toBeUndefined();
});

test("chunk() splits iterable into chunks", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(chunk([1, 2, 3, 4], 2)).toEqual([
    [1, 2],
    [3, 4],
  ]);
  expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  expect(chunk([], 3)).toEqual([]);
});

test("chunk() throws on invalid size", () => {
  expect(() => chunk([1, 2, 3], 0)).toThrow(
    "Chunk size must be greater than 0",
  );
  expect(() => chunk([1, 2, 3], -1)).toThrow(
    "Chunk size must be greater than 0",
  );
});

test("window() creates sliding windows", () => {
  expect(window([1, 2, 3, 4], 2)).toEqual([
    [1, 2],
    [2, 3],
    [3, 4],
  ]);
  expect(window([1, 2, 3, 4], 3)).toEqual([
    [1, 2, 3],
    [2, 3, 4],
  ]);
  expect(window([1, 2], 3)).toEqual([]);
  expect(window([], 2)).toEqual([]);
});

test("window() throws on invalid size", () => {
  expect(() => window([1, 2, 3], 0)).toThrow(
    "Window size must be greater than 0",
  );
  expect(() => window([1, 2, 3], -1)).toThrow(
    "Window size must be greater than 0",
  );
});

test("zip() combines two iterables", () => {
  expect(zip([1, 2, 3], ["a", "b", "c"])).toEqual([
    [1, "a"],
    [2, "b"],
    [3, "c"],
  ]);
  expect(zip([1, 2], ["a", "b", "c"])).toEqual([
    [1, "a"],
    [2, "b"],
  ]);
  expect(zip([1, 2, 3], ["a", "b"])).toEqual([
    [1, "a"],
    [2, "b"],
  ]);
  expect(zip([], ["a", "b"])).toEqual([]);
});

test("flatten() flattens nested iterables", () => {
  expect(flatten([[1, 2], [3, 4], [5]])).toEqual([1, 2, 3, 4, 5]);
  expect(flatten([[1, 2], [], [3]])).toEqual([1, 2, 3]);
  expect(flatten([])).toEqual([]);
});

test("groupBy() groups elements by key", () => {
  const result = groupBy([1, 2, 3, 4, 5, 6], (x: number) =>
    x % 2 === 0 ? "even" : "odd",
  );
  expect(result.get("even")).toEqual([2, 4, 6]);
  expect(result.get("odd")).toEqual([1, 3, 5]);

  const users = [
    { name: "Alice", group: "A" },
    { name: "Bob", group: "B" },
    { name: "Charlie", group: "A" },
  ];
  const byGroup = groupBy(
    users,
    (u: { name: string; group: string }) => u.group,
  );
  expect(byGroup.get("A")).toEqual([
    { name: "Alice", group: "A" },
    { name: "Charlie", group: "A" },
  ]);
  expect(byGroup.get("B")).toEqual([{ name: "Bob", group: "B" }]);
});

test("groupBy() returns empty map for empty iterable", () => {
  const result = groupBy([], (x: number) => x);
  expect(result.size).toBe(0);
});

test("unique() filters duplicates", () => {
  expect(unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
  expect(unique(["a", "b", "a", "c"])).toEqual(["a", "b", "c"]);
  expect(unique([])).toEqual([]);
  expect(unique([1])).toEqual([1]);
});

test("unique() with identity function", () => {
  const users = [
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
    { id: 1, name: "Alice Duplicate" },
  ];
  expect(unique(users, (u: { id: number; name: string }) => u.id)).toEqual([
    { id: 1, name: "Alice" },
    { id: 2, name: "Bob" },
  ]);
});

test("difference() returns items in a not in b", () => {
  expect(difference([1, 2, 3], [2, 3, 4])).toEqual([1]);
  expect(difference([1, 2, 3], [4, 5, 6])).toEqual([1, 2, 3]);
  expect(difference([1, 2, 3], [1, 2, 3])).toEqual([]);
  expect(difference([], [1, 2])).toEqual([]);
});

test("intersection() returns items in both a and b", () => {
  expect(intersection([1, 2, 3], [2, 3, 4])).toEqual([2, 3]);
  expect(intersection([1, 2, 3], [4, 5, 6])).toEqual([]);
  expect(intersection([1, 2, 3], [1, 2, 3])).toEqual([1, 2, 3]);
  expect(intersection([], [1, 2])).toEqual([]);
});

test("intersection() handles duplicates correctly", () => {
  expect(intersection([1, 1, 2], [1, 2])).toEqual([1, 2]);
  expect(intersection([1, 1, 2], [1, 1, 2])).toEqual([1, 2]);
});

test("take() returns first n elements", () => {
  expect(take([1, 2, 3, 4, 5], 3)).toEqual([1, 2, 3]);
  expect(take([1, 2, 3], 5)).toEqual([1, 2, 3]);
  expect(take([], 3)).toEqual([]);
});

test("take() with n <= 0 returns empty", () => {
  expect(take([1, 2, 3], 0)).toEqual([]);
  expect(take([1, 2, 3], -1)).toEqual([]);
});

test("skip() skips first n elements", () => {
  expect(skip([1, 2, 3, 4, 5], 2)).toEqual([3, 4, 5]);
  expect(skip([1, 2, 3], 5)).toEqual([]);
  expect(skip([], 3)).toEqual([]);
});

test("skip() with n <= 0 returns all elements", () => {
  expect(skip([1, 2, 3], 0)).toEqual([1, 2, 3]);
  expect(skip([1, 2, 3], -1)).toEqual([1, 2, 3]);
});

test("first() returns first element", () => {
  expect(first([1, 2, 3])).toBe(1);
  expect(first([42])).toBe(42);
  expect(first([])).toBeUndefined();
});

test("last() returns last element", () => {
  expect(last([1, 2, 3])).toBe(3);
  expect(last([42])).toBe(42);
  expect(last([])).toBeUndefined();
});

test("isEmpty() checks if iterable is empty", () => {
  expect(isEmpty([])).toBe(true);
  expect(isEmpty([1])).toBe(false);
  expect(isEmpty([1, 2, 3])).toBe(false);
});

test("takeWhile() takes while predicate is true", () => {
  expect(takeWhile([1, 2, 3, 4, 5], (x: number) => x < 4)).toEqual([1, 2, 3]);
  expect(takeWhile([1, 2, 3], (x: number) => x > 10)).toEqual([]);
  expect(takeWhile([], (x: number) => x < 4)).toEqual([]);
});

test("skipWhile() skips while predicate is true", () => {
  expect(skipWhile([1, 2, 3, 4, 5], (x: number) => x < 4)).toEqual([4, 5]);
  expect(skipWhile([1, 2, 3], (x: number) => x > 10)).toEqual([1, 2, 3]);
  expect(skipWhile([], (x: number) => x < 4)).toEqual([]);
});

test("find() finds first matching element", () => {
  expect(find([1, 2, 3, 4, 5], (x: number) => x > 3)).toBe(4);
  expect(find([1, 2, 3], (x: number) => x > 10)).toBeUndefined();
  expect(find([], (x: number) => x > 0)).toBeUndefined();
});

test("any() checks if any element satisfies predicate", () => {
  expect(any([1, 2, 3], (x: number) => x > 2)).toBe(true);
  expect(any([1, 2, 3], (x: number) => x > 10)).toBe(false);
  expect(any([], (x: number) => x > 0)).toBe(false);
});

test("all() checks if all elements satisfy predicate", () => {
  expect(all([1, 2, 3], (x: number) => x > 0)).toBe(true);
  expect(all([1, 2, 3], (x: number) => x > 2)).toBe(false);
  expect(all([], (x: number) => x > 0)).toBe(true);
});

test("count() counts all elements", () => {
  expect(count([1, 2, 3, 4, 5])).toBe(5);
  expect(count([])).toBe(0);
});

test("count() with predicate counts matching elements", () => {
  expect(count([1, 2, 3, 4, 5], (x: number) => x % 2 === 0)).toBe(2);
  expect(count([1, 2, 3], (x: number) => x > 10)).toBe(0);
});

test("union() combines unique items from both iterables", () => {
  expect(union([1, 2, 3], [2, 3, 4])).toEqual([1, 2, 3, 4]);
  expect(union([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
  expect(union([], [1, 2])).toEqual([1, 2]);
  expect(union([1, 2], [])).toEqual([1, 2]);
  expect(union([], [])).toEqual([]);
});
