import type { Result } from "@temelj/result";

import { timeout } from "@temelj/async";
import { fromPromise } from "@temelj/result";
import * as React from "react";

import { useLatest } from "../internal/mod.ts";

/**
 * Options for useTimeoutResult.
 */
export interface UseTimeoutResultOptions<T, E> {
  /** Timeout duration in milliseconds. */
  ms: number;
  /** Optional value returned when the operation times out. */
  fallback?: T;
  /** Maps unknown thrown values to the Result error type. */
  mapError?: (error: unknown) => E;
}

/**
 * Function returned by useTimeoutResult.
 */
export type TimeoutResultRunner<T, E> = (
  promise: PromiseLike<T> | (() => PromiseLike<T> | T),
) => Promise<Result<T, E>>;

/**
 * Returns a stable helper that wraps a promise or promise factory with timeout and Result.
 */
export function useTimeoutResult<T, E = unknown>(
  options: UseTimeoutResultOptions<T, E>,
): TimeoutResultRunner<T, E> {
  const optionsRef = useLatest(options);

  return React.useCallback(
    async (promise: PromiseLike<T> | (() => PromiseLike<T> | T)) => {
      const currentOptions = optionsRef.current;
      const timeoutOptions = Object.prototype.hasOwnProperty.call(currentOptions, "fallback")
        ? { fallback: currentOptions.fallback }
        : undefined;
      return fromPromise(
        () => timeout(promise, currentOptions.ms, timeoutOptions),
        (error) => (currentOptions.mapError ? currentOptions.mapError(error) : (error as E)),
      );
    },
    [optionsRef],
  );
}
