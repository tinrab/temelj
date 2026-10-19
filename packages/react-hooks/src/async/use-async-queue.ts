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
  /** Rejects queued tasks with AbortError; running tasks continue. */
  clear: () => void;
  /** Resolves when the queue has no queued or active tasks. */
  onIdle: () => Promise<void>;
}

/**
 * Creates a React-aware wrapper around Queue.
 */
export function useAsyncQueue(options: UseAsyncQueueOptions = {}): AsyncQueueControls {
  const [queue] = React.useState(() => new Queue(options));
  const state = React.useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);

  const add = React.useCallback(
    <T>(fn: () => PromiseLike<T> | T, addOptions?: AsyncQueueAddOptions) =>
      queue.add(fn, addOptions),
    [queue],
  );

  const pause = React.useCallback(() => queue.pause(), [queue]);
  const resume = React.useCallback(() => queue.resume(), [queue]);
  const clear = React.useCallback(() => queue.clear(), [queue]);
  const onIdle = React.useCallback(() => queue.onIdle, [queue]);
  React.useEffect(() => () => queue.clear(), [queue]);

  return { ...state, add, pause, resume, clear, onIdle };
}
