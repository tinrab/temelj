import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Subscribes to a CSS media query and returns whether it currently matches.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = React.useCallback(
    (callback: () => void) => {
      if (!isBrowser) return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    [query],
  );
  const getSnapshot = React.useCallback(
    () => isBrowser && window.matchMedia(query).matches,
    [query],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false);
}
