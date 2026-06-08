import { describe, expect, test, vi } from "vitest";

import { createStorage } from "../storage.ts";
import {
  createIndexedDbEngine,
  type IndexedDbDatabase,
  type IndexedDbFactory,
  type IndexedDbObjectStore,
  type IndexedDbOpenRequest,
  type IndexedDbRequest,
} from "./indexed-db.ts";

describe("indexedDB engine", () => {
  test("stores bytes, scans prefixes, and deletes records", async () => {
    const storage = createStorage({
      engine: createIndexedDbEngine({
        indexedDB: createMockIndexedDbFactory(),
        namespace: "app",
      }),
    });

    await storage.set("users:1", { name: "Verso" });
    await storage.set("users:2", { name: "Maelle" });
    await storage.set("posts:1", { title: "Drafts" });

    expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);
    expect(await storage.delete("users:1")).toBe(true);
    await storage.clear({ prefix: "users:" });
    expect(await storage.keys()).toEqual(["posts:1"]);
  });
});

function createMockIndexedDbFactory(): IndexedDbFactory {
  const stores = new Map<string, Map<string, unknown>>();
  return {
    open: vi.fn<(name: string, version?: number) => IndexedDbOpenRequest>(
      (_name: string, _version?: number): IndexedDbOpenRequest => {
        const request = createOpenRequest();
        queueMicrotask(() => {
          request.result = createMockIndexedDbDatabase(stores);
          request.onupgradeneeded?.({});
          request.onsuccess?.({});
        });
        return request;
      },
    ),
  };
}

function createMockIndexedDbDatabase(stores: Map<string, Map<string, unknown>>): IndexedDbDatabase {
  return {
    objectStoreNames: {
      contains: vi.fn<(name: string) => boolean>((name: string): boolean => stores.has(name)),
    },
    close: vi.fn<() => void>(),
    createObjectStore: vi.fn<(name: string) => IndexedDbObjectStore>((name: string) => {
      const store = new Map<string, unknown>();
      stores.set(name, store);
      return createMockIndexedDbObjectStore(store);
    }),
    transaction: vi.fn<
      (
        name: string,
        mode: "readonly" | "readwrite",
      ) => { objectStore(name: string): IndexedDbObjectStore }
    >(
      (
        name: string,
        _mode: "readonly" | "readwrite",
      ): { objectStore(name: string): IndexedDbObjectStore } => {
        const store = stores.get(name) ?? new Map<string, unknown>();
        stores.set(name, store);
        return {
          objectStore: vi.fn<(name: string) => IndexedDbObjectStore>(() =>
            createMockIndexedDbObjectStore(store),
          ),
        };
      },
    ),
  };
}

function createMockIndexedDbObjectStore(items: Map<string, unknown>): IndexedDbObjectStore {
  return {
    delete: vi.fn<(key: string) => IndexedDbRequest<undefined>>((key: string) => {
      items.delete(key);
      return createRequest(undefined);
    }),
    get: vi.fn<(key: string) => IndexedDbRequest<unknown>>((key: string) =>
      createRequest(items.get(key)),
    ),
    getAllKeys: vi.fn<() => IndexedDbRequest<string[]>>(() => createRequest([...items.keys()])),
    put: vi.fn<(value: unknown, key: string) => IndexedDbRequest<unknown>>(
      (value: unknown, key: string) => {
        items.set(key, value);
        return createRequest(undefined);
      },
    ),
  };
}

interface MutableIndexedDbOpenRequest extends IndexedDbOpenRequest {
  result: IndexedDbDatabase;
}

function createOpenRequest(): MutableIndexedDbOpenRequest {
  return {
    error: null,
    result: undefined as unknown as IndexedDbDatabase,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
  };
}

function createRequest<T>(result: T): IndexedDbRequest<T> {
  const request: IndexedDbRequest<T> = {
    error: null,
    result,
    onerror: null,
    onsuccess: null,
  };
  queueMicrotask(() => {
    request.onsuccess?.({});
  });
  return request;
}
