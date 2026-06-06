import type { Result } from "@temelj/result";

import { fromPromise } from "@temelj/result";
import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Lifecycle status reported by useAsyncTask.
 */
export type AsyncTaskStatus = "idle" | "running" | "success" | "error" | "aborted";

/**
 * Options for useAsyncTask.
 */
export interface UseAsyncTaskOptions<T, E> {
  /** Maps unknown thrown values to the task error type. */
  mapError?: (error: unknown) => E;
  /** Called after a successful task run. */
  onSuccess?: (value: T) => void;
  /** Called after an error result. */
  onError?: (error: E) => void;
  /** Called after the task is aborted. */
  onAbort?: () => void;
}

/**
 * State and controls returned by useAsyncTask.
 */
export interface UseAsyncTaskReturn<T, E, Args extends unknown[]> {
  /** Current task status. */
  status: AsyncTaskStatus;
  /** Latest task Result, or null before completion. */
  result: Result<T, E> | null;
  /** Latest task error, or null when there is no error. */
  error: E | null;
  /** Whether the task is currently running. */
  running: boolean;
  /** Timestamp when the current or latest task started. */
  startedAt: number | null;
  /** Timestamp when the latest task finished. */
  finishedAt: number | null;
  /** Latest task duration in milliseconds. */
  duration: number | null;
  /** Starts the task and aborts any previous run. */
  start: (...args: Args) => Promise<Result<T, E>>;
  /** Aborts the current task. */
  cancel: (reason?: unknown) => void;
  /** Aborts the current task and resets state to idle. */
  reset: () => void;
}

/**
 * Runs cancellable async work and exposes task-oriented status and timing metadata.
 */
export function useAsyncTask<T, E = unknown, Args extends unknown[] = []>(
  task: (signal: AbortSignal, ...args: Args) => Promise<T>,
  options: UseAsyncTaskOptions<T, E> = {},
): UseAsyncTaskReturn<T, E, Args> {
  const taskRef = useLatest(task);
  const optionsRef = useLatest(options);
  const mountedRef = React.useRef(true);
  const runIdRef = React.useRef(0);
  const controllerRef = React.useRef<AbortController | null>(null);
  const [state, setState] = React.useState<
    Omit<UseAsyncTaskReturn<T, E, Args>, "start" | "cancel" | "reset">
  >({
    status: "idle",
    result: null,
    error: null,
    running: false,
    startedAt: null,
    finishedAt: null,
    duration: null,
  });

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  const cancel = React.useCallback((reason?: unknown) => {
    controllerRef.current?.abort(reason);
  }, []);

  const reset = React.useCallback(() => {
    runIdRef.current++;
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState({
      status: "idle",
      result: null,
      error: null,
      running: false,
      startedAt: null,
      finishedAt: null,
      duration: null,
    });
  }, []);

  const start = React.useCallback(
    async (...args: Args): Promise<Result<T, E>> => {
      const runId = ++runIdRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const startedAt = Date.now();
      setState({
        status: "running",
        result: null,
        error: null,
        running: true,
        startedAt,
        finishedAt: null,
        duration: null,
      });

      const result = await fromPromise(
        () => taskRef.current(controller.signal, ...args),
        (error) =>
          optionsRef.current.mapError ? optionsRef.current.mapError(error) : (error as E),
      );
      const finishedAt = Date.now();

      if (mountedRef.current && runId === runIdRef.current) {
        if (controller.signal.aborted) {
          setState({
            status: "aborted",
            result,
            error: result.kind === "error" ? result.error : null,
            running: false,
            startedAt,
            finishedAt,
            duration: finishedAt - startedAt,
          });
          optionsRef.current.onAbort?.();
        } else if (result.kind === "ok") {
          setState({
            status: "success",
            result,
            error: null,
            running: false,
            startedAt,
            finishedAt,
            duration: finishedAt - startedAt,
          });
          optionsRef.current.onSuccess?.(result.value);
        } else {
          setState({
            status: "error",
            result,
            error: result.error,
            running: false,
            startedAt,
            finishedAt,
            duration: finishedAt - startedAt,
          });
          optionsRef.current.onError?.(result.error);
        }
      }

      return result;
    },
    [optionsRef, taskRef],
  );

  return { ...state, start, cancel, reset };
}
