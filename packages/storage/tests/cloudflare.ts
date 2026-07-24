import type Cloudflare from "cloudflare";
import type {
  NamespaceBulkDeleteResponse,
  NamespaceBulkGetParams,
  NamespaceBulkGetResponse,
  NamespaceBulkUpdateParams,
  NamespaceBulkUpdateResponse,
} from "cloudflare/resources/kv/namespaces/namespaces";

import Database from "libsql";
import { vi } from "vitest";

import type {
  CloudflareD1Binding,
  CloudflareD1PreparedStatement,
  CloudflareD1Result,
  CloudflareD1Value,
} from "../src/engine/cloudflare/d1.ts";
import type { CloudflareKvBinding, CloudflareKvKey } from "../src/engine/cloudflare/kv.ts";
import type { CloudflareR2Binding, CloudflareR2Object } from "../src/engine/cloudflare/r2.ts";

export function createMockCloudflareKvBinding(): {
  readonly binding: CloudflareKvBinding;
  readonly put: (
    key: string,
    value: string,
    options?: { readonly expirationTtl?: number },
  ) => Promise<void>;
} {
  const items = new Map<string, string>();
  const put = vi.fn<
    (key: string, value: string, options?: { readonly expirationTtl?: number }) => Promise<void>
  >(async (key, value) => {
    items.set(key, value);
  });

  return {
    binding: {
      delete: vi.fn<(key: string) => Promise<void>>(async (key) => {
        items.delete(key);
      }),
      get: vi.fn<(key: string, options: { readonly type: "text" }) => Promise<string | null>>(
        async (key) => items.get(key) ?? null,
      ),
      list: vi.fn<CloudflareKvBinding["list"]>(
        async (options): Promise<{ keys: readonly CloudflareKvKey[]; list_complete: true }> => ({
          keys: [...items.keys()]
            .filter((key) => options?.prefix === undefined || key.startsWith(options.prefix))
            .map((name) => ({ name })),
          list_complete: true,
        }),
      ),
      put,
    },
    put,
  };
}

export function createMockCloudflareKvClient(): {
  readonly bulkDelete: (
    namespaceId: string,
    params: { readonly account_id: string; readonly body: readonly string[] },
  ) => Promise<NamespaceBulkDeleteResponse | null>;
  readonly bulkGet: (
    namespaceId: string,
    params: NamespaceBulkGetParams,
  ) => Promise<NamespaceBulkGetResponse | null>;
  readonly bulkUpdate: (
    namespaceId: string,
    params: {
      readonly account_id: string;
      readonly body: readonly NamespaceBulkUpdateParams.Body[];
    },
  ) => Promise<NamespaceBulkUpdateResponse | null>;
  readonly client: Cloudflare;
  readonly deleteValue: (
    key: string,
    params: { readonly account_id: string; readonly namespace_id: string },
  ) => Promise<unknown>;
  readonly listKeys: (
    namespaceId: string,
    params: {
      readonly account_id: string;
      readonly prefix?: string;
      readonly limit?: number;
    },
  ) => AsyncIterable<CloudflareKvKey>;
  readonly update: (
    key: string,
    params: {
      readonly account_id: string;
      readonly namespace_id: string;
      readonly value: unknown;
      readonly expiration_ttl?: number;
    },
  ) => Promise<unknown>;
} {
  const items = new Map<string, Uint8Array>();
  const bulkDelete = vi.fn<
    (
      namespaceId: string,
      params: { readonly account_id: string; readonly body: readonly string[] },
    ) => Promise<NamespaceBulkDeleteResponse | null>
  >(async (_namespaceId, params) => {
    for (const key of params.body) {
      items.delete(key);
    }
    return { successful_key_count: params.body.length };
  });
  const bulkGet = vi.fn<
    (
      namespaceId: string,
      params: NamespaceBulkGetParams,
    ) => Promise<NamespaceBulkGetResponse | null>
  >(async (_namespaceId, params) => {
    const values: Record<string, string> = {};
    for (const key of params.keys) {
      const value = items.get(key);
      if (value !== undefined) {
        values[key] = new TextDecoder().decode(value);
      }
    }
    return { values };
  });
  const bulkUpdate = vi.fn<
    (
      namespaceId: string,
      params: {
        readonly account_id: string;
        readonly body: readonly NamespaceBulkUpdateParams.Body[];
      },
    ) => Promise<NamespaceBulkUpdateResponse | null>
  >(async (_namespaceId, params) => {
    for (const item of params.body) {
      items.set(item.key, decodeMockBulkValue(item));
    }
    return { successful_key_count: params.body.length };
  });
  const deleteValue = vi.fn<
    (
      key: string,
      params: { readonly account_id: string; readonly namespace_id: string },
    ) => Promise<unknown>
  >(async (key) => {
    items.delete(key);
  });
  const listKeys = vi.fn<
    (
      namespaceId: string,
      params: {
        readonly account_id: string;
        readonly prefix?: string;
        readonly limit?: number;
      },
    ) => AsyncIterable<CloudflareKvKey>
  >((_namespaceId, params) =>
    asyncIterable(
      [...items.keys()]
        .filter((key) => params.prefix === undefined || key.startsWith(params.prefix))
        .map((name) => ({ name })),
    ),
  );
  const update = vi.fn<
    (
      key: string,
      params: {
        readonly account_id: string;
        readonly namespace_id: string;
        readonly value: unknown;
        readonly expiration_ttl?: number;
      },
    ) => Promise<unknown>
  >(async (key, params) => {
    if (!(params.value instanceof Uint8Array)) {
      throw new TypeError("Expected Uint8Array value");
    }
    items.set(key, params.value.slice());
  });

  return {
    client: {
      kv: {
        namespaces: {
          bulkDelete,
          bulkGet,
          bulkUpdate,
          keys: {
            list: listKeys,
          },
          values: {
            delete: deleteValue,
            get: vi.fn<
              (
                key: string,
                params: { readonly account_id: string; readonly namespace_id: string },
              ) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>
            >(async (key) => {
              const value = items.get(key);
              if (value === undefined) {
                throw Object.assign(new Error("not found"), { status: 404 });
              }
              return {
                async arrayBuffer(): Promise<ArrayBuffer> {
                  return copyArrayBuffer(value);
                },
              };
            }),
            update,
          },
        },
      },
    } as unknown as Cloudflare,
    bulkDelete,
    bulkGet,
    bulkUpdate,
    deleteValue,
    listKeys,
    update,
  };
}

