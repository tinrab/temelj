import type { Result } from "@temelj/result";

import { fromPromise } from "@temelj/result";
import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Lifecycle state reported by async result hooks.
 */
export type AsyncResultStatus = "idle" | "loading" | "success" | "error";

/**
 * State shared by hooks that execute async work and expose a Result.
 */
export interface AsyncResultState<T, E> {
  /** Current lifecycle status. */
  status: AsyncResultStatus;
  /** Latest Result, or null before completion. */
  result: Result<T, E> | null;
  /** Whether an operation is currently in flight. */
  loading: boolean;
  /** Latest error value, or null when there is no error. */
  error: E | null;
}

/**
 * Options for configuring useAsyncResult execution and result handling.
 */
export interface UseAsyncResultOptions<T, E, Args extends unknown[]> {
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

/**
 * Return value from useAsyncResult, including state and imperative controls.
 */
export interface UseAsyncResultReturn<T, E, Args extends unknown[]> extends AsyncResultState<T, E> {
  /** Executes the wrapped function. */
  execute: (...args: Args) => Promise<Result<T, E>>;
  /** Resets state back to idle. */
  reset: () => void;
}

/**
 * Wraps an async function and exposes its result as a non-throwing Result.
 */
export function useAsyncResult<T, E = unknown, Args extends unknown[] = []>(
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
