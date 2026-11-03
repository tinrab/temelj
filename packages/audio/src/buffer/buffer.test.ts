import { describe, expect, it } from "vitest";

import { createMockDecodeAudioContext } from "../../tests/audio.ts";
import {
  addAudioBufferDcOffset,
  clampAudioBuffer,
  convertAudioBufferChannels,
  createAudioBufferFromChannels,
  fadeAudioBuffer,
  getAudioBufferChannelExtrema,
  getAudioBufferChannelDcOffsets,
  getAudioBufferChannelPeaks,
  getAudioBufferChannelRms,
  getAudioBufferExtrema,
  getAudioBufferPeak,
  getAudioBufferRms,
  invertAudioBuffer,
  mapAudioBufferSamples,
  midSideAudioBufferToStereo,
  mixAudioBufferToMono,
  normalizeAudioBuffer,
  removeAudioBufferDcOffset,
  resampleAudioBuffer,
  scaleAudioBuffer,
  setStereoAudioBufferWidth,
  stereoAudioBufferToMidSide,
  trimAudioBuffer,
} from "../mod.ts";

function createMockContext(sampleRate = 48_000): BaseAudioContext {
  return createMockDecodeAudioContext(sampleRate);
}

describe("AudioBuffer utilities", () => {
  it("mixes multichannel buffers down to mono", () => {
    const context = createMockContext(10);

    const source = createAudioBufferFromChannels(
      [
        [1, 0, -1],
        [0, 0.5, 1],
      ],
      { sampleRate: context.sampleRate },
    );

    const mono = mixAudioBufferToMono(source);

    expect(mono.numberOfChannels).toBe(1);
    expect(mono.sampleRate).toBe(source.sampleRate);
    expect(Array.from(mono.getChannelData(0))).toEqual([0.5, 0.25, 0]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 0, -1]);
    expect(Array.from(source.getChannelData(1))).toEqual([0, 0.5, 1]);
  });

  it("converts AudioBuffer channel counts without mutating the source", () => {
    const source = createAudioBufferFromChannels(
      [
        [1, 0, -1],
        [0, 0.5, 1],
      ],
      {
        sampleRate: 10,
      },
    );

    const mono = convertAudioBufferChannels(source, { numberOfChannels: 1 });
    const quad = convertAudioBufferChannels(source, { numberOfChannels: 4 });
    const copy = convertAudioBufferChannels(source, { numberOfChannels: 2 });

    expect(mono.numberOfChannels).toBe(1);
    expect(Array.from(mono.getChannelData(0))).toEqual([0.5, 0.25, 0]);
    expect(quad.numberOfChannels).toBe(4);
    expect(Array.from(quad.getChannelData(0))).toEqual([1, 0, -1]);
    expect(Array.from(quad.getChannelData(1))).toEqual([0, 0.5, 1]);
    expect(Array.from(quad.getChannelData(2))).toEqual([1, 0, -1]);
    expect(Array.from(quad.getChannelData(3))).toEqual([0, 0.5, 1]);
    expect(copy).not.toBe(source);
    expect(Array.from(copy.getChannelData(0))).toEqual([1, 0, -1]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 0, -1]);
  });

  it("rejects invalid AudioBuffer channel conversion targets", () => {
    const context = createMockContext();
    const source = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    expect(() => convertAudioBufferChannels(source, { numberOfChannels: 0 })).toThrow(RangeError);
  });

  it("resamples AudioBuffers with linear interpolation", () => {
    const source = createAudioBufferFromChannels([[0, 1]], {
      sampleRate: 2,
    });

    const resampled = resampleAudioBuffer(source, { sampleRate: 4 });

    expect(resampled).not.toBe(source);
    expect(resampled.length).toBe(4);
    expect(resampled.sampleRate).toBe(4);
    expect(Array.from(resampled.getChannelData(0))).toHaveLength(4);
    expect(resampled.getChannelData(0)[0]).toBeCloseTo(0);
    expect(resampled.getChannelData(0)[1]).toBeCloseTo(1 / 3);
    expect(resampled.getChannelData(0)[2]).toBeCloseTo(2 / 3);
    expect(resampled.getChannelData(0)[3]).toBeCloseTo(1);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 1]);
  });

  it("downsamples AudioBuffers and copies unchanged sample rates", () => {
    const source = createAudioBufferFromChannels(
      [
        [0, 0.5, 1],
        [1, 0.5, 0],
      ],
      {
        sampleRate: 3,
      },
    );

    const downsampled = resampleAudioBuffer(source, { sampleRate: 2 });
    const copy = resampleAudioBuffer(source, { sampleRate: 3 });

    expect(downsampled.length).toBe(2);
    expect(downsampled.numberOfChannels).toBe(2);
    expect(downsampled.sampleRate).toBe(2);
    expect(Array.from(downsampled.getChannelData(0))).toEqual([0, 1]);
    expect(Array.from(downsampled.getChannelData(1))).toEqual([1, 0]);
    expect(copy).not.toBe(source);
    expect(Array.from(copy.getChannelData(0))).toEqual([0, 0.5, 1]);
  });

  it("validates AudioBuffer resampling targets", () => {
    const context = createMockContext();
    const source = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    expect(() => resampleAudioBuffer(source, { sampleRate: 0 })).toThrow(RangeError);
  });

  it("copies a single channel when mixing to mono with a channel option", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels(
      [
        [1, 0, -1],
        [0, 0.5, 1],
      ],
      { sampleRate: context.sampleRate },
    );

    const mono = mixAudioBufferToMono(source, { channel: 1 });

    expect(mono.numberOfChannels).toBe(1);
    expect(Array.from(mono.getChannelData(0))).toEqual([0, 0.5, 1]);
  });

  it("finds and normalizes AudioBuffer peak level without mutating the source", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels(
      [
        [0, 0.25, -0.5],
        [0.75, -1, 0.5],
      ],
      { sampleRate: context.sampleRate },
    );

    const normalized = normalizeAudioBuffer(source, { peak: 0.5 });

    expect(getAudioBufferPeak(source)).toBe(1);
    expect(Array.from(getAudioBufferChannelPeaks(source))).toEqual([0.5, 1]);
    expect(getAudioBufferChannelExtrema(source)).toEqual([
      { max: 0.25, min: -0.5 },
      { max: 0.75, min: -1 },
    ]);
    expect(getAudioBufferExtrema(source)).toEqual({ max: 0.75, min: -1 });
    // Extrema come from the samples, not from a zero starting point.
    expect(
      getAudioBufferExtrema(
        createAudioBufferFromChannels([[0.5, 0.75]], { sampleRate: context.sampleRate }),
      ),
    ).toEqual({ max: 0.75, min: 0.5 });
    expect(getAudioBufferRms(source)).toBeCloseTo(Math.sqrt(2.125 / 6));
    expect(getAudioBufferChannelRms(source)[0]).toBeCloseTo(Math.sqrt(0.3125 / 3));
    expect(getAudioBufferChannelRms(source)[1]).toBeCloseTo(Math.sqrt(1.8125 / 3));
    expect(getAudioBufferPeak(normalized)).toBe(0.5);
    expect(Array.from(normalized.getChannelData(0))).toEqual([0, 0.125, -0.25]);
    expect(Array.from(normalized.getChannelData(1))).toEqual([0.375, -0.5, 0.25]);
    expect(Array.from(source.getChannelData(1))).toEqual([0.75, -1, 0.5]);
  });

  it("converts stereo AudioBuffers to mid-side and back without mutating the source", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels(
      [
        [1, 0],
        [0, 1],
      ],
      { sampleRate: context.sampleRate },
    );

    const midSide = stereoAudioBufferToMidSide(source);
    const stereo = midSideAudioBufferToStereo(midSide);

    expect(midSide.numberOfChannels).toBe(2);
    expect(midSide.sampleRate).toBe(source.sampleRate);
    expect(Array.from(midSide.getChannelData(0))).toEqual([0.5, 0.5]);
    expect(Array.from(midSide.getChannelData(1))).toEqual([0.5, -0.5]);
    expect(Array.from(stereo.getChannelData(0))).toEqual([1, 0]);
    expect(Array.from(stereo.getChannelData(1))).toEqual([0, 1]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 0]);
  });

  it("validates mid-side AudioBuffer conversion inputs", () => {
    const context = createMockContext();
    const mono = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    expect(() => stereoAudioBufferToMidSide(mono)).toThrow(RangeError);
    expect(() => midSideAudioBufferToStereo(mono)).toThrow(RangeError);
  });

  it("sets stereo AudioBuffer width without mutating the source", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels(
      [
        [1, 0],
        [0, 1],
      ],
      { sampleRate: context.sampleRate },
    );

    const mono = setStereoAudioBufferWidth(source, { width: 0 });
    const same = setStereoAudioBufferWidth(source, { width: 1 });
    const wide = setStereoAudioBufferWidth(source, { width: 2 });

    expect(Array.from(mono.getChannelData(0))).toEqual([0.5, 0.5]);
    expect(Array.from(mono.getChannelData(1))).toEqual([0.5, 0.5]);
    expect(Array.from(same.getChannelData(0))).toEqual([1, 0]);
    expect(Array.from(same.getChannelData(1))).toEqual([0, 1]);
    expect(Array.from(wide.getChannelData(0))).toEqual([1.5, -0.5]);
    expect(Array.from(wide.getChannelData(1))).toEqual([-0.5, 1.5]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 0]);
  });

  it("validates stereo AudioBuffer width processing inputs", () => {
    const context = createMockContext();
    const stereo = createAudioBufferFromChannels([[1], [0]], { sampleRate: context.sampleRate });
    const mono = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    expect(() => setStereoAudioBufferWidth(stereo, { width: -1 })).toThrow(RangeError);
    expect(() => setStereoAudioBufferWidth(mono, { width: 1 })).toThrow(RangeError);
  });

  it("scales AudioBuffer samples without mutating the source", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels(
      [
        [0, 0.25, -0.5],
        [0.75, -1, 0.5],
      ],
      { sampleRate: context.sampleRate },
    );

    const scaled = scaleAudioBuffer(source, { gain: -2 });

    expect(scaled).not.toBe(source);
    expect(scaled.numberOfChannels).toBe(2);
    expect(scaled.sampleRate).toBe(source.sampleRate);
    expect(scaled.getChannelData(0)[0]).toBeCloseTo(0);
    expect(scaled.getChannelData(0)[1]).toBeCloseTo(-0.5);
    expect(scaled.getChannelData(0)[2]).toBeCloseTo(1);
    expect(Array.from(scaled.getChannelData(1))).toEqual([-1.5, 2, -1]);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 0.25, -0.5]);
  });

  it("inverts AudioBuffer polarity without mutating the source", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels(
      [
        [0, 0.25, -0.5],
        [0.75, -1, 0.5],
      ],
      { sampleRate: context.sampleRate },
    );

    const inverted = invertAudioBuffer(source);

    expect(inverted).not.toBe(source);
    expect(inverted.numberOfChannels).toBe(2);
    expect(inverted.sampleRate).toBe(source.sampleRate);
    expect(Array.from(inverted.getChannelData(0))).toEqual([0, -0.25, 0.5]);
    expect(Array.from(inverted.getChannelData(1))).toEqual([-0.75, 1, -0.5]);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 0.25, -0.5]);
  });

  it("validates AudioBuffer scale gain", () => {
    const context = createMockContext();
    const source = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    expect(() => scaleAudioBuffer(source, { gain: Number.NaN })).toThrow(RangeError);
  });

  it("maps AudioBuffer samples from one numeric range into another", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels(
      [
        [-1, 0, 1],
        [-0.5, 0.5, 1],
      ],
      { sampleRate: context.sampleRate },
    );

    const mapped = mapAudioBufferSamples(source, {
      fromMax: 1,
      fromMin: -1,
      toMax: 1,
      toMin: 0,
    });

    expect(mapped).not.toBe(source);
    expect(mapped.numberOfChannels).toBe(2);
    expect(mapped.sampleRate).toBe(source.sampleRate);
    expect(Array.from(mapped.getChannelData(0))).toEqual([0, 0.5, 1]);
    expect(Array.from(mapped.getChannelData(1))).toEqual([0.25, 0.75, 1]);
    expect(Array.from(source.getChannelData(0))).toEqual([-1, 0, 1]);
  });

  it("maps AudioBuffer samples into reversed output ranges", () => {
    const context = createMockContext();
    const source = createAudioBufferFromChannels([[-1, 0, 1]], { sampleRate: context.sampleRate });

    const mapped = mapAudioBufferSamples(source, {
      fromMax: 1,
      fromMin: -1,
      toMax: -1,
      toMin: 1,
    });

    expect(Array.from(mapped.getChannelData(0))).toEqual([1, 0, -1]);
    expect(Array.from(source.getChannelData(0))).toEqual([-1, 0, 1]);
  });

  it("validates AudioBuffer sample mapping ranges", () => {
    const context = createMockContext();
    const source = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    const options = {
      fromMax: 1,
      fromMin: -1,
      toMax: 1,
      toMin: 0,
    };

    expect(() => mapAudioBufferSamples(source, { ...options, fromMin: Number.NaN })).toThrow(
      RangeError,
    );
    expect(() =>
      mapAudioBufferSamples(source, { ...options, toMax: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() => mapAudioBufferSamples(source, { ...options, fromMin: 1 })).toThrow(RangeError);
  });

  it("clamps AudioBuffer samples without mutating the source", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels([[-2, -0.5, 0.5, 2]], {
      sampleRate: context.sampleRate,
    });

    const clamped = clampAudioBuffer(source);
    const custom = clampAudioBuffer(source, { min: -0.25, max: 0.75 });

    expect(clamped).not.toBe(source);
    expect(Array.from(clamped.getChannelData(0))).toEqual([-1, -0.5, 0.5, 1]);
    expect(Array.from(custom.getChannelData(0))).toEqual([-0.25, -0.25, 0.5, 0.75]);
    expect(Array.from(source.getChannelData(0))).toEqual([-2, -0.5, 0.5, 2]);
  });

  it("validates AudioBuffer clamp ranges", () => {
    const context = createMockContext();
    const source = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    expect(() => clampAudioBuffer(source, { min: Number.NaN })).toThrow(RangeError);
    expect(() => clampAudioBuffer(source, { min: 1, max: -1 })).toThrow(RangeError);
  });

  it("measures and removes per-channel AudioBuffer DC offsets", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels(
      [
        [1, 2, 3],
        [-2, -1, 0],
      ],
      { sampleRate: context.sampleRate },
    );

    const offsets = getAudioBufferChannelDcOffsets(source);
    const centered = removeAudioBufferDcOffset(source);

    expect(Array.from(offsets)).toEqual([2, -1]);
    expect(centered).not.toBe(source);
    expect(Array.from(centered.getChannelData(0))).toEqual([-1, 0, 1]);
    expect(Array.from(centered.getChannelData(1))).toEqual([-1, 0, 1]);
    expect(Array.from(getAudioBufferChannelDcOffsets(centered))).toEqual([0, 0]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 2, 3]);
  });

  it("adds scalar and per-channel AudioBuffer DC offsets without mutating the source", () => {
    const context = createMockContext();

    const source = createAudioBufferFromChannels(
      [
        [0, 0.5],
        [1, -1],
      ],
      { sampleRate: context.sampleRate },
    );

    const shifted = addAudioBufferDcOffset(source, { offset: 0.25 });
    const perChannel = addAudioBufferDcOffset(source, { offset: [1, -1] });
    const missingChannel = addAudioBufferDcOffset(source, { offset: [0.5] });

    expect(Array.from(shifted.getChannelData(0))).toEqual([0.25, 0.75]);
    expect(Array.from(shifted.getChannelData(1))).toEqual([1.25, -0.75]);
    expect(Array.from(perChannel.getChannelData(0))).toEqual([1, 1.5]);
    expect(Array.from(perChannel.getChannelData(1))).toEqual([0, -2]);
    expect(Array.from(missingChannel.getChannelData(0))).toEqual([0.5, 1]);
    expect(Array.from(missingChannel.getChannelData(1))).toEqual([1, -1]);
    expect(Array.from(source.getChannelData(0))).toEqual([0, 0.5]);
  });

  it("validates AudioBuffer DC offset values", () => {
    const context = createMockContext();
    const source = createAudioBufferFromChannels([[1]], { sampleRate: context.sampleRate });

    expect(() => addAudioBufferDcOffset(source, { offset: Number.NaN })).toThrow(RangeError);
    expect(() => addAudioBufferDcOffset(source, { offset: [Number.NaN] })).toThrow(RangeError);
  });

  it("copies silent buffers when normalizing and validates target peaks", () => {
    const context = createMockContext();
    const source = createAudioBufferFromChannels([[0, 0]], { sampleRate: context.sampleRate });

    const normalized = normalizeAudioBuffer(source);

    expect(normalized).not.toBe(source);
    expect(getAudioBufferPeak(normalized)).toBe(0);
    expect(getAudioBufferRms(normalized)).toBe(0);
    expect(Array.from(normalized.getChannelData(0))).toEqual([0, 0]);
    expect(() => normalizeAudioBuffer(source, { peak: 0 })).toThrow(RangeError);
  });

  it("trims leading and trailing silence across all channels", () => {
    const source = createAudioBufferFromChannels(
      [
        [0, 0, 0.5, 0, 0],
        [0, -0.25, 0, 0, 0],
      ],
      {
        sampleRate: 10,
      },
    );

    const trimmed = trimAudioBuffer(source);

    expect(trimmed.length).toBe(2);
    expect(trimmed.numberOfChannels).toBe(2);
    expect(Array.from(trimmed.getChannelData(0))).toEqual([0, 0.5]);
    expect(Array.from(trimmed.getChannelData(1))).toEqual([-0.25, 0]);
  });

  it("trims with a threshold and returns empty buffers for silence", () => {
    const source = createAudioBufferFromChannels([[0.01, 0.2, 0.03]], {
      sampleRate: 10,
    });

    const silence = createAudioBufferFromChannels([[0, 0]], {
      sampleRate: 10,
    });

    const trimmed = trimAudioBuffer(source, { threshold: 0.05 });
    const empty = trimAudioBuffer(silence);

    expect(trimmed.getChannelData(0)[0]).toBeCloseTo(0.2);
    // Web Audio has no empty buffers, so pure silence trims to one silent frame.
    expect(empty.length).toBe(1);
    expect(empty.getChannelData(0)[0]).toBe(0);
    expect(empty.numberOfChannels).toBe(1);
    expect(() => trimAudioBuffer(source, { threshold: -1 })).toThrow(RangeError);
  });

  it("applies non-mutating linear fades to AudioBuffers", () => {
    const source = createAudioBufferFromChannels([[1, 1, 1, 1, 1]], {
      sampleRate: 10,
    });

    const faded = fadeAudioBuffer(source, { fadeIn: 0.2, fadeOut: 0.2 });

    expect(faded).not.toBe(source);
    expect(Array.from(faded.getChannelData(0))).toEqual([0, 0.5, 1, 0.5, 0]);
    expect(Array.from(source.getChannelData(0))).toEqual([1, 1, 1, 1, 1]);
  });

  it("clamps fades to short buffers and validates durations", () => {
    const source = createAudioBufferFromChannels([[1, 1]], {
      sampleRate: 10,
    });

    const faded = fadeAudioBuffer(source, { fadeIn: 1, fadeOut: 1 });

    expect(Array.from(faded.getChannelData(0))).toEqual([0, 0]);
    expect(() => fadeAudioBuffer(source, { fadeIn: -1 })).toThrow(RangeError);
  });
});
