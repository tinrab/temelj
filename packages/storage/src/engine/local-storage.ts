import type {
  StorageEngine,
  StorageEngineCompareAndSetManyItem,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

import { bytesEqual, resolveExpiresAt } from "../utility.ts";

/**
 * Minimal Web Storage-compatible interface used by browser storage engines.
 */
export interface WebStorageLike {
  readonly length: number;
  clear(): void;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

/**
 * Options shared by localStorage and sessionStorage engines.
 */
export interface WebStorageEngineOptions {
  /**
   * Explicit storage object. Defaults to `globalThis.localStorage` or `globalThis.sessionStorage`.
   */
  readonly storage?: WebStorageLike;

  /**
   * Prefix namespace applied to all engine keys.
   */
  readonly namespace?: string;

  /**
   * Separator between namespace and key. Defaults to `":"`.
   */
  readonly separator?: string;
}

interface WebStorageRecord {
  readonly value: string;
  readonly expiresAt?: number;
}

class WebStorageEngine implements StorageEngine {
  readonly name: string;

  readonly #storage: WebStorageLike;
  readonly #prefix: string;

  constructor(name: string, storage: WebStorageLike | undefined, options: WebStorageEngineOptions) {
    if (storage === undefined) {
      throw new TypeError(`${name} is not available`);
    }

    const namespace = options.namespace ?? "";
    const separator = options.separator ?? ":";

    this.name = name;
    this.#storage = storage;
    this.#prefix = namespace.length === 0 ? "" : `${namespace}${separator}`;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const record = this.#readRecord(this.#prefixedKey(key));
    return record === undefined ? undefined : decodeBase64(record.value);
  }

  async set(key: string, value: Uint8Array, options?: StorageEngineSetOptions): Promise<void> {
    this.#writeRecord(this.#prefixedKey(key), value, resolveExpiresAt(options));
  }

  async compareAndSet(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
    options?: StorageEngineSetOptions,
  ): Promise<boolean> {
    const storageKey = this.#prefixedKey(key);
    const current = this.#readRecord(storageKey);
    if (!bytesEqual(current === undefined ? undefined : decodeBase64(current.value), expected)) {
      return false;
    }

    if (value === undefined) {
      this.#storage.removeItem(storageKey);
      return true;
    }

    this.#writeRecord(storageKey, value, resolveExpiresAt(options));
    return true;
  }

  async compareAndSetMany(items: readonly StorageEngineCompareAndSetManyItem[]): Promise<boolean> {
    const records = items.map((item) => ({
      ...item,
      storageKey: this.#prefixedKey(item.key),
    }));
    for (const item of records) {
      const current = this.#readRecord(item.storageKey);
      if (
        !bytesEqual(current === undefined ? undefined : decodeBase64(current.value), item.expected)
      ) {
        return false;
      }
    }

    for (const item of records) {
      if (item.value === undefined) {
        this.#storage.removeItem(item.storageKey);
      } else {
        this.#writeRecord(item.storageKey, item.value, resolveExpiresAt(item.options));
      }
    }
    return true;
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    for (const item of items) {
      await this.set(item.key, item.value, item.options);
    }
  }

  async delete(key: string): Promise<boolean> {
    const storageKey = this.#prefixedKey(key);
    const exists = this.#readRecord(storageKey) !== undefined;
    this.#storage.removeItem(storageKey);
    return exists;
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (await this.delete(key)) {
        deleted++;
      }
    }
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    return this.#readRecord(this.#prefixedKey(key)) !== undefined;
  }

  async keys(options?: StorageEngineKeyOptions): Promise<readonly string[]> {
    return this.#matchingKeys(options)
      .filter((key) => this.#readRecord(key) !== undefined)
      .map((key) => this.#unprefixKey(key));
  }

  async clear(options?: StorageEngineKeyOptions): Promise<void> {
    for (const key of this.#matchingKeys(options)) {
      this.#storage.removeItem(key);
    }
  }

  #prefixedKey(key: string): string {
    return `${this.#prefix}${key}`;
  }

  #unprefixKey(key: string): string {
    return this.#prefix.length === 0 ? key : key.slice(this.#prefix.length);
  }

  #readRecord(key: string): WebStorageRecord | undefined {
    const item = this.#storage.getItem(key);
    if (item === null) {
      return undefined;
    }

    const record = JSON.parse(item) as WebStorageRecord;
    if (record.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      this.#storage.removeItem(key);
      return undefined;
    }
    return record;
  }

  #writeRecord(key: string, value: Uint8Array, expiresAt: number | undefined): void {
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.#storage.removeItem(key);
      return;
    }
    this.#storage.setItem(key, JSON.stringify({ value: encodeBase64(value), expiresAt }));
  }

  #allStorageKeys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < this.#storage.length; index++) {
      const key = this.#storage.key(index);
      if (key !== null && key.startsWith(this.#prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }

  #matchingKeys(options: StorageEngineKeyOptions | undefined): string[] {
    const matchPrefix = this.#prefixedKey(options?.prefix ?? "");
    return this.#allStorageKeys().filter((key) => key.startsWith(matchPrefix));
  }
}

/**
 * Storage engine backed by the browser `localStorage` API.
 */
export class LocalStorageEngine extends WebStorageEngine {
  constructor(options: WebStorageEngineOptions = {}) {
    super("localStorage", options.storage ?? globalThis.localStorage, options);
  }
}

/**
 * Storage engine backed by the browser `sessionStorage` API.
 */
export class SessionStorageEngine extends WebStorageEngine {
  constructor(options: WebStorageEngineOptions = {}) {
    super("sessionStorage", options.storage ?? globalThis.sessionStorage, options);
  }
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

/**
 * Engine batch item types accepted by Web Storage operations.
 */
export type { StorageEngineCompareAndSetManyItem, StorageEngineSetManyItem };
