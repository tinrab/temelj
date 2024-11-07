import id128 from "id128";

export interface UlidOptions {
  time?: Date;
  random?: Uint8Array;
}

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

export function generateUlidMultiple(
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

export function isUlidValid(id: string): boolean {
  try {
    return !!id128.Ulid.fromCanonical(id);
  } catch {
    return false;
  }
}

export function getUlidBytes(id: string): Uint8Array {
  const ulid = id128.Ulid.fromCanonicalTrusted(id);
  return ulid.bytes;
}

export function makeUlidFromBytes(bytes: Uint8Array): string {
  return id128.Ulid.construct(bytes).toCanonical();
}
