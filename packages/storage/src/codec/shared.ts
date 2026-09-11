export const textEncoder = new TextEncoder();

export const textDecoder = new TextDecoder();

export type StorageCodecFormat = "string" | "bytes";

export type FormattedStoredValue<TFormat extends StorageCodecFormat> = TFormat extends "bytes"
  ? Uint8Array
  : string;

export function encodeFormatted(value: string, format: StorageCodecFormat): string | Uint8Array {
  return format === "bytes" ? textEncoder.encode(value) : value;
}

export function decodeFormatted(value: string | Uint8Array): string {
  return value instanceof Uint8Array ? textDecoder.decode(value) : value;
}
