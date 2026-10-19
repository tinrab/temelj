import * as React from "react";

import { isBrowser, useIsoLayoutEffect } from "../internal/mod.ts";

/**
 * Locks scrolling for document body or a supplied element ref while enabled.
 */
export function useScrollLock<T extends HTMLElement>(
  enabled = true,
  target?: React.RefObject<T | null>,
): void {
  useIsoLayoutEffect(() => {
    if (!enabled || !isBrowser) {
      return undefined;
    }

    const element = target?.current ?? document.body;
    const previousOverflow = element.style.getPropertyValue("overflow");
    const previousPriority = element.style.getPropertyPriority("overflow");
    element.style.setProperty("overflow", "hidden");

    return () => {
      element.style.setProperty("overflow", previousOverflow, previousPriority);
    };
  }, [enabled, target]);
}
