import type { Result } from "@temelj/result";

import { fromThrowable } from "@temelj/result";
import * as React from "react";

/**
 * Computes a memoized value as a Result, converting thrown errors to Err.
 */
export function useResultMemo<T, E = unknown>(
  factory: () => T,
  dependencies: React.DependencyList,
  mapError?: (error: unknown) => E,
): Result<T, E> {
  return React.useMemo(
    () => fromThrowable(factory, (error) => (mapError ? mapError(error) : (error as E))),
    // The explicit dependency list mirrors React.useMemo while keeping the factory wrapped in Result.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    dependencies,
  );
}
