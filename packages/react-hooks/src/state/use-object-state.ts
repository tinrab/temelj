import { isPrimitiveValue } from "@temelj/value";
import * as React from "react";

/**
 * Manages object state with shallow patch updates.
 */
export function useObjectState<T extends Record<PropertyKey, unknown>>(
  initialValue: T,
): [T, (patch: Partial<T> | ((state: T) => Partial<T> | void)) => void] {
  const [state, setState] = React.useState(initialValue);
  const update = React.useCallback((patch: Partial<T> | ((state: T) => Partial<T> | void)) => {
    setState((current) => {
      const next = typeof patch === "function" ? patch(current) : patch;
      if (typeof next !== "object" || next === null || !isPrimitiveValue(next)) {
        return current;
      }
      return { ...current, ...(next as Partial<T>) };
    });
  }, []);
  return [state, update];
}
