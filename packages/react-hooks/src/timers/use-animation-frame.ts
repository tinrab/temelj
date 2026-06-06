import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Runs a callback on the next animation frame whenever dependencies change.
 */
export function useAnimationFrame(callback: (time: DOMHighResTimeStamp) => void): () => void {
  const frameRef = React.useRef<number | null>(null);

  const cancel = React.useCallback(() => {
    if (frameRef.current !== null && isBrowser) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    frameRef.current = requestAnimationFrame(callback);
    return cancel;
  }, [callback, cancel]);

  return cancel;
}
