import { limit } from "@temelj/async";
import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Returns a callback that limits concurrent executions.
 */
export function useLimitedCallback<Args extends unknown[], R>(
  callback: (...args: Args) => PromiseLike<R> | R,
  concurrency: number,
): (...args: Args) => Promise<R> {
  const callbackRef = useLatest(callback);
  const controller = React.useMemo(() => new AbortController(), []);

  React.useEffect(() => () => controller.abort(), [controller]);

  return React.useMemo(
    () =>
      limit((...args: Args) => callbackRef.current(...args), concurrency, {
        signal: controller.signal,
      }),
    [callbackRef, concurrency, controller],
  );
}
