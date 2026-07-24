import { expect, test } from "vitest";

import { primitivize } from "./ops";

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
  ).toEqual({
    x: 42,
    entries: {
      a: 1,
      b: 2,
    },
    items: [1, 2, 3],
  });
});
