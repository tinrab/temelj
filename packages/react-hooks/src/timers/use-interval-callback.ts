import * as React from "react";

import { useLatestRef } from "../state/use-latest-ref.ts";

/**
 * Controls returned by useIntervalCallback.
 */
export interface IntervalCallbackControls {
  /** Whether the interval is currently running. */
  running: boolean;
  /** Current interval delay in milliseconds. */
  delay: number;
  /** Starts the interval. */
  start: () => void;
  /** Stops the interval. */
  stop: () => void;
  /** Updates the interval delay. */
  setDelay: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * Runs an interval imperatively with start, stop, and delay controls.
 */
export function useIntervalCallback(
  callback: () => void,
  initialDelay: number,
  startImmediately = false,
): IntervalCallbackControls {
  const callbackRef = useLatestRef(callback);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [delay, setDelay] = React.useState(initialDelay);
  const [running, setRunning] = React.useState(false);

  const stop = React.useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setRunning(false);
  }, []);

  const start = React.useCallback(() => {
    setRunning(true);
  }, []);

  React.useEffect(() => {
    if (!running) return;
    intervalRef.current = setInterval(() => callbackRef.current(), delay);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [callbackRef, delay, running]);

  React.useEffect(() => {
    if (startImmediately) start();
    return stop;
  }, [start, startImmediately, stop]);

  return { running, delay, start, stop, setDelay };
}
