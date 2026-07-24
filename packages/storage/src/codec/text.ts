import { StorageSerializationError, type StorageCodec } from "../types.ts";
import { textDecoder, textEncoder } from "./shared.ts";

/**
 * Creates a UTF-8 text codec for string values.
 */
export function createTextStorageCodec(): StorageCodec<string> {
  return {
    encode(value) {
      try {
        return textEncoder.encode(value);
      } catch (error) {
        StorageSerializationError.encode(error);
      }
    },

    decode(bytes) {
      try {
        return textDecoder.decode(bytes);
      } catch (error) {
        StorageSerializationError.decode(error);
      }
    },
  };
}
