import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Reports whether the document visibility state is visible.
 */
export function useVisibilityChange(): boolean {
  const subscribe = React.useCallback((callback: () => void) => {
    if (!isBrowser) {
      return () => {};
    }
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  }, []);
  const getSnapshot = React.useCallback(
    () => isBrowser && document.visibilityState === "visible",
    [],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, () => true);
}
