import { parse as parseSuperJson, stringify as stringifySuperJson } from "superjson";

import { StorageSerializationError, type StorageCodec, type StorageValue } from "../types.ts";
import {
  decodeFormatted,
  encodeFormatted,
  type FormattedStoredValue,
  type StorageCodecFormat,
} from "./shared.ts";
import { registerTemporalStorageSerialization } from "./temporal.ts";

registerTemporalStorageSerialization();

/**
 * Creates a codec for rich JavaScript and Temporal values using SuperJSON.
 */
export function createSuperJsonStorageCodec<TValue = StorageValue>(): StorageCodec<TValue, string>;
export function createSuperJsonStorageCodec<
  TValue = StorageValue,
  TFormat extends StorageCodecFormat = "string",
>(options: { readonly format: TFormat }): StorageCodec<TValue, FormattedStoredValue<TFormat>>;
export function createSuperJsonStorageCodec<TValue = StorageValue>(
  options: { readonly format: StorageCodecFormat } = { format: "string" },
): StorageCodec<TValue, string | Uint8Array> {
  const format = options.format ?? "string";

  return {
    encode(value) {
      try {
        return encodeFormatted(stringifySuperJson(value), format);
      } catch (error) {
        StorageSerializationError.encode(error);
      }
    },

    decode(value) {
      try {
        return parseSuperJson<TValue>(decodeFormatted(value));
      } catch (error) {
        StorageSerializationError.decode(error);
      }
    },
  };
}
