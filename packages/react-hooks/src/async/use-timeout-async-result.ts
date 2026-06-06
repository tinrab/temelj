import type { Result } from "@temelj/result";

import { timeout } from "@temelj/async";
import { fromPromise } from "@temelj/result";
import * as React from "react";

import { useLatest } from "../internal/mod.ts";

type AsyncResultStatus = "idle" | "loading" | "success" | "error";

interface AsyncResultState<T, E> {
  /** Current lifecycle status. */
  status: AsyncResultStatus;
  /** Latest Result, or null before completion. */
  result: Result<T, E> | null;
  /** Whether an operation is currently in flight. */
  loading: boolean;
  /** Latest error value, or null when there is no error. */
  error: E | null;
}

interface UseAsyncResultOptions<T, E, Args extends unknown[]> {
  /** Execute immediately after mount. */
  immediate?: boolean;
  /** Arguments used for immediate execution. */
  initialArgs?: Args;
  /** Maps unknown thrown values to the hook error type. */
  mapError?: (error: unknown) => E;
  /** Called after a successful execution. */
  onSuccess?: (value: T) => void;
  /** Called after an error result. */
  onError?: (error: E) => void;
}

interface UseAsyncResultReturn<T, E, Args extends unknown[]> extends AsyncResultState<T, E> {
  /** Executes the wrapped function. */
  execute: (...args: Args) => Promise<Result<T, E>>;
  /** Resets state back to idle. */
  reset: () => void;
}

function useAsyncResult<T, E = unknown, Args extends unknown[] = []>(
  fn: (...args: Args) => Promise<T>,
  options?: UseAsyncResultOptions<T, E, Args>,
): UseAsyncResultReturn<T, E, Args> {
  const fnRef = useLatest(fn);
  const optionsRef = useLatest(options);
  const mountedRef = React.useRef(true);
  const callIdRef = React.useRef(0);
  const [state, setState] = React.useState<AsyncResultState<T, E>>({
    status: "idle",
    result: null,
    loading: false,
    error: null,
  });

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = React.useCallback(
    async (...args: Args): Promise<Result<T, E>> => {
      const callId = ++callIdRef.current;
      setState((current) => ({ ...current, status: "loading", loading: true, error: null }));

      const currentOptions = optionsRef.current;
      const result = await fromPromise(
        () => fnRef.current(...args),
        (error) => (currentOptions?.mapError ? currentOptions.mapError(error) : (error as E)),
      );

      if (mountedRef.current && callId === callIdRef.current) {
        if (result.kind === "ok") {
          setState({ status: "success", result, loading: false, error: null });
          currentOptions?.onSuccess?.(result.value);
        } else {
          setState({ status: "error", result, loading: false, error: result.error });
          currentOptions?.onError?.(result.error);
        }
      }

      return result;
    },
    [fnRef, optionsRef],
  );

  const reset = React.useCallback(() => {
    callIdRef.current++;
    setState({ status: "idle", result: null, loading: false, error: null });
  }, []);

  React.useEffect(() => {
    if (options?.immediate) {
      void execute(...((options.initialArgs ?? []) as Args));
    }
  }, [execute, options?.immediate, options?.initialArgs]);

  return { ...state, execute, reset };
}

/**
 * Options for useTimeoutAsyncResult, including timeout and optional fallback behavior.
 */
export interface UseTimeoutAsyncResultOptions<
  T,
  E,
  Args extends unknown[],
> extends UseAsyncResultOptions<T, E, Args> {
  /** Timeout or interval duration in milliseconds. */
  ms: number;
  /** Optional value returned when the operation times out. */
  fallback?: T;
}

/**
 * Runs an async function with timeout and exposes the outcome as a Result.
 */
export function useTimeoutAsyncResult<T, E, Args extends unknown[] = []>(
  fn: (...args: Args) => Promise<T>,
  options: UseTimeoutAsyncResultOptions<T, E, Args>,
): UseAsyncResultReturn<T, E, Args> {
  const fnRef = useLatest(fn);
  const timeoutOptions = Object.prototype.hasOwnProperty.call(options, "fallback")
    ? { fallback: options.fallback }
    : undefined;
  return useAsyncResult(
    (...args: Args) => timeout(() => fnRef.current(...args), options.ms, timeoutOptions),
    { ...options, mapError: options.mapError ?? ((error) => error as E) },
  );
}
