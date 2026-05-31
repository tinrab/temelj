import { expect, test } from "vitest";

import { isObjectDeepPrimitive, isObjectPrimitive } from "./check";

test("isObjectPlain() works", () => {
  expect(isObjectPrimitive({ x: 42 })).toBe(true);

  expect(isObjectPrimitive(42)).toBe(false);
  expect(isObjectPrimitive("abc")).toBe(false);
  expect(isObjectPrimitive(new Date())).toBe(false);
  expect(isObjectPrimitive(new Map())).toBe(false);
});

test("isObjectDeepPlain() works", () => {
  expect(isObjectDeepPrimitive({ x: 42 })).toBe(true);
  expect(isObjectDeepPrimitive({ x: 42, y: { z: 42 } })).toBe(true);

  expect(isObjectDeepPrimitive({ x: 42, d: new Date() })).toBe(false);
});
