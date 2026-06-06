import { type Vector2, vector2 } from "@temelj/math";
import * as React from "react";

import { isBrowser, useIsoLayoutEffect } from "../internal/mod.ts";

/**
 * Tracks pointer coordinates as a Vector2.
 *
 * When the returned ref is attached to an element, coordinates are relative to that element.
 * Otherwise, coordinates are reported in viewport space.
 */
export function usePointerVector<T extends Element>(): [Vector2, React.RefObject<T | null>] {
  const [position, setPosition] = React.useState<Vector2>(vector2.zero());
  const ref = React.useRef<T | null>(null);

  useIsoLayoutEffect(() => {
    if (!isBrowser) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      const node = ref.current;
      if (!node) {
        setPosition(vector2.of(event.clientX, event.clientY));
        return;
      }
      const bounds = node.getBoundingClientRect();
      setPosition(vector2.of(event.clientX - bounds.left, event.clientY - bounds.top));
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  return [position, ref];
}
