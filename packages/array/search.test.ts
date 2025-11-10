import { err, ok } from "@temelj/result";
import { deepEquals } from "@temelj/value";
import { expect, test } from "vitest";

import { binarySearch, containsDuplicates } from "./search";

test("containsDuplicates() works", () => {
  expect(containsDuplicates([1, 1])).toBe(true);
  expect(containsDuplicates([1, 2, 3, 3])).toBe(true);

  expect(containsDuplicates([])).toBe(false);
  expect(containsDuplicates([1, 2, 3])).toBe(false);

  expect(containsDuplicates([{ x: 1 }, { x: 1 }], deepEquals)).toBe(true);
  expect(containsDuplicates([{ x: 1 }, { x: 2 }], deepEquals)).toBe(false);
});

test("binarySearch() works", () => {
  expect(
    binarySearch(["a", "b", "c", "d", "e"], "c", (a, b) => a.localeCompare(b)),
  ).toStrictEqual(ok(2));
  expect(
    binarySearch(["a", "b", "c", "d", "e"], "z", (a, b) => a.localeCompare(b)),
  ).toStrictEqual(err(5));
  expect(
    binarySearch(["a", "b", "c", "d", "e"], "0", (a, b) => a.localeCompare(b)),
  ).toStrictEqual(err(0));
});
