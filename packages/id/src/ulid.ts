import id128 from "id128";

import { IdOptionsError } from "./errors";

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
  assertUlidTime(options.time);

  if (options.random !== undefined) {
    if (options.random.length !== 10) {
      IdOptionsError.invalidUlidRandomBytes();
    }

    const buffer = new Uint8Array(16);
    buffer.set(options.random, 6);

    const time = options.time === undefined ? Date.now() : options.time.getTime();

    if (!Number.isSafeInteger(time) || time < 0 || time >= 2 ** 48) {
      IdOptionsError.invalidUlidTime();
    }

    const view = new DataView(buffer.buffer);
    view.setUint16(0, Math.floor(time / 2 ** 32));
    view.setUint32(2, time % 2 ** 32);

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
export function generateUlidList(count: number, options: UlidOptions = {}): string[] {
  assertUlidTime(options.time);

  if (!Number.isSafeInteger(count) || count < 0) {
    IdOptionsError.invalidUlidCount();
  }

  if (options.random !== undefined) {
    IdOptionsError.ulidListRandomBytesUnsupported();
  }

  const ids = [];

  for (let i = 0; i < count; i++) {
    ids.push(id128.UlidMonotonic.generate({ ...options }).toCanonical());
  }

  return ids;
}

function assertUlidTime(time: Date | undefined): void {
  if (time === undefined) {
    return;
  }

  const milliseconds = time.getTime();

  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds >= 2 ** 48) {
    IdOptionsError.invalidUlidTime();
  }
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
