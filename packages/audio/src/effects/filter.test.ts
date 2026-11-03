import { describe, expect, it } from "vitest";

import {
  createMockAudioContext,
  MockBiquadFilterNode,
  MockConvolverNode,
  MockDelayNode,
  MockGainNode,
  MockIIRFilterNode,
  asNative,
  createMockFacade,
  asMock,
  invalid,
} from "../../tests/audio.ts";
import {
  Convolver,
  Filter,
  IIRFilter,
  FeedbackCombFilter,
  LowpassCombFilter,
  OnePoleFilter,
} from "../mod.ts";

describe("audio filter utilities", () => {
  it("creates a convolver with buffer and normalize controls", () => {
    const context = createMockAudioContext();
    const buffer = asNative<AudioBuffer>({ duration: 1 });

    const convolver = new Convolver(context, {
      buffer,
      normalize: false,
    });

    const native = asMock<MockConvolverNode>(convolver.convolver);

    expect(native.buffer).toBe(buffer);
    expect(native.normalize).toBe(false);
    expect(convolver.buffer).toBe(buffer);

    convolver.setNormalize(true);

    expect(native.normalize).toBe(true);
    expect(convolver.normalize).toBe(true);
  });

  it("replaces convolver nodes when an existing buffer is changed", () => {
    const context = createMockAudioContext();
    const firstBuffer = asNative<AudioBuffer>({ duration: 1 });
    const secondBuffer = asNative<AudioBuffer>({ duration: 2 });
    const convolver = new Convolver(context, { buffer: firstBuffer });
    const first = asMock<MockConvolverNode>(convolver.convolver);

    convolver.setNormalize(false);
    convolver.setBuffer(secondBuffer);
    const second = asMock<MockConvolverNode>(convolver.convolver);

    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    expect(second.buffer).toBe(secondBuffer);
    expect(second.normalize).toBe(false);
    expect(context.createdConvolvers).toHaveLength(2);
  });

  it("disconnects convolver routing on dispose", () => {
    const context = createMockAudioContext();
    const convolver = new Convolver(context);
    const input = asMock<MockGainNode>(convolver.input);
    const output = asMock<MockGainNode>(convolver.output);
    const native = asMock<MockConvolverNode>(convolver.convolver);

    expect(convolver.disposed).toBe(false);

    convolver.dispose();
    convolver.dispose();

    expect(convolver.disposed).toBe(true);
    expect(input.disconnect).toHaveBeenCalledTimes(1);
    expect(native.disconnect).toHaveBeenCalledTimes(1);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates a cascaded filter for the requested rolloff", () => {
    const context = createMockAudioContext(2);

    const filter = new Filter(context, {
      frequency: 800,
      Q: 2,
      rolloff: -48,
      type: "highpass",
    });

    const input = asMock<MockGainNode>(filter.input);
    const filters = asMock<MockBiquadFilterNode[]>(filter.filters);

    expect(filters).toHaveLength(4);
    expect(filter.rolloff).toBe(-48);
    expect(filter.type).toBe("highpass");
    expect(input.connect).toHaveBeenCalledWith(filters[0]);
    expect(filters[0]?.connect).toHaveBeenCalledWith(filters[1]);
    expect(filters.at(-1)?.connect).toHaveBeenCalledWith(filter.output);
    expect(filters.every((node) => node.frequency.value === 800)).toBe(true);
    expect(filters.every((node) => node.Q.value === 2)).toBe(true);
  });

  it("updates params at facade immediate time", () => {
    const native = createMockAudioContext(3);
    const facade = createMockFacade(asNative<AudioContext>(native), 0.5);
    const filter = new Filter(facade, { rolloff: -24 });
    const filters = asMock<MockBiquadFilterNode[]>(filter.filters);

    filter.setFrequency(1_200);
    filter.setQ(4, 5);
    filter.setGain(-3, 6);
    filter.setDetune(12, 7);
    filter.setType("peaking");

    expect(filters[0]?.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([1_200, 3]);
    expect(filters[1]?.frequency.setValueAtTime.mock.calls.at(-1)).toEqual([1_200, 3]);
    expect(filters[0]?.Q.setValueAtTime.mock.calls.at(-1)).toEqual([4, 5]);
    expect(filters[0]?.gain.setValueAtTime.mock.calls.at(-1)).toEqual([-3, 6]);
    expect(filters[0]?.detune.setValueAtTime.mock.calls.at(-1)).toEqual([12, 7]);
    expect(filters.every((node) => node.type === "peaking")).toBe(true);
  });

  it("rebuilds filters when rolloff changes and preserves settings", () => {
    const context = createMockAudioContext(1);

    const filter = new Filter(context, {
      frequency: 500,
      gain: -2,
      rolloff: -12,
      type: "lowpass",
    });

    const first = asMock<MockBiquadFilterNode>(filter.filters[0]);

    filter.setRolloff(-96);
    const rebuilt = asMock<MockBiquadFilterNode[]>(filter.filters);

    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(rebuilt).toHaveLength(8);
    expect(rebuilt.every((node) => node.frequency.value === 500)).toBe(true);
    expect(rebuilt.every((node) => node.gain.value === -2)).toBe(true);
    expect(() => filter.setRolloff(invalid<-12>(-36))).toThrow(RangeError);
  });

  it("returns a cascaded frequency response", () => {
    const context = createMockAudioContext();
    const filter = new Filter(context, { rolloff: -24 });

    const response = filter.getFrequencyResponse(3);

    expect(Array.from(response)).toEqual([0.25, 0.25, 0.25]);
  });

  it("disconnects input, filters, and output on dispose", () => {
    const context = createMockAudioContext();
    const filter = new Filter(context, { rolloff: -24 });
    const input = asMock<MockGainNode>(filter.input);
    const output = asMock<MockGainNode>(filter.output);
    const filters = asMock<MockBiquadFilterNode[]>(filter.filters);

    expect(filter.disposed).toBe(false);

    input.disconnect.mockClear();
    filter.dispose();
    filter.dispose();

    expect(filter.disposed).toBe(true);
    expect(input.disconnect).toHaveBeenCalledTimes(1);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
    expect(filters[0]?.disconnect).toHaveBeenCalledTimes(1);
    expect(filters[1]?.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("comb filter utilities", () => {
  it("creates a feedback comb filter with delay feedback routing", () => {
    const context = createMockAudioContext(2);

    const comb = new FeedbackCombFilter(context, {
      delayTime: 0.2,
      resonance: 0.75,
    });

    const input = asMock<MockGainNode>(comb.input);
    const output = asMock<MockGainNode>(comb.output);
    const delay = asMock<MockDelayNode>(comb.delay);
    const feedback = asMock<MockGainNode>(comb.feedback);

    expect(delay.delayTime.value).toBe(0.2);
    expect(feedback.gain.value).toBe(0.75);
    expect(input.connect).toHaveBeenCalledWith(delay);
    expect(delay.connect).toHaveBeenCalledWith(output);
    expect(delay.connect).toHaveBeenCalledWith(feedback);
    expect(feedback.connect).toHaveBeenCalledWith(delay);

    comb.setDelayTime(0.3, 4);
    comb.setResonance(1, 5);

    expect(delay.delayTime.setValueAtTime).toHaveBeenCalledWith(0.3, 4);
    expect(feedback.gain.setValueAtTime).toHaveBeenCalledWith(1, 5);

    expect(comb.disposed).toBe(false);

    comb.dispose();
    comb.dispose();

    expect(comb.disposed).toBe(true);
    expect(input.disconnect).toHaveBeenCalledTimes(1);
    expect(delay.disconnect).toHaveBeenCalledTimes(1);
    expect(feedback.disconnect).toHaveBeenCalledTimes(1);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
  });

  it("creates a lowpass comb filter with dampened feedback input", () => {
    const context = createMockAudioContext(2);

    const comb = new LowpassCombFilter(context, {
      dampening: 1_500,
      delayTime: 0.1,
      resonance: 0.4,
    });

    const input = asMock<MockGainNode>(comb.input);
    const lowpass = asMock<MockBiquadFilterNode>(comb.lowpass);
    const delay = asMock<MockDelayNode>(comb.delay);
    const feedback = asMock<MockGainNode>(comb.feedback);

    expect(lowpass.type).toBe("lowpass");
    expect(lowpass.frequency.value).toBe(1_500);
    expect(input.disconnect).toHaveBeenCalledTimes(1);
    expect(input.connect).toHaveBeenLastCalledWith(lowpass);
    expect(lowpass.connect).toHaveBeenCalledWith(delay);

    comb.setDampening(2_400, 3);
    comb.setDelayTime(0.25, 4);
    comb.setResonance(0, 5);

    expect(lowpass.frequency.setValueAtTime).toHaveBeenCalledWith(2_400, 3);
    expect(delay.delayTime.setValueAtTime).toHaveBeenCalledWith(0.25, 4);
    expect(feedback.gain.setValueAtTime).toHaveBeenCalledWith(0, 5);

    expect(comb.disposed).toBe(false);

    comb.dispose();
    comb.dispose();

    expect(comb.disposed).toBe(true);
    expect(lowpass.disconnect).toHaveBeenCalledTimes(1);
  });
});

describe("one-pole filter utilities", () => {
  it("creates a generic IIR filter and exposes its frequency response", () => {
    const context = createMockAudioContext();

    const filter = new IIRFilter(context, {
      feedback: [1, -0.5],
      feedforward: [0.25, 0.25],
    });

    const iir = asMock<MockIIRFilterNode>(filter.filter);

    expect(filter.input).toBe(iir);
    expect(filter.output).toBe(iir);
    expect(filter.coefficients).toEqual({ feedback: [1, -0.5], feedforward: [0.25, 0.25] });
    expect(Array.from(filter.getFrequencyResponse(3))).toEqual([0.75, 0.75, 0.75]);

    filter.dispose();
    filter.dispose();

    expect(filter.disposed).toBe(true);
    expect(iir.disconnect).toHaveBeenCalledTimes(1);
  });

  it("validates generic IIR coefficients", () => {
    const context = createMockAudioContext();

    for (const coefficients of [
      { feedback: [], feedforward: [1] },
      { feedback: [1], feedforward: [] },
      { feedback: [1, Number.POSITIVE_INFINITY], feedforward: [1] },
      { feedback: [0], feedforward: [1] },
    ]) {
      expect(() => new IIRFilter(context, coefficients)).toThrow(RangeError);
    }
  });

  it("creates a lowpass IIR filter and connects input to output", () => {
    const context = createMockAudioContext();

    const filter = new OnePoleFilter(context, {
      frequency: 880,
      type: "lowpass",
    });

    const input = asMock<MockGainNode>(filter.input);
    const iir = asMock<MockIIRFilterNode>(filter.filter);

    expect(filter.frequency).toBe(880);
    expect(filter.type).toBe("lowpass");
    expect(input.connect).toHaveBeenCalledWith(iir);
    expect(iir.connect).toHaveBeenCalledWith(filter.output);
    expect(iir.feedforward[1]).toBe(0);
    expect(iir.feedback[0]).toBe(1);
  });

  it("replaces the IIR filter when frequency or type changes", () => {
    const context = createMockAudioContext();
    const filter = new OnePoleFilter(context);
    const input = asMock<MockGainNode>(filter.input);
    const first = asMock<MockIIRFilterNode>(filter.filter);

    filter.setType("highpass");
    const highpass = asMock<MockIIRFilterNode>(filter.filter);
    filter.setFrequency(440);
    const lower = asMock<MockIIRFilterNode>(filter.filter);

    expect(first.disconnect).toHaveBeenCalledTimes(1);
    expect(highpass).not.toBe(first);
    expect(highpass.feedforward).toEqual([1, -1]);
    expect(lower).not.toBe(highpass);
    expect(filter.frequency).toBe(440);
    expect(input.disconnect).toHaveBeenCalledTimes(2);
  });

  it("returns the active IIR frequency response and disposes nodes", () => {
    const context = createMockAudioContext();
    const filter = new OnePoleFilter(context, { type: "highpass" });
    const input = asMock<MockGainNode>(filter.input);
    const output = asMock<MockGainNode>(filter.output);
    const iir = asMock<MockIIRFilterNode>(filter.filter);

    expect(filter.disposed).toBe(false);
    expect(Array.from(filter.getFrequencyResponse(2))).toEqual([0.75, 0.75]);

    input.disconnect.mockClear();
    filter.dispose();
    filter.dispose();

    expect(filter.disposed).toBe(true);
    expect(input.disconnect).toHaveBeenCalledTimes(1);
    expect(iir.disconnect).toHaveBeenCalledTimes(1);
    expect(output.disconnect).toHaveBeenCalledTimes(1);
  });
});
