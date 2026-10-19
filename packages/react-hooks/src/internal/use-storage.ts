import * as React from "react";

import { dispatchStorageEvent, isBrowser } from "./mod.ts";

/** Validates stored text on read and serializes domain values on write. */
export interface StorageCodec<T> {
  readonly parse: (serialized: string) => T;
  readonly serialize: (value: T) => string;
}

/** Explicit storage operations, including function-valued data and null. */
export interface StorageControls<T> {
  readonly set: (value: T) => void;
  readonly update: (update: (current: T) => T) => void;
  readonly remove: () => void;
}

/** Subscribes to a browser storage key using a caller-owned validation codec. */
export function useStorage<T>(
  storageName: "localStorage" | "sessionStorage",
  key: string,
  initialValue: T,
  codec: StorageCodec<T>,
): [T, StorageControls<T>] {
  const subscribe = React.useCallback((callback: () => void) => {
    if (!isBrowser) return () => {};

    window.addEventListener("storage", callback);

    return () => window.removeEventListener("storage", callback);
  }, []);

  const getSnapshot = React.useCallback(
    () => (isBrowser ? window[storageName].getItem(key) : null),
    [storageName, key],
  );

  const serialized = React.useSyncExternalStore(subscribe, getSnapshot, () => null);

  const set = React.useCallback(
    (value: T) => {
      if (!isBrowser) return;
      const next = codec.serialize(value);
      window[storageName].setItem(key, next);
      dispatchStorageEvent(key, next);
    },
    [storageName, key, codec],
  );

  const update = React.useCallback(
    (transform: (current: T) => T) => {
      if (!isBrowser) return;
      const current = window[storageName].getItem(key);
      set(transform(current === null ? initialValue : codec.parse(current)));
    },
    [storageName, key, initialValue, codec, set],
  );

  const remove = React.useCallback(() => {
    if (!isBrowser) return;
    window[storageName].removeItem(key);
    dispatchStorageEvent(key, null);
  }, [storageName, key]);

  return [serialized === null ? initialValue : codec.parse(serialized), { set, update, remove }];
}
