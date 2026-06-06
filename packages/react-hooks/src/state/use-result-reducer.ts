import type { Result } from "@temelj/result";

import * as React from "react";

/**
 * Reducer that can reject an action by returning an Err Result.
 */
export type ResultReducer<S, A, E> = (state: S, action: A) => Result<S, E>;

/**
 * Dispatch function returned by useResultReducer.
 */
export type ResultDispatch<A> = (action: A) => void;

/**
 * Stores reducer state only when the reducer returns Ok and exposes the latest Result.
 */
export function useResultReducer<S, A, E>(
  reducer: ResultReducer<S, A, E>,
  initialState: S | (() => S),
): [S, ResultDispatch<A>, Result<S, E> | null] {
  const [state, setState] = React.useState(initialState);
  const [result, setResult] = React.useState<Result<S, E> | null>(null);

  const dispatch = React.useCallback(
    (action: A) => {
      setState((current) => {
        const next = reducer(current, action);
        setResult(next);
        return next.kind === "ok" ? next.value : current;
      });
    },
    [reducer],
  );

  return [state, dispatch, result];
}
