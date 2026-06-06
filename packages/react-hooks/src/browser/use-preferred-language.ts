import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Returns the browser preferred language and updates on language changes.
 */
export function usePreferredLanguage(): string {
  const subscribe = React.useCallback((callback: () => void) => {
    if (!isBrowser) {
      return () => {};
    }
    window.addEventListener("languagechange", callback);
    return () => window.removeEventListener("languagechange", callback);
  }, []);
  return React.useSyncExternalStore(
    subscribe,
    () => navigator.language,
    () => "en",
  );
}
