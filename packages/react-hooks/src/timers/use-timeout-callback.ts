import * as React from "react";

import { useLatestRef } from "../state/use-latest-ref.ts";

/**
 * Controls returned by useTimeoutCallback.
 */
export interface TimeoutCallbackControls<Args extends unknown[]> {
  /** Whether a timeout is currently scheduled. */
  running: boolean;
  /** Starts the timeout with optional callback arguments. */
  start: (...args: Args) => void;
  /** Clears the scheduled timeout. */
  clear: () => void;
}

/**
 * Schedules a callback imperatively and exposes running state.
 */
export function useTimeoutCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delay: number,
): TimeoutCallbackControls<Args> {
  const callbackRef = useLatestRef(callback);
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [running, setRunning] = React.useState(false);

  const clear = React.useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setRunning(false);
  }, []);

  const start = React.useCallback(
    (...args: Args) => {
      clear();
      setRunning(true);
      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        setRunning(false);
        callbackRef.current(...args);
      }, delay);
    },
    [callbackRef, clear, delay],
  );

  React.useEffect(() => clear, [clear]);

  return { running, start, clear };
}
