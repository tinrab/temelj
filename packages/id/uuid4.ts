import id128 from "id128";

/** Max UUID4 value. */
export const UUID4_MAX: string = id128.Uuid4.MAX().toCanonical().toLowerCase();

/** Min UUID4 value. */
export const UUID4_MIN: string = id128.Uuid4.MIN().toCanonical().toLowerCase();

/** UUID4 encoded length. */
export const UUID4_LENGTH: number = 36;

/**
 * Generates a new UUID v4 string.
 *
 * @returns A new UUID v4 string.
 */
export function generateUuid4(): string {
  return id128.Uuid4.generate().toCanonical().toLowerCase();
}

/**
 * Checks if the given string is a valid UUID v4.
 *
 * @param id The string to check.
 * @returns `true` if the input is a valid UUID v4, `false` otherwise.
 */
export function isUuid4Valid(id: string): boolean {
  try {
    return !!id128.Uuid4.fromCanonical(id);
  } catch {
    return false;
  }
}

/**
 * Returns the byte array representation of the given UUID v4 string.
 *
 * @param id The UUID v4 string to convert.
 * @returns The byte array representation of the UUID v4 string.
 */
export function getUuid4Bytes(id: string): Uint8Array {
  const uuid = id128.Uuid4.fromCanonicalTrusted(id);
  return uuid.bytes;
}

/**
 * Constructs a UUID v4 string from the given byte array.
 *
 * @param bytes The byte array to construct the UUID v4 from.
 * @returns The UUID v4 string.
 */
export function makeUuid4FromBytes(bytes: Uint8Array): string {
  return id128.Uuid4.construct(bytes).toCanonical().toLowerCase();
}
