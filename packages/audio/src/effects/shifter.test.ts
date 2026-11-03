import { describe, expect, it } from "vitest";

import { createMockAudioContext } from "../../tests/audio.ts";
import { AudioDisposedError } from "../errors.ts";
import { FrequencyShifter, PhaseShiftAllpass } from "./frequency-shifter.ts";
import { PitchShift } from "./pitch-shift.ts";

describe("PitchShift", () => {
  it("builds its graph without exposing internal nodes", () => {
    const context = createMockAudioContext(2);

    const shift = new PitchShift(context, { delayTime: 0.1, feedback: 0.3, pitch: 7, wet: 0.5 });

    expect(Object.keys(shift)).toEqual(["input", "output"]);
    expect(shift.wet.value).toBe(0.5);
    expect(shift.feedback.value).toBe(0.3);
    expect(shift.delayTime.value).toBe(0.1);
    expect(context.createdOscillators).toHaveLength(0);

    // The sweep loops a one-second ramp, so its playback rate is the sweep frequency. One window
    // per sweep: the delay falls by 0.1 s every `1 / frequency` seconds.
    const [sweep] = context.createdSources;
    expect(sweep?.loop).toBe(true);
    expect(sweep?.buffer?.duration).toBe(1);
    expect(sweep?.playbackRate.value).toBeCloseTo((2 ** (7 / 12) - 1) / 0.1, 5);

    // The feedback delay is created first; the two shifting lines sit at the window center.
    const [feedbackDelay, lineA, lineB] = context.createdDelays;
    expect(feedbackDelay?.delayTime.value).toBe(0.1);
    expect(lineA?.delayTime.value).toBeCloseTo(0.05, 5);
    expect(lineB?.delayTime.value).toBeCloseTo(0.05, 5);
  });

  it("sweeps the delay up for downward shifts at the matching rate", () => {
    const context = createMockAudioContext(2);
    new PitchShift(context, { pitch: -12, windowSize: 0.2 });

    expect(context.createdSources[0]?.playbackRate.value).toBeCloseTo(0.5 / 0.2, 5);
  });

  it("starts, retunes, and disposes its sweep", () => {
    const context = createMockAudioContext(2);
    const shift = new PitchShift(context);

    shift.start(3);
    shift.setPitch(-12, 4);
    shift.dispose();

    expect(context.createdSources).toHaveLength(1);

    for (const sweep of context.createdSources) {
      expect(sweep.start).toHaveBeenCalledWith(3);
      expect(sweep.stop).toHaveBeenCalled();
      expect(sweep.disconnect).toHaveBeenCalled();
    }

    expect(shift.pitch).toBe(-12);
    expect(shift.state).toBe("stopped");
    expect(() => shift.start()).toThrow(AudioDisposedError);
  });

  it("validates its options", () => {
    const context = createMockAudioContext();

    expect(() => new PitchShift(context, { windowSize: 0 })).toThrow("windowSize");
    expect(() => new PitchShift(context, { windowSize: 1.5 })).toThrow("windowSize");
    expect(() => new PitchShift(context).setPitch(Number.NaN)).toThrow("pitch");
  });
});

describe("PhaseShiftAllpass", () => {
  it("creates two four-stage all-pass chains plus a one-sample delay", () => {
    const context = createMockAudioContext();

    const allpass = new PhaseShiftAllpass(context);

    expect(context.createdIIRFilters).toHaveLength(9);
    expect(
      context.createdIIRFilters.filter((filter) => filter.feedforward.length === 2),
    ).toHaveLength(1);
    allpass.dispose();
    expect(
      context.createdIIRFilters.every((filter) => filter.disconnect.mock.calls.length > 0),
    ).toBe(true);
    expect(allpass.disposed).toBe(true);
  });
});

describe("FrequencyShifter", () => {
  it("modulates quadrature branches with sine and cosine carriers", () => {
    const context = createMockAudioContext(1);

    const shifter = new FrequencyShifter(context, { frequency: 30, wet: 0.25 });
    shifter.start(2);
    shifter.setFrequency(-10, 3);

    expect(shifter.wet.value).toBe(0.25);
    expect(context.createPeriodicWave).toHaveBeenCalledOnce();

    for (const carrier of context.createdOscillators) {
      expect(carrier.start).toHaveBeenCalledWith(2);
      expect(carrier.frequency.setValueAtTime).toHaveBeenCalledWith(-10, 3);
    }

    expect(shifter.frequency).toBe(-10);

    shifter.dispose();
    expect(context.createdOscillators.every((carrier) => carrier.stop.mock.calls.length > 0)).toBe(
      true,
    );
  });
});
