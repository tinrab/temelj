import { describe, expect, it } from "vitest";

import {
  createMockAudioContext,
  MockBiquadFilterNode,
  MockDynamicsCompressorNode,
  MockGainNode,
  asNative,
  createMockFacade,
  asMock,
} from "../../tests/audio.ts";
import { EQ3, MultibandCompressor, MultibandSplit } from "../mod.ts";

describe("multiband utilities", () => {
  it("creates a three-band split with low and high crossover filters", () => {
    const context = createMockAudioContext(2);

    const split = new MultibandSplit(context, {
      highFrequency: 2_000,
      lowFrequency: 250,
      Q: 2,
    });

    const input = asMock<MockGainNode>(split.input);
    const low = asMock<MockBiquadFilterNode>(split.low);
    const lowMid = context.createdFilters[1]!;
    const mid = asMock<MockBiquadFilterNode>(split.mid);
    const high = asMock<MockBiquadFilterNode>(split.high);

    expect(input.connect.mock.calls).toEqual([[low], [lowMid], [high]]);
    expect(split.disposed).toBe(false);
    expect(lowMid.connect).toHaveBeenCalledWith(mid);
    expect(low.type).toBe("lowpass");
    expect(lowMid.type).toBe("highpass");
    expect(mid.type).toBe("lowpass");
    expect(high.type).toBe("highpass");
    expect(low.frequency.value).toBe(250);
    expect(mid.frequency.value).toBe(2_000);
    expect(high.Q.value).toBe(2);
  });

  it("updates split crossover frequencies and Q at facade immediate time", () => {
    const native = createMockAudioContext(3);
    const facade = createMockFacade(asNative<AudioContext>(native), 0.5);
    const split = new MultibandSplit(facade);
    const low = asMock<MockBiquadFilterNode>(split.low);
    const lowMid = native.createdFilters[1]!;
    const mid = asMock<MockBiquadFilterNode>(split.mid);
    const high = asMock<MockBiquadFilterNode>(split.high);

    split.setLowFrequency(300);
    split.setHighFrequency(3_000, 4);
    split.setQ(4);

    expect(low.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([300, 3]);
    expect(lowMid.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([300, 3]);
    expect(mid.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([3_000, 4]);
    expect(high.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([3_000, 4]);
    expect(high.Q.setValueAtTime.mock.calls.at(-1)).toEqual([4, 3]);

    split.dispose();
    split.dispose();

    expect(split.disposed).toBe(true);
    expect(low.disconnect).toHaveBeenCalledTimes(1);
    expect(lowMid.disconnect).toHaveBeenCalledTimes(1);
    expect(mid.disconnect).toHaveBeenCalledTimes(1);
    expect(high.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates a multiband compressor with split bands routed into a shared output", () => {
    const context = createMockAudioContext(1);

    const multiband = new MultibandCompressor(context, {
      high: { threshold: -18 },
      highFrequency: 1_600,
      low: { threshold: -36 },
      lowFrequency: 180,
      mid: { ratio: 5 },
    });

    const splitLow = asMock<MockBiquadFilterNode>(multiband.split.low);
    const splitMid = asMock<MockBiquadFilterNode>(multiband.split.mid);
    const splitHigh = asMock<MockBiquadFilterNode>(multiband.split.high);
    const low = asMock<MockDynamicsCompressorNode>(multiband.low.compressor);
    const mid = asMock<MockDynamicsCompressorNode>(multiband.mid.compressor);
    const high = asMock<MockDynamicsCompressorNode>(multiband.high.compressor);
    const output = asMock<MockGainNode>(multiband.output);

    expect(splitLow.connect).toHaveBeenCalledWith(low);
    expect(multiband.disposed).toBe(false);
    expect(splitMid.connect).toHaveBeenCalledWith(mid);
    expect(splitHigh.connect).toHaveBeenCalledWith(high);
    expect(low.connect).toHaveBeenCalledWith(output);
    expect(mid.connect).toHaveBeenCalledWith(output);
    expect(high.connect).toHaveBeenCalledWith(output);
    expect(low.threshold.value).toBe(-36);
    expect(mid.ratio.value).toBe(5);
    expect(high.threshold.value).toBe(-18);

    multiband.setLowFrequency(220, 2);
    expect(asMock<MockBiquadFilterNode>(multiband.split.low).frequency.value).toBe(220);

    multiband.dispose();
    multiband.dispose();
    expect(multiband.disposed).toBe(true);
    expect(multiband.split.disposed).toBe(true);
    expect(multiband.low.disposed).toBe(true);
    expect(multiband.mid.disposed).toBe(true);
    expect(multiband.high.disposed).toBe(true);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
    expect(low.disconnect).toHaveBeenCalledTimes(1);
    expect(mid.disconnect).toHaveBeenCalledTimes(1);
    expect(high.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates a three-band EQ with dB gain controls and shared output", () => {
    const context = createMockAudioContext(2);

    const eq = new EQ3(context, {
      high: 3,
      highFrequency: 2_200,
      low: -6,
      lowFrequency: 320,
      mid: 0,
    });

    const splitLow = asMock<MockBiquadFilterNode>(eq.split.low);
    const splitMid = asMock<MockBiquadFilterNode>(eq.split.mid);
    const splitHigh = asMock<MockBiquadFilterNode>(eq.split.high);
    const lowBand = asMock<MockGainNode>(eq.lowBand);
    const midBand = asMock<MockGainNode>(eq.midBand);
    const highBand = asMock<MockGainNode>(eq.highBand);
    const output = asMock<MockGainNode>(eq.output);

    expect(splitLow.connect).toHaveBeenCalledWith(lowBand);
    expect(eq.disposed).toBe(false);
    expect(splitMid.connect).toHaveBeenCalledWith(midBand);
    expect(splitHigh.connect).toHaveBeenCalledWith(highBand);
    expect(lowBand.connect).toHaveBeenCalledWith(output);
    expect(midBand.connect).toHaveBeenCalledWith(output);
    expect(highBand.connect).toHaveBeenCalledWith(output);
    expect(lowBand.gain.value).toBeCloseTo(0.501_187, 5);
    expect(midBand.gain.value).toBe(1);
    expect(highBand.gain.value).toBeCloseTo(1.412_538, 5);
    expect(eq.lowFrequency.value).toBe(320);
    expect(eq.highFrequency.value).toBe(2_200);
  });

  it("updates EQ band gains and crossover frequencies at scheduled times", () => {
    const native = createMockAudioContext(5);
    const facade = createMockFacade(asNative<AudioContext>(native), 0.1);
    const eq = new EQ3(facade);
    const lowBand = asMock<MockGainNode>(eq.lowBand);
    const midBand = asMock<MockGainNode>(eq.midBand);
    const highBand = asMock<MockGainNode>(eq.highBand);
    const low = asMock<MockBiquadFilterNode>(eq.split.low);
    const high = asMock<MockBiquadFilterNode>(eq.split.high);

    eq.setLow(-12);
    eq.setMid(6, 7);
    eq.setHigh(Number.NEGATIVE_INFINITY, 8);
    eq.setLowFrequency(180, 9);
    eq.setHighFrequency(4_000, 10);

    expect(lowBand.gain.setValueAtTime.mock.calls.at(-1)?.[0]).toBeCloseTo(0.251_189, 5);
    expect(lowBand.gain.setValueAtTime.mock.calls.at(-1)?.[1]).toBe(5);
    expect(midBand.gain.setValueAtTime.mock.calls.at(-1)?.[0]).toBeCloseTo(1.995_262, 5);
    expect(midBand.gain.setValueAtTime.mock.calls.at(-1)?.[1]).toBe(7);
    expect(highBand.gain.setValueAtTime.mock.calls.at(-1)).toEqual([0, 8]);
    expect(low.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([180, 9]);
    expect(high.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([4_000, 10]);
  });

  it("disposes EQ routing nodes", () => {
    const context = createMockAudioContext(1);
    const eq = new EQ3(context);
    const lowBand = asMock<MockGainNode>(eq.lowBand);
    const midBand = asMock<MockGainNode>(eq.midBand);
    const highBand = asMock<MockGainNode>(eq.highBand);
    const output = asMock<MockGainNode>(eq.output);
    const splitLow = asMock<MockBiquadFilterNode>(eq.split.low);

    eq.dispose();
    eq.dispose();

    expect(eq.disposed).toBe(true);
    expect(eq.split.disposed).toBe(true);
    expect(splitLow.disconnect).toHaveBeenCalledTimes(1);
    expect(lowBand.disconnect).toHaveBeenCalledTimes(1);
    expect(midBand.disconnect).toHaveBeenCalledTimes(1);
    expect(highBand.disconnect).toHaveBeenCalledTimes(1);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
  });
});
