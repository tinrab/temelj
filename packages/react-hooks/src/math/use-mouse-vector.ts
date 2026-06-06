import { type Vector2, vector2 } from "@temelj/math";
import * as React from "react";

import { isBrowser, useIsoLayoutEffect } from "../internal/mod.ts";

/**
 * Tracks mouse coordinates as a Vector2.
 */
export function useMouseVector<T extends Element>(): [Vector2, React.RefObject<T | null>] {
  const [position, setPosition] = React.useState<Vector2>(vector2.zero());
  const ref = React.useRef<T | null>(null);

  useIsoLayoutEffect(() => {
    if (!isBrowser) return undefined;
    const handleMouseMove = (event: MouseEvent) => {
      const node = ref.current;
      if (!node) {
        setPosition(vector2.of(event.pageX, event.pageY));
        return;
      }
      const bounds = node.getBoundingClientRect();
      setPosition(vector2.of(event.clientX - bounds.left, event.clientY - bounds.top));
    };

    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return [position, ref];
}
