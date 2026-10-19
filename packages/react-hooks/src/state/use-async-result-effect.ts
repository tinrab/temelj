/* oxlint-disable react-hooks/exhaustive-deps */
import { fromPromise } from "@temelj/result";
import * as React from "react";

import type { AsyncResultState } from "../async/use-async-result.ts";

import { AsyncResultStore } from "../internal/async-result-store.ts";
import { mapThrownError } from "../internal/error.ts";

/** Options for useAsyncResultEffect. */
export interface UseAsyncResultEffectOptions<E> {
  /** Converts a thrown cause to a domain error. Mapper failures remain Error objects. */
  mapError?: (cause: unknown) => E;
}

/** Runs async work when dependencies change and exposes completion as a Temelj Result. */
export function useAsyncResultEffect<T, E = never>(
  effect: () => Promise<T>,
  dependencies: React.DependencyList,
  options?: UseAsyncResultEffectOptions<E>,
): AsyncResultState<T, E | Error> {
  const [store] = React.useState(() => new AsyncResultStore<T, E | Error>());

  const state = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  React.useEffect(() => {
    store.activate();
    const callId = store.begin();
    void fromPromise(effect, (cause) => mapThrownError(cause, options?.mapError)).then((result) => {
      store.settle(callId, result);
    });

    return () => store.deactivate();
  }, dependencies);

  return state;
}
