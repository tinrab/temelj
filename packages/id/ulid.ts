import id128 from "id128";

/**
 * Options for generating ULIDs.
 * Used in {@linkcode generateUlid} and {@linkcode generateUlidList}.
 */
export interface UlidOptions {
  /**
   * The time to use for generating the ULID.
   */
  time?: Date;
  /**
   * The random bytes to use for generating the ULID.
   */
  random?: Uint8Array;
}

/**
 * Generates a new ULID string.
 *
 * @param options The options to use for generating the ULID.
 * @returns The generated ULID string.
 */
export function generateUlid(options: UlidOptions = {}): string {
  if (options.random !== undefined) {
    if (options.random.length !== 10) {
      throw new Error("Invalid random bytes");
    }

    const buffer = new Uint8Array(16);
    buffer.set(options.random, 6);

    const time = options.time === undefined
      ? Date.now()
      : options.time.getTime();
    buffer.set([
      (time >> 40) & 0xff,
      (time >> 32) & 0xff,
      (time >> 24) & 0xff,
      (time >> 16) & 0xff,
      (time >> 8) & 0xff,
      time & 0xff,
    ], 0);

    return id128.Ulid.construct(buffer).toCanonical();
  }

  return id128.Ulid.generate({ ...options }).toCanonical();
}

/**
 * Generates multiple ULIDs in a monotonically increasing sequence.
 *
 * When generating ULIDs within the same millisecond, the random component is incremented by 1 bit
 * in the least significant bit position (with carrying) to ensure strict monotonicity.
 * For example, two ULIDs generated in the same millisecond might look like:
 * - 01BX5ZZKBKACTAV9WEVGEMMVRZ
 * - 01BX5ZZKBKACTAV9WEVGEMMVS0
 *
 * **Note**: If more than 2^80 ULIDs are generated within the same millisecond, or if the random
 * component overflows, the generation will fail.
 *
 * @param count The number of ULIDs to generate.
 * @param options The options to use for generating the ULIDs.
 * @returns The generated ULID strings.
 */
export function generateUlidList(
  count: number,
  options: UlidOptions = {},
): string[] {
  if (options.random !== undefined) {
    throw new Error(
      "Cannot generate multiple ULIDs with the same random bytes",
    );
  }

  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push(id128.UlidMonotonic.generate({ ...options }).toCanonical());
  }
  return ids;
}

/**
 * Checks if the given string is a valid ULID.
 *
 * @param id The string to check.
 * @returns `true` if the input is a valid ULID, `false` otherwise.
 */
export function isUlidValid(id: string): boolean {
  try {
    return !!id128.Ulid.fromCanonical(id);
  } catch {
    return false;
  }
}

/**
 * Returns the byte array representation of the given ULID string.
 *
 * @param id The ULID string to convert.
 * @returns The byte array representation of the ULID string.
 */
export function getUlidBytes(id: string): Uint8Array {
  const ulid = id128.Ulid.fromCanonicalTrusted(id);
  return ulid.bytes;
}

/**
 * Constructs a ULID string from the given byte array.
 *
 * @param bytes The byte array to construct the ULID from.
 * @returns The ULID string.
 */
export function makeUlidFromBytes(bytes: Uint8Array): string {
  return id128.Ulid.construct(bytes).toCanonical();
}
