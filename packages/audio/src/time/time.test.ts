import { describe, expect, it } from "vitest";

import {
  createTimeScope,
  millisecondsToSeconds,
  quantizeTime,
  samplesToSeconds,
  secondsToNotation,
  secondsToMilliseconds,
  secondsToSamples,
  ticksToBarsBeatsSixteenths,
  ticksToSeconds,
  toFrequency,
  toMilliseconds,
  toMidi,
  toSamples,
  toSeconds,
  toTicks,
} from "./time.ts";

describe("time", () => {
  it("converts seconds, relative offsets, notes, triplets, measures, and transport positions", () => {
    expect(toSeconds(1.25)).toBe(1.25);
    expect(toSeconds("1.5")).toBe(1.5);
    expect(toSeconds("+0.5", { now: 10 })).toBe(10.5);
    expect(toSeconds("-0.25", { now: 10 })).toBe(9.75);
    expect(toSeconds("+4n", { bpm: 120, now: 10 })).toBe(10.5);
    expect(toSeconds("-8n", { bpm: 120, now: 10 })).toBe(9.75);
    expect(toSeconds("1.5s")).toBe(1.5);
    expect(toSeconds("500ms")).toBe(0.5);
    expect(toSeconds("2hz")).toBe(0.5);
    expect(toSeconds("22050samples", { sampleRate: 44_100 })).toBe(0.5);
    expect(toSeconds("4n", { bpm: 120 })).toBe(0.5);
    expect(toSeconds("2n.", { bpm: 120 })).toBe(1.5);
    expect(toSeconds("4n..", { bpm: 120 })).toBe(0.875);
    expect(toSeconds("8t", { bpm: 120 })).toBeCloseTo(1 / 6, 12);
    expect(toSeconds("2m", { bpm: 120 })).toBe(4);
    expect(toSeconds("2m", { bpm: 120, timeSignature: 3 })).toBe(3);
    expect(toSeconds("2m", { bpm: 120, timeSignature: [6, 8] })).toBe(3);
    expect(toSeconds("0:2", { bpm: 120 })).toBe(1);
    expect(toSeconds("1:2", { bpm: 120, timeSignature: [6, 8] })).toBe(2.5);
    expect(toSeconds("0:2:0", { bpm: 120 })).toBe(1);
    expect(toSeconds("1:0:0", { bpm: 120, timeSignature: 3 })).toBe(1.5);
    expect(toSeconds("1:0:0", { bpm: 120, timeSignature: [6, 8] })).toBe(1.5);
    expect(toSeconds("0:1:2.5", { bpm: 120 })).toBeCloseTo(0.8125, 12);
    expect(toSeconds("192i", { bpm: 120 })).toBe(0.5);
    expect(toSeconds({ "4n": 2, "8t": 1, "1m": undefined }, { bpm: 120 })).toBeCloseTo(7 / 6, 12);
    expect(toSeconds({ "2n": 1, "8n": -1 }, { bpm: 120 })).toBe(0.75);
  });

  it("converts time expressions to ticks and ticks back to time", () => {
    expect(toTicks("4n", { bpm: 120 })).toBe(192);
    expect(toTicks("1s", { bpm: 120 })).toBe(384);
    expect(toTicks("2hz", { bpm: 120 })).toBe(192);
    expect(toTicks("2n.", { bpm: 120 })).toBe(576);
    expect(toTicks("8n", { bpm: 120 })).toBe(96);
    expect(toTicks("1m", { bpm: 120 })).toBe(768);
    expect(toTicks("1:2", { bpm: 120 })).toBe(1_152);
    expect(toTicks("0:2:0", { bpm: 120 })).toBe(384);
    expect(toTicks("96i", { bpm: 120 })).toBe(96);
    expect(toTicks({ "4n": 2, "8t": 1 }, { bpm: 120 })).toBe(448);
    expect(toTicks("+4n", { bpm: 120, now: 2 })).toBe(960);
    expect(ticksToSeconds(192, { bpm: 120 })).toBe(0.5);
    expect(ticksToSeconds(96, { bpm: 60, ppq: 96 })).toBe(1);
    expect(ticksToBarsBeatsSixteenths(192 * 7)).toBe("1:3:0");
    expect(ticksToBarsBeatsSixteenths(192 * 7, { timeSignature: 3 })).toBe("2:1:0");
    expect(ticksToBarsBeatsSixteenths(192 * 7, { timeSignature: [6, 8] })).toBe("2:1:0");
  });

  it("converts seconds to the closest Tone-style notation", () => {
    expect(secondsToNotation(0, { bpm: 120 })).toBe("0");
    expect(secondsToNotation(0.5, { bpm: 120 })).toBe("4n");
    expect(secondsToNotation(1.5, { bpm: 120 })).toBe("2n.");
    expect(secondsToNotation(1 / 6, { bpm: 120 })).toBe("8t");
    expect(secondsToNotation(0.51, { bpm: 120 })).toBe("4n");
  });

  it("converts time expressions to milliseconds, samples, frequency, and MIDI", () => {
    expect(toMilliseconds("4n", { bpm: 120 })).toBe(500);
    expect(toMilliseconds("0.5s")).toBe(500);
    expect(toMilliseconds("500ms")).toBe(500);
    expect(secondsToMilliseconds(0.5)).toBe(500);
    expect(millisecondsToSeconds(500)).toBe(0.5);
    expect(toSamples("4n", { bpm: 120, sampleRate: 48_000 })).toBe(24_000);
    expect(secondsToSamples(0.5, { sampleRate: 48_000 })).toBe(24_000);
    expect(samplesToSeconds(24_000, { sampleRate: 48_000 })).toBe(0.5);
    expect(toFrequency("4n", { bpm: 120 })).toBe(2);
    expect(toMidi("440hz")).toBe(69);
    expect(toMidi("432hz", { referenceFrequency: 432 })).toBe(69);
  });

  it("quantizes time expressions to the nearest subdivision", () => {
    expect(quantizeTime(1.1, 0.5)).toBe(1);
    expect(quantizeTime(2.3, 0.5)).toBe(2.5);
    expect(quantizeTime(0, 4)).toBe(0);
    expect(quantizeTime(0.6, "4n", { bpm: 120, percent: 0.5 })).toBe(0.55);
    expect(quantizeTime("0:1:2", "4n", { bpm: 120 })).toBe(1);
  });

  it("rejects unsupported expressions and invalid bpm values", () => {
    expect(() => toSeconds("soon")).toThrow(RangeError);
    expect(() => toSeconds("4n", { bpm: 0 })).toThrow(RangeError);
    expect(() => toSeconds("4n", { bpm: Number.NaN })).toThrow(RangeError);
    expect(() => toSeconds("1i", { ppq: 0 })).toThrow(RangeError);
    expect(() => toSeconds("1samples", { sampleRate: 0 })).toThrow(RangeError);
    expect(() => toSeconds("1m", { timeSignature: 0 })).toThrow(RangeError);
    expect(() => toSeconds("1m", { timeSignature: [6, 0] })).toThrow(RangeError);
    expect(() => toSamples("1s", { sampleRate: Number.NaN })).toThrow(RangeError);
    expect(() => secondsToMilliseconds(Number.NaN)).toThrow(RangeError);
    expect(() => millisecondsToSeconds(Number.NaN)).toThrow(RangeError);
    expect(() => secondsToSamples(Number.NaN)).toThrow(RangeError);
    expect(() => samplesToSeconds(Number.NaN)).toThrow(RangeError);
    expect(() => samplesToSeconds(1, { sampleRate: 0 })).toThrow(RangeError);
    expect(() => toSeconds({ "4n": Number.NaN })).toThrow(RangeError);
    expect(() => toTicks("4n", { ppq: Number.NaN })).toThrow(RangeError);
    expect(() => ticksToSeconds(Number.NaN)).toThrow(RangeError);
    expect(() => secondsToNotation(-1)).toThrow(RangeError);
    expect(() => quantizeTime(1, 0)).toThrow(RangeError);
    expect(() => quantizeTime(1, 0.5, { percent: Number.NaN })).toThrow(RangeError);
  });

  it("creates a scope with immediate, lookahead now, relative conversion, and captured offsets", () => {
    let immediate = 2;

    const scope = createTimeScope({
      getImmediateTime: () => immediate,
      getNowTime: () => immediate + 0.1,
    });

    expect(scope.immediate).toBe(2);
    expect(scope.now).toBe(2.1);
    expect(scope.plus(0.5)).toBe(2.5);

    immediate = 4;

    expect(scope.immediate).toBe(4);
    expect(scope.now).toBe(4.1);
    expect(scope.plus(0.5)).toBe(2.5);
    expect(scope.toSeconds("+0.25")).toBe(4.25);
    expect(scope.toSeconds("2n", { bpm: 60 })).toBe(2);
    expect(scope.toSeconds("1m", { timeSignature: 3 })).toBe(1.5);
    expect(scope.toSeconds("1:2", { timeSignature: [6, 8] })).toBe(2.5);
    expect(scope.toTicks("4n")).toBe(192);
    expect(scope.toTicks("1m", { ppq: 192, timeSignature: 3 })).toBe(576);
    expect(scope.toTicks("+4n")).toBe(1728);
    expect(scope.quantize(0.6, "4n", { percent: 0.5 })).toBe(0.55);
  });
});
