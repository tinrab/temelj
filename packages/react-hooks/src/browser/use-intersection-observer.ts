import * as React from "react";

/**
 * Observes an element with IntersectionObserver and returns the latest entry.
 */
export function useIntersectionObserver<T extends Element>(
  options: IntersectionObserverInit = {},
): [React.RefCallback<T>, IntersectionObserverEntry | null] {
  const [entry, setEntry] = React.useState<IntersectionObserverEntry | null>(null);
  const observerRef = React.useRef<IntersectionObserver | null>(null);
  const { threshold = 1, root = null, rootMargin = "0px" } = options;

  const ref = React.useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      if (!node || typeof IntersectionObserver === "undefined") {
        return;
      }
      const observer = new IntersectionObserver(([nextEntry]) => setEntry(nextEntry ?? null), {
        threshold,
        root,
        rootMargin,
      });
      observer.observe(node);
      observerRef.current = observer;
    },
    [threshold, root, rootMargin],
  );

  React.useEffect(() => () => observerRef.current?.disconnect(), []);
  return [ref, entry];
}
