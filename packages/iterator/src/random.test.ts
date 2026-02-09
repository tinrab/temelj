import { expect, test } from "vitest";

import { arrayShuffle, sample, sampleList, sampleListUnique } from "./random";

test("arrayShuffle() works", () => {
  const array = [1, 2, 3, 4, 5];
  const shuffled = arrayShuffle(array);
  expect(shuffled.length).toStrictEqual(array.length);
  expect(shuffled.sort()).toEqual(array.sort());
});

test("sample() works", () => {
  const array = ["a", "b", "c"];
  const item = sample(array);
  expect(item !== undefined).toStrictEqual(true);
  // biome-ignore lint/style/noNonNullAssertion: testing
  expect(array.includes(item!)).toStrictEqual(true);

  expect(sample([])).toBeUndefined();
});

test("sampleList() works", () => {
  const array = ["a", "b", "c"];
  const list = sampleList(array, 2);
  expect(list.length).toStrictEqual(2);
  expect(list.every((item) => array.includes(item))).toStrictEqual(true);

  expect(sampleList([], 2).length).toStrictEqual(0);
});

test("sampleListUnique() works", () => {
  const array = ["a", "b", "c"];
  for (let i = 0; i < 10; i++) {
    const list = sampleListUnique(array, 2);
    expect(list.length).toStrictEqual(2);
    expect(list.every((item) => array.includes(item))).toStrictEqual(true);
    expect(new Set(list).size).toStrictEqual(list.length);
  }

  expect(sampleListUnique([], 2).length).toStrictEqual(0);
  expect(sampleListUnique(["a"], 2).length).toStrictEqual(1);
});
