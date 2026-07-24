import { parse as parseSuperJson, stringify as stringifySuperJson } from "superjson";

import { StorageSerializationError, type StorageCodec, type StorageValue } from "../types.ts";
import { textDecoder, textEncoder } from "./shared.ts";
import { registerTemporalStorageSerialization } from "./temporal.ts";

registerTemporalStorageSerialization();

/**
 * Creates a codec for rich JavaScript and Temporal values using SuperJSON.
 */
export function createSuperJsonStorageCodec<TValue = StorageValue>(): StorageCodec<TValue> {
  return {
    encode(value) {
      try {
        return textEncoder.encode(stringifySuperJson(value));
      } catch (error) {
        StorageSerializationError.encode(error);
      }
    },

    decode(bytes) {
      try {
        return parseSuperJson<TValue>(textDecoder.decode(bytes));
      } catch (error) {
        StorageSerializationError.decode(error);
      }
    },
  };
}
