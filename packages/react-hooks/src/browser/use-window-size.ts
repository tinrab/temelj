import * as React from "react";

import { isBrowser, useIsoLayoutEffect } from "../internal/mod.ts";

/**
 * Tracks the current window inner width and height.
 */
export function useWindowSize(): { width: number | null; height: number | null } {
  const [size, setSize] = React.useState({
    width: null as number | null,
    height: null as number | null,
  });

  useIsoLayoutEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    const handleResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return size;
}
