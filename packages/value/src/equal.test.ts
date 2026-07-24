import { describe, expect, test } from "vitest";

import { deepEquals } from "./equal";

test("deepEquals() works", () => {
  const obj1 = { x: 1, y: 2, a: [1, 2] };
  const obj2 = { x: 1, y: 2, a: [1, 2] };
  const obj3 = { x: 1, y: 2, a: [3, 45] };
  expect(deepEquals(obj1, obj2)).toBe(true);
  expect(deepEquals(obj1, obj3)).toBe(false);
});

describe("deepEquals() instances", () => {
  test.each([
    ["undefined", undefined, undefined, true],
    ["null", null, null, true],
    ["boolean", true, true, true],
    ["string", "value", "value", true],
    ["number", 42, 42, true],
    ["bigint", 42n, 42n, true],
    ["date", new Date("2024-01-01T00:00:00.000Z"), new Date("2024-01-01T00:00:00.000Z"), true],
    [
      "temporal instant",
      Temporal.Instant.from("2024-01-01T00:00:00Z"),
      Temporal.Instant.from("2024-01-01T00:00:00Z"),
      true,
    ],
    [
      "temporal duration",
      Temporal.Duration.from({ seconds: 1 }),
      Temporal.Duration.from({ seconds: 1 }),
      true,
    ],
    [
      "same calendar duration without relativeTo",
      Temporal.Duration.from("P1M"),
      Temporal.Duration.from("P1M"),
      true,
    ],
    ["regexp", /value/giu, /value/giu, true],
    ["bytes", Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3]), true],
    [
      "map",
      new Map<unknown, unknown>([
        ["instant", Temporal.Instant.from("2024-01-01T00:00:00Z")],
        ["duration", Temporal.Duration.from({ seconds: 1 })],
      ]),
      new Map<unknown, unknown>([
        ["instant", Temporal.Instant.from("2024-01-01T00:00:00Z")],
        ["duration", Temporal.Duration.from({ seconds: 1 })],
      ]),
      true,
    ],
    [
      "set",
      new Set<unknown>([Temporal.Duration.from({ seconds: 1 }), "value"]),
      new Set<unknown>([Temporal.Duration.from({ seconds: 1 }), "value"]),
      true,
    ],
    [
      "array",
      [Temporal.Instant.from("2024-01-01T00:00:00Z"), Uint8Array.from([1, 2, 3])],
      [Temporal.Instant.from("2024-01-01T00:00:00Z"), Uint8Array.from([1, 2, 3])],
      true,
    ],
    [
      "record",
      {
        date: new Date("2024-01-01T00:00:00.000Z"),
        duration: Temporal.Duration.from({ seconds: 1 }),
        pattern: /value/giu,
      },
      {
        date: new Date("2024-01-01T00:00:00.000Z"),
        duration: Temporal.Duration.from({ seconds: 1 }),
        pattern: /value/giu,
      },
      true,
    ],
    [
      "null prototype record",
      Object.assign(Object.create(null) as Record<string, unknown>, {
        duration: Temporal.Duration.from({ seconds: 1 }),
      }),
      Object.assign(Object.create(null) as Record<string, unknown>, {
        duration: Temporal.Duration.from({ seconds: 1 }),
      }),
      true,
    ],
    [
      "different temporal instant",
      Temporal.Instant.from("2024-01-01T00:00:00Z"),
      Temporal.Instant.from("2024-01-01T00:00:01Z"),
      false,
    ],
    [
      "different temporal duration",
      Temporal.Duration.from({ seconds: 1 }),
      Temporal.Duration.from({ seconds: 2 }),
      false,
    ],
    [
      "incomparable calendar durations",
      { duration: Temporal.Duration.from("P1M") },
      { duration: Temporal.Duration.from("P30D") },
      false,
    ],
    ["different bytes", Uint8Array.from([1, 2, 3]), Uint8Array.from([4]), false],
    ["different regexp flags", /value/g, /value/i, false],
    [
      "different map order",
      new Map<unknown, unknown>([
        ["a", 1],
        ["b", 2],
      ]),
      new Map<unknown, unknown>([
        ["b", 2],
        ["a", 1],
      ]),
      false,
    ],
    ["different set order", new Set<unknown>(["a", "b"]), new Set<unknown>(["b", "a"]), false],
    ["different record", { value: Temporal.Duration.from({ seconds: 1 }) }, { value: 1 }, false],
  ])("%s", (_name, left, right, expected) => {
    expect(deepEquals(left, right)).toBe(expected);
  });
});
