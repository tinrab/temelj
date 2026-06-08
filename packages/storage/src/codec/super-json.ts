import { parse as parseSuperJson, stringify as stringifySuperJson } from "superjson";

import { StorageSerializationError, type StorageCodec, type StorageValue } from "../types.ts";
import { textDecoder, textEncoder } from "./shared.ts";

export function createSuperJsonStorageCodec<TValue = StorageValue>(): StorageCodec<TValue> {
  return {
    encode(value) {
      try {
        return textEncoder.encode(stringifySuperJson(value));
      } catch (error) {
        throw new StorageSerializationError("encode", error);
      }
    },

    decode(bytes) {
      try {
        return parseSuperJson<TValue>(textDecoder.decode(bytes));
      } catch (error) {
        throw new StorageSerializationError("decode", error);
      }
    },
  };
}
