import { retry } from "@temelj/async";

import { useLatest } from "../internal/mod.ts";
import {
  useAsyncResult,
  type UseAsyncResultOptions,
  type UseAsyncResultReturn,
} from "./use-async-result.ts";

/**
 * Options for useRetryingAsyncResult, including retry policy configuration.
 */
export type UseRetryingAsyncResultOptions<T, E, Args extends unknown[]> = UseAsyncResultOptions<
  T,
  E,
  Args
> & {
  /** Maximum number of attempts. */
  times?: number;
  /** Fixed delay between attempts in milliseconds. */
  delay?: number;
  /** Computes the delay from the attempt number. */
  backoff?: (attempt: number) => number;
  /** Returns whether an error should be retried. */
  shouldRetry?: (cause: unknown) => boolean;
};

/**
 * Runs an async function through retry and exposes the outcome as a Result.
 */
export function useRetryingAsyncResult<T, E = never, Args extends unknown[] = []>(
  fn: (...args: Args) => Promise<T>,
  options?: UseRetryingAsyncResultOptions<T, E, Args>,
): UseAsyncResultReturn<T, E | Error, Args> {
  const fnRef = useLatest(fn);

  return useAsyncResult(
    (...args: Args) =>
      retry(() => fnRef.current(...args), {
        times: options?.times,
        delay: options?.delay,
        backoff: options?.backoff,
        shouldRetry: options?.shouldRetry,
      }),
    options,
  );
}
