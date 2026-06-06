import * as React from "react";

import { isBrowser, useLatest } from "../internal/mod.ts";

/**
 * Calls a callback when the mouse leaves the top of the document viewport.
 */
export function usePageLeave(callback: (event: MouseEvent) => void): void {
  const callbackRef = useLatest(callback);
  React.useEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    const handler = (event: MouseEvent) => {
      if (!event.relatedTarget && event.clientY <= 0) {
        callbackRef.current(event);
      }
    };
    document.addEventListener("mouseout", handler);
    return () => document.removeEventListener("mouseout", handler);
  }, [callbackRef]);
}
