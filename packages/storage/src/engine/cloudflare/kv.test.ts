import { describe, expect, test, vi } from "vitest";

import {
  createMockCloudflareKvBinding,
  createMockCloudflareKvClient,
} from "../../../tests/cloudflare.ts";
import { createBytesStorageCodec } from "../../codec/bytes.ts";
import { createSuperJsonStorageCodec } from "../../codec/super-json.ts";
import { createTextStorageCodec } from "../../codec/text.ts";
import { createStorage } from "../../storage.ts";
import { StorageOperationError } from "../../types.ts";
import { CloudflareKvStorageEngine } from "./kv.ts";

const cloudflareModuleMock = vi.hoisted(() => ({
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
      cloudflareModuleMock.constructor(options);
      this.kv = (cloudflareModuleMock.instance as { readonly kv: unknown }).kv;
    }
  },
  toFile: cloudflareModuleMock.toFile,
}));

describe("Cloudflare KV engine", () => {
  test("stores strings directly in configured text mode", async () => {
    const { binding, put } = createMockCloudflareKvBinding();
    const storage = createStorage({
      codec: createTextStorageCodec(),
      engine: new CloudflareKvStorageEngine({ binding, format: "string" }),
    });

    await storage.set("message", "hello");
    expect(await storage.get("message")).toBe("hello");
    expect(put).toHaveBeenCalledWith("message", "hello", undefined);
  });

  test("uses Worker KV bindings for storage operations", async () => {
    const { binding, put } = createMockCloudflareKvBinding();
    const storage = createStorage({
      codec: createSuperJsonStorageCodec({ format: "bytes" }),
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
      expect.any(String),
      expect.objectContaining({ expirationTtl: 60 }),
    );

    await storage.set("sessions:1", "expired", { ttl: 0 });
    expect(await storage.get("sessions:1")).toBeUndefined();

    await storage.clear({ prefix: "users:" });
    expect(await storage.keys()).toEqual([]);
  });

  test("resolves Worker KV bindings from an env-like bindings object", async () => {
    const { binding } = createMockCloudflareKvBinding();
    const storage = createStorage({
      codec: createSuperJsonStorageCodec({ format: "bytes" }),
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
      codec: createSuperJsonStorageCodec({ format: "bytes" }),
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
      createMockCloudflareKvClient();
    const storage = createStorage({
      codec: createSuperJsonStorageCodec({ format: "bytes" }),
      engine: new CloudflareKvStorageEngine({
        accountId: "account",
        client,
        namespaceId: "namespace",
        prefix: "app",
      }),
    });

    await storage.set("users:1", { name: "Verso" }, { ttl: 100 });
    expect(update).toHaveBeenCalledWith(
      "app:users:1",
      expect.objectContaining({
        account_id: "account",
        expiration_ttl: 60,
        namespace_id: "namespace",
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
          key: "app:users:2",
          value: expect.any(String),
        }),
        expect.objectContaining({
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
    expect(deleteValue).toHaveBeenCalledWith("app:users:1", {
      account_id: "account",
      namespace_id: "namespace",
    });

    await storage.set("cache:1", "cached");
    await storage.clear({ prefix: "cache:" });
    expect(bulkDelete).toHaveBeenLastCalledWith("namespace", {
      account_id: "account",
      body: ["app:cache:1"],
    });
  });

  test("round-trips arbitrary bytes through the text-only bulk API", async () => {
    const { client } = createMockCloudflareKvClient();
    const storage = createStorage({
      codec: createBytesStorageCodec(),
      engine: new CloudflareKvStorageEngine({
        accountId: "account",
        client,
        namespaceId: "namespace",
      }),
    });
    const bytes = new Uint8Array([0, 255, 128, 1]);

    await storage.setMany([{ key: "binary", value: bytes }]);

    expect(await storage.get("binary")).toEqual(bytes);
    expect(await storage.getMany(["binary"])).toEqual([bytes]);
  });

  test("creates the Cloudflare package client lazily", async () => {
    const { client } = createMockCloudflareKvClient();
    cloudflareModuleMock.instance = client;
    const engine = new CloudflareKvStorageEngine({
      accountId: "account",
      apiToken: "token",
      namespaceId: "namespace",
    });

    expect(await engine.keys()).toEqual([]);
    const constructor = cloudflareModuleMock.constructor;
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
