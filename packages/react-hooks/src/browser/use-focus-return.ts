import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Captures the active element when enabled and restores focus when disabled or unmounted.
 */
export function useFocusReturn(enabled: boolean): void {
  const previousElementRef = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    if (enabled) {
      previousElementRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return undefined;
    }

    previousElementRef.current?.focus();
    previousElementRef.current = null;

    return undefined;
  }, [enabled]);

  React.useEffect(() => () => previousElementRef.current?.focus(), []);
}
