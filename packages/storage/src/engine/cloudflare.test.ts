import type Cloudflare from "cloudflare";
import type {
  NamespaceBulkDeleteResponse,
  NamespaceBulkGetParams,
  NamespaceBulkGetResponse,
  NamespaceBulkUpdateParams,
  NamespaceBulkUpdateResponse,
} from "cloudflare/resources/kv/namespaces/namespaces";

import { describe, expect, test, vi } from "vitest";

import { createStorage } from "../storage.ts";
import { StorageOperationError } from "../types.ts";
import {
  CloudflareKvStorageEngine,
  type CloudflareKvBinding,
  type CloudflareKvKey,
} from "./cloudflare.ts";

const cloudflareMock = vi.hoisted(() => ({
  constructor: vi.fn<(options: unknown) => void>(),
  instance: undefined as unknown,
  toFile: vi.fn<(value: Uint8Array) => Promise<Uint8Array>>(
    async (value: Uint8Array): Promise<Uint8Array> => value.slice(),
  ),
}));

vi.mock("cloudflare", () => ({
  default: class Cloudflare {
    readonly kv: unknown;

    constructor(options: unknown) {
      cloudflareMock.constructor(options);
      this.kv = (cloudflareMock.instance as Cloudflare).kv;
    }
  },
  toFile: cloudflareMock.toFile,
}));

describe("Cloudflare KV engine", () => {
  test("uses Worker KV bindings for storage operations", async () => {
    const { binding, put } = createMockBinding();
    const storage = createStorage({
      engine: new CloudflareKvStorageEngine({
        binding,
        minTtl: 60_000,
        prefix: "app",
      }),
    });

    await storage.set("users:1", { name: "Verso" });
    await storage.set("users:2", { name: "Maelle" });
    await storage.set("sessions:1", "active", { ttl: 100 });

    expect(await storage.get("users:1")).toEqual({ name: "Verso" });
    expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);
    expect(put).toHaveBeenLastCalledWith(
      "app:sessions:1",
      expect.any(Uint8Array),
      expect.objectContaining({ expirationTtl: 60 }),
    );

    await storage.set("sessions:1", "expired", { ttl: 0 });
    expect(await storage.get("sessions:1")).toBeUndefined();

    await storage.clear({ prefix: "users:" });
    expect(await storage.keys()).toEqual([]);
  });

  test("resolves Worker KV bindings from an env-like bindings object", async () => {
    const { binding } = createMockBinding();
    const storage = createStorage({
      engine: new CloudflareKvStorageEngine({
        binding: "STORAGE",
        bindings: { STORAGE: binding },
      }),
    });

    await storage.set("users:1", { name: "Verso" });

    expect(await storage.get("users:1")).toEqual({ name: "Verso" });
  });

  test("rejects missing named Worker KV bindings", async () => {
    const storage = createStorage({
      engine: new CloudflareKvStorageEngine({
        binding: "STORAGE",
        bindings: {},
      }),
    });

    const result = await storage.tryGet("users:1");

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      throw new Error("Expected storage result to be an error");
    }
    expect(result.error).toBeInstanceOf(StorageOperationError);
    expect(result.error.cause).toBeInstanceOf(TypeError);
    expect(result.error.cause).toEqual(
      expect.objectContaining({ message: "Cloudflare binding STORAGE was not found" }),
    );
  });

  test("uses the Cloudflare API client when a client is provided", async () => {
    const { bulkDelete, bulkGet, bulkUpdate, client, deleteValue, listKeys, update } =
      createMockClient();
    const storage = createStorage({
      engine: new CloudflareKvStorageEngine({
        accountId: "account",
        client,
        namespaceId: "namespace",
        prefix: "app",
      }),
    });

    await storage.set("users:1", { name: "Verso" }, { ttl: 100 });
    expect(update).toHaveBeenCalledWith(
      "namespace",
      "app:users:1",
      expect.objectContaining({
        account_id: "account",
        expiration_ttl: 60,
        value: expect.any(Uint8Array),
      }),
    );

    expect(await storage.get("users:1")).toEqual({ name: "Verso" });
    await storage.setMany([
      { key: "users:2", value: { name: "Maelle" } },
      { key: "sessions:1", value: "active", options: { ttl: 100 } },
      { key: "expired:1", value: "expired", options: { ttl: 0 } },
    ]);
    expect(update).toHaveBeenCalledTimes(1);
    expect(bulkDelete).toHaveBeenCalledWith("namespace", {
      account_id: "account",
      body: ["app:expired:1"],
    });
    expect(bulkUpdate).toHaveBeenCalledWith("namespace", {
      account_id: "account",
      body: [
        expect.objectContaining({
          base64: true,
          key: "app:users:2",
          value: expect.any(String),
        }),
        expect.objectContaining({
          base64: true,
          expiration_ttl: 60,
          key: "app:sessions:1",
          value: expect.any(String),
        }),
      ],
    });
    expect(await storage.get("users:2")).toEqual({ name: "Maelle" });
    expect(await storage.get("sessions:1")).toBe("active");
    expect(await storage.get("expired:1")).toBeUndefined();
    expect(await storage.getMany(["users:1", "users:2", "users:missing"])).toEqual([
      { name: "Verso" },
      { name: "Maelle" },
      undefined,
    ]);
    expect(bulkGet).toHaveBeenCalledWith("namespace", {
      account_id: "account",
      keys: ["app:users:1", "app:users:2", "app:users:missing"],
      type: "text",
    });
    expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);
    expect(listKeys).toHaveBeenCalledWith("namespace", {
      account_id: "account",
      prefix: "app:users:",
    });
    expect(await storage.deleteMany(["users:2", "sessions:1"])).toBe(2);
    expect(bulkDelete).toHaveBeenLastCalledWith("namespace", {
      account_id: "account",
      body: ["app:users:2", "app:sessions:1"],
    });

    expect(await storage.delete("users:missing")).toBe(false);
    expect(await storage.delete("users:1")).toBe(true);
    expect(deleteValue).toHaveBeenCalledWith("namespace", "app:users:1", {
      account_id: "account",
    });

    await storage.set("cache:1", "cached");
    await storage.clear({ prefix: "cache:" });
    expect(bulkDelete).toHaveBeenLastCalledWith("namespace", {
      account_id: "account",
      body: ["app:cache:1"],
    });
  });

  test("creates the Cloudflare package client lazily", async () => {
    const { client } = createMockClient();
    cloudflareMock.instance = client;
    const engine = new CloudflareKvStorageEngine({
      accountId: "account",
      apiToken: "token",
      namespaceId: "namespace",
    });

    expect(await engine.keys()).toEqual([]);
    const constructor = cloudflareMock.constructor;
    expect(constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiToken: "token",
      }),
    );
    expect(constructor).not.toHaveBeenCalledWith(expect.objectContaining({ accountId: "account" }));
    expect(constructor).not.toHaveBeenCalledWith(
      expect.objectContaining({ namespaceId: "namespace" }),
    );
  });
});

