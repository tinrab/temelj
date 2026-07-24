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
export function createSuperJsonStorageCodec<
  TValue = StorageValue,
  TFormat extends StorageCodecFormat = "string",
>(
  options: { readonly format?: TFormat } = {},
): StorageCodec<TValue, FormattedStoredValue<TFormat>> {
  const format = options.format ?? "string";
  return {
    encode(value) {
      try {
        return encodeFormatted(stringifySuperJson(value), format as TFormat);
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
