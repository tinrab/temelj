import * as React from "react";

import { isBrowser } from "../internal/mod.ts";
import { useLatestRef } from "../state/use-latest-ref.ts";

/**
 * Controls returned by useRafLoop.
 */
export interface RafLoopControls {
  /** Whether the loop is currently running. */
  running: boolean;
  /** Starts the animation-frame loop. */
  start: () => void;
  /** Stops the animation-frame loop. */
  stop: () => void;
}

/**
 * Runs a callback on every animation frame while active.
 */
export function useRafLoop(
  callback: (time: DOMHighResTimeStamp) => void,
  startImmediately = true,
): RafLoopControls {
  const callbackRef = useLatestRef(callback);
  const frameRef = React.useRef<number | null>(null);
  const runningRef = React.useRef(false);
  const [running, setRunning] = React.useState(false);

  const stop = React.useCallback(() => {
    runningRef.current = false;
    setRunning(false);
    if (frameRef.current !== null && isBrowser) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  const start = React.useCallback(() => {
    if (!isBrowser || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    const tick = (time: DOMHighResTimeStamp) => {
      if (!runningRef.current) return;
      callbackRef.current(time);
      frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [callbackRef]);

  React.useEffect(() => {
    if (startImmediately) {
      start();
    }
    return stop;
  }, [start, startImmediately, stop]);

  return { running, start, stop };
}
