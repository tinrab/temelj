import { useStorage, type StorageCodec, type StorageControls } from "../internal/use-storage.ts";

export type { StorageCodec, StorageControls } from "../internal/use-storage.ts";

/** Stores validated domain values in localStorage and subscribes to storage changes. */
export function useLocalStorage<T>(
  key: string,
  initialValue: T,
  codec: StorageCodec<T>,
): [T, StorageControls<T>] {
  return useStorage("localStorage", key, initialValue, codec);
}
