import { IdFormatError } from "./errors";

/** Min UUID4 value. */
export const UUID4_MIN: string = "00000000-0000-4000-8000-000000000000";

/** Max UUID4 value. */
export const UUID4_MAX: string = "ffffffff-ffff-4fff-bfff-ffffffffffff";

/** UUID4 encoded length. */
export const UUID4_LENGTH: number = 36;

const UUID4_BYTE_LENGTH = 16;

const UUID4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Generates a new UUID v4 string.
 *
 * @returns A new UUID v4 string.
 */
export function generateUuid4(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(UUID4_BYTE_LENGTH));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  return encodeUuid4(bytes);
}

/**
 * Checks if the given string is a valid UUID v4.
 *
 * @param id The string to check.
 * @returns `true` if the input is a valid UUID v4, `false` otherwise.
 */
export function isUuid4Valid(id: string): boolean {
  return UUID4_PATTERN.test(id);
}

/**
 * Returns the byte array representation of the given UUID v4 string.
 *
 * @param id The UUID v4 string to convert.
 * @returns The byte array representation of the UUID v4 string.
 */
export function getUuid4Bytes(id: string): Uint8Array {
  if (!isUuid4Valid(id)) {
    IdFormatError.invalidUuid4();
  }

  const hex = id.replaceAll("-", "");
  const bytes = new Uint8Array(UUID4_BYTE_LENGTH);

  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}

/**
 * Constructs a UUID v4 string from the given byte array.
 *
 * @param bytes The byte array to construct the UUID v4 from.
 * @returns The UUID v4 string.
 */
export function makeUuid4FromBytes(bytes: Uint8Array): string {
  if (bytes.length !== UUID4_BYTE_LENGTH) {
    IdFormatError.invalidByteLength(bytes.length);
  }

  const id = encodeUuid4(bytes);

  if (!isUuid4Valid(id)) {
    IdFormatError.invalidUuid4();
  }

  return id;
}

function encodeUuid4(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
