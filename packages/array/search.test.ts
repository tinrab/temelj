import { assert, assertEquals } from "@std/assert";
import { deepEquals } from "@temelj/value";
import { err, ok } from "@temelj/result";

import { binarySearch, containsDuplicates } from "./search.ts";

Deno.test("containsDuplicates() works", () => {
  assert(containsDuplicates([1, 1]));
  assert(containsDuplicates([1, 2, 3, 3]));

  assert(!containsDuplicates([]));
  assert(!containsDuplicates([1, 2, 3]));

  assert(containsDuplicates([{ x: 1 }, { x: 1 }], deepEquals));
  assert(!containsDuplicates([{ x: 1 }, { x: 2 }], deepEquals));
});

Deno.test("binarySearch() works", () => {
  assertEquals(
    binarySearch(
      ["a", "b", "c", "d", "e"],
      "c",
      (a, b) => a.localeCompare(b),
    ),
    ok(2),
  );
  assertEquals(
    binarySearch(
      ["a", "b", "c", "d", "e"],
      "z",
      (a, b) => a.localeCompare(b),
    ),
    err(5),
  );
  assertEquals(
    binarySearch(
      ["a", "b", "c", "d", "e"],
      "0",
      (a, b) => a.localeCompare(b),
    ),
    err(0),
  );
});
