import { limit } from "@temelj/async";

import { useRateLimitedCallback } from "../internal/use-rate-limited-callback.ts";

function createLimiter<Args extends unknown[], R>(
  callback: (...args: Args) => PromiseLike<R> | R,
  concurrency: number,
  signal: AbortSignal,
): (...args: Args) => Promise<R> {
  return limit(callback, concurrency, { signal });
}

/** Limits concurrent executions and cancels queued calls on replacement or unmount. */
export function useLimitedCallback<Args extends unknown[], R>(
  callback: (...args: Args) => PromiseLike<R> | R,
  concurrency: number,
): (...args: Args) => Promise<R> {
  return useRateLimitedCallback(callback, concurrency, createLimiter);
}
