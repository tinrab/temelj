import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Options for useResizeObserver.
 */
export interface UseResizeObserverOptions extends ResizeObserverOptions {
  /** Called whenever ResizeObserver emits an entry. */
  onResize?: (entry: ResizeObserverEntry) => void;
}

/**
 * Observes an element with ResizeObserver and returns the latest entry.
 */
export function useResizeObserver<T extends Element>(
  options: UseResizeObserverOptions = {},
): [React.RefCallback<T>, ResizeObserverEntry | null] {
  const { onResize, ...observerOptions } = options;
  const [entry, setEntry] = React.useState<ResizeObserverEntry | null>(null);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  const ref = React.useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      setEntry(null);

      if (!node || !isBrowser || typeof ResizeObserver === "undefined") {
        return;
      }
      const observer = new ResizeObserver(([nextEntry]) => {
        if (!nextEntry) {
          return;
        }
        setEntry(nextEntry);
        onResize?.(nextEntry);
      });
      observer.observe(node, observerOptions);
      observerRef.current = observer;
    },
    [observerOptions, onResize],
  );

  React.useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, entry];
}
