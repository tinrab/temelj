import { describe, expect, it } from "vitest";

import { labToRgb, rgbToLab } from "./lab";
import { lchToRgb, rgbToLch } from "./lch";
import { okLabToRgb, rgbToOkLab } from "./oklab";
import { okLchToRgb, rgbToOkLch } from "./oklch";
import { fromRgb } from "./rgb";

describe("color spaces", () => {
  it("should convert between RGB and Lab", () => {
    const white = fromRgb(255, 255, 255);
    const lab = rgbToLab(white);
    expect(lab.l).toBeCloseTo(100, 1);
    expect(lab.a).toBeCloseTo(0, 1);
    expect(lab.b).toBeCloseTo(0, 1);
    expect(labToRgb(lab)).toEqual(white);

    const red = fromRgb(255, 0, 0);
    const labRed = rgbToLab(red);
    expect(labToRgb(labRed)).toEqual(red);
  });

  it("should convert between RGB and LCH", () => {
    const red = fromRgb(255, 0, 0);
    const lch = rgbToLch(red);
    expect(lchToRgb(lch)).toEqual(red);
  });

  it("should convert between RGB and OKLab", () => {
    const white = fromRgb(255, 255, 255);
    const oklab = rgbToOkLab(white);
    expect(oklab.l).toBeCloseTo(1, 4);
    expect(oklab.a).toBeCloseTo(0, 4);
    expect(oklab.b).toBeCloseTo(0, 4);
    expect(okLabToRgb(oklab)).toEqual(white);

    const red = fromRgb(255, 0, 0);
    const oklabRed = rgbToOkLab(red);
    expect(okLabToRgb(oklabRed)).toEqual(red);
  });

  it("should convert between RGB and OKLCH", () => {
    const red = fromRgb(255, 0, 0);
    const oklch = rgbToOkLch(red);
    expect(okLchToRgb(oklch)).toEqual(red);
  });
});
