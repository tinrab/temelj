import { isBrowser, useIsoLayoutEffect } from "../internal/mod.ts";

/**
 * Locks document body scrolling while the component is mounted.
 */
export function useLockBodyScroll(): void {
  useIsoLayoutEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, []);
}
