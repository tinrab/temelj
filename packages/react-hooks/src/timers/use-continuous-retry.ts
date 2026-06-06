import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Retry limit configuration for useContinuousRetry.
 */
export interface ContinuousRetryOptions {
  /** Maximum retry attempts before stopping. */
  maxRetries?: number;
}

/**
 * Retries a callback on an interval until it returns true or reaches the retry limit.
 */
export function useContinuousRetry(
  callback: () => boolean | Promise<boolean>,
  interval = 100,
  options: ContinuousRetryOptions = {},
): boolean {
  const callbackRef = useLatest(callback);
  const [resolved, setResolved] = React.useState(false);

  React.useEffect(() => {
    let attempts = 0;
    let cancelled = false;

    const id = setInterval(async () => {
      if (options.maxRetries !== undefined && attempts >= options.maxRetries) {
        clearInterval(id);
        return;
      }
      attempts++;
      if (await callbackRef.current()) {
        if (!cancelled) {
          setResolved(true);
        }
        clearInterval(id);
      }
    }, interval);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [callbackRef, interval, options.maxRetries]);

  return resolved;
}
