import * as React from "react";

import { isBrowser, useLatest } from "../internal/mod.ts";

/**
 * Returns a ref and calls a callback when pointer interaction happens outside that element.
 */
export function useClickAway<T extends Element>(
  callback: (event: Event) => void,
): React.RefObject<T | null> {
  const ref = React.useRef<T | null>(null);
  const callbackRef = useLatest(callback);

  React.useEffect(() => {
    if (!isBrowser) {
      return undefined;
    }
    const handler = (event: Event) => {
      const node = ref.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) {
        callbackRef.current(event);
      }
    };

    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);

    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [callbackRef]);

  return ref;
}
