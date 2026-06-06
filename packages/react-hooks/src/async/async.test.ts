// @vitest-environment jsdom
/* oxlint-disable typescript/no-floating-promises, vitest/require-mock-type-parameters */
import { ok } from "@temelj/result";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import "../test/setup.ts";
import { useAbortController } from "./use-abort-controller.ts";
import { useAsyncQueue } from "./use-async-queue.ts";
import { useAsyncResult } from "./use-async-result.ts";
import { useAsyncTask } from "./use-async-task.ts";
import { useDebouncedCallback } from "./use-debounced-callback.ts";
import { useLimitedCallback } from "./use-limited-callback.ts";
import { useRetry } from "./use-retry.ts";
import { useRetryingAsyncResult } from "./use-retrying-async-result.ts";
import { useThrottledCallback } from "./use-throttled-callback.ts";
import { useTimeoutAsyncResult } from "./use-timeout-async-result.ts";
import { useTimeoutResult } from "./use-timeout-result.ts";

describe("async hooks", () => {
  it("useAsyncResult returns ok and error Results without throwing", async () => {
    const success = renderHook(() => useAsyncResult(async (value: number) => value + 1));
    await act(async () => {
      await success.result.current.execute(1);
    });
    expect(success.result.current.status).toBe("success");
    expect(success.result.current.result).toEqual(ok(2));

    const failure = renderHook(() =>
      useAsyncResult(
        async () => {
          throw new Error("boom");
        },
        { mapError: (error) => (error as Error).message },
      ),
    );
    await act(async () => {
      await failure.result.current.execute();
    });
    expect(failure.result.current.status).toBe("error");
    expect(failure.result.current.error).toBe("boom");
  });

  it("useRetry retries until success and records attempts", async () => {
    let attempts = 0;
    const { result } = renderHook(() =>
      useRetry(
        async () => {
          attempts++;
          if (attempts < 2) throw new Error("try again");
          return "ok";
        },
        { times: 2, delay: 0 },
      ),
    );

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual(ok("ok"));
    expect(attempts).toBe(2);
  });

  it("useRetryingAsyncResult wraps retry in the async-result shape", async () => {
    let attempts = 0;
    const { result } = renderHook(() =>
      useRetryingAsyncResult(
        async () => {
          attempts++;
          if (attempts < 2) throw new Error("again");
          return attempts;
        },
        { times: 2, delay: 0 },
      ),
    );

    await act(async () => {
      await result.current.execute();
    });
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual(ok(2));
  });

  it("useTimeoutResult and useTimeoutAsyncResult resolve fallback values on timeout", async () => {
    vi.useFakeTimers();

    const timeoutResult = renderHook(() => useTimeoutResult<string>({ ms: 10, fallback: "slow" }));
    const promise = timeoutResult.result.current(new Promise<string>(() => {}));
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toEqual(ok("slow"));

    const timeoutAsync = renderHook(() =>
      useTimeoutAsyncResult(async () => new Promise<string>(() => {}), {
        ms: 10,
        fallback: "fallback",
      }),
    );
    await act(async () => {
      const run = timeoutAsync.result.current.execute();
      await vi.advanceTimersByTimeAsync(10);
      await run;
    });
    expect(timeoutAsync.result.current.result).toEqual(ok("fallback"));
  });

  it("useAsyncTask reports success and can reset", async () => {
    const { result } = renderHook(() =>
      useAsyncTask(async (_signal: AbortSignal, value: string) => value.toUpperCase()),
    );

    await act(async () => {
      await result.current.start("ok");
    });
    expect(result.current.status).toBe("success");
    expect(result.current.result).toEqual(ok("OK"));

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
  });

  it("useAbortController aborts and resets the current signal", () => {
    const { result } = renderHook(() => useAbortController());
    const firstSignal = result.current.signal;

    act(() => result.current.abort("stop"));
    expect(result.current.aborted).toBe(true);
    expect(firstSignal.aborted).toBe(true);

    act(() => result.current.reset());
    expect(result.current.signal).not.toBe(firstSignal);
    expect(result.current.aborted).toBe(false);
  });

  it("useAsyncQueue runs queued work and exposes pause/resume state", async () => {
    const { result } = renderHook(() => useAsyncQueue({ autoStart: false }));

    act(() => result.current.pause());
    const queued = result.current.add(() => "done");
    expect(result.current.paused).toBe(true);

    act(() => result.current.resume());
    await expect(queued).resolves.toBe("done");
    await act(async () => {
      await result.current.onIdle();
    });
    expect(result.current.size).toBe(0);
  });

  it("useLimitedCallback limits concurrent executions", async () => {
    let running = 0;
    let maxRunning = 0;
    const { result } = renderHook(() =>
      useLimitedCallback(async (value: number) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        running--;
        return value;
      }, 1),
    );

    await act(async () => {
      await Promise.all([result.current(1), result.current(2)]);
    });
    expect(maxRunning).toBe(1);
  });

  it("useDebouncedCallback and useThrottledCallback return stable rate-limited callbacks", async () => {
    const debouncedFn = vi.fn((value: string) => value);
    const debounced = renderHook(() => useDebouncedCallback(debouncedFn, 5));
    void debounced.result.current("a");
    const debouncedResult = await debounced.result.current("b");
    expect(debouncedResult).toBe("b");
    expect(debouncedFn).toHaveBeenCalledTimes(1);

    const throttledFn = vi.fn((value: string) => value);
    const throttled = renderHook(() => useThrottledCallback(throttledFn, 5));
    const first = await throttled.result.current("a");
    void throttled.result.current("b");
    const latest = await throttled.result.current("c");
    expect(first).toBe("a");
    expect(latest).toBe("c");
    expect(throttledFn).toHaveBeenCalledTimes(2);
  });
});
