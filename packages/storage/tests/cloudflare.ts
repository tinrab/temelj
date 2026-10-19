import type {
  NamespaceBulkDeleteResponse,
  NamespaceBulkGetParams,
  NamespaceBulkGetResponse,
  NamespaceBulkUpdateParams,
  NamespaceBulkUpdateResponse,
} from "cloudflare/resources/kv/namespaces/namespaces";

import { isString, isFunction } from "@temelj/value";
import Database from "libsql";
import { vi } from "vitest";

import type { CloudflareKvClient, CloudflareR2Client } from "../src/engine/cloudflare/client.ts";
import type {
  CloudflareD1Binding,
  CloudflareD1PreparedStatement,
  CloudflareD1Result,
  CloudflareD1Value,
  CloudflareD1Row,
} from "../src/engine/cloudflare/d1.ts";
import type { CloudflareKvBinding, CloudflareKvKey } from "../src/engine/cloudflare/kv.ts";
import type { CloudflareR2Binding, CloudflareR2Object } from "../src/engine/cloudflare/r2.ts";

export function createMockCloudflareKvBinding() {
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
      list: vi.fn<CloudflareKvBinding["list"]>(async (options) => ({
        keys: [...items.keys()].flatMap((name) =>
          options?.prefix === undefined || name.startsWith(options.prefix) ? [{ name }] : [],
        ),
        list_complete: true,
      })),
      put,
    },
    put,
  };
}

export function createMockCloudflareKvClient() {
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
    ) => Promise<null>
  >(async (key) => {
    items.delete(key);

    return null;
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
      [...items.keys()].flatMap((name) =>
        params.prefix === undefined || name.startsWith(params.prefix) ? [{ name }] : [],
      ),
    ),
  );

  const update = vi.fn<
    (
      key: string,
      params: {
        readonly account_id: string;
        readonly namespace_id: string;
        readonly value: Parameters<
          CloudflareKvClient["kv"]["namespaces"]["values"]["update"]
        >[1]["value"];
        readonly expiration_ttl?: number;
      },
    ) => Promise<null>
  >(async (key, params) => {
    if (!(params.value instanceof Blob)) {
      throw new TypeError("Expected uploaded file");
    }

    items.set(key, new Uint8Array(await params.value.arrayBuffer()));

    return null;
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
              ) => Promise<Response>
            >(async (key) => {
              const value = items.get(key);

              if (value === undefined) {
                throw Object.assign(new Error("not found"), { status: 404 });
              }

              return new Response(copyArrayBuffer(value));
            }),
            update,
          },
        },
      },
    } satisfies CloudflareKvClient,
    bulkDelete,
    bulkGet,
    bulkUpdate,
    deleteValue,
    listKeys,
    update,
  };
}

interface MockD1Statement extends CloudflareD1PreparedStatement {
  execute<T = CloudflareD1Row>(): CloudflareD1Result<T>;
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
        statements.map((statement) => {
          if (!("execute" in statement) || !isFunction(statement.execute)) {
            throw new TypeError("Foreign D1 statement");
          }

          // SAFETY: prepare below owns every statement; execute uses the same generic result contract as all and run.
          return (statement as MockD1Statement).execute<T>();
        }),
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
              // SAFETY: The SQLite statement executes the SQL supplied by the caller declaring T.
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
      for (const key of isString(keys) ? [keys] : keys) {
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

interface MockCloudflareR2Client {
  readonly client: CloudflareR2Client;
  readonly deleteObject: CloudflareR2Client["r2"]["buckets"]["objects"]["delete"];
  readonly get: CloudflareR2Client["r2"]["buckets"]["objects"]["get"];
  readonly list: CloudflareR2Client["r2"]["buckets"]["objects"]["list"];
  readonly upload: CloudflareR2Client["r2"]["buckets"]["objects"]["upload"];
  readonly objects: Map<string, Uint8Array>;
}

export function createMockCloudflareR2Client(): MockCloudflareR2Client {
  const objects = new Map<string, Uint8Array>();

  const upload = vi.fn<CloudflareR2Client["r2"]["buckets"]["objects"]["upload"]>(
    async (key, value) => {
      if (!(value instanceof Uint8Array)) {
        throw new TypeError("Expected bytes");
      }

      objects.set(key, value.slice());

      return {};
    },
  );

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
  } satisfies CloudflareR2Client;

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

function normalizeD1Value(value: CloudflareD1Value): CloudflareD1Value {
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
