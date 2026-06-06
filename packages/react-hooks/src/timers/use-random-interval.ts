import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Minimum and maximum delay configuration for useRandomInterval.
 */
export interface RandomIntervalOptions {
  /** Minimum random delay in milliseconds. */
  minDelay: number | null;
  /** Maximum random delay in milliseconds. */
  maxDelay: number | null;
}

/**
 * Runs a callback repeatedly with a random delay between bounds.
 */
export function useRandomInterval(
  callback: () => void,
  options: RandomIntervalOptions,
): () => void {
  const { minDelay, maxDelay } = options;
  const callbackRef = useLatest(callback);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = React.useCallback(() => {
    if (timeoutRef.current !== undefined) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = undefined;
    }
  }, []);

  React.useEffect(() => {
    if (minDelay === null || maxDelay === null) {
      return undefined;
    }

    const tick = () => {
      const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
      timeoutRef.current = setTimeout(() => {
        callbackRef.current();
        tick();
      }, delay);
    };

    tick();
    return clear;
  }, [callbackRef, clear, minDelay, maxDelay]);

  return clear;
}
