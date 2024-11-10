import { assert, assertEquals } from "@std/assert";
import { binarySearch, containsDuplicates } from "~/array/iter.ts";
import { deepEquals } from "~/value/ops.ts";

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
    2,
  );
});
