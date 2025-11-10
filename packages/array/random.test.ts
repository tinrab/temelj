import { expect, test } from "vitest";

import { sample, sampleList, sampleListUnique, shuffle } from "./random";

test("shuffle() works", () => {
  const array = [1, 2, 3, 4, 5];
  const shuffled = shuffle(array);
  expect(shuffled.length, array.length);
  expect(shuffled.sort(), array.sort());
});

test("sample() works", () => {
  const array = ["a", "b", "c"];
  const item = sample(array);
  expect(item !== undefined);
  expect(array.includes(item));

  expect(sample([]), undefined);
});

test("sampleList() works", () => {
  const array = ["a", "b", "c"];
  const list = sampleList(array, 2);
  expect(list.length, 2);
  expect(list.every((item) => array.includes(item)));

  expect(sampleList([], 2).length, 0);
});

test("sampleListUnique() works", () => {
  const array = ["a", "b", "c"];
  for (let i = 0; i < 10; i++) {
    const list = sampleListUnique(array, 2);
    expect(list.length, 2);
    expect(list.every((item) => array.includes(item)));
    expect(new Set(list).size, list.length);
  }

  expect(sampleListUnique([], 2).length, 0);
  expect(sampleListUnique(["a"], 2).length, 1);
});
