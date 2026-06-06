import type { Result } from "@temelj/result";

import { err, map, mapErr, ok } from "@temelj/result";
import * as React from "react";

/**
 * Controls returned by useResultState.
 */
export interface ResultStateControls<T, E> {
  /** Stores an ok Result. */
  setOk: (value: T) => void;
  /** Stores an error Result. */
  setErr: (error: E) => void;
  /** Replaces the current Result. */
  set: React.Dispatch<React.SetStateAction<Result<T, E> | null>>;
  /** Maps an ok value when a Result is present. */
  map: (fn: (value: T) => T) => void;
  /** Maps an error value when a Result is present. */
  mapErr: (fn: (error: E) => E) => void;
  /** Clears the current Result. */
  reset: () => void;
}

/**
 * Stores a Result in React state with ok/error helper controls.
 */
export function useResultState<T, E>(
  initialResult: Result<T, E> | null = null,
): [Result<T, E> | null, ResultStateControls<T, E>] {
  const [result, setResult] = React.useState<Result<T, E> | null>(initialResult);

  const setOk = React.useCallback((value: T) => setResult(ok(value)), []);
  const setErr = React.useCallback((error: E) => setResult(err(error)), []);
  const mapResult = React.useCallback((fn: (value: T) => T) => {
    setResult((current) => (current === null ? null : map(current, fn)));
  }, []);
  const mapErrorResult = React.useCallback((fn: (error: E) => E) => {
    setResult((current) => (current === null ? null : mapErr(current, fn)));
  }, []);
  const reset = React.useCallback(() => setResult(null), []);

  return [result, { setOk, setErr, set: setResult, map: mapResult, mapErr: mapErrorResult, reset }];
}
