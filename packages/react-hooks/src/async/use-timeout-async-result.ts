import { timeout } from "@temelj/async";

import { useLatest } from "../internal/mod.ts";
import {
  useAsyncResult,
  type UseAsyncResultOptions,
  type UseAsyncResultReturn,
} from "./use-async-result.ts";

/**
 * Options for useTimeoutAsyncResult, including timeout and optional fallback behavior.
 */
export type UseTimeoutAsyncResultOptions<T, E, Args extends unknown[]> = UseAsyncResultOptions<
  T,
  E,
  Args
> & {
  /** Timeout or interval duration in milliseconds. */
  ms: number;
  /** Optional value returned when the operation times out. */
  fallback?: T;
};

/**
 * Runs an async function with timeout and exposes the outcome as a Result.
 */
export function useTimeoutAsyncResult<T, E = never, Args extends unknown[] = []>(
  fn: (...args: Args) => Promise<T>,
  options: UseTimeoutAsyncResultOptions<T, E, Args>,
): UseAsyncResultReturn<T, E | Error, Args> {
  const fnRef = useLatest(fn);

  const timeoutOptions = Object.prototype.hasOwnProperty.call(options, "fallback")
    ? { fallback: options.fallback }
    : undefined;

  return useAsyncResult(
    (...args: Args) =>
      timeout(
        Promise.try(() => fnRef.current(...args)),
        options.ms,
        timeoutOptions,
      ),
    options,
  );
}
