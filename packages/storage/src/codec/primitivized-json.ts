import { primitivize } from "@temelj/value";

import { StorageSerializationError, type StorageCodec, type StorageValue } from "../types.ts";
import { textDecoder, textEncoder } from "./shared.ts";

/**
 * Creates a codec that primitivizes rich values before JSON serialization.
 */
export function createPrimitivizedJsonStorageCodec(): StorageCodec<StorageValue> {
  return {
    encode(value) {
      let serialized: string | undefined;
      try {
        serialized = JSON.stringify(primitivize(value));
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
        return JSON.parse(textDecoder.decode(bytes)) as StorageValue;
      } catch (error) {
        StorageSerializationError.decode(error);
      }
    },
  };
}
