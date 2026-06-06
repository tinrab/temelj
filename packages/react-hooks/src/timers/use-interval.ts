import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Runs a callback repeatedly at an interval and returns a clear function.
 */
export function useInterval(callback: () => void, ms: number | null): () => void {
  const callbackRef = useLatest(callback);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const clear = React.useCallback(() => {
    if (intervalRef.current !== undefined) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }, []);

  React.useEffect(() => {
    if (ms === null) return undefined;
    intervalRef.current = setInterval(() => callbackRef.current(), ms);
    return clear;
  }, [callbackRef, clear, ms]);

  return clear;
}
