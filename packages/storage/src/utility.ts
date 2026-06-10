import { StorageEngineSetOptions } from "./types.ts";

export function bytesEqual(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return left.every((byte, index) => byte === right[index]);
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
