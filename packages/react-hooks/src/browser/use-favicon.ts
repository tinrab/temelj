import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Creates or updates the document favicon link.
 */
export function useFavicon(url: string): void {
  React.useEffect(() => {
    if (!isBrowser) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) {
      link = document.createElement("link");
      link.type = "image/x-icon";
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = url;
  }, [url]);
}
