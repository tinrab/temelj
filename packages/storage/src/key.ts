import { StorageKeyError } from "./types.ts";

export function normalizeStorageKey(key: string): string {
  if (key.length === 0) {
    throw new StorageKeyError(key);
  }

  if (key.includes("\0")) {
    throw new StorageKeyError(key, "Storage key must not contain null bytes");
  }

  return key;
}

export function normalizeStoragePrefix(prefix: string | undefined): string | undefined {
  if (prefix === undefined) {
    return undefined;
  }

  if (prefix.includes("\0")) {
    throw new StorageKeyError(prefix, "Storage key prefix must not contain null bytes");
  }

  return prefix;
}

export function resolveTtl(
  options: { readonly ttl?: number; readonly expiresAt?: Date } | undefined,
): number | undefined {
  if (options?.ttl !== undefined) {
    if (!Number.isFinite(options.ttl) || options.ttl < 0) {
      throw new StorageKeyError("", "Storage ttl must be a finite non-negative number");
    }
    return options.ttl;
  }

  if (options?.expiresAt === undefined) {
    return undefined;
  }

  const expiresAt = options.expiresAt.getTime();
  if (!Number.isFinite(expiresAt)) {
    throw new StorageKeyError("", "Storage expiresAt must be a valid date");
  }

  const ttl = expiresAt - Date.now();
  return Math.max(0, ttl);
}
