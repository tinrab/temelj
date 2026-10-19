import { isString, isNumber, isBigInt } from "@temelj/value";

import { type StoredValue, StorageEngineSetOptions } from "./types.ts";

export function bytesEqual(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }

  if (left.byteLength !== right.byteLength) {
    return false;
  }

  return left.every((byte, index) => byte === right[index]);
}

export function storedValuesEqual(
  left: StoredValue | undefined,
  right: StoredValue | undefined,
): boolean {
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return bytesEqual(left, right);
  }

  return left === right;
}

export function resolveExpiresAt(
  options: StorageEngineSetOptions | undefined,
  now = Date.now(),
): number | undefined {
  return options?.ttl === undefined ? undefined : now + options.ttl;
}

export function isExpired(time: number | string | bigint | null): boolean {
  return time !== null && Number(time) <= Date.now();
}

export function toUint8Array(value: ArrayBuffer | Uint8Array | Buffer): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value).slice();
  }

  if (value instanceof Buffer) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }

  return new Uint8Array(value).slice();
}

export function toBuffer(value: Uint8Array): Buffer {
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

export type StoredValueFormat = "string" | "number" | "bytes";

export type StoredValueForFormat<TFormat extends StoredValueFormat> = TFormat extends "bytes"
  ? Uint8Array
  : TFormat extends "number"
    ? number
    : string;

export type DatabaseStoredValue = StoredValue | ArrayBuffer | bigint | null;

export function isDatabaseStoredValue(value: unknown): value is DatabaseStoredValue {
  return (
    value === null ||
    isString(value) ||
    isNumber(value) ||
    isBigInt(value) ||
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer
  );
}

export function parseDatabaseRows<TRow>(
  rows: readonly unknown[],
  isRow: (value: unknown) => value is TRow,
): TRow[] {
  return rows.map((row) => {
    if (!isRow(row)) {
      throw new TypeError("Database returned an invalid row");
    }

    return row;
  });
}

export function normalizeStoredValue<TFormat extends StoredValueFormat>(
  value: DatabaseStoredValue,
  format: TFormat,
): StoredValueForFormat<TFormat> {
  const normalized =
    value instanceof Uint8Array || value instanceof ArrayBuffer ? toUint8Array(value) : value;

  if (
    (format === "bytes" && normalized instanceof Uint8Array) ||
    (format === "string" && isString(normalized)) ||
    (format === "number" && isNumber(normalized))
  ) {
    // SAFETY: Each runtime format branch checks exactly the corresponding conditional return type.
    return normalized as StoredValueForFormat<TFormat>;
  }

  throw new TypeError("Database value does not match the requested " + format + " format");
}

export function storedValueParameter(value: StoredValue): StoredValue | Buffer {
  return value instanceof Uint8Array ? toBuffer(value) : value;
}

export function chunkArray<TItem>(
  items: readonly TItem[],
  size: number,
): readonly (readonly TItem[])[] {
  const chunks: TItem[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
