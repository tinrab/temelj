import { describe, expect, it } from "vitest";

import { darken, desaturate, lighten, mix, saturate } from "./manipulation";
import { fromRgb } from "./rgb";

describe("manipulation", () => {
  it("should mix colors", () => {
    const white = fromRgb(255, 255, 255);
    const black = fromRgb(0, 0, 0);
    expect(mix(white, black, 0.5)).toEqual(fromRgb(127.5, 127.5, 127.5));
    expect(mix(white, black, 1)).toEqual(white);
    expect(mix(white, black, 0)).toEqual(black);
  });

  it("should lighten colors", () => {
    const black = fromRgb(0, 0, 0);
    const lightened = lighten(black, 0.5);
    expect(lightened.red).toBeCloseTo(128, -1);
    expect(lightened.green).toBeCloseTo(128, -1);
    expect(lightened.blue).toBeCloseTo(128, -1);
  });

  it("should darken colors", () => {
    const white = fromRgb(255, 255, 255);
    const darkened = darken(white, 0.5);
    expect(darkened.red).toBeCloseTo(128, -1);
    expect(darkened.green).toBeCloseTo(128, -1);
    expect(darkened.blue).toBeCloseTo(128, -1);
  });

  it("should saturate colors", () => {
    const gray = fromRgb(128, 128, 128);
    const saturated = saturate(gray, 0.5);
    expect(saturated.red).toBeGreaterThan(128);
    expect(saturated.blue).toBeLessThan(128);
  });

  it("should desaturate colors", () => {
    const red = fromRgb(255, 0, 0);
    const desaturated = desaturate(red, 0.5);
    expect(desaturated.red).toBeLessThan(255);
    expect(desaturated.green).toBeGreaterThan(0);
    expect(desaturated.blue).toBeGreaterThan(0);
  });
});