function createMockBinding(): {
  readonly binding: CloudflareKvBinding;
  readonly put: (
    key: string,
    value: Uint8Array,
    options?: { readonly expirationTtl?: number },
  ) => Promise<void>;
} {
  const items = new Map<string, Uint8Array>();
  const put = vi.fn<
    (key: string, value: Uint8Array, options?: { readonly expirationTtl?: number }) => Promise<void>
  >(async (key: string, value: Uint8Array) => {
    items.set(key, value.slice());
  });

  return {
    binding: {
      delete: vi.fn<(key: string) => Promise<void>>(async (key: string) => {
        items.delete(key);
      }),
      get: vi.fn<
        (key: string, options: { readonly type: "arrayBuffer" }) => Promise<ArrayBuffer | null>
      >(async (key: string): Promise<ArrayBuffer | null> => {
        const value = items.get(key);
        return value === undefined ? null : copyArrayBuffer(value);
      }),
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

function createMockClient(): {
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
    namespaceId: string,
    key: string,
    params: { readonly account_id: string },
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
    namespaceId: string,
    key: string,
    params: {
      readonly account_id: string;
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
    (namespaceId: string, key: string, params: { readonly account_id: string }) => Promise<unknown>
  >(async (_namespaceId, key) => {
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
      namespaceId: string,
      key: string,
      params: {
        readonly account_id: string;
        readonly value: unknown;
        readonly expiration_ttl?: number;
      },
    ) => Promise<unknown>
  >(async (_namespaceId, key, params) => {
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
                namespaceId: string,
                key: string,
                params: { readonly account_id: string },
              ) => Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>
            >(async (_namespaceId, key) => {
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

async function* asyncIterable<TItem>(items: readonly TItem[]): AsyncIterable<TItem> {
  for (const item of items) {
    yield item;
  }
}
