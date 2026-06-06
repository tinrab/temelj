/* oxlint-disable react-hooks/exhaustive-deps */
import { fromPromise } from "@temelj/result";
import * as React from "react";

import type { AsyncResultState } from "../async/use-async-result.ts";

/**
 * Options for useAsyncResultEffect.
 */
export interface UseAsyncResultEffectOptions<E> {
  /** Maps unknown thrown values or rejected reasons to the hook error type. */
  mapError?: (error: unknown) => E;
}

/**
 * Runs async work when dependencies change and exposes completion as a Temelj Result.
 */
export function useAsyncResultEffect<T, E = unknown>(
  effect: () => Promise<T>,
  dependencies: React.DependencyList,
  options?: UseAsyncResultEffectOptions<E>,
): AsyncResultState<T, E> {
  const [state, setState] = React.useState<AsyncResultState<T, E>>({
    status: "idle",
    result: null,
    loading: false,
    error: null,
  });

  React.useEffect(() => {
    let cancelled = false;

    setState((current) => ({ ...current, status: "loading", loading: true, error: null }));

    void fromPromise(effect, (error) =>
      options?.mapError ? options.mapError(error) : (error as E),
    ).then((result) => {
      if (cancelled) return;
      if (result.kind === "ok") {
        setState({ status: "success", result, loading: false, error: null });
      } else {
        setState({ status: "error", result, loading: false, error: result.error });
      }
    });

    return () => {
      cancelled = true;
    };
  }, dependencies);

  return state;
}
