import { throttle } from "@temelj/async";
import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Creates a throttled callback backed by throttle and cleans it up on unmount.
 */
export function useThrottledCallback<Args extends unknown[], R>(
  fn: (...args: Args) => PromiseLike<R> | R,
  intervalMs: number,
): (...args: Args) => Promise<R> {
  const fnRef = useLatest(fn);

  const throttled = React.useMemo(() => {
    const controller = new AbortController();
    const callback = throttle((...args: Args) => fnRef.current(...args), intervalMs, {
      signal: controller.signal,
    });
    return { callback, controller };
  }, [fnRef, intervalMs]);

  React.useEffect(() => () => throttled.controller.abort(), [throttled]);

  return throttled.callback;
}
