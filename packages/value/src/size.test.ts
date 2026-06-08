import { expect, test } from "vitest";

import { sizeOf } from "./mod";

test("sizeOf() estimates primitive value sizes", () => {
  expect(sizeOf(undefined)).toBe(0);
  expect(sizeOf(null)).toBe(0);
  expect(sizeOf(false)).toBe(4);
  expect(sizeOf(123)).toBe(8);
  expect(sizeOf("abc")).toBe(6);
  expect(sizeOf(123n)).toBe(6);
  expect(sizeOf(Symbol("abc"))).toBe(6);
  expect(sizeOf(Symbol.for("shared"))).toBe(12);
});

test("sizeOf() includes enumerable object keys and values", () => {
  expect(sizeOf({ abc: "def" })).toBe(12);
  expect(sizeOf({ a: 1, b: true })).toBe(16);
});

test("sizeOf() estimates arrays, maps, and sets structurally", () => {
  expect(sizeOf(["a", 1, true])).toBe(14);

  expect(
    sizeOf(
      new Map<unknown, unknown>([
        ["a", 1],
        ["b", true],
      ]),
    ),
  ).toBe(16);

  expect(sizeOf(new Set<unknown>(["a", 1, true]))).toBe(14);
});

test("sizeOf() uses byteLength for buffers and array buffer views", () => {
  expect(sizeOf(new ArrayBuffer(8))).toBe(8);
  expect(sizeOf(new Uint16Array([1, 2, 3]))).toBe(6);
  expect(sizeOf(new DataView(new ArrayBuffer(16), 4, 8))).toBe(8);
});

test("sizeOf() handles circular references once", () => {
  const parent: { child?: unknown } = {};
  const child = { parent };
  parent.child = child;

  expect(sizeOf(parent)).toBe(22);
});

test("sizeOf() counts enumerable symbol properties", () => {
  const key = Symbol("key");

  expect(sizeOf({ [key]: "value" })).toBe(16);
});

test("sizeOf() skips properties with throwing getters", () => {
  const value = {
    get error(): string {
      throw new Error("nope");
    },
  };

  expect(sizeOf(value)).toBe(10);
});
