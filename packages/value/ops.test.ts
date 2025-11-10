import { expect, test } from "vitest";

import { deepEquals, primitivize } from "./ops";

test("deepEquals() works", () => {
  const obj1 = { x: 1, y: 2, a: [1, 2] };
  const obj2 = { x: 1, y: 2, a: [1, 2] };
  const obj3 = { x: 1, y: 2, a: [3, 45] };
  expect(deepEquals(obj1, obj2));
  expect(!deepEquals(obj1, obj3));
});

test("primitivize() works", () => {
  expect(
    primitivize({
      x: 42,
      entries: new Map([
        ["a", 1],
        ["b", 2],
      ]),
      items: new Set([1, 2, 3]),
    }),
    {
      x: 42,
      entries: {
        a: 1,
        b: 2,
      },
      items: [1, 2, 3],
    },
  );
});
