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
export function createPrimitivizedJsonStorageCodec(): StorageCodec<StorageValue, string>;
export function createPrimitivizedJsonStorageCodec<TFormat extends StorageCodecFormat>(options: {
  readonly format: TFormat;
}): StorageCodec<StorageValue, FormattedStoredValue<TFormat>>;
export function createPrimitivizedJsonStorageCodec(
  options: { readonly format: StorageCodecFormat } = { format: "string" },
): StorageCodec<StorageValue, string | Uint8Array> {
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

      return encodeFormatted(serialized, format);
    },

    decode(value) {
      try {
        // SAFETY: JSON.parse produces JSON values, all of which belong to StorageValue.
        return JSON.parse(decodeFormatted(value)) as StorageValue;
      } catch (error) {
        StorageSerializationError.decode(error);
      }
    },
  };
}
