import type { StorageCodec, StoredValue } from "../types.ts";

function copyStoredValue<TValue extends StoredValue>(value: TValue): TValue {
  return (value instanceof Uint8Array ? value.slice() : value) as TValue;
}

/** Creates a pass-through codec for an exact persisted value type. */
export function createIdentityStorageCodec<
  TValue extends StoredValue = StoredValue,
>(): StorageCodec<TValue, TValue> {
  return { encode: copyStoredValue, decode: copyStoredValue };
}
