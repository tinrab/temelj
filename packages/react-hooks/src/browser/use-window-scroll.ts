import * as React from "react";

import { isBrowser, useIsoLayoutEffect } from "../internal/mod.ts";

/**
 * Typed scrollTo function returned by useWindowScroll.
 */
export type WindowScrollTo = {
  (options?: ScrollToOptions): void;
  (x: number, y: number): void;
};

/**
 * Tracks window scroll position and returns a scrollTo helper.
 */
export function useWindowScroll(): [{ x: number | null; y: number | null }, WindowScrollTo] {
  const [state, setState] = React.useState<{ x: number | null; y: number | null }>({
    x: null,
    y: null,
  });
  const scrollTo = React.useCallback<WindowScrollTo>(
    ((...args: [ScrollToOptions?] | [number, number]) => {
      if (!isBrowser) {
        return;
      }
      if (typeof args[0] === "number") window.scrollTo(args[0], args[1] as number);
      else window.scrollTo(args[0]);
    }) as WindowScrollTo,
    [],
  );

  useIsoLayoutEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    const handleScroll = () => setState({ x: window.scrollX, y: window.scrollY });
    handleScroll();
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return [state, scrollTo];
}
