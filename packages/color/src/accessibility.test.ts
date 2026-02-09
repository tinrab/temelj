import { describe, expect, it } from "vitest";

import { getContrastRatio, getLuminance } from "./accessibility";
import { fromRgb } from "./rgb";

describe("accessibility", () => {
  it("should calculate luminance", () => {
    expect(getLuminance(fromRgb(255, 255, 255))).toBe(1);
    expect(getLuminance(fromRgb(0, 0, 0))).toBe(0);
    expect(getLuminance(fromRgb(255, 0, 0))).toBeCloseTo(0.2126, 4);
    expect(getLuminance(fromRgb(0, 255, 0))).toBeCloseTo(0.7152, 4);
    expect(getLuminance(fromRgb(0, 0, 255))).toBeCloseTo(0.0722, 4);
  });

  it("should calculate contrast ratio", () => {
    const white = fromRgb(255, 255, 255);
    const black = fromRgb(0, 0, 0);
    expect(getContrastRatio(white, black)).toBe(21);
    expect(getContrastRatio(white, white)).toBe(1);
    expect(getContrastRatio(black, black)).toBe(1);

    const red = fromRgb(255, 0, 0);
    expect(getContrastRatio(white, red)).toBeCloseTo(3.998, 3);
  });
});
