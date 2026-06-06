import * as React from "react";

/**
 * Returns a callback ref and whether the referenced element is currently hovered.
 */
export function useHover<T extends Element>(): [React.RefCallback<T>, boolean] {
  const [hovering, setHovering] = React.useState(false);
  const previousNode = React.useRef<T | null>(null);
  const handleMouseEnter = React.useCallback(() => setHovering(true), []);
  const handleMouseLeave = React.useCallback(() => setHovering(false), []);

  const ref = React.useCallback(
    (node: T | null) => {
      previousNode.current?.removeEventListener("mouseenter", handleMouseEnter);
      previousNode.current?.removeEventListener("mouseleave", handleMouseLeave);
      if (node) {
        node.addEventListener("mouseenter", handleMouseEnter);
        node.addEventListener("mouseleave", handleMouseLeave);
      }
      previousNode.current = node;
    },
    [handleMouseEnter, handleMouseLeave],
  );

  return [ref, hovering];
}
