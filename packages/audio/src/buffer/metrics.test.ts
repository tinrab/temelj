import { describe, expect, it } from "vitest";

import { createMockAudioContext } from "../../tests/audio.ts";
import {
  createAudioBuffer,
  createAudioBufferFromChannels,
  getAudioBufferChannelZeroCrossingRates,
  getAudioBufferZeroCrossingRate,
  getStereoAudioBufferCorrelation,
  getStereoAudioBufferWidth,
} from "../mod.ts";

describe("AudioBuffer metrics", () => {
  it("measures AudioBuffer zero crossing rates", () => {
    const context = createMockAudioContext();

    const source = createAudioBufferFromChannels(
      [
        [1, -1, 1, -1],
        [1, 0, -1, -1],
      ],
      { sampleRate: context.sampleRate },
    );

    const rates = getAudioBufferChannelZeroCrossingRates(source);

    expect(rates[0]).toBeCloseTo(1);
    expect(rates[1]).toBeCloseTo(1 / 3);
    expect(getAudioBufferZeroCrossingRate(source)).toBeCloseTo(2 / 3);
  });

  it("returns zero crossing rates for silent and short AudioBuffers", () => {
    const context = createMockAudioContext();

    const silent = createAudioBufferFromChannels(
      [
        [0, 0],
        [0, 0],
      ],
      { sampleRate: context.sampleRate },
    );

    const singleFrame = createAudioBuffer({
      length: 1,
      numberOfChannels: 2,
      sampleRate: context.sampleRate,
    });

    expect(getAudioBufferZeroCrossingRate(silent)).toBe(0);
    expect(Array.from(getAudioBufferChannelZeroCrossingRates(silent))).toEqual([0, 0]);
    expect(getAudioBufferZeroCrossingRate(singleFrame)).toBe(0);
  });

  it("measures stereo AudioBuffer channel correlation", () => {
    const context = createMockAudioContext();

    const inPhase = createAudioBufferFromChannels(
      [
        [1, -1, 1],
        [1, -1, 1],
      ],
      { sampleRate: context.sampleRate },
    );

    const inverted = createAudioBufferFromChannels(
      [
        [1, -1, 1],
        [-1, 1, -1],
      ],
      { sampleRate: context.sampleRate },
    );

    const mixed = createAudioBufferFromChannels(
      [
        [1, 0, -1],
        [0, 1, 0],
      ],
      { sampleRate: context.sampleRate },
    );

    expect(getStereoAudioBufferCorrelation(inPhase)).toBeCloseTo(1);
    expect(getStereoAudioBufferCorrelation(inverted)).toBeCloseTo(-1);
    expect(getStereoAudioBufferCorrelation(mixed)).toBeCloseTo(0);
  });

  it("measures normalized stereo AudioBuffer width from correlation", () => {
    const context = createMockAudioContext();

    const mono = createAudioBufferFromChannels(
      [
        [1, -1, 1],
        [1, -1, 1],
      ],
      { sampleRate: context.sampleRate },
    );

    const wide = createAudioBufferFromChannels(
      [
        [1, 0, -1],
        [0, 1, 0],
      ],
      { sampleRate: context.sampleRate },
    );

    const inverted = createAudioBufferFromChannels(
      [
        [1, -1, 1],
        [-1, 1, -1],
      ],
      { sampleRate: context.sampleRate },
    );

    expect(getStereoAudioBufferWidth(mono)).toBeCloseTo(0);
    expect(getStereoAudioBufferWidth(wide)).toBeCloseTo(0.5);
    expect(getStereoAudioBufferWidth(inverted)).toBeCloseTo(1);
  });

  it("handles and validates stereo AudioBuffer correlation inputs", () => {
    const context = createMockAudioContext();

    const silent = createAudioBufferFromChannels(
      [
        [0, 0],
        [0, 0],
      ],
      { sampleRate: context.sampleRate },
    );

    const mono = createAudioBufferFromChannels([[1, 2]], { sampleRate: context.sampleRate });

    expect(getStereoAudioBufferCorrelation(silent)).toBe(0);
    expect(getStereoAudioBufferWidth(silent)).toBe(0.5);
    expect(() => getStereoAudioBufferCorrelation(mono)).toThrow(RangeError);
  });
});
