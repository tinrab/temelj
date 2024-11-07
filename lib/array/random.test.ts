import { assert, assertEquals } from "@std/assert";

import { sample, sampleList, sampleListUnique, shuffle } from "./random.ts";

Deno.test("shuffle() works", () => {
  const array = [1, 2, 3, 4, 5];
  const shuffled = shuffle(array);
  assertEquals(shuffled.length, array.length);
  assertEquals(shuffled.sort(), array.sort());
});

Deno.test("sample() works", () => {
  const array = ["a", "b", "c"];
  const item = sample(array);
  assert(item !== undefined);
  assert(array.includes(item));

  assertEquals(sample([]), undefined);
});

Deno.test("sampleList() works", () => {
  const array = ["a", "b", "c"];
  const list = sampleList(array, 2);
  assertEquals(list.length, 2);
  assert(list.every((item) => array.includes(item)));

  assertEquals(sampleList([], 2).length, 0);
});

Deno.test("sampleListUnique() works", () => {
  const array = ["a", "b", "c"];
  for (let i = 0; i < 10; i++) {
    const list = sampleListUnique(array, 2);
    assertEquals(list.length, 2);
    assert(list.every((item) => array.includes(item)));
    assertEquals(new Set(list).size, list.length);
  }

  assertEquals(sampleListUnique([], 2).length, 0);
  assertEquals(sampleListUnique(["a"], 2).length, 1);
});
