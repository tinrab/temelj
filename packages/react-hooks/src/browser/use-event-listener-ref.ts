import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Returns a callback ref that attaches an event listener when a node appears.
 */
export function useEventListenerRef<K extends keyof HTMLElementEventMap, T extends HTMLElement>(
  eventName: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): React.RefCallback<T> {
  const cleanupRef = React.useRef<(() => void) | null>(null);
  const handlerRef = useLatest(handler);

  const ref = React.useCallback(
    (node: T | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;

      if (!node) return;
      const listener = (event: Event) => handlerRef.current(event as HTMLElementEventMap[K]);
      node.addEventListener(eventName, listener, options);
      cleanupRef.current = () => node.removeEventListener(eventName, listener, options);
    },
    [eventName, handlerRef, options],
  );

  React.useEffect(() => () => cleanupRef.current?.(), []);

  return ref;
}
