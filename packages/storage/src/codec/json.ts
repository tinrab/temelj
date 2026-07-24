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
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(value);
      } catch (error) {
        StorageSerializationError.encode(error);
      }
      if (serialized === undefined) {
        StorageSerializationError.encode("Storage values must be JSON serializable");
      }
      return textEncoder.encode(serialized);
    },

    decode(bytes) {
      try {
        return JSON.parse(textDecoder.decode(bytes)) as TValue;
      } catch (error) {
        StorageSerializationError.decode(error);
      }
    },
  };
}
