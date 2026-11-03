import { describe, expect, it } from "vitest";

import { TickParam, TickSource } from "./tick-source.ts";

describe("TickParam", () => {
  it("integrates constant hertz rates and inverts tick positions", () => {
    const ticks = new TickParam({ value: 2 });

    expect(ticks.unit).toBe("hertz");
    expect(ticks.multiplier).toBe(1);
    expect(ticks.value).toBe(2);
    expect(ticks.getTicksAtTime(4)).toBe(8);
    expect(ticks.getTimeOfTick(8)).toBe(4);
    expect(ticks.ticksToTime(6, 1)).toBe(3);
    expect(ticks.timeToTicks(3, 1)).toBe(6);
  });

  it("maps BPM values through PPQ-style multipliers", () => {
    const ticks = new TickParam({
      multiplier: 192,
      unit: "bpm",
      value: 120,
    });

    expect(ticks.getTicksAtTime(1)).toBe(384);
    expect(ticks.getTimeOfTick(768)).toBe(2);

    ticks.setMultiplier(96);

    expect(ticks.multiplier).toBe(96);
    expect(ticks.getTicksAtTime(1)).toBe(192);
  });

  it("integrates and inverts linear rate ramps", () => {
    const ticks = new TickParam({ value: 2 });

    ticks.linearRampToValueAtTime(6, 4);

    expect(ticks.getValueAtTime(2)).toBe(4);
    expect(ticks.getTicksAtTime(4)).toBe(16);
    expect(ticks.getTicksAtTime(5)).toBe(22);
    expect(ticks.getTimeOfTick(16)).toBe(4);
    expect(ticks.getTimeOfTick(8)).toBeCloseTo(2.4721359549995796, 12);
    expect(ticks.getDurationOfTicks(6, 4)).toBe(1);
  });

  it("supports scheduled set points and cancellation", () => {
    const ticks = new TickParam({ value: 1 });

    ticks.setValueAtTime(4, 2);
    ticks.linearRampToValueAtTime(8, 6);

    expect(ticks.getTicksAtTime(3)).toBe(6.5);

    ticks.cancelScheduledValues(3);

    expect(ticks.getValueAtTime(4)).toBe(5);
    expect(ticks.getTicksAtTime(4)).toBe(11.5);
  });

  it("validates finite tick inputs", () => {
    expect(() => new TickParam({ multiplier: 0 })).toThrow("multiplier");
    expect(() => new TickParam().setValueAtTime(Number.NaN, 0)).toThrow("value");
    expect(() => new TickParam().getTicksAtTime(Number.POSITIVE_INFINITY)).toThrow("time");
  });
});

describe("TickSource", () => {
  it("tracks started ticks from offsets and inverts absolute tick positions", () => {
    const source = new TickSource({ value: 2 });

    source.start(1, 10);

    expect(source.getStateAtTime(0)).toBe("stopped");
    expect(source.getStateAtTime(1)).toBe("started");
    expect(source.getTicksAtTime(1)).toBe(10);
    expect(source.getTicksAtTime(4)).toBe(16);
    expect(source.getSecondsAtTime(4)).toBe(8);
    expect(source.getTimeOfTick(16)).toBe(4);
  });

  it("preserves ticks across pause and resumes from the held offset", () => {
    const source = new TickSource({ value: 4 });

    source.start(0);
    source.pause(2);
    source.start(5);

    expect(source.getStateAtTime(3)).toBe("paused");
    expect(source.getTicksAtTime(3)).toBe(8);
    expect(source.getTicksAtTime(6)).toBe(12);
  });

  it("stops by resetting future ticks and supports explicit tick and second offsets", () => {
    const source = new TickSource({ value: 2 });

    source.start(0);
    source.setTicksAtTime(20, 3);
    source.setSecondsAtTime(4, 4);
    source.stop(6);

    expect(source.getTicksAtTime(3)).toBe(20);
    expect(source.getTicksAtTime(4)).toBe(8);
    expect(source.getTicksAtTime(5)).toBe(10);
    expect(source.getStateAtTime(7)).toBe("stopped");
    expect(source.getTicksAtTime(7)).toBe(0);
  });

  it("cancels future source and frequency events and exposes disposal", () => {
    const source = new TickSource({ value: 1 });

    source.start(0);
    source.frequency.linearRampToValueAtTime(4, 4);
    source.pause(3);
    source.cancel(2);

    expect(source.getStateAtTime(3)).toBe("started");
    expect(source.frequency.getValueAtTime(3)).toBe(2.5);

    source.dispose();

    expect(source.disposed).toBe(true);
    expect(source.getStateAtTime(0)).toBe("stopped");
    expect(source.getTicksAtTime(10)).toBe(0);
  });
});
