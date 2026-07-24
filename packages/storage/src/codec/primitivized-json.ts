import { primitivize } from "@temelj/value";

import { StorageSerializationError, type StorageCodec, type StorageValue } from "../types.ts";
import {
  decodeFormatted,
  encodeFormatted,
  type FormattedStoredValue,
  type StorageCodecFormat,
} from "./shared.ts";

/**
 * Creates a codec that primitivizes rich values before JSON serialization.
 */
export function createPrimitivizedJsonStorageCodec<TFormat extends StorageCodecFormat = "string">(
  options: { readonly format?: TFormat } = {},
): StorageCodec<StorageValue, FormattedStoredValue<TFormat>> {
  const format = options.format ?? "string";
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
      return encodeFormatted(serialized, format as TFormat);
    },

    decode(value) {
      try {
        return JSON.parse(decodeFormatted(value)) as StorageValue;
      } catch (error) {
        StorageSerializationError.decode(error);
      }
    },
  };
}
