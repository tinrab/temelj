/* oxlint-disable anti-slop/no-shape-in-symbol-names -- `WaveShaper` is the Web Audio API name (`WaveShaperNode`, `BaseAudioContext.createWaveShaper()`). */
import { describe, expect, it } from "vitest";

import {
  createBitCrusherCurve,
  createChebyshevCurve,
  createDistortionCurve,
  createEffect,
  createSoftClipCurve,
  createWaveShaperMap,
} from "../mod.ts";

describe("createBitCrusherCurve", () => {
  it("creates a quantized transfer curve for a bit depth", () => {
    const curve = createBitCrusherCurve(2, 9);
    const uniqueLevels = new Set(curve);

    expect(curve).toHaveLength(9);
    expect(curve[0]).toBe(-1);
    expect(curve[8]).toBe(1);
    expect(uniqueLevels.size).toBeLessThanOrEqual(4);
  });

  it("uses a minimum usable sample count and bit depth", () => {
    const curve = createBitCrusherCurve(0, 1);

    expect(curve).toHaveLength(2);
    expect([...curve]).toEqual([-1, 1]);
  });

  it("preserves an explicit bit crusher curve", () => {
    const curve = new Float32Array([-1, 0, 1]);
    const bitCrusher = createEffect("bitCrusher", { bits: 2, curve });

    expect(bitCrusher.options?.curve).toBe(curve);
  });
});

describe("createChebyshevCurve", () => {
  it("creates a Chebyshev transfer curve for a polynomial order", () => {
    const curve = createChebyshevCurve(2, 5);

    expect([...curve]).toEqual([1, -0.5, -1, -0.5, 1]);
  });

  it("uses order one as an identity transfer curve", () => {
    const curve = createChebyshevCurve(1, 5);

    expect([...curve]).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it("uses minimum usable order and sample count", () => {
    const curve = createChebyshevCurve(0, 1);

    expect(curve).toHaveLength(2);
    expect([...curve]).toEqual([-1, 1]);
  });

  it("preserves an explicit chebyshev curve", () => {
    const curve = new Float32Array([-1, 0, 1]);
    const chebyshev = createEffect("chebyshev", { order: 2, curve });

    expect(chebyshev.options?.curve).toBe(curve);
  });
});

describe("createSoftClipCurve", () => {
  it("creates a symmetric normalized soft clipping curve", () => {
    const curve = createSoftClipCurve(2, 5);

    expect(curve).toHaveLength(5);
    expect(curve[0]).toBeCloseTo(-1);
    expect(curve[2]).toBeCloseTo(0);
    expect(curve[4]).toBeCloseTo(1);
    expect(curve[1]).toBeCloseTo(-curve[3]!);
  });

  it("uses drive zero as an identity transfer curve", () => {
    const curve = createSoftClipCurve(0, 5);

    expect([...curve]).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it("uses a minimum usable sample count", () => {
    const curve = createSoftClipCurve(1, 1);

    expect(curve).toHaveLength(2);
    expect(curve[0]).toBeCloseTo(-1);
    expect(curve[1]).toBeCloseTo(1);
  });

  it("preserves an explicit soft clip curve", () => {
    const curve = new Float32Array([-1, 0, 1]);
    const softClip = createEffect("softClip", { drive: 2, curve });

    expect(softClip.options?.curve).toBe(curve);
  });
});

describe("createWaveShaperMap", () => {
  it("samples a mapping function across the -1 to 1 input range", () => {
    const curve = createWaveShaperMap((value, index) => value + index, 3);

    expect(Array.from(curve)).toEqual([-1, 1, 3]);
  });
});

describe("createDistortionCurve", () => {
  it("creates a symmetric transfer curve", () => {
    const curve = createDistortionCurve(50, 9);

    expect(curve).toHaveLength(9);
    expect(curve[0]).toBeLessThan(0);
    expect(curve[8]).toBeGreaterThan(0);
    expect(Math.abs(curve[0]!)).toBeCloseTo(Math.abs(curve[8]!), 1);
  });
});
