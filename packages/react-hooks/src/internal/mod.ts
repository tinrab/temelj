import * as React from "react";

/**
 * True when both window and document are available.
 */
export const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

/**
 * React layout effect in the browser and regular effect during server rendering.
 */
export const useIsoLayoutEffect = isBrowser ? React.useLayoutEffect : React.useEffect;

/**
 * Stores the latest value in a stable ref.
 */
export function useLatest<T>(value: T): React.RefObject<T> {
  const ref = React.useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * Dispatches a storage event for same-document storage subscribers.
 */
export function dispatchStorageEvent(key: string, newValue: string | null) {
  if (!isBrowser) {
    return;
  }
  window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
}

/**
 * Parses a JSON storage value or returns the fallback for null values.
 */
export function parseJson<T>(value: string | null, fallback: T): T {
  if (value === null) {
    return fallback;
  }
  return JSON.parse(value) as T;
}

/**
 * Returns window when running in the browser.
 */
export function getDefaultTarget(): Window | undefined {
  return typeof window === "undefined" ? undefined : window;
}
