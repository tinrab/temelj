import { describe, expect, it } from "vitest";

import { AudioRangeError } from "./errors.ts";
import {
  clampNormal,
  clampRange,
  floorNonNegative,
  floorPositive,
  requireFinite,
  requireInRange,
  requireInteger,
  requireNonNegative,
  requireNonNegativeInteger,
  requirePositive,
  requirePositiveInteger,
} from "./validation.ts";

describe("validation", () => {
  it("returns valid values unchanged", () => {
    expect(requireFinite(-1.5, "value")).toBe(-1.5);
    expect(requirePositive(0.25, "value")).toBe(0.25);
    expect(requireNonNegative(0, "value")).toBe(0);
    expect(requireInteger(-3, "value")).toBe(-3);
    expect(requirePositiveInteger(2, "value")).toBe(2);
    expect(requireNonNegativeInteger(0, "value")).toBe(0);
    expect(requireInRange(1, 0, 1, "value")).toBe(1);
  });

  it.each([
    ["requireFinite", () => requireFinite(Number.NaN, "value")],
    ["requirePositive", () => requirePositive(0, "value")],
    ["requirePositive (infinite)", () => requirePositive(Number.POSITIVE_INFINITY, "value")],
    ["requireNonNegative", () => requireNonNegative(-0.1, "value")],
    ["requireInteger", () => requireInteger(1.5, "value")],
    ["requirePositiveInteger", () => requirePositiveInteger(0, "value")],
    ["requireNonNegativeInteger", () => requireNonNegativeInteger(0.5, "value")],
    ["requireInRange", () => requireInRange(2, 0, 1, "value")],
    ["floorPositive", () => floorPositive(0.5, "value")],
    ["floorNonNegative", () => floorNonNegative(-1, "value")],
  ])("%s rejects invalid input with AudioRangeError", (_name, check) => {
    expect(check).toThrow(AudioRangeError);
    expect(check).toThrow(RangeError);
  });

  it("clamps bounded values after checking finiteness", () => {
    expect(clampRange(5, 0, 2, "value")).toBe(2);
    expect(clampRange(-5, 0, 2, "value")).toBe(0);
    expect(clampNormal(1.5, "value")).toBe(1);
    expect(clampNormal(-0.5, "value")).toBe(0);
    expect(() => clampNormal(Number.NaN, "value")).toThrow(AudioRangeError);
  });

  it("floors counts and quantities", () => {
    expect(floorPositive(2.9, "value")).toBe(2);
    expect(floorNonNegative(0.9, "value")).toBe(0);
  });

  it("names the offending value in the message", () => {
    expect(() => requirePositive(-1, "frequency")).toThrow("frequency");
  });
});