interface MockD1Statement extends CloudflareD1PreparedStatement {
  execute<T = Record<string, unknown>>(): CloudflareD1Result<T>;
}

export function createMockCloudflareD1Binding(): CloudflareD1Binding {
  const database = new Database(":memory:");
  database.exec(`
    CREATE TABLE temelj_storage (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);

  return {
    async batch<T>(
      statements: readonly CloudflareD1PreparedStatement[],
    ): Promise<readonly CloudflareD1Result<T>[]> {
      return database.transaction(() =>
        statements.map((statement) => (statement as MockD1Statement).execute<T>()),
      )();
    },
    prepare(sql): MockD1Statement {
      let params: readonly CloudflareD1Value[] = [];
      const statement: MockD1Statement = {
        bind(...values): MockD1Statement {
          params = values;
          return statement;
        },
        execute<T>(): CloudflareD1Result<T> {
          const prepared = database.prepare(sql);
          const normalized = params.map(normalizeD1Value);
          if (prepared.reader) {
            return {
              results: prepared.all(...normalized) as T[],
              success: true,
            };
          }
          const result = prepared.run(...normalized);
          return {
            meta: { changes: Number(result.changes) },
            results: [],
            success: true,
          };
        },
        async all<T>(): Promise<CloudflareD1Result<T>> {
          return statement.execute<T>();
        },
        async run<T>(): Promise<CloudflareD1Result<T>> {
          return statement.execute<T>();
        },
      };
      return statement;
    },
  };
}

interface MockR2Entry extends CloudflareR2Object {
  readonly value: Uint8Array;
}

export function createMockCloudflareR2Binding(): CloudflareR2Binding {
  const objects = new Map<string, MockR2Entry>();
  return {
    async delete(keys): Promise<void> {
      for (const key of typeof keys === "string" ? [keys] : keys) {
        objects.delete(key);
      }
    },
    async get(key) {
      const object = objects.get(key);
      if (object === undefined) {
        return null;
      }
      return {
        ...object,
        async arrayBuffer(): Promise<ArrayBuffer> {
          return object.value.slice().buffer;
        },
      };
    },
    async list(options) {
      return {
        objects: [...objects.values()].filter(
          (object) => options?.prefix === undefined || object.key.startsWith(options.prefix),
        ),
        truncated: false,
      };
    },
    async put(key, value) {
      const object = {
        key,
        value: value.slice(),
      };
      objects.set(key, object);
      return object;
    },
  };
}

export function createMockCloudflareR2Client(): {
  readonly client: Cloudflare;
  readonly deleteObject: (key: string) => Promise<object>;
  readonly get: (key: string) => Promise<Response>;
  readonly list: (
    bucket: string,
    options: { readonly prefix?: string },
  ) => AsyncIterable<{ key: string }>;
  readonly objects: Map<string, Uint8Array>;
  readonly upload: (key: string, value: Uint8Array) => Promise<object>;
} {
  const objects = new Map<string, Uint8Array>();
  const upload = vi.fn<(key: string, value: Uint8Array) => Promise<object>>(async (key, value) => {
    objects.set(key, value.slice());
    return {};
  });
  const get = vi.fn<(key: string) => Promise<Response>>(async (key) => {
    const value = objects.get(key);
    if (value === undefined) {
      throw Object.assign(new Error("Not found"), { status: 404 });
    }
    return new Response(new Uint8Array(value).buffer);
  });
  const deleteObject = vi.fn<(key: string) => Promise<object>>(async (key) => {
    objects.delete(key);
    return {};
  });
  const list = vi.fn<
    (bucket: string, options: { readonly prefix?: string }) => AsyncIterable<{ key: string }>
  >((_bucket, options) => ({
    async *[Symbol.asyncIterator](): AsyncGenerator<{ key: string }> {
      for (const key of objects.keys()) {
        if (options.prefix === undefined || key.startsWith(options.prefix)) {
          yield { key };
        }
      }
    },
  }));
  const client = {
    r2: {
      buckets: {
        objects: {
          delete: deleteObject,
          get,
          list,
          upload,
        },
      },
    },
  } as unknown as Cloudflare;
  return { client, deleteObject, get, list, objects, upload };
}

function decodeMockBulkValue(item: NamespaceBulkUpdateParams.Body): Uint8Array {
  if (item.base64 === true) {
    return new Uint8Array(Buffer.from(item.value, "base64"));
  }
  return new TextEncoder().encode(item.value);
}

function copyArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function normalizeD1Value(value: CloudflareD1Value): unknown {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value);
  }
  return value;
}

async function* asyncIterable<TItem>(items: readonly TItem[]): AsyncIterable<TItem> {
  for (const item of items) {
    yield item;
  }
}
