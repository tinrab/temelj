import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

export interface WebStorageLike {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface WebStorageEngineOptions {
  readonly storage?: WebStorageLike;
  readonly namespace?: string;
  readonly separator?: string;
}

interface WebStorageRecord {
  readonly value: string;
  readonly expiresAt?: number;
}

export function createLocalStorageEngine(options: WebStorageEngineOptions = {}): StorageEngine {
  return createWebStorageEngine(
    "localStorage",
    options.storage ?? globalThis.localStorage,
    options,
  );
}

export function createSessionStorageEngine(options: WebStorageEngineOptions = {}): StorageEngine {
  return createWebStorageEngine(
    "sessionStorage",
    options.storage ?? globalThis.sessionStorage,
    options,
  );
}

function createWebStorageEngine(
  name: string,
  storage: WebStorageLike | undefined,
  options: WebStorageEngineOptions,
): StorageEngine {
  if (storage === undefined) {
    throw new TypeError(`${name} is not available`);
  }

  const namespace = options.namespace ?? "";
  const separator = options.separator ?? ":";
  const prefix = namespace.length === 0 ? "" : `${namespace}${separator}`;
  const prefixedKey = (key: string): string => `${prefix}${key}`;
  const unprefixKey = (key: string): string =>
    prefix.length === 0 ? key : key.slice(prefix.length);

  const readRecord = (key: string): WebStorageRecord | undefined => {
    const item = storage.getItem(key);
    if (item === null) {
      return undefined;
    }

    const record = JSON.parse(item) as WebStorageRecord;
    if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      storage.removeItem(key);
      return undefined;
    }
    return record;
  };

  const allStorageKeys = (): string[] => {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key !== null && key.startsWith(prefix)) {
        keys.push(key);
      }
    }
    return keys;
  };

  const matchingKeys = (keyOptions: StorageEngineKeyOptions | undefined): string[] => {
    const matchPrefix = prefixedKey(keyOptions?.prefix ?? "");
    return allStorageKeys().filter((key) => key.startsWith(matchPrefix));
  };

  return {
    name,

    async get(key) {
      const record = readRecord(prefixedKey(key));
      return record === undefined ? undefined : decodeBase64(record.value);
    },

    async set(key, value, setOptions) {
      const storageKey = prefixedKey(key);
      const expiresAt = resolveExpiresAt(setOptions);
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        storage.removeItem(storageKey);
        return;
      }
      storage.setItem(storageKey, JSON.stringify({ value: encodeBase64(value), expiresAt }));
    },

    async setMany(items) {
      for (const item of items) {
        await this.set(item.key, item.value, item.options);
      }
    },

    async delete(key) {
      const storageKey = prefixedKey(key);
      const exists = readRecord(storageKey) !== undefined;
      storage.removeItem(storageKey);
      return exists;
    },

    async deleteMany(keys) {
      let deleted = 0;
      for (const key of keys) {
        if (await this.delete(key)) {
          deleted++;
        }
      }
      return deleted;
    },

    async has(key) {
      return readRecord(prefixedKey(key)) !== undefined;
    },

    async keys(keyOptions) {
      return matchingKeys(keyOptions)
        .filter((key) => readRecord(key) !== undefined)
        .map((key) => unprefixKey(key));
    },

    async clear(keyOptions) {
      for (const key of matchingKeys(keyOptions)) {
        storage.removeItem(key);
      }
    },
  };
}

function resolveExpiresAt(options: StorageEngineSetOptions | undefined): number | undefined {
  return options?.ttl === undefined ? undefined : Date.now() + options.ttl;
}

function encodeBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export type { StorageEngineSetManyItem };
