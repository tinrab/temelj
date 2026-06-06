// @vitest-environment jsdom
/* oxlint-disable typescript/no-floating-promises, vitest/require-mock-type-parameters */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "../test/setup.ts";
import { useAnimationFrame } from "./use-animation-frame.ts";
import { useContinuousRetry } from "./use-continuous-retry.ts";
import { useCountdown } from "./use-countdown.ts";
import { useDebounce } from "./use-debounce.ts";
import { useIntervalCallback } from "./use-interval-callback.ts";
import { useIntervalWhen } from "./use-interval-when.ts";
import { useInterval } from "./use-interval.ts";
import { useRafLoop } from "./use-raf-loop.ts";
import { useRandomInterval } from "./use-random-interval.ts";
import { useThrottle } from "./use-throttle.ts";
import { useTimeoutCallback } from "./use-timeout-callback.ts";
import { useTimeout } from "./use-timeout.ts";

describe("timer hooks", () => {
  it("useTimeout runs once and can be cleared", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result } = renderHook(() => useTimeout(callback, 10));

    act(() => result.current());
    vi.advanceTimersByTime(20);
    expect(callback).not.toHaveBeenCalled();
  });

  it("useInterval runs repeatedly until cleared", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result } = renderHook(() => useInterval(callback, 10));

    vi.advanceTimersByTime(25);
    expect(callback).toHaveBeenCalledTimes(2);

    act(() => result.current());
    vi.advanceTimersByTime(20);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("useIntervalWhen respects condition and immediate start", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { rerender } = renderHook(
      ({ when }) => useIntervalWhen(callback, { ms: 10, when, startImmediately: true }),
      { initialProps: { when: false } },
    );

    expect(callback).not.toHaveBeenCalled();
    rerender({ when: true });
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("useTimeoutCallback schedules and clears imperative timeouts", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result } = renderHook(() => useTimeoutCallback(callback, 10));

    act(() => result.current.start("value"));
    expect(result.current.running).toBe(true);
    act(() => result.current.clear());
    vi.advanceTimersByTime(10);
    expect(callback).not.toHaveBeenCalled();

    act(() => result.current.start("next"));
    vi.advanceTimersByTime(10);
    expect(callback).toHaveBeenCalledWith("next");
  });

  it("useIntervalCallback starts, stops, and updates delay", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const { result } = renderHook(() => useIntervalCallback(callback, 10));

    act(() => result.current.start());
    vi.advanceTimersByTime(20);
    expect(callback).toHaveBeenCalledTimes(2);

    act(() => result.current.stop());
    vi.advanceTimersByTime(20);
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it("useDebounce and useThrottle delay value updates", () => {
    vi.useFakeTimers();
    const debounced = renderHook(({ value }) => useDebounce(value, 10), {
      initialProps: { value: "a" },
    });
    debounced.rerender({ value: "b" });
    expect(debounced.result.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(debounced.result.current).toBe("b");

    const throttled = renderHook(({ value }) => useThrottle(value, 10), {
      initialProps: { value: "a" },
    });
    throttled.rerender({ value: "b" });
    expect(throttled.result.current).toBe("a");
    act(() => {
      vi.advanceTimersByTime(10);
    });
    expect(throttled.result.current).toBe("b");
  });

  it("useCountdown ticks and completes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const onComplete = vi.fn();
    const { result } = renderHook(() => useCountdown(1030, { interval: 10, onComplete }));

    expect(result.current).toBe(30);
    act(() => {
      vi.advanceTimersByTime(30);
    });
    expect(result.current).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("useContinuousRetry resolves once the callback returns true", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const { result } = renderHook(() =>
      useContinuousRetry(() => {
        attempts++;
        return attempts === 2;
      }, 10),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current).toBe(true);
  });

  it("useRandomInterval schedules callbacks between bounds", () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const callback = vi.fn();
    const { result } = renderHook(() => useRandomInterval(callback, { minDelay: 5, maxDelay: 5 }));

    vi.advanceTimersByTime(5);
    expect(callback).toHaveBeenCalledTimes(1);

    act(() => result.current());
    vi.advanceTimersByTime(10);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("useAnimationFrame and useRafLoop schedule and cancel animation frames", () => {
    let nextId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      callbacks.delete(id);
    });

    const frameCallback = vi.fn();
    const frame = renderHook(() => useAnimationFrame(frameCallback));
    callbacks.get(1)?.(123);
    expect(frameCallback).toHaveBeenCalledWith(123);
    act(() => frame.result.current());
    expect(callbacks.has(1)).toBe(false);

    const loopCallback = vi.fn();
    const loop = renderHook(() => useRafLoop(loopCallback, false));
    act(() => loop.result.current.start());
    expect(loop.result.current.running).toBe(true);
    callbacks.get(2)?.(456);
    expect(loopCallback).toHaveBeenCalledWith(456);
    act(() => loop.result.current.stop());
    expect(loop.result.current.running).toBe(false);
  });
});
