import { describe, expect, it } from "vitest";

import { asNative, createMockAudioContext, MockAudioParam, invalid } from "../../tests/audio.ts";
import { AmplitudeEnvelope, applyEnvelope, Envelope, FrequencyEnvelope } from "../mod.ts";

describe("Envelope", () => {
  it("schedules linear attack and exponential decay by default", () => {
    const envelope = new Envelope({
      attack: 0.2,
      decay: 0.3,
      sustain: 0.25,
    });

    const param = new MockAudioParam();

    envelope.triggerAttack(asNative<AudioParam>(param), 1, { velocity: 0.8 });

    expect(envelope.state).toBe("started");
    expect(param.cancelAndHoldAtTime).toHaveBeenCalledWith(1);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0, 1);
    expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(0.8, 1.2);
    expect(param.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.2, 1.5);
  });

  it("supports exponential attack and linear release", () => {
    const envelope = new Envelope({
      attack: 0.1,
      attackCurve: "exponential",
      release: 0.4,
      releaseCurve: "linear",
    });

    const param = new MockAudioParam();

    envelope.triggerAttack(asNative<AudioParam>(param), 2);
    envelope.triggerRelease(asNative<AudioParam>(param), 3);

    expect(envelope.state).toBe("stopped");
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.000_001, 2);
    expect(param.exponentialRampToValueAtTime).toHaveBeenCalledWith(1, 2.1);
    expect(param.cancelAndHoldAtTime).toHaveBeenCalledWith(3);
    expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(0, 3.4);
  });

  it("schedules attack release with musical durations", () => {
    const envelope = new Envelope({
      attack: "8n",
      decay: "8n",
      release: "4n",
      sustain: 0.5,
    });

    const param = new MockAudioParam();

    envelope.triggerAttackRelease(asNative<AudioParam>(param), "2n", "+0.25", {
      bpm: 120,
      now: 10,
    });

    expect(envelope.state).toBe("started");
    expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.5);
    expect(param.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.5, 10.75);
    expect(param.cancelAndHoldAtTime).toHaveBeenCalledWith(10.25);
    expect(param.cancelAndHoldAtTime).toHaveBeenCalledWith(11.25);
    expect(param.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.000_001, 11.75);
  });

  it("holds the scheduled level on release when cancelAndHoldAtTime is unavailable", () => {
    const envelope = new Envelope({ attack: 0.1, decay: 0.1, release: 0.2, sustain: 0.5 });
    const param = new MockAudioParam(0);
    Object.defineProperty(param, "cancelAndHoldAtTime", { value: undefined });
    const audioParam = asNative<AudioParam>(param);

    envelope.triggerAttack(audioParam, 0);
    envelope.triggerRelease(audioParam, 1);
    expect(param.setValueAtTime).toHaveBeenLastCalledWith(0.5, 1);

    envelope.triggerAttack(audioParam, 2);
    envelope.triggerRelease(audioParam, 2.05);
    const [heldLevel, heldTime] = param.setValueAtTime.mock.lastCall ?? [];
    expect(heldLevel).toBeCloseTo(0.5, 9);
    expect(heldTime).toBe(2.05);
    // The default release curve is exponential, which cannot reach 0 and stops at a small floor.
    expect(param.exponentialRampToValueAtTime).toHaveBeenLastCalledWith(0.000_001, 2.25);
  });

  it("uses cancelScheduledValues when cancelAndHoldAtTime is unavailable", () => {
    const envelope = new Envelope({ release: 0 });
    const param = new MockAudioParam();
    Object.defineProperty(param, "cancelAndHoldAtTime", { value: undefined });

    envelope.triggerRelease(asNative<AudioParam>(param), 1);

    expect(param.cancelScheduledValues).toHaveBeenCalledWith(1);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0, 1);
  });

  it("supports non-zero min/max and clamps sustain and velocity", () => {
    const envelope = new Envelope({
      attack: 0,
      decay: 0,
      max: 10,
      min: 2,
      sustain: 2,
    });

    const param = new MockAudioParam();

    envelope.triggerAttack(asNative<AudioParam>(param), 0, { velocity: 2 });

    expect(envelope.sustain).toBe(1);
    expect(param.setValueAtTime).toHaveBeenCalledWith(10, 0);
  });

  it("validates curves, durations, and bpm", () => {
    expect(() => new Envelope({ attackCurve: invalid<"linear">("bounce") })).toThrow(RangeError);

    const envelope = new Envelope({ attack: -1 });
    const param = new MockAudioParam();

    expect(() => envelope.triggerAttack(asNative<AudioParam>(param))).toThrow(RangeError);
    expect(() => envelope.triggerAttack(asNative<AudioParam>(param), 0, { bpm: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      new Envelope({ decay: "soon" }).triggerAttack(asNative<AudioParam>(param)),
    ).toThrow(RangeError);
  });

  it("exposes idempotent disposal state", () => {
    const envelope = new Envelope();

    expect(envelope.disposed).toBe(false);
    expect(envelope.state).toBe("stopped");
    envelope.dispose();
    envelope.dispose();

    expect(envelope.disposed).toBe(true);
    expect(envelope.state).toBe("stopped");
  });

  it("applies a one-shot envelope with convenience helper", () => {
    const param = new MockAudioParam();

    const result = applyEnvelope(asNative<AudioParam>(param), 0.5, {
      attack: 0.1,
      release: 0.2,
    });

    expect(result).toBe(param);
    expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(1, 0.1);
    expect(param.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.000_001, 0.7);
  });

  it("starts the one-shot envelope at the given context time", () => {
    const param = new MockAudioParam();

    applyEnvelope(asNative<AudioParam>(param), 0.5, { attack: 0.1, release: 0.2, time: 10 });

    expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.1);
    expect(param.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.000_001, 10.7);
  });

  it("wraps a gain node in an amplitude envelope", () => {
    const context = createMockAudioContext();

    const envelope = new AmplitudeEnvelope(context, {
      attack: 0.1,
      decay: 0,
      release: 0.2,
      sustain: 1,
    });

    const gain = context.createdGains[0]!;

    expect(envelope.input).toBe(gain);
    expect(envelope.state).toBe("stopped");
    expect(gain.gain.value).toBe(0);

    envelope.triggerAttackRelease(0.5, 1);

    expect(envelope.state).toBe("started");
    expect(gain.gain.linearRampToValueAtTime.mock.calls).toContainEqual([1, 1.1]);
    expect(gain.gain.exponentialRampToValueAtTime.mock.calls).toContainEqual([0.000_001, 1.7]);

    envelope.dispose();
    envelope.dispose();
    expect(envelope.envelope.disposed).toBe(true);
    expect(gain.disconnect).toHaveBeenCalledTimes(1);
  });

  it("sweeps a constant source across octaves above the base frequency", () => {
    const context = createMockAudioContext();

    const envelope = new FrequencyEnvelope(context, {
      attack: 0.1,
      baseFrequency: "A3",
      decay: 0,
      exponent: 2,
      octaves: 2,
      release: 0.2,
      sustain: 0.5,
    });

    const source = context.createdConstantSources[0]!;

    expect(source.start).toHaveBeenCalledTimes(1);
    expect(source.offset.value).toBe(220);
    expect(envelope.envelope.max).toBe(880);

    envelope.triggerAttack(1, { velocity: 0.5 });
    expect(source.offset.linearRampToValueAtTime.mock.calls).toContainEqual([385, 1.1]);

    envelope.setBaseFrequency(110);
    envelope.setOctaves(1);
    expect(source.offset.value).toBe(110);
    expect(envelope.envelope.max).toBe(220);

    envelope.dispose();
    envelope.dispose();
    expect(envelope.envelope.disposed).toBe(true);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(source.stop).toHaveBeenCalledTimes(1);
  });
});
