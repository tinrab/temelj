import { err, ok } from "@temelj/result";
import { deepEquals } from "@temelj/value";
import { expect, test } from "vitest";

import { arrayBinarySearch, arrayContainsDuplicates } from "./search";

test("arrayContainsDuplicates() works", () => {
  expect(arrayContainsDuplicates([1, 1])).toStrictEqual(true);
  expect(arrayContainsDuplicates([1, 2, 3, 3])).toStrictEqual(true);

  expect(arrayContainsDuplicates([])).toStrictEqual(false);
  expect(arrayContainsDuplicates([1, 2, 3])).toStrictEqual(false);

  expect(
    arrayContainsDuplicates([{ x: 1 }, { x: 1 }], deepEquals),
  ).toStrictEqual(true);
  expect(
    arrayContainsDuplicates([{ x: 1 }, { x: 2 }], deepEquals),
  ).toStrictEqual(false);
});

test("arrayBinarySearch() works", () => {
  expect(
    arrayBinarySearch(["a", "b", "c", "d", "e"], "c", (a: string, b: string) =>
      a.localeCompare(b),
    ),
  ).toStrictEqual(ok(2));
  expect(
    arrayBinarySearch(["a", "b", "c", "d", "e"], "z", (a: string, b: string) =>
      a.localeCompare(b),
    ),
  ).toStrictEqual(err(5));
  expect(
    arrayBinarySearch(["a", "b", "c", "d", "e"], "0", (a: string, b: string) =>
      a.localeCompare(b),
    ),
  ).toStrictEqual(err(0));
});
