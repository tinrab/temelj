import { expect, test } from "vitest";

import {
  isBigInt,
  isBoolean,
  isFunction,
  isNumber,
  isObject,
  isPlainObject,
  isPrimitiveObject,
  isString,
  isSymbol,
} from "./check";

test("primitive guards reject boxed values and distinguish null from objects", () => {
  expect(isString("value")).toBe(true);
  expect(isString(Object("value"))).toBe(false);
  expect(isNumber(Number.NaN)).toBe(true);
  expect(isNumber(Infinity)).toBe(true);
  expect(isNumber("1")).toBe(false);
  expect(isBoolean(false)).toBe(true);
  expect(isBoolean(0)).toBe(false);
  expect(isBigInt(1n)).toBe(true);
  expect(isBigInt(1)).toBe(false);
  expect(isSymbol(Symbol("key"))).toBe(true);
  expect(isSymbol("key")).toBe(false);
  expect(isFunction(() => {})).toBe(true);
  expect(isFunction({ call() {} })).toBe(false);
  expect(isObject({})).toBe(true);
  expect(isObject(null)).toBe(false);
  expect(isObject(() => {})).toBe(false);
});

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
