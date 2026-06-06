import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Reports whether the user has been inactive for the given duration.
 */
export function useIdle(ms = 60_000): boolean {
  const [idle, setIdle] = React.useState(false);

  React.useEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    let timeoutId: ReturnType<typeof setTimeout>;
    let last = 0;

    const reset = () => {
      const now = Date.now();
      if (now - last < 500) {
        return;
      }
      last = now;
      setIdle(false);
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => setIdle(true), ms);
    };

    timeoutId = setTimeout(() => setIdle(true), ms);
    const events = ["mousemove", "mousedown", "resize", "keydown", "touchstart", "wheel"];
    events.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    document.addEventListener("visibilitychange", reset);
    return () => {
      events.forEach((event) => window.removeEventListener(event, reset));
      document.removeEventListener("visibilitychange", reset);
      clearTimeout(timeoutId);
    };
  }, [ms]);

  return idle;
}
