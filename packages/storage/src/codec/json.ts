import { StorageSerializationError, type JsonStorageValue, type StorageCodec } from "../types.ts";
import {
  decodeFormatted,
  encodeFormatted,
  type FormattedStoredValue,
  type StorageCodecFormat,
} from "./shared.ts";

/**
 * Creates a codec that serializes JSON-compatible values with `JSON.stringify`.
 */
export function createJsonStorageCodec(): StorageCodec<JsonStorageValue, string>;
export function createJsonStorageCodec<TFormat extends StorageCodecFormat>(options: {
  readonly format: TFormat;
}): StorageCodec<JsonStorageValue, FormattedStoredValue<TFormat>>;
export function createJsonStorageCodec(
  options: { readonly format: StorageCodecFormat } = { format: "string" },
): StorageCodec<JsonStorageValue, string | Uint8Array> {
  const format = options.format ?? "string";

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

      return encodeFormatted(serialized, format);
    },

    decode(value) {
      try {
        // SAFETY: JSON.parse accepts only JSON syntax, whose values are exactly JsonStorageValue.
        return JSON.parse(decodeFormatted(value)) as JsonStorageValue;
      } catch (error) {
        StorageSerializationError.decode(error);
      }
    },
  };
}
