import { IdFormatError, IdOptionsError } from "./errors";

const ULID_BYTE_LENGTH = 16;

const ULID_RANDOM_OFFSET = 6;

const ULID_MAX_TIME = 2 ** 48;

/** Crockford's Base32 alphabet. */
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Decoding is case-insensitive and maps the ambiguous `I`, `L`, and `O` to their digits. */
const ULID_DECODING: ReadonlyMap<string, number> = createUlidDecoding();

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
  const time = options.time === undefined ? Date.now() : getUlidTime(options.time);

  if (options.random !== undefined && options.random.length !== 10) {
    IdOptionsError.invalidUlidRandomBytes();
  }

  return encodeUlid(createUlidBytes(time, options.random));
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
  const fixedTime = options.time === undefined ? undefined : getUlidTime(options.time);

  if (!Number.isSafeInteger(count) || count < 0) {
    IdOptionsError.invalidUlidCount();
  }

  if (options.random !== undefined) {
    IdOptionsError.ulidListRandomBytesUnsupported();
  }

  const ids: string[] = [];
  let bytes: Uint8Array | undefined;
  let previousTime = -1;

  for (let i = 0; i < count; i++) {
    const time = fixedTime ?? Date.now();

    // A clock that stalls or moves backwards keeps the previous timestamp.
    if (bytes !== undefined && time <= previousTime) {
      incrementUlidRandom(bytes);
    } else {
      bytes = createUlidBytes(time);
      previousTime = time;
    }

    ids.push(encodeUlid(bytes));
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
  return decodeUlid(id) !== undefined;
}

/**
 * Returns the byte array representation of the given ULID string.
 *
 * @param id The ULID string to convert.
 * @returns The byte array representation of the ULID string.
 */
export function getUlidBytes(id: string): Uint8Array {
  return decodeUlid(id) ?? IdFormatError.invalidUlid();
}

/**
 * Constructs a ULID string from the given byte array.
 *
 * @param bytes The byte array to construct the ULID from.
 * @returns The ULID string.
 */
export function makeUlidFromBytes(bytes: Uint8Array): string {
  if (bytes.length !== ULID_BYTE_LENGTH) {
    IdFormatError.invalidByteLength(bytes.length);
  }

  return encodeUlid(bytes);
}

function getUlidTime(time: Date): number {
  const milliseconds = time.getTime();

  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds >= ULID_MAX_TIME) {
    IdOptionsError.invalidUlidTime();
  }

  return milliseconds;
}

function createUlidBytes(time: number, random?: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(ULID_BYTE_LENGTH);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, Math.floor(time / 2 ** 32));
  view.setUint32(2, time % 2 ** 32);

  if (random === undefined) {
    crypto.getRandomValues(bytes.subarray(ULID_RANDOM_OFFSET));
  } else {
    bytes.set(random, ULID_RANDOM_OFFSET);
  }

  return bytes;
}

function incrementUlidRandom(bytes: Uint8Array): void {
  for (let i = ULID_BYTE_LENGTH - 1; i >= ULID_RANDOM_OFFSET; i--) {
    if (bytes[i] !== 0xff) {
      bytes[i]++;

      return;
    }

    bytes[i] = 0;
  }

  IdOptionsError.ulidRandomOverflow();
}

function createUlidDecoding(): Map<string, number> {
  const decoding = new Map<string, number>([
    ["I", 1],
    ["L", 1],
    ["O", 0],
  ]);

  for (const [value, char] of ULID_ALPHABET.split("").entries()) {
    decoding.set(char, value);
  }

  // Copy the entries so the loop doesn't visit the lowercase keys it adds.
  for (const [char, value] of Array.from(decoding)) {
    decoding.set(char.toLowerCase(), value);
  }

  return decoding;
}

function encodeUlid(bytes: Uint8Array): string {
  let id = "";
  let buffer = 0;
  // 26 characters hold 130 bits, so the 128-bit value starts with 2 zero bits.
  let bits = 2;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      id += ULID_ALPHABET[(buffer >>> bits) & 0b11111];
    }
  }

  return id;
}

function decodeUlid(id: string): Uint8Array | undefined {
  const first = ULID_DECODING.get(id.charAt(0));

  // The first character only carries the top 3 bits.
  if (id.length !== 26 || first === undefined || first > 7) {
    return undefined;
  }

  const bytes = new Uint8Array(ULID_BYTE_LENGTH);
  let buffer = 0;
  let bits = -2;
  let offset = 0;

  for (const char of id) {
    const value = ULID_DECODING.get(char);

    if (value === undefined) {
      return undefined;
    }

    buffer = (buffer << 5) | value;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = buffer >>> bits;
    }
  }

  return bytes;
}
