import type { Result } from "@temelj/result";

import { fromPromise } from "@temelj/result";
import * as React from "react";

import { AsyncResultStore } from "../internal/async-result-store.ts";
import { mapThrownError } from "../internal/error.ts";
import { useLatest } from "../internal/mod.ts";

/**
 * Lifecycle state reported by async result hooks.
 */
export type AsyncResultStatus = "idle" | "loading" | "success" | "error";

/**
 * State shared by hooks that execute async work and expose a Result.
 */
export type AsyncResultState<T, E> =
  | Readonly<{ status: "idle"; result: null; loading: false; error: null }>
  | Readonly<{ status: "loading"; result: Result<T, E> | null; loading: true; error: null }>
  | Readonly<{
      status: "success";
      result: Extract<Result<T, E>, { kind: "ok" }>;
      loading: false;
      error: null;
    }>
  | Readonly<{
      status: "error";
      result: Extract<Result<T, E>, { kind: "error" }>;
      loading: false;
      error: E;
    }>;

/**
 * Options for configuring useAsyncResult execution and result handling.
 */
export interface AsyncResultCallbacks<T, E> {
  /** Maps unknown thrown values to the hook error type. */
  mapError?: (cause: unknown) => E;
  /** Called after a successful execution. */
  onSuccess?: (value: T) => void;
  /** Called after an error result. */
  onError?: (error: E | Error) => void;
}

export type UseAsyncResultOptions<T, E, Args extends unknown[]> = AsyncResultCallbacks<T, E> &
  (
    | { readonly immediate?: false; readonly initialArgs?: never }
    | { readonly immediate: true; readonly initialArgs: Args }
  );

/**
 * Return value from useAsyncResult, including state and imperative controls.
 */
export type UseAsyncResultReturn<T, E, Args extends unknown[]> = AsyncResultState<T, E> & {
  /** Executes the wrapped function. */
  execute: (...args: Args) => Promise<Result<T, E>>;
  /** Resets state back to idle. */
  reset: () => void;
};

/**
 * Wraps an async function and exposes its result as a non-throwing Result.
 */
export function useAsyncResult<T, E = never, Args extends unknown[] = []>(
  fn: (...args: Args) => Promise<T>,
  options?: UseAsyncResultOptions<T, E, Args>,
): UseAsyncResultReturn<T, E | Error, Args> {
  const fnRef = useLatest(fn);
  const optionsRef = useLatest(options);
  const [store] = React.useState(() => new AsyncResultStore<T, E | Error>());

  const state = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  React.useEffect(() => {
    store.activate();

    return () => store.deactivate();
  }, [store]);

  const execute = React.useCallback(
    async (...args: Args): Promise<Result<T, E | Error>> => {
      const callId = store.begin();

      const currentOptions = optionsRef.current;

      const result = await fromPromise(
        () => fnRef.current(...args),
        (cause) => mapThrownError(cause, currentOptions?.mapError),
      );

      if (store.settle(callId, result)) {
        if (result.kind === "ok") {
          currentOptions?.onSuccess?.(result.value);
        } else {
          currentOptions?.onError?.(result.error);
        }
      }

      return result;
    },
    [fnRef, optionsRef, store],
  );

  React.useEffect(() => {
    const currentOptions = optionsRef.current;

    if (currentOptions?.immediate) {
      void execute(...currentOptions.initialArgs);
    }
  }, [execute, options?.immediate, optionsRef]);

  return { ...state, execute, reset: store.reset };
}
