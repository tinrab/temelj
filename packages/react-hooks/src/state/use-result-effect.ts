/* oxlint-disable react-hooks/exhaustive-deps */
import type { Result } from "@temelj/result";

import { fromThrowable, ok } from "@temelj/result";
import * as React from "react";

import { AsyncResultStore } from "../internal/async-result-store.ts";
import { mapThrownError } from "../internal/error.ts";

/** The effect's value and optional cleanup are separate, so values may themselves be functions. */
export interface ResultEffectValue<T> {
  readonly value: T;
  readonly cleanup?: () => void;
}

/** Effect callback accepted by useResultEffect. */
export type ResultEffectCallback<T> = () => ResultEffectValue<T>;

/** Runs a React effect and stores whether the synchronous effect body succeeded. */
export function useResultEffect<T = void, E = never>(
  effect: ResultEffectCallback<T>,
  dependencies: React.DependencyList,
  mapError?: (cause: unknown) => E,
): Result<T, E | Error> | null {
  const [store] = React.useState(() => new AsyncResultStore<T, E | Error>());

  const state = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  React.useEffect(() => {
    store.activate();
    const callId = store.begin();
    const next = fromThrowable(effect, (cause) => mapThrownError(cause, mapError));

    if (next.kind === "ok") {
      store.settle(callId, ok(next.value.value));
    } else {
      store.settle(callId, next);
    }

    return () => {
      store.deactivate();

      if (next.kind === "ok") next.value.cleanup?.();
    };
  }, dependencies);

  return state.result;
}
