import { StorageSerializationError, type JsonStorageValue, type StorageCodec } from "../types.ts";
import { textDecoder, textEncoder } from "./shared.ts";

/**
 * Creates a codec that serializes JSON-compatible values with `JSON.stringify`.
 */
export function createJsonStorageCodec<
  TValue extends JsonStorageValue = JsonStorageValue,
>(): StorageCodec<TValue> {
  return {
    encode(value) {
      try {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) {
          throw new TypeError("Storage values must be JSON serializable");
        }
        return textEncoder.encode(serialized);
      } catch (error) {
        throw new StorageSerializationError("encode", error);
      }
    },

    decode(bytes) {
      try {
        return JSON.parse(textDecoder.decode(bytes)) as TValue;
      } catch (error) {
        throw new StorageSerializationError("decode", error);
      }
    },
  };
}
