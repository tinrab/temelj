// @vitest-environment jsdom
/* oxlint-disable typescript/no-floating-promises, vitest/require-mock-type-parameters */
import { defer } from "@temelj/async";
import { ok } from "@temelj/result";
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

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
  it("normalizes thrown values and mapper failures into Errors", async () => {
    const thrown = renderHook(() =>
      useAsyncResult(async () => {
        throw "failure";
      }),
    );

    expectTypeOf(thrown.result.current.error).toEqualTypeOf<Error | null>();
    await act(async () => {
      await thrown.result.current.execute();
    });
    expect(thrown.result.current.error).toMatchObject({ message: "failure", cause: "failure" });

    const mapped = renderHook(() =>
      useAsyncResult(
        async () => {
          throw "original";
        },
        {
          mapError: () => {
            throw new Error("mapper failed");
          },
        },
      ),
    );

    await act(async () => {
      await mapped.result.current.execute();
    });
    expect(mapped.result.current.error).toMatchObject({ message: "mapper failed" });
  });

  it("normalizes thrown objects without invoking their conversion methods", async () => {
    const cause = {
      toString() {
        throw new Error("conversion failed");
      },
    };

    const hook = renderHook(() =>
      useAsyncResult(async () => {
        throw cause;
      }),
    );

    await act(async () => {
      await hook.result.current.execute();
    });
    expect(hook.result.current.error).toMatchObject({ cause });
  });

  it("starts immediate work once per mount with its required arguments", async () => {
    const run = vi.fn<(value: number) => Promise<number>>(async (value) => value + 1);
    const hook = renderHook(() => useAsyncResult(run, { immediate: true, initialArgs: [41] }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.result).toEqual(ok(42));
    expect(run).toHaveBeenCalledOnce();
    hook.rerender();
    expect(run).toHaveBeenCalledOnce();
  });

  it("ignores obsolete completions and completions after reset", async () => {
    const first = defer<number>();
    const second = defer<number>();
    const third = defer<number>();
    const onSuccess = vi.fn<(value: number) => void>();

    const hook = renderHook(() =>
      useAsyncResult((operation: Promise<number>) => operation, { onSuccess }),
    );

    let firstRun: ReturnType<typeof hook.result.current.execute>;
    let secondRun: ReturnType<typeof hook.result.current.execute>;
    act(() => {
      firstRun = hook.result.current.execute(first.promise);
      secondRun = hook.result.current.execute(second.promise);
    });
    await act(async () => {
      second.resolve(2);
      await secondRun;
    });
    await act(async () => {
      first.resolve(1);
      await firstRun;
    });
    expect(hook.result.current.result).toEqual(ok(2));
    expect(onSuccess).toHaveBeenCalledTimes(1);
    act(() => {
      void hook.result.current.execute(third.promise);
      hook.result.current.reset();
    });
    await act(async () => {
      third.resolve(3);
      await Promise.resolve();
    });
    expect(hook.result.current.status).toBe("idle");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
  it("keeps debouncing usable through Strict Mode and uses the latest callback", async () => {
    const hook = renderHook(
      ({ suffix }) => useDebouncedCallback((value: string) => value + suffix, 5),
      {
        initialProps: { suffix: "a" },
        wrapper: StrictMode,
      },
    );

    const callback = hook.result.current;
    hook.rerender({ suffix: "b" });
    expect(hook.result.current).toBe(callback);
    expect(await callback("value:")).toBe("value:b");
    const pending = callback("cancel:");
    hook.unmount();
    await expect(pending).rejects.toBeInstanceOf(Error);
    await expect(callback("unmounted")).rejects.toBeInstanceOf(Error);
  });

  it("keeps throttling usable through Strict Mode and cancels pending work", async () => {
    const hook = renderHook(() => useThrottledCallback((value: string) => value, 50), {
      wrapper: StrictMode,
    });

    expect(await hook.result.current("first")).toBe("first");
    const pending = hook.result.current("pending");
    hook.unmount();
    await expect(pending).rejects.toBeInstanceOf(Error);
  });
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
        { mapError: (cause) => (cause instanceof Error ? cause.message : String(cause)) },
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

  it("observes external aborts and replaces aborted controllers in Strict Mode", () => {
    const hook = renderHook(() => useAbortController(), { wrapper: StrictMode });
    expect(hook.result.current.signal.aborted).toBe(false);
    act(() => hook.result.current.controller.abort(new Error("external")));
    expect(hook.result.current.aborted).toBe(true);
    act(() => hook.result.current.reset());
    const signal = hook.result.current.signal;
    act(() => hook.result.current.reset());
    expect(signal.aborted).toBe(true);
    const last = hook.result.current.signal;
    hook.unmount();
    expect(last.aborted).toBe(true);
  });

  it("updates queue counts as work starts and completes", async () => {
    const task = defer<string>();
    const hook = renderHook(() => useAsyncQueue({ concurrency: 1 }));
    let first: Promise<string>;
    let second: Promise<number>;
    act(() => {
      first = hook.result.current.add(() => task.promise);
      second = hook.result.current.add(() => 42);
    });
    expect(hook.result.current.pending).toBe(1);
    expect(hook.result.current.size).toBe(1);
    await act(async () => {
      task.resolve("done");
      await Promise.all([first, second]);
      await hook.result.current.onIdle();
    });
    expect(hook.result.current.pending).toBe(0);
    expect(hook.result.current.size).toBe(0);
  });

  it("cancels waiting limited callbacks on unmount in Strict Mode", async () => {
    const task = defer<string>();

    const hook = renderHook(() => useLimitedCallback(() => task.promise, 1), {
      wrapper: StrictMode,
    });

    const running = hook.result.current();
    const waiting = hook.result.current();
    hook.unmount();
    await expect(waiting).rejects.toBeInstanceOf(Error);
    task.resolve("done");
    await expect(running).resolves.toBe("done");
  });

  it("useAsyncQueue runs queued work and exposes pause/resume state", async () => {
    const { result } = renderHook(() => useAsyncQueue({ autoStart: false }));

    act(() => result.current.pause());
    let queued: Promise<string>;
    act(() => {
      queued = result.current.add(() => "done");
    });
    expect(result.current.paused).toBe(true);

    act(() => result.current.resume());
    await act(async () => {
      await expect(queued).resolves.toBe("done");
    });
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
