export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

export type StorageCodecFormat = "string" | "bytes";
export type FormattedStoredValue<TFormat extends StorageCodecFormat> = TFormat extends "bytes"
  ? Uint8Array
  : string;

export function encodeFormatted<TFormat extends StorageCodecFormat>(
  value: string,
  format: TFormat,
): FormattedStoredValue<TFormat> {
  return (format === "bytes" ? textEncoder.encode(value) : value) as FormattedStoredValue<TFormat>;
}

export function decodeFormatted(value: string | Uint8Array): string {
  return typeof value === "string" ? value : textDecoder.decode(value);
}
