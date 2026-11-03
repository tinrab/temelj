import { describe, expect, it } from "vitest";

import { createMockDecodeAudioContext } from "../../tests/audio.ts";
import {
  concatAudioBuffers,
  createAudioBuffer,
  createAudioBufferFromChannels,
  createAudioBufferFromInterleavedArray,
  mixAudioBuffers,
  mergeAudioBufferChannels,
  splitAudioBufferChannels,
} from "../mod.ts";

function createMockContext(sampleRate = 48_000): BaseAudioContext {
  return createMockDecodeAudioContext(sampleRate);
}

describe("AudioBuffer creation", () => {
  it("creates audio buffers from channel arrays", () => {
    const context = createMockContext();

    const buffer = createAudioBufferFromChannels([[0, 0.5, 1], new Float32Array([1, 0.5, 0])], {
      sampleRate: context.sampleRate,
    });

    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(3);
    expect(buffer.sampleRate).toBe(48_000);
    expect(Array.from(buffer.getChannelData(0))).toEqual([0, 0.5, 1]);
    expect(Array.from(buffer.getChannelData(1))).toEqual([1, 0.5, 0]);
  });

  it("validates interleaved AudioBuffer construction inputs", () => {
    const context = createMockContext();

    expect(() =>
      createAudioBufferFromInterleavedArray([1, 0, -1], {
        numberOfChannels: 2,
        sampleRate: context.sampleRate,
      }),
    ).toThrow(RangeError);
    expect(() =>
      createAudioBufferFromInterleavedArray([1, 0], {
        numberOfChannels: 0,
        sampleRate: context.sampleRate,
      }),
    ).toThrow(RangeError);
  });

  it("creates silent buffers from explicit length or duration", () => {
    const context = createMockContext(44_100);

    const byLength = createAudioBuffer({
      length: 128,
      numberOfChannels: 2,
      sampleRate: context.sampleRate,
    });

    const byDuration = createAudioBuffer({
      duration: 0.5,
      sampleRate: 8_000,
    });

    expect(byLength.numberOfChannels).toBe(2);
    expect(byLength.length).toBe(128);
    expect(byDuration.length).toBe(4_000);
    expect(byDuration.duration).toBe(0.5);
  });

  it("does not lose a frame to floating-point error in durations", () => {
    // `0.35 * 44_100` is `15434.999999999998`.
    expect(createAudioBuffer({ duration: 0.35, sampleRate: 44_100 }).length).toBe(15_435);
  });

  it("concatenates compatible AudioBuffers without mutating sources", () => {
    const first = createAudioBufferFromChannels(
      [
        [0, 1],
        [1, 0],
      ],
      {
        sampleRate: 10,
      },
    );

    const second = createAudioBufferFromChannels(
      [
        [2, 3, 4],
        [4, 3, 2],
      ],
      {
        sampleRate: 10,
      },
    );

    const concatenated = concatAudioBuffers([first, second]);

    expect(concatenated.length).toBe(5);
    expect(concatenated.numberOfChannels).toBe(2);
    expect(concatenated.sampleRate).toBe(10);
    expect(Array.from(concatenated.getChannelData(0))).toEqual([0, 1, 2, 3, 4]);
    expect(Array.from(concatenated.getChannelData(1))).toEqual([1, 0, 4, 3, 2]);
    expect(Array.from(first.getChannelData(0))).toEqual([0, 1]);
  });

  it("rejects invalid AudioBuffer concatenation inputs", () => {
    const first = createAudioBufferFromChannels([[0]], { sampleRate: 10 });
    const differentRate = createAudioBufferFromChannels([[1]], { sampleRate: 20 });

    const differentChannels = createAudioBufferFromChannels([[1], [2]], {
      sampleRate: 10,
    });

    expect(() => concatAudioBuffers([])).toThrow(RangeError);
    expect(() => concatAudioBuffers([first, differentRate])).toThrow(RangeError);
    expect(() => concatAudioBuffers([first, differentChannels])).toThrow(RangeError);
  });

  it("mixes compatible AudioBuffers without mutating sources", () => {
    const first = createAudioBufferFromChannels(
      [
        [1, 0.5, 0],
        [0, 0.5, 1],
      ],
      {
        sampleRate: 10,
      },
    );

    const second = createAudioBufferFromChannels(
      [
        [0.25, -0.25],
        [1, -1],
      ],
      {
        sampleRate: 10,
      },
    );

    const mixed = mixAudioBuffers([first, second], { gains: [1, 2] });

    expect(mixed.length).toBe(3);
    expect(mixed.numberOfChannels).toBe(2);
    expect(mixed.sampleRate).toBe(10);
    expect(Array.from(mixed.getChannelData(0))).toEqual([1.5, 0, 0]);
    expect(Array.from(mixed.getChannelData(1))).toEqual([2, -1.5, 1]);
    expect(Array.from(first.getChannelData(0))).toEqual([1, 0.5, 0]);
  });

  it("mixes AudioBuffers at second-based offsets", () => {
    const first = createAudioBufferFromChannels([[1, 1]], { sampleRate: 10 });
    const second = createAudioBufferFromChannels([[0.5, 0.25]], { sampleRate: 10 });

    const mixed = mixAudioBuffers([first, second], {
      gains: [1, 2],
      offsets: [0.1, 0.3],
    });

    expect(mixed.length).toBe(5);
    expect(Array.from(mixed.getChannelData(0))).toEqual([0, 1, 1, 1, 0.5]);
  });

  it("mixes stereo AudioBuffers with equal-power pan gains", () => {
    const source = createAudioBufferFromChannels([[1], [1]], { sampleRate: 10 });

    const left = mixAudioBuffers([source], { pans: [-1] });
    const center = mixAudioBuffers([source], { pans: [0] });
    const right = mixAudioBuffers([source], { pans: [1] });

    expect(left.getChannelData(0)[0]).toBeCloseTo(1);
    expect(left.getChannelData(1)[0]).toBeCloseTo(0);
    expect(center.getChannelData(0)[0]).toBeCloseTo(Math.SQRT1_2);
    expect(center.getChannelData(1)[0]).toBeCloseTo(Math.SQRT1_2);
    expect(right.getChannelData(0)[0]).toBeCloseTo(0);
    expect(right.getChannelData(1)[0]).toBeCloseTo(1);
  });

  it("rejects invalid AudioBuffer mix inputs", () => {
    const first = createAudioBufferFromChannels([[0]], { sampleRate: 10 });
    const differentRate = createAudioBufferFromChannels([[0]], { sampleRate: 20 });

    const differentChannels = createAudioBufferFromChannels([[0], [1]], {
      sampleRate: 10,
    });

    expect(() => mixAudioBuffers([])).toThrow(RangeError);
    expect(() => mixAudioBuffers([first, differentRate])).toThrow(RangeError);
    expect(() => mixAudioBuffers([first, differentChannels])).toThrow(RangeError);
    expect(() => mixAudioBuffers([first], { gains: [Number.NaN] })).toThrow(RangeError);
    expect(() => mixAudioBuffers([first], { offsets: [-1] })).toThrow(RangeError);
    expect(() => mixAudioBuffers([first], { pans: [Number.POSITIVE_INFINITY] })).toThrow(
      RangeError,
    );
  });

  it("merges AudioBuffer channels without mutating sources", () => {
    const left = createAudioBufferFromChannels([[0, 1, 2]], {
      sampleRate: 10,
    });

    const right = createAudioBufferFromChannels([[3, 4, 5]], {
      sampleRate: 10,
    });

    const stereo = mergeAudioBufferChannels([left, right]);

    expect(stereo.length).toBe(3);
    expect(stereo.numberOfChannels).toBe(2);
    expect(stereo.sampleRate).toBe(10);
    expect(Array.from(stereo.getChannelData(0))).toEqual([0, 1, 2]);
    expect(Array.from(stereo.getChannelData(1))).toEqual([3, 4, 5]);
    expect(Array.from(left.getChannelData(0))).toEqual([0, 1, 2]);
  });

  it("merges all channels from multichannel AudioBuffers in source order", () => {
    const stereo = createAudioBufferFromChannels(
      [
        [1, 0],
        [0.5, -0.5],
      ],
      {
        sampleRate: 10,
      },
    );

    const mono = createAudioBufferFromChannels([[-1, 1]], {
      sampleRate: 10,
    });

    const merged = mergeAudioBufferChannels([stereo, mono]);

    expect(merged.numberOfChannels).toBe(3);
    expect(Array.from(merged.getChannelData(0))).toEqual([1, 0]);
    expect(Array.from(merged.getChannelData(1))).toEqual([0.5, -0.5]);
    expect(Array.from(merged.getChannelData(2))).toEqual([-1, 1]);
  });

  it("rejects invalid AudioBuffer channel merge inputs", () => {
    const first = createAudioBufferFromChannels([[0, 1]], { sampleRate: 10 });
    const differentRate = createAudioBufferFromChannels([[0, 1]], { sampleRate: 20 });
    const differentLength = createAudioBufferFromChannels([[0]], { sampleRate: 10 });

    expect(() => mergeAudioBufferChannels([])).toThrow(RangeError);
    expect(() => mergeAudioBufferChannels([first, differentRate])).toThrow(RangeError);
    expect(() => mergeAudioBufferChannels([first, differentLength])).toThrow(RangeError);
  });

  it("splits AudioBuffer channels into owned mono buffers", () => {
    const source = createAudioBufferFromChannels(
      [
        [0, 1],
        [2, 3],
        [4, 5],
      ],
      {
        sampleRate: 10,
      },
    );

    const channels = splitAudioBufferChannels(source);

    expect(channels).toHaveLength(3);
    expect(channels.map((buffer) => buffer.numberOfChannels)).toEqual([1, 1, 1]);
    expect(channels.map((buffer) => buffer.length)).toEqual([2, 2, 2]);
    expect(channels.map((buffer) => buffer.sampleRate)).toEqual([10, 10, 10]);
    expect(Array.from(channels[0]!.getChannelData(0))).toEqual([0, 1]);
    expect(Array.from(channels[1]!.getChannelData(0))).toEqual([2, 3]);
    expect(Array.from(channels[2]!.getChannelData(0))).toEqual([4, 5]);

    channels[0]!.getChannelData(0)[0] = -1;
    expect(Array.from(source.getChannelData(0))).toEqual([0, 1]);
  });

  it("rejects invalid buffer construction options", () => {
    const context = createMockContext();

    expect(() => createAudioBuffer({ length: -1, sampleRate: context.sampleRate })).toThrow(
      RangeError,
    );
    expect(() =>
      createAudioBuffer({ numberOfChannels: 0, sampleRate: context.sampleRate }),
    ).toThrow(RangeError);
    expect(() => createAudioBuffer({ sampleRate: 0 })).toThrow(RangeError);
  });
});
