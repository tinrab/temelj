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

export function normalizeStoredValue<TStoredValue extends StoredValue>(
  value: unknown,
): TStoredValue {
  if (
    value instanceof Uint8Array ||
    value instanceof ArrayBuffer ||
    (typeof Buffer !== "undefined" && value instanceof Buffer)
  ) {
    return toUint8Array(value) as TStoredValue;
  }
  if (typeof value === "string" || typeof value === "number") {
    return value as TStoredValue;
  }
  throw new TypeError("Database returned an unsupported stored value");
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
