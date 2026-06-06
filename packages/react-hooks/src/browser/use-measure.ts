import * as React from "react";

/**
 * Measures an element with ResizeObserver and returns its width and height.
 */
export function useMeasure<T extends Element>(): [
  React.RefCallback<T>,
  { width: number | null; height: number | null },
] {
  const [dimensions, setDimensions] = React.useState({
    width: null as number | null,
    height: null as number | null,
  });
  const observerRef = React.useRef<ResizeObserver | null>(null);

  const ref = React.useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const measure = () => {
      const rect = node.getBoundingClientRect();
      setDimensions({ width: rect.width, height: rect.height });
    };
    measure();
    observerRef.current = new ResizeObserver(measure);
    observerRef.current.observe(node);
  }, []);

  React.useEffect(() => () => observerRef.current?.disconnect(), []);
  return [ref, dimensions];
}
