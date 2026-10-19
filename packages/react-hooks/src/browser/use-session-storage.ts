import { useStorage, type StorageCodec, type StorageControls } from "../internal/use-storage.ts";

/** Stores validated domain values in sessionStorage and subscribes to storage changes. */
export function useSessionStorage<T>(
  key: string,
  initialValue: T,
  codec: StorageCodec<T>,
): [T, StorageControls<T>] {
  return useStorage("sessionStorage", key, initialValue, codec);
}
