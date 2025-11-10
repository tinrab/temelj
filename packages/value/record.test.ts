import { expect, test } from "vitest";

import { recordEquals, recordMerge } from "./record";

test("recordEquals() works", () => {
  expect(recordEquals({ a: 1, b: 2 }, { a: 1, b: 2 }));

  expect(!recordEquals({ a: 1 }, { a: 3 }));
});

test("recordMerge() works", () => {
  const obj1 = { x: 1, y: 2, a: [1, 2] };
  const obj2 = { z: 3, w: 4, a: [3, 4] };
  const obj3 = { s: "foo" };
  expect(recordMerge<unknown>([obj1, obj2, obj3]), {
    x: 1,
    y: 2,
    z: 3,
    w: 4,
    a: [1, 2, 3, 4],
    s: "foo",
  });
});
