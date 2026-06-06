import type * as ReactTypes from "react";

import * as React from "react";

import { dispatchStorageEvent, isBrowser, parseJson } from "../internal/mod.ts";

function createStorageHook(storageName: "localStorage" | "sessionStorage") {
  return function useStorage<T>(
    key: string,
    initialValue: T,
  ): [T, ReactTypes.Dispatch<ReactTypes.SetStateAction<T | null | undefined>>] {
    const subscribe = React.useCallback((callback: () => void) => {
      if (!isBrowser) return () => {};
      window.addEventListener("storage", callback);
      return () => window.removeEventListener("storage", callback);
    }, []);
    const getSnapshot = React.useCallback(
      () => (isBrowser ? window[storageName].getItem(key) : null),
      [key],
    );
    const store = React.useSyncExternalStore(subscribe, getSnapshot, () => null);

    React.useEffect(() => {
      if (!isBrowser) return;
      if (window[storageName].getItem(key) === null && initialValue !== undefined) {
        const value = JSON.stringify(initialValue);
        window[storageName].setItem(key, value);
        dispatchStorageEvent(key, value);
      }
    }, [key, initialValue]);

    const setState = React.useCallback(
      (value: ReactTypes.SetStateAction<T | null | undefined>) => {
        if (!isBrowser) return;
        const current = parseJson(store, initialValue);
        const next =
          typeof value === "function"
            ? (value as (current: T) => T | null | undefined)(current)
            : value;
        if (next == null) {
          window[storageName].removeItem(key);
          dispatchStorageEvent(key, null);
          return;
        }
        const serialized = JSON.stringify(next);
        window[storageName].setItem(key, serialized);
        dispatchStorageEvent(key, serialized);
      },
      [key, store, initialValue],
    );

    return [parseJson(store, initialValue), setState];
  };
}

/**
 * Stores state in localStorage and subscribes to storage events for the key.
 */
export const useLocalStorage = createStorageHook("localStorage");
