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
export function createJsonStorageCodec<
  TValue extends JsonStorageValue = JsonStorageValue,
  TFormat extends StorageCodecFormat = "string",
>(
  options: { readonly format?: TFormat } = {},
): StorageCodec<TValue, FormattedStoredValue<TFormat>> {
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
      return encodeFormatted(serialized, format as TFormat);
    },

    decode(value) {
      try {
        return JSON.parse(decodeFormatted(value)) as TValue;
      } catch (error) {
        StorageSerializationError.decode(error);
      }
    },
  };
}
