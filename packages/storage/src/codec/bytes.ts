import { StorageSerializationError, type StorageCodec } from "../types.ts";

export function createBytesStorageCodec(): StorageCodec<Uint8Array> {
  return {
    encode(value) {
      try {
        return value.slice();
      } catch (error) {
        throw new StorageSerializationError("encode", error);
      }
    },

    decode(bytes) {
      try {
        return bytes.slice();
      } catch (error) {
        throw new StorageSerializationError("decode", error);
      }
    },
  };
}
