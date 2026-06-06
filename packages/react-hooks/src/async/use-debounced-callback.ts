import { debounce } from "@temelj/async";
import * as React from "react";

import { useLatest } from "../internal/mod.ts";

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
  const fnRef = useLatest(fn);

  const debounced = React.useMemo(() => {
    const controller = new AbortController();
    const callback = debounce((...args: Args) => fnRef.current(...args), waitMs, {
      leading: options?.leading,
      trailing: options?.trailing,
      signal: controller.signal,
    });
    return { callback, controller };
  }, [fnRef, waitMs, options?.leading, options?.trailing]);

  React.useEffect(() => () => debounced.controller.abort(), [debounced]);

  return debounced.callback;
}
