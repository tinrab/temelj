import { beforeEach, describe, expect, it } from "vitest";

import { createMockAudioContext, type MockAudioBuffer, asMock } from "../../tests/audio.ts";
import { ConvolutionReverb, Freeverb, JCReverb } from "../mod.ts";

let context: ReturnType<typeof createMockAudioContext>;

beforeEach(() => {
  context = createMockAudioContext(3, 48_000);
});

describe("ConvolutionReverb", () => {
  it("generates a decaying impulse after the pre-delay", () => {
    const reverb = new ConvolutionReverb(context, {
      decay: 0.25,
      preDelay: 0.05,
      seed: 2,
      wet: 0.6,
    });

    const buffer = asMock<MockAudioBuffer>(reverb.convolver.buffer);

    expect(reverb.wet.value).toBe(0.6);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(14_400);
    expect(
      buffer
        .getChannelData(0)
        .slice(0, 2_400)
        .every((value) => value === 0),
    ).toBe(true);
    expect(buffer.getChannelData(0)[2_400]).not.toBe(0);
  });

  it("regenerates the impulse when settings change", () => {
    const reverb = new ConvolutionReverb(context);
    const first = reverb.convolver.buffer;

    reverb.setDecay(0.4);
    reverb.setPreDelay(0.1);

    expect(reverb.convolver.buffer).not.toBe(first);
    expect(reverb.convolver.buffer?.length).toBe(24_000);
    expect(() => {
      reverb.setDecay(0);
    }).toThrow(RangeError);
  });
});

describe("Freeverb", () => {
  it("builds eight dampened combs and updates them together", () => {
    const reverb = new Freeverb(context, { dampening: 2_500, roomSize: 0.8, wet: 0.7 });
    const comb = reverb.combFilters[0]!;

    expect(reverb.combFilters).toHaveLength(8);
    expect(comb.dampening.value).toBe(2_500);
    expect(comb.resonance.value).toBe(0.8);
    expect(comb.delayTime.value).toBeCloseTo(1557 / 44_100, 12);

    reverb.setDampening(1_000, 4);
    reverb.setRoomSize(1, 5);
    expect(reverb.dampening).toBe(1_000);
    expect(comb.dampening.value).toBe(1_000);
    expect(comb.resonance.value).toBe(1);

    reverb.dispose();
    expect(comb.disposed).toBe(true);
  });
});

describe("JCReverb", () => {
  it("maps room size to comb feedback", () => {
    const reverb = new JCReverb(context, { roomSize: 0.5, wet: 0.75 });

    expect(reverb.combFilters).toHaveLength(4);
    expect(reverb.combFilters[0]!.resonance.value).toBeCloseTo(-0.268, 12);

    reverb.setRoomSize(1, 5);
    expect(reverb.combFilters[0]!.resonance.value).toBeCloseTo(0.197, 12);

    reverb.dispose();
    expect(reverb.combFilters.every((comb) => comb.disposed)).toBe(true);

    for (const gain of context.createdGains) {
      expect(gain.disconnect).toHaveBeenCalled();
    }
  });
});
