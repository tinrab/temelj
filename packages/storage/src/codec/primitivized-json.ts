import { primitivize } from "@temelj/value";

import { StorageSerializationError, type StorageCodec, type StorageValue } from "../types.ts";
import { textDecoder, textEncoder } from "./shared.ts";

export function createPrimitivizedJsonStorageCodec(): StorageCodec<StorageValue> {
  return {
    encode(value) {
      try {
        const serialized = JSON.stringify(primitivize(value));
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
        return JSON.parse(textDecoder.decode(bytes)) as StorageValue;
      } catch (error) {
        throw new StorageSerializationError("decode", error);
      }
    },
  };
}
