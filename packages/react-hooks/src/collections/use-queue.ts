import * as React from "react";

/**
 * Queue state and helpers returned by useQueue.
 */
export interface QueueControls<T> {
  /** Append an element to the queue. */
  add: (element: T) => void;
  /** Remove and return the first element. */
  remove: () => T | undefined;
  /** Clear the current collection or history. */
  clear: () => void;
  /** First queue element. */
  first: T | undefined;
  /** Last queue element. */
  last: T | undefined;
  /** Number of queued elements. */
  size: number;
  /** Current queue contents. */
  queue: T[];
}

/**
 * Manages a FIFO queue with add, remove, and clear helpers.
 */
export function useQueue<T>(initialValue: T[] = []): QueueControls<T> {
  const [queue, setQueue] = React.useState(initialValue);
  const queueRef = React.useRef(queue);
  queueRef.current = queue;

  const add = React.useCallback((element: T) => setQueue((value) => [...value, element]), []);
  const remove = React.useCallback(() => {
    const first = queueRef.current[0];
    setQueue(([, ...rest]) => rest);
    return first;
  }, []);
  const clear = React.useCallback(() => setQueue([]), []);

  return {
    add,
    remove,
    clear,
    first: queue[0],
    last: queue[queue.length - 1],
    size: queue.length,
    queue,
  };
}
