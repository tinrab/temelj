import type { StorageValue } from "@temelj/storage";

export function toStorageValue(value: unknown): StorageValue {
  // Workflow payload types are user-defined.
  // Runtime serialization is delegated to @temelj/storage.
  return value as StorageValue;
}
