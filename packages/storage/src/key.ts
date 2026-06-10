import { StorageKeyError } from "./types.ts";

export function normalizeStorageKey(key: string): string {
  if (key.length === 0) {
    throw StorageKeyError.invalidFormat(key);
  }

  if (key.includes("\0")) {
    throw StorageKeyError.nullBytes(key);
  }

  return key;
}

export function normalizeStoragePrefix(prefix: string | undefined): string | undefined {
  if (prefix === undefined) {
    return undefined;
  }

  if (prefix.includes("\0")) {
    throw StorageKeyError.nullBytes(prefix);
  }

  return prefix;
}

export function resolveTtl(
  options: { readonly ttl?: number; readonly expiresAt?: Date } | undefined,
): number | undefined {
  if (options?.ttl !== undefined) {
    if (!Number.isFinite(options.ttl) || options.ttl < 0) {
      throw StorageKeyError.invalidTtl();
    }
    return options.ttl;
  }

  if (options?.expiresAt === undefined) {
    return undefined;
  }

  const expiresAt = options.expiresAt.getTime();
  if (!Number.isFinite(expiresAt)) {
    throw StorageKeyError.invalidExpiresAt();
  }

  const ttl = expiresAt - Date.now();
  return Math.max(0, ttl);
}
