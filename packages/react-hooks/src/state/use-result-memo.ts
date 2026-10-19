import type { Result } from "@temelj/result";

import { fromThrowable } from "@temelj/result";
import * as React from "react";

import { mapThrownError } from "../internal/error.ts";

/**
 * Computes a memoized value as a Result, converting thrown errors to Err.
 */
export function useResultMemo<T, E = never>(
  factory: () => T,
  dependencies: React.DependencyList,
  mapError?: (cause: unknown) => E,
): Result<T, E | Error> {
  return React.useMemo(
    () => fromThrowable(factory, (cause) => mapThrownError(cause, mapError)),
    // The explicit dependency list mirrors React.useMemo while keeping the factory wrapped in Result.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    dependencies,
  );
}
