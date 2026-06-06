import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Runs a callback once after a delay and returns a clear function.
 */
export function useTimeout(callback: () => void, ms: number | null): () => void {
  const callbackRef = useLatest(callback);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = React.useCallback(() => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
  }, []);

  React.useEffect(() => {
    if (ms === null) return undefined;
    timerRef.current = setTimeout(() => callbackRef.current(), ms);
    return clear;
  }, [callbackRef, clear, ms]);

  return clear;
}
