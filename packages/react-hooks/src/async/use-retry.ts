import type { Result } from "@temelj/result";

import { retry } from "@temelj/async";
import { fromPromise } from "@temelj/result";
import * as React from "react";

import { mapThrownError } from "../internal/error.ts";
import { useLatest } from "../internal/mod.ts";

/**
 * Lifecycle status reported by useRetry.
 */
export type RetryStatus = "idle" | "running" | "success" | "error";

/**
 * Options for useRetry.
 */
export interface UseRetryOptions<T, E> {
  /** Maximum number of attempts. */
  times?: number;
  /** Fixed delay between attempts in milliseconds. */
  delay?: number;
  /** Computes the delay from the attempt number. */
  backoff?: (attempt: number) => number;
  /** Returns whether an error should be retried. */
  shouldRetry?: (cause: unknown) => boolean;
  /** Maps unknown thrown values to the retry error type. */
  mapError?: (cause: unknown) => E;
  /** Called after a successful retry sequence. */
  onSuccess?: (value: T) => void;
  /** Called after the retry sequence fails. */
  onError?: (error: E | Error) => void;
}

/**
 * State and controls returned by useRetry.
 */
export interface UseRetryReturn<T, E, Args extends unknown[]> {
  /** Current retry status. */
  status: RetryStatus;
  /** Latest Result, or null before completion. */
  result: Result<T, E> | null;
  /** Latest error value, or null when there is no error. */
  error: E | null;
  /** Whether a retry sequence is currently running. */
  running: boolean;
  /** Latest attempt number. */
  attempt: number;
  /** Executes the retried function. */
  execute: (...args: Args) => Promise<Result<T, E>>;
  /** Resets state back to idle. */
  reset: () => void;
}

/**
 * Retries an async function and exposes attempt state.
 */
export function useRetry<T, E = never, Args extends unknown[] = []>(
  fn: (attempt: number, ...args: Args) => Promise<T>,
  options: UseRetryOptions<T, E> = {},
): UseRetryReturn<T, E | Error, Args> {
  const fnRef = useLatest(fn);
  const optionsRef = useLatest(options);
  const mountedRef = React.useRef(true);
  const callIdRef = React.useRef(0);

  const [state, setState] = React.useState<
    Omit<UseRetryReturn<T, E | Error, Args>, "execute" | "reset">
  >({
    status: "idle",
    result: null,
    error: null,
    running: false,
    attempt: 0,
  });

  React.useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = React.useCallback(
    async (...args: Args): Promise<Result<T, E | Error>> => {
      const callId = ++callIdRef.current;
      setState((current) => ({ ...current, status: "running", running: true, error: null }));

      const result = await fromPromise(
        () =>
          retry(
            (attempt) => {
              if (mountedRef.current && callId === callIdRef.current) {
                setState((current) => ({ ...current, attempt }));
              }

              return fnRef.current(attempt, ...args);
            },
            {
              times: optionsRef.current.times,
              delay: optionsRef.current.delay,
              backoff: optionsRef.current.backoff,
              shouldRetry: optionsRef.current.shouldRetry,
            },
          ),
        (cause) => mapThrownError(cause, optionsRef.current.mapError),
      );

      if (mountedRef.current && callId === callIdRef.current) {
        if (result.kind === "ok") {
          setState((current) => ({
            ...current,
            status: "success",
            result,
            error: null,
            running: false,
          }));
          optionsRef.current.onSuccess?.(result.value);
        } else {
          setState((current) => ({
            ...current,
            status: "error",
            result,
            error: result.error,
            running: false,
          }));
          optionsRef.current.onError?.(result.error);
        }
      }

      return result;
    },
    [fnRef, optionsRef],
  );

  const reset = React.useCallback(() => {
    callIdRef.current++;
    setState({ status: "idle", result: null, error: null, running: false, attempt: 0 });
  }, []);

  return { ...state, execute, reset };
}
