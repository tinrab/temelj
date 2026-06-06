import { Queue } from "@temelj/async";
import * as React from "react";

/**
 * Options for useAsyncQueue.
 */
export interface UseAsyncQueueOptions {
  /** Maximum number of tasks that may run concurrently. */
  concurrency?: number;
  /** Whether queued tasks should begin immediately. */
  autoStart?: boolean;
}

/**
 * Options for adding a task to useAsyncQueue.
 */
export interface AsyncQueueAddOptions {
  /** Higher priority tasks run before lower priority tasks. */
  priority?: number;
  /** Optional signal used to cancel a pending task. */
  signal?: AbortSignal;
}

/**
 * State and controls returned by useAsyncQueue.
 */
export interface AsyncQueueControls {
  /** Number of queued tasks waiting to run. */
  size: number;
  /** Number of currently running tasks. */
  pending: number;
  /** Whether the queue is paused. */
  paused: boolean;
  /** Adds a task to the queue. */
  add: <T>(fn: () => PromiseLike<T> | T, options?: AsyncQueueAddOptions) => Promise<T>;
  /** Pauses pending task execution. */
  pause: () => void;
  /** Resumes pending task execution. */
  resume: () => void;
  /** Clears queued tasks that have not started yet. */
  clear: () => void;
  /** Resolves when the queue has no queued or active tasks. */
  onIdle: () => Promise<void>;
}

/**
 * Creates a React-aware wrapper around Queue.
 */
export function useAsyncQueue(options: UseAsyncQueueOptions = {}): AsyncQueueControls {
  const queueRef = React.useRef<Queue | null>(null);
  const pausedRef = React.useRef(options.autoStart === false);
  const [, rerender] = React.useReducer((value: number) => value + 1, 0);

  if (queueRef.current === null) {
    queueRef.current = new Queue(options);
  }

  const refresh = React.useCallback(() => rerender(), []);

  const add = React.useCallback(
    async <T>(fn: () => PromiseLike<T> | T, addOptions?: AsyncQueueAddOptions): Promise<T> => {
      const queue = queueRef.current as Queue;
      refresh();
      try {
        return await queue.add(fn, addOptions);
      } finally {
        refresh();
      }
    },
    [refresh],
  );

  const pause = React.useCallback(() => {
    pausedRef.current = true;
    queueRef.current?.pause();
    refresh();
  }, [refresh]);

  const resume = React.useCallback(() => {
    pausedRef.current = false;
    queueRef.current?.resume();
    refresh();
  }, [refresh]);

  const clear = React.useCallback(() => {
    queueRef.current?.clear();
    refresh();
  }, [refresh]);

  const onIdle = React.useCallback(async () => {
    await queueRef.current?.onIdle;
    refresh();
  }, [refresh]);

  const queue = queueRef.current;
  return {
    size: queue.size,
    pending: queue.pending,
    paused: pausedRef.current,
    add,
    pause,
    resume,
    clear,
    onIdle,
  };
}
