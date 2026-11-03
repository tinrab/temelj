import { describe, expect, it, vi } from "vitest";

import type { AudioSignal, SyncedSignalTransport } from "./param-signal.ts";
import type { ParamUnit } from "./param.ts";

import {
  createMockAudioContext,
  MockAudioNode,
  MockAudioParam,
  MockConstantSourceNode,
  asMock,
  asNative,
} from "../../tests/audio.ts";
import { createAudioSignal, createSyncedSignal } from "./param-signal.ts";
import { createParam, dbToGain, equalPowerScale, gainToDb } from "./param.ts";

function createMockContext(currentTime = 1): ReturnType<typeof createMockAudioContext> {
  return createMockAudioContext(currentTime);
}

describe("Param", () => {
  it("converts values between units and audio values", () => {
    const mock = new MockAudioParam();
    const dbParam = createParam(asNative<AudioParam>(mock), "decibels", () => 0);

    expect(dbParam.toAudioValue(-6)).toBeCloseTo(0.5011872336272722, 12);
    expect(dbParam.fromAudioValue(0.5)).toBeCloseTo(-6.020599913279624, 12);
    const sixDecibels = -6;
    expect(dbToGain(sixDecibels)).toBeCloseTo(0.5011872336272722, 12);
    expect(gainToDb(0.5)).toBeCloseTo(-6.020599913279624, 12);
  });

  it("maps normal ranges to equal-power gain", () => {
    expect(equalPowerScale(0)).toBe(0);
    expect(equalPowerScale(0.5)).toBeCloseTo(0.7071067811865475, 12);
    expect(equalPowerScale(0.75)).toBeCloseTo(0.9238795325112867, 12);
    expect(equalPowerScale(1)).toBe(1);
    expect(equalPowerScale(-1)).toBe(0);
    expect(equalPowerScale(2)).toBe(1);
  });

  it("tracks setValue and ramp automation in local time space", () => {
    const linear = new MockAudioParam(0);
    const linearParam = createParam(asNative<AudioParam>(linear), "normalRange", () => 0);

    linearParam.setValueAtTime(0, 0);
    linearParam.linearRampToValueAtTime(2, 2);
    expect(linearParam.getValueAtTime(1)).toBe(1);

    const exponential = new MockAudioParam(200);
    const expParam = createParam(asNative<AudioParam>(exponential), "hertz", () => 0);

    expParam.setValueAtTime(200, 0);
    expParam.exponentialRampToValueAtTime(800, 2);
    expect(expParam.getValueAtTime(1)).toBeCloseTo(400, 10);
  });

  it("creates explicit ramp points for delayed Tone-style ramps", () => {
    const linear = new MockAudioParam(0);
    const linearParam = createParam(asNative<AudioParam>(linear), "normalRange", () => 0);

    linearParam.setValueAtTime(0, 0);
    linearParam.setValueAtTime(4, 2);
    linearParam.linearRampTo(8, 2, 4);

    expect(linear.cancelAndHoldAtTime).toHaveBeenCalledWith(4);
    expect(linearParam.getValueAtTime(3)).toBe(4);
    expect(linearParam.getValueAtTime(5)).toBe(6);

    const exponential = new MockAudioParam(200);
    const expParam = createParam(asNative<AudioParam>(exponential), "hertz", () => 0);

    expParam.setValueAtTime(200, 0);
    expParam.exponentialRampTo(800, 2, 4);

    expect(exponential.cancelAndHoldAtTime).toHaveBeenCalledWith(4);
    expect(expParam.getValueAtTime(5)).toBeCloseTo(400, 10);
  });

  it("cancels future automation and locally holds the current value", () => {
    const mock = new MockAudioParam(0);
    const param = createParam(asNative<AudioParam>(mock), "normalRange", () => 0);

    param.setValueAtTime(0, 0);
    param.linearRampToValueAtTime(10, 10);
    param.cancelAndHoldAtTime(4);

    expect(mock.cancelAndHoldAtTime).toHaveBeenCalledWith(4);
    expect(param.getValueAtTime(4)).toBe(4);
    expect(param.getValueAtTime(8)).toBe(4);
  });

  it("falls back to cancelScheduledValues when cancelAndHoldAtTime is unavailable", () => {
    const mock = new MockAudioParam(0);
    Reflect.deleteProperty(mock, "cancelAndHoldAtTime");
    const param = createParam(asNative<AudioParam>(mock), "normalRange", () => 0);

    param.setValueAtTime(0, 0);
    param.linearRampToValueAtTime(10, 10);
    param.setRampPoint(4);

    expect(mock.cancelScheduledValues).toHaveBeenCalledWith(4);
    expect(mock.setValueAtTime).toHaveBeenCalledWith(4, 4);
    expect(param.getValueAtTime(8)).toBe(4);
  });

  it("passes hertz values through without clamping and converts decibels", () => {
    const mock = new MockAudioParam(440);
    const hertz = createParam(asNative<AudioParam>(mock), "hertz", () => 0);
    const decibels = createParam(asNative<AudioParam>(mock), "decibels", () => 0);

    expect(hertz.toAudioValue(0.5)).toBe(0.5);
    expect(hertz.toAudioValue(40_000)).toBe(40_000);
    expect(decibels.toAudioValue(-120)).toBeCloseTo(1e-6);
    expect(decibels.toAudioValue(0)).toBe(1);
  });

  it("forwards converted values to underlying AudioParam calls", () => {
    const mock = new MockAudioParam(1);
    const hParam = createParam(asNative<AudioParam>(mock), "decibels", () => 0);

    hParam.setValueAtTime(-12, 0.5);
    hParam.rampTo(-6, 2, 0);

    expect(mock.setValueAtTime).toHaveBeenCalledWith(10 ** (-12 / 20), 0.5);
    expect(mock.exponentialRampToValueAtTime).toHaveBeenCalledWith(10 ** (-6 / 20), 2);
  });

  it("returns user-space values from scheduled automation in getValueAtTime", () => {
    const mock = new MockAudioParam(1);
    const dbParam = createParam(asNative<AudioParam>(mock), "decibels", () => 0);

    dbParam.setValueAtTime(-12, 0);
    dbParam.setTargetAtTime(-6, 0, 1);

    expect(dbParam.getValueAtTime(0.5)).toBeCloseTo(
      gainToDb(10 ** (-12 / 20) + (10 ** (-6 / 20) - 10 ** (-12 / 20)) * Math.exp(-0.5 / 1)),
      10,
    );
  });

  it("creates an auto-started audio signal with unit-aware offset automation", () => {
    const context = createMockContext(2);

    const signal = createAudioSignal(context, {
      unit: "decibels",
      value: -6,
    });

    const source = asMock<MockConstantSourceNode>(signal.node);

    expect(signal.output).toBe(signal.node);
    expect(signal.state).toBe("started");
    expect(signal.unit).toBe("decibels");
    expect(signal.value).toBeCloseTo(-6, 12);
    expect(source.offset.setValueAtTime).toHaveBeenCalledWith(10 ** (-6 / 20), 2);
    expect(source.start).toHaveBeenCalledWith(2);

    signal.setValueAtTime(-12, 3);

    expect(source.offset.setValueAtTime).toHaveBeenCalledWith(10 ** (-12 / 20), 3);
    expect(signal.offset.getValueAtTime(3)).toBeCloseTo(-12, 12);
  });

  it("connects and disconnects audio signals to nodes and params", () => {
    const context = createMockContext(1);
    const signal = createAudioSignal(context, { autoStart: false, value: 0.25 });
    const source = asMock<MockConstantSourceNode>(signal.node);
    const destination = new MockAudioNode();
    const param = new MockAudioParam(0);

    signal.connect(asNative<AudioNode>(destination));
    signal.connect(asNative<AudioParam>(param));
    signal.disconnect();

    expect(source.start).not.toHaveBeenCalled();
    expect(signal.state).toBe("stopped");
    expect(signal.state).toBe("stopped");
    expect(source.connect.mock.calls).toEqual([[destination], [param]]);
    expect(source.disconnect.mock.calls).toEqual([[]]);
  });

  it("starts and stops audio signals idempotently", () => {
    const context = createMockContext(4);
    const signal = createAudioSignal(context, { autoStart: false });
    const source = asMock<MockConstantSourceNode>(signal.node);

    expect(signal.state).toBe("stopped");
    expect(signal.state).toBe("stopped");
    signal.start();
    signal.start(5);
    expect(signal.state).toBe("started");
    expect(signal.state).toBe("started");
    signal.stop(6);
    expect(signal.state).toBe("stopped");
    expect(signal.state).toBe("stopped");

    expect(source.start.mock.calls).toEqual([[4]]);
    expect(source.stop.mock.calls).toEqual([[6]]);
  });

  it("disconnects and stops started audio signals on dispose", () => {
    const context = createMockContext(8);
    const signal = createAudioSignal(context);
    const source = asMock<MockConstantSourceNode>(signal.node);

    expect(signal.disposed).toBe(false);
    expect(signal.state).toBe("started");
    expect(signal.state).toBe("started");

    signal.dispose();
    signal.dispose();

    expect(signal.disposed).toBe(true);
    expect(signal.state).toBe("stopped");
    expect(signal.state).toBe("stopped");
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(source.stop).toHaveBeenCalledWith(8);
  });

  it("creates synced signals that follow a transport BPM ratio", () => {
    const context = createMockContext(2);
    let transport: SyncedSignalTransport & { bpm: number };

    const syncSignal = vi.fn<
      (signal: AudioSignal<ParamUnit>, ratio?: number) => SyncedSignalTransport
    >((signal, ratio) => {
      signal.setValueAtTime(transport.bpm * (ratio ?? 0), context.currentTime);

      return transport;
    });

    const unsyncSignal = vi.fn<(signal: AudioSignal<ParamUnit>) => SyncedSignalTransport>(
      () => transport,
    );

    transport = {
      bpm: 120,
      syncSignal,
      unsyncSignal,
    };

    const signal = createSyncedSignal(context, {
      transport,
      value: 2,
    });

    const source = asMock<MockConstantSourceNode>(signal.node);

    expect(signal.ratio).toBeCloseTo(1 / 60, 12);
    expect(signal.disposed).toBe(false);
    expect(signal.state).toBe("started");
    expect(signal.state).toBe("started");
    expect(signal.synced).toBe(true);
    expect(syncSignal).toHaveBeenCalledWith(signal, 1 / 60);
    expect(signal.value).toBe(2);

    transport.bpm = 240;
    signal.refresh();

    expect(syncSignal).toHaveBeenCalledWith(signal, 1 / 60);
    expect(signal.value).toBe(4);

    signal.unsync();
    signal.dispose();
    signal.dispose();

    expect(signal.disposed).toBe(true);
    expect(unsyncSignal).toHaveBeenCalledTimes(1);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
  });
});
