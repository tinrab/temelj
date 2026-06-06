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
    const previousOverflow = element.style.overflow;
    element.style.overflow = "hidden";
    return () => {
      element.style.overflow = previousOverflow;
    };
  }, [enabled, target]);
}
