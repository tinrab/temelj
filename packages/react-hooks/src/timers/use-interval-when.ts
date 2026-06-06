import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Configuration for conditionally running useIntervalWhen.
 */
export interface IntervalWhenOptions {
  /** Timeout or interval duration in milliseconds. */
  ms: number;
  /** Whether the interval should run. */
  when: boolean;
  /** Run the callback immediately when starting. */
  startImmediately?: boolean;
}

/**
 * Runs an interval while a condition is true, with optional immediate execution.
 */
export function useIntervalWhen(callback: () => void, options: IntervalWhenOptions): () => void {
  const { ms, when, startImmediately = false } = options;
  const callbackRef = useLatest(callback);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const clear = React.useCallback(() => {
    if (intervalRef.current !== undefined) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }, []);

  React.useEffect(() => {
    if (!when) {
      clear();
      return undefined;
    }
    if (startImmediately) callbackRef.current();
    intervalRef.current = setInterval(() => callbackRef.current(), ms);
    return clear;
  }, [callbackRef, clear, ms, startImmediately, when]);

  return clear;
}
