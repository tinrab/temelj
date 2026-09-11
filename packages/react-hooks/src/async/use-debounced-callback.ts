import { debounce } from "@temelj/async";
import * as React from "react";

import { useRateLimitedCallback } from "../internal/use-rate-limited-callback.ts";

/**
 * Leading and trailing edge options for rate-limited callback hooks.
 */
export interface RateLimitOptions {
  /** Invoke on the leading edge. */
  leading?: boolean;
  /** Invoke on the trailing edge. */
  trailing?: boolean;
}

/**
 * Creates a debounced callback and cleans it up on unmount.
 */
export function useDebouncedCallback<Args extends unknown[], R>(
  fn: (...args: Args) => PromiseLike<R> | R,
  waitMs: number,
  options?: RateLimitOptions,
): (...args: Args) => Promise<R> {
  const config = React.useMemo(
    () => ({ waitMs, leading: options?.leading, trailing: options?.trailing }),
    [waitMs, options?.leading, options?.trailing],
  );

  return useRateLimitedCallback(fn, config, createDebounced);
}

interface DebounceConfig extends RateLimitOptions {
  readonly waitMs: number;
}

function createDebounced<Args extends unknown[], R>(
  fn: (...args: Args) => PromiseLike<R> | R,
  config: DebounceConfig,
  signal: AbortSignal,
): (...args: Args) => Promise<R> {
  return debounce(fn, config.waitMs, {
    leading: config.leading,
    trailing: config.trailing,
    signal,
  });
}
