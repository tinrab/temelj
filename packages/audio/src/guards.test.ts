import { describe, expect, expectTypeOf, it } from "vitest";

import { isAudioBufferValue, isAudioParamValue } from "./guards.ts";

describe("audio guards", () => {
  it("recognizes AudioBuffer-like values without relying on globals", () => {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- The guard under test must start from an unknown value.
    const buffer: unknown = {
      duration: 1,
      getChannelData: (_channel: number) => new Float32Array(10),
      length: 10,
      numberOfChannels: 1,
      sampleRate: 44_100,
    };

    expect(isAudioBufferValue(buffer)).toBe(true);

    if (!isAudioBufferValue(buffer)) {
      throw new Error("expected audio buffer");
    }

    expectTypeOf(buffer).toEqualTypeOf<AudioBuffer>();
    expect(isAudioBufferValue({ duration: 1 })).toBe(false);
    expect(isAudioBufferValue(null)).toBe(false);
  });

  it("recognizes AudioParam-like values without relying on globals", () => {
    // oxlint-disable-next-line anti-slop/no-known-value-widening -- The guard under test must start from an unknown value.
    const param: unknown = {
      setValueAtTime: (_value: number, _time: number) => param,
      value: 0.5,
    };

    expect(isAudioParamValue(param)).toBe(true);

    if (!isAudioParamValue(param)) {
      throw new Error("expected audio param");
    }

    expectTypeOf(param).toEqualTypeOf<AudioParam>();
    expect(isAudioParamValue({ value: 1 })).toBe(false);
    expect(isAudioParamValue(null)).toBe(false);
  });
});
