import { isFunction } from "@temelj/value";
import * as React from "react";

/**
 * Manages object state with shallow patch updates.
 */
export function useObjectState<T extends object>(
  initialValue: T,
): [T, (patch: Partial<T> | ((state: T) => Partial<T> | undefined)) => void] {
  const [state, setState] = React.useState(() => initialValue);

  const update = React.useCallback((patch: Partial<T> | ((state: T) => Partial<T> | undefined)) => {
    setState((current) => {
      const next = isFunction(patch) ? patch(current) : patch;

      if (next === undefined) {
        return current;
      }

      return { ...current, ...next };
    });
  }, []);

  return [state, update];
}
