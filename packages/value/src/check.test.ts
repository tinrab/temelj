import { expect, test } from "vitest";

import { isPlainObject, isPrimitiveObject } from "./check";

test("isPlainObject() works", () => {
  expect(isPlainObject({ x: 42 })).toBe(true);

  expect(isPlainObject(42)).toBe(false);
  expect(isPlainObject("abc")).toBe(false);
  expect(isPlainObject(new Date())).toBe(false);
  expect(isPlainObject(new Map())).toBe(false);
});

test("isPrimitiveObject() works", () => {
  expect(isPrimitiveObject({ x: 42 })).toBe(true);
  expect(isPrimitiveObject({ x: 42, y: { z: 42 } })).toBe(true);

  expect(isPrimitiveObject({ x: 42, d: new Date() })).toBe(false);
});
