import * as React from "react";

import { isBrowser, useIsoLayoutEffect } from "../internal/mod.ts";

/**
 * Tracks the current screen orientation angle and type.
 */
export function useOrientation(): { angle: number; type: string } {
  const [orientation, setOrientation] = React.useState({ angle: 0, type: "landscape-primary" });

  useIsoLayoutEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    const update = () => {
      if (window.screen?.orientation) {
        setOrientation({
          angle: window.screen.orientation.angle,
          type: window.screen.orientation.type,
        });
      } else {
        setOrientation({ angle: 0, type: "unknown" });
      }
    };
    update();
    window.screen?.orientation?.addEventListener("change", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.screen?.orientation?.removeEventListener("change", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return orientation;
}
