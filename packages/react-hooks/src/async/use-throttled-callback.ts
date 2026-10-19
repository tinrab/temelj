import { throttle } from "@temelj/async";

import { useRateLimitedCallback } from "../internal/use-rate-limited-callback.ts";

/**
 * Creates a throttled callback backed by throttle and cleans it up on unmount.
 */
export function useThrottledCallback<Args extends unknown[], R>(
  fn: (...args: Args) => PromiseLike<R> | R,
  intervalMs: number,
): (...args: Args) => Promise<R> {
  return useRateLimitedCallback(fn, intervalMs, createThrottled);
}

function createThrottled<Args extends unknown[], R>(
  fn: (...args: Args) => PromiseLike<R> | R,
  intervalMs: number,
  signal: AbortSignal,
): (...args: Args) => Promise<R> {
  return throttle(fn, intervalMs, { signal });
}
