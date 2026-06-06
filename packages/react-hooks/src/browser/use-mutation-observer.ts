import * as React from "react";

import { isBrowser } from "../internal/mod.ts";

/**
 * Options for useMutationObserver.
 */
export interface UseMutationObserverOptions extends MutationObserverInit {
  /** Called with mutation records whenever the observer fires. */
  onMutate?: (records: MutationRecord[], observer: MutationObserver) => void;
}

/**
 * Observes DOM mutations for an element and returns the latest mutation records.
 */
export function useMutationObserver<T extends Node>(
  options: UseMutationObserverOptions,
): [React.RefCallback<T>, MutationRecord[]] {
  const { onMutate, ...observerOptions } = options;
  const [records, setRecords] = React.useState<MutationRecord[]>([]);
  const observerRef = React.useRef<MutationObserver | null>(null);

  const ref = React.useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      setRecords([]);

      if (!node || !isBrowser || typeof MutationObserver === "undefined") {
        return;
      }
      const observer = new MutationObserver((nextRecords, currentObserver) => {
        setRecords(nextRecords);
        onMutate?.(nextRecords, currentObserver);
      });
      observer.observe(node, observerOptions);
      observerRef.current = observer;
    },
    [observerOptions, onMutate],
  );

  React.useEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, records];
}
