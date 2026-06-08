import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

export interface IndexedDbFactory {
  open(name: string, version?: number): IndexedDbOpenRequest;
}

export interface IndexedDbOpenRequest extends IndexedDbRequest<IndexedDbDatabase> {
  onupgradeneeded: ((event: unknown) => void) | null;
}

export interface IndexedDbRequest<TResult> {
  readonly error: unknown;
  readonly result: TResult;
  onerror: ((event: unknown) => void) | null;
  onsuccess: ((event: unknown) => void) | null;
}

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

export interface IndexedDbObjectStore {
  delete(key: string): IndexedDbRequest<undefined>;
  get(key: string): IndexedDbRequest<unknown>;
  getAllKeys(): IndexedDbRequest<unknown[]>;
  put(value: unknown, key: string): IndexedDbRequest<unknown>;
}

export interface IndexedDbEngineOptions {
  readonly indexedDB?: IndexedDbFactory;
  readonly databaseName?: string;
  readonly storeName?: string;
  readonly namespace?: string;
  readonly separator?: string;
}

interface IndexedDbRecord {
  readonly value: Uint8Array;
  readonly expiresAt?: number;
}

export function createIndexedDbEngine(options: IndexedDbEngineOptions = {}): StorageEngine {
  const factory =
    options.indexedDB ??
    (globalThis as typeof globalThis & { readonly indexedDB?: IndexedDbFactory }).indexedDB;
  if (factory === undefined) {
    throw new TypeError("indexedDB is not available");
  }

  const databaseName = options.databaseName ?? "temelj-storage";
  const storeName = options.storeName ?? "entries";
  const namespace = options.namespace ?? "";
  const separator = options.separator ?? ":";
  const prefix = namespace.length === 0 ? "" : `${namespace}${separator}`;
  const prefixedKey = (key: string): string => `${prefix}${key}`;
  const unprefixKey = (key: string): string =>
    prefix.length === 0 ? key : key.slice(prefix.length);

  let databasePromise: Promise<IndexedDbDatabase> | undefined;
  const getDatabase = (): Promise<IndexedDbDatabase> => {
    databasePromise ??= openDatabase(factory, databaseName, storeName);
    return databasePromise;
  };

  const readRecord = async (key: string): Promise<IndexedDbRecord | undefined> => {
    const database = await getDatabase();
    const record = (await requestResult(
      database.transaction(storeName, "readonly").objectStore(storeName).get(key),
    )) as IndexedDbRecord | undefined;

    if (record?.expiresAt !== undefined && record.expiresAt <= Date.now()) {
      await deleteRecord(database, storeName, key);
      return undefined;
    }
    return record;
  };

  const allKeys = async (): Promise<string[]> => {
    const database = await getDatabase();
    const keys = await requestResult(
      database.transaction(storeName, "readonly").objectStore(storeName).getAllKeys(),
    );
    return keys.filter((key): key is string => typeof key === "string" && key.startsWith(prefix));
  };

  const matchingKeys = async (
    keyOptions: StorageEngineKeyOptions | undefined,
  ): Promise<string[]> => {
    const matchPrefix = prefixedKey(keyOptions?.prefix ?? "");
    return (await allKeys()).filter((key) => key.startsWith(matchPrefix));
  };

  return {
    name: "indexedDB",

    async get(key) {
      const record = await readRecord(prefixedKey(key));
      return record === undefined ? undefined : record.value.slice();
    },

    async set(key, value, setOptions) {
      const storageKey = prefixedKey(key);
      const expiresAt = resolveExpiresAt(setOptions);
      const database = await getDatabase();
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        await deleteRecord(database, storeName, storageKey);
        return;
      }
      await requestResult(
        database
          .transaction(storeName, "readwrite")
          .objectStore(storeName)
          .put({ value: value.slice(), expiresAt }, storageKey),
      );
    },

    async setMany(items) {
      for (const item of items) {
        await this.set(item.key, item.value, item.options);
      }
    },

    async delete(key) {
      const storageKey = prefixedKey(key);
      const exists = (await readRecord(storageKey)) !== undefined;
      await deleteRecord(await getDatabase(), storeName, storageKey);
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
      return (await readRecord(prefixedKey(key))) !== undefined;
    },

    async keys(keyOptions) {
      const keys = await matchingKeys(keyOptions);
      const result: string[] = [];
      for (const key of keys) {
        if ((await readRecord(key)) !== undefined) {
          result.push(unprefixKey(key));
        }
      }
      return result;
    },

    async clear(keyOptions) {
      const database = await getDatabase();
      for (const key of await matchingKeys(keyOptions)) {
        await deleteRecord(database, storeName, key);
      }
    },

    async dispose() {
      const database = await databasePromise;
      database?.close();
      databasePromise = undefined;
    },
  };
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

function resolveExpiresAt(options: StorageEngineSetOptions | undefined): number | undefined {
  return options?.ttl === undefined ? undefined : Date.now() + options.ttl;
}

export type { StorageEngineSetManyItem };
