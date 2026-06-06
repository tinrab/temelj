/* oxlint-disable react-hooks/exhaustive-deps */
import type { Result } from "@temelj/result";

import { fromThrowable } from "@temelj/result";
import * as React from "react";

/**
 * Effect callback accepted by useResultEffect.
 */
export type ResultEffectCallback<T> = () => T | (() => void);

/**
 * Runs a React effect and stores whether the synchronous effect body succeeded.
 */
export function useResultEffect<T = void, E = unknown>(
  effect: ResultEffectCallback<T>,
  dependencies: React.DependencyList,
  mapError?: (error: unknown) => E,
): Result<T, E> | null {
  const [result, setResult] = React.useState<Result<T, E> | null>(null);

  React.useEffect(() => {
    let cleanup: (() => void) | undefined;
    const next = fromThrowable(
      () => effect(),
      (error) => (mapError ? mapError(error) : (error as E)),
    );

    if (next.kind === "ok" && typeof next.value === "function") {
      cleanup = next.value as () => void;
      setResult({ kind: "ok", value: undefined as T });
    } else {
      setResult(next as Result<T, E>);
    }

    return () => cleanup?.();
  }, dependencies);

  return result;
}
