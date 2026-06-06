import { type Rectangle, rectangle } from "@temelj/math";
import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Measures an element as a Rectangle.
 */
export function useRect<T extends Element>(): [React.RefCallback<T>, Rectangle | null] {
  const [rect, setRect] = React.useState<Rectangle | null>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  const ref = React.useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;

    if (!node || !isBrowser) {
      setRect(null);
      return;
    }

    const measure = () => setRect(rectangle.fromDOM(node.getBoundingClientRect()));
    measure();

    if (typeof ResizeObserver !== "undefined") {
      observerRef.current = new ResizeObserver(measure);
      observerRef.current.observe(node);
    }
  }, []);

  React.useEffect(() => () => observerRef.current?.disconnect(), []);
  return [ref, rect];
}
