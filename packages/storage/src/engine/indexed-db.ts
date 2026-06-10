import type {
  StorageEngine,
  StorageEngineCompareAndSetManyItem,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

import { bytesEqual, resolveExpiresAt } from "../utility.ts";

/**
 * Minimal IndexedDB factory interface used by {@link IndexedDbStorageEngine}.
 */
export interface IndexedDbFactory {
  open(name: string, version?: number): IndexedDbOpenRequest;
}

/**
 * Minimal IndexedDB open request interface used by the engine.
 */
export interface IndexedDbOpenRequest extends IndexedDbRequest<IndexedDbDatabase> {
  onupgradeneeded: ((event: unknown) => void) | null;
}

/**
 * Minimal IndexedDB request interface used by the engine.
 */
export interface IndexedDbRequest<TResult> {
  readonly error: unknown;
  readonly result: TResult;
  onerror: ((event: unknown) => void) | null;
  onsuccess: ((event: unknown) => void) | null;
}

/**
 * Minimal IndexedDB database interface used by the engine.
 */
export interface IndexedDbDatabase {
  readonly objectStoreNames: {
    contains(name: string): boolean;
  };
  close(): void;
  createObjectStore(name: string): unknown;
  transaction(
    storeName: string,
    mode: "readonly" | "readwrite",
  ): {
    objectStore(name: string): IndexedDbObjectStore;
  };
}

/**
 * Minimal IndexedDB object store interface used by the engine.
 */
export interface IndexedDbObjectStore {
  delete(key: string): IndexedDbRequest<undefined>;
  get(key: string): IndexedDbRequest<unknown>;
  getAllKeys(): IndexedDbRequest<unknown[]>;
  put(value: unknown, key: string): IndexedDbRequest<unknown>;
}

/**
 * Options for {@link IndexedDbStorageEngine}.
 */
export interface IndexedDbEngineOptions {
  /**
   * IndexedDB factory. Defaults to `globalThis.indexedDB`.
   */
  readonly indexedDB?: IndexedDbFactory;

  /**
   * Database name. Defaults to `"temelj-storage"`.
   */
  readonly databaseName?: string;

  /**
   * Object store name. Defaults to `"entries"`.
   */
  readonly storeName?: string;

  /**
   * Prefix namespace applied to all engine keys.
   */
  readonly namespace?: string;

  /**
   * Separator between namespace and key. Defaults to `":"`.
   */
  readonly separator?: string;
}

interface IndexedDbRecord {
  readonly value: Uint8Array;
  readonly expiresAt?: number;
}

/**
 * Storage engine backed by an IndexedDB object store.
 */
export class IndexedDbStorageEngine implements StorageEngine {
  readonly name = "indexedDB";

  readonly #factory: IndexedDbFactory;
  readonly #databaseName: string;
  readonly #storeName: string;
  readonly #prefix: string;
  #databasePromise: Promise<IndexedDbDatabase> | undefined;

  constructor(options: IndexedDbEngineOptions = {}) {
    const factory =
      options.indexedDB ??
      (globalThis as typeof globalThis & { readonly indexedDB?: IndexedDbFactory }).indexedDB;
    if (factory === undefined) {
      throw new TypeError("indexedDB is not available");
    }

    const namespace = options.namespace ?? "";
    const separator = options.separator ?? ":";

    this.#factory = factory;
    this.#databaseName = options.databaseName ?? "temelj-storage";
    this.#storeName = options.storeName ?? "entries";
    this.#prefix = namespace.length === 0 ? "" : `${namespace}${separator}`;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const record = await this.#readRecord(this.#prefixedKey(key));
    return record === undefined ? undefined : record.value.slice();
  }

  async set(key: string, value: Uint8Array, setOptions?: StorageEngineSetOptions): Promise<void> {
    const storageKey = this.#prefixedKey(key);
    const expiresAt = resolveExpiresAt(setOptions);
    const database = await this.#getDatabase();
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await deleteRecord(database, this.#storeName, storageKey);
      return;
    }
    await requestResult(
      database
        .transaction(this.#storeName, "readwrite")
        .objectStore(this.#storeName)
        .put({ value: value.slice(), expiresAt }, storageKey),
    );
  }

  async compareAndSet(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
    setOptions?: StorageEngineSetOptions,
  ): Promise<boolean> {
    const database = await this.#getDatabase();
    return compareAndSetRecord(
      database.transaction(this.#storeName, "readwrite").objectStore(this.#storeName),
      this.#prefixedKey(key),
      expected,
      value,
      resolveExpiresAt(setOptions),
    );
  }

  async compareAndSetMany(items: readonly StorageEngineCompareAndSetManyItem[]): Promise<boolean> {
    const database = await this.#getDatabase();
    return await compareAndSetRecords(
      database.transaction(this.#storeName, "readwrite").objectStore(this.#storeName),
      items.map((item) => ({
        key: this.#prefixedKey(item.key),
        expected: item.expected,
        value: item.value,
        expiresAt: resolveExpiresAt(item.options),
      })),
    );
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    for (const item of items) {
      await this.set(item.key, item.value, item.options);
    }
  }

  async delete(key: string): Promise<boolean> {
    const storageKey = this.#prefixedKey(key);
    const exists = (await this.#readRecord(storageKey)) !== undefined;
    await deleteRecord(await this.#getDatabase(), this.#storeName, storageKey);
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
    return (await this.#readRecord(this.#prefixedKey(key))) !== undefined;
  }

  async keys(keyOptions?: StorageEngineKeyOptions): Promise<readonly string[]> {
    const keys = await this.#matchingKeys(keyOptions);
    const result: string[] = [];
    for (const key of keys) {
      if ((await this.#readRecord(key)) !== undefined) {
        result.push(this.#unprefixKey(key));
      }
    }
    return result;
  }

  async clear(keyOptions?: StorageEngineKeyOptions): Promise<void> {
    const database = await this.#getDatabase();
    for (const key of await this.#matchingKeys(keyOptions)) {
      await deleteRecord(database, this.#storeName, key);
    }
  }

  async dispose(): Promise<void> {
    const database = await this.#databasePromise;
    database?.close();
    this.#databasePromise = undefined;
  }

  #getDatabase(): Promise<IndexedDbDatabase> {
    this.#databasePromise ??= openDatabase(this.#factory, this.#databaseName, this.#storeName);
    return this.#databasePromise;
  }

  #prefixedKey(key: string): string {
    return `${this.#prefix}${key}`;
  }

  #unprefixKey(key: string): string {
    return this.#prefix.length === 0 ? key : key.slice(this.#prefix.length);
  }

  async #readRecord(key: string): Promise<IndexedDbRecord | undefined> {
    const database = await this.#getDatabase();
    const record = (await requestResult(
      database.transaction(this.#storeName, "readonly").objectStore(this.#storeName).get(key),
    )) as IndexedDbRecord | undefined;

    if (record?.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      await deleteRecord(database, this.#storeName, key);
      return undefined;
    }
    return record;
  }

  async #allKeys(): Promise<string[]> {
    const database = await this.#getDatabase();
    const keys = await requestResult(
      database.transaction(this.#storeName, "readonly").objectStore(this.#storeName).getAllKeys(),
    );
    return keys.filter(
      (key): key is string => typeof key === "string" && key.startsWith(this.#prefix),
    );
  }

  async #matchingKeys(keyOptions: StorageEngineKeyOptions | undefined): Promise<string[]> {
    const matchPrefix = this.#prefixedKey(keyOptions?.prefix ?? "");
    return (await this.#allKeys()).filter((key) => key.startsWith(matchPrefix));
  }
}

function openDatabase(
  factory: IndexedDbFactory,
  databaseName: string,
  storeName: string,
): Promise<IndexedDbDatabase> {
  const request = factory.open(databaseName, 1);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(storeName)) {
      database.createObjectStore(storeName);
    }
  };
  return requestResult(request);
}

function requestResult<TResult>(request: IndexedDbRequest<TResult>): Promise<TResult> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteRecord(
  database: IndexedDbDatabase,
  storeName: string,
  key: string,
): Promise<undefined> {
  return requestResult(
    database.transaction(storeName, "readwrite").objectStore(storeName).delete(key),
  );
}

function compareAndSetRecord(
  objectStore: IndexedDbObjectStore,
  key: string,
  expected: Uint8Array | undefined,
  value: Uint8Array | undefined,
  expiresAt: number | undefined,
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const getRequest = objectStore.get(key);
    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => {
      const record = getRequest.result as IndexedDbRecord | undefined;
      const current =
        record?.expiresAt !== undefined && record.expiresAt <= Date.now() ? undefined : record;

      if (current !== record) {
        const deleteRequest = objectStore.delete(key);
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onsuccess = () => {
          applyCompareAndSetWrite(objectStore, key, expected, value, expiresAt, undefined)
            .then(resolve)
            .catch(reject);
        };
        return;
      }

      applyCompareAndSetWrite(objectStore, key, expected, value, expiresAt, current)
        .then(resolve)
        .catch(reject);
    };
  });
}

interface IndexedDbCompareAndSetRecordItem {
  readonly key: string;
  readonly expected: Uint8Array | undefined;
  readonly value: Uint8Array | undefined;
  readonly expiresAt: number | undefined;
}

async function compareAndSetRecords(
  objectStore: IndexedDbObjectStore,
  items: readonly IndexedDbCompareAndSetRecordItem[],
): Promise<boolean> {
  const currentRecords = new Map<string, IndexedDbRecord | undefined>();
  for (const item of items) {
    const record = (await requestResult(objectStore.get(item.key))) as IndexedDbRecord | undefined;
    const current =
      record?.expiresAt !== undefined && record.expiresAt <= Date.now() ? undefined : record;
    currentRecords.set(item.key, current);
  }

  if (
    items.some((item) => !compareAndSetExpectedMatches(currentRecords.get(item.key), item.expected))
  ) {
    return false;
  }

  for (const item of items) {
    if (
      item.value === undefined ||
      (item.expiresAt !== undefined && item.expiresAt <= Date.now())
    ) {
      await requestResult(objectStore.delete(item.key));
      continue;
    }
    await requestResult(
      objectStore.put({ value: item.value.slice(), expiresAt: item.expiresAt }, item.key),
    );
  }
  return true;
}

function compareAndSetExpectedMatches(
  current: IndexedDbRecord | undefined,
  expected: Uint8Array | undefined,
): boolean {
  if (expected === undefined) {
    return current === undefined;
  }
  return current !== undefined && bytesEqual(current.value, expected);
}

async function applyCompareAndSetWrite(
  objectStore: IndexedDbObjectStore,
  key: string,
  expected: Uint8Array | undefined,
  value: Uint8Array | undefined,
  expiresAt: number | undefined,
  current: IndexedDbRecord | undefined,
): Promise<boolean> {
  if (expected === undefined) {
    if (current !== undefined) {
      return false;
    }

    if (value === undefined || (expiresAt !== undefined && expiresAt <= Date.now())) {
      return true;
    }

    await requestResult(objectStore.put({ value: value.slice(), expiresAt }, key));
    return true;
  }

  if (current === undefined || !bytesEqual(current.value, expected)) {
    return false;
  }

  if (value === undefined || (expiresAt !== undefined && expiresAt <= Date.now())) {
    await requestResult(objectStore.delete(key));
    return true;
  }

  await requestResult(objectStore.put({ value: value.slice(), expiresAt }, key));
  return true;
}

/**
 * Engine batch item types accepted by IndexedDB storage operations.
 */
export type { StorageEngineCompareAndSetManyItem, StorageEngineSetManyItem };
