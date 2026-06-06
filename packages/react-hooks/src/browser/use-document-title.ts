import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Updates document.title when the supplied title changes.
 */
export function useDocumentTitle(title: string): void {
  React.useEffect(() => {
    if (isBrowser) {
      document.title = title;
    }
  }, [title]);
}
