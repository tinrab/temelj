import { describe, expect, it } from "vitest";

import { createMockAudioContext } from "../../tests/audio.ts";
import { Quadrafuzz } from "../mod.ts";

describe("Quadrafuzz", () => {
  it("splits into four distorted bands with crossovers and a dry/wet mix", () => {
    const context = createMockAudioContext(3);

    const quadrafuzz = new Quadrafuzz(context, {
      high: 0.8,
      highFrequency: 2_000,
      low: 0.2,
      lowFrequency: 200,
      midHigh: 0.6,
      midLow: 0.4,
      midFrequency: 800,
      mix: 0.5,
      samples: 16,
    });

    expect(context.createdFilters.map((filter) => filter.type)).toEqual([
      "highpass",
      "lowpass",
      "highpass",
      "highpass",
      "lowpass",
      "lowpass",
    ]);
    expect(context.createdWaveShapers[0]?.curve).toHaveLength(16);
    expect(quadrafuzz.bandGain("high").value).toBe(0.8);

    quadrafuzz.setBandGain("midLow", 2, 4);
    quadrafuzz.setLowFrequency(250, 5);
    quadrafuzz.setMidFrequency(1_000, 6);
    quadrafuzz.setHighFrequency(3_000, 7);
    quadrafuzz.setMix(-1, 8);

    expect(quadrafuzz.bandGain("midLow").value).toBe(1);
    expect(quadrafuzz.lowFrequency.value).toBe(250);
    expect(quadrafuzz.midFrequency.value).toBe(1_000);
    expect(quadrafuzz.highFrequency.value).toBe(3_000);
    expect(quadrafuzz.mix).toBe(0);

    quadrafuzz.dispose();
    quadrafuzz.dispose();

    for (const node of [...context.createdFilters, ...context.createdWaveShapers]) {
      expect(node.disconnect).toHaveBeenCalledTimes(1);
    }
  });
});
