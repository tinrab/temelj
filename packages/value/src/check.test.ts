import { expect, test } from "vitest";

import { isObjectDeepPrimitive, isObjectPrimitive } from "./check";

test("isObjectPlain() works", () => {
  expect(isObjectPrimitive({ x: 42 }));

  expect(!isObjectPrimitive(42));
  expect(!isObjectPrimitive("abc"));
  expect(!isObjectPrimitive(new Date()));
  expect(!isObjectPrimitive(new Map()));
});

test("isObjectDeepPlain() works", () => {
  expect(isObjectDeepPrimitive({ x: 42 }));
  expect(isObjectDeepPrimitive({ x: 42, y: { z: 42 } }));

  expect(!isObjectDeepPrimitive({ x: 42, d: new Date() }));
});
