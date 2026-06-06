import * as React from "react";

import { isBrowser, useIsoLayoutEffect } from "../internal/mod.ts";

/**
 * Mouse coordinates in page space and relative to an optional element.
 */
export interface MousePosition {
  /** Horizontal page coordinate. */
  x: number;
  /** Vertical page coordinate. */
  y: number;
  /** Horizontal coordinate relative to the element. */
  elementX: number;
  /** Vertical coordinate relative to the element. */
  elementY: number;
  /** Element horizontal page position. */
  elementPositionX: number;
  /** Element vertical page position. */
  elementPositionY: number;
}

/**
 * Tracks mouse position globally and relative to an optional referenced element.
 */
export function useMouse<T extends Element>(): [MousePosition, React.RefObject<T | null>] {
  const [state, setState] = React.useState<MousePosition>({
    x: 0,
    y: 0,
    elementX: 0,
    elementY: 0,
    elementPositionX: 0,
    elementPositionY: 0,
  });
  const ref = React.useRef<T | null>(null);

  useIsoLayoutEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    const handleMouseMove = (event: MouseEvent) => {
      const next: Partial<MousePosition> = { x: event.pageX, y: event.pageY };
      const node = ref.current;
      if (node) {
        const bounds = node.getBoundingClientRect();
        const elementPositionX = bounds.left + window.scrollX;
        const elementPositionY = bounds.top + window.scrollY;
        next.elementX = event.pageX - elementPositionX;
        next.elementY = event.pageY - elementPositionY;
        next.elementPositionX = elementPositionX;
        next.elementPositionY = elementPositionY;
      }
      setState((current) => ({ ...current, ...next }));
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, []);

  return [state, ref];
}
