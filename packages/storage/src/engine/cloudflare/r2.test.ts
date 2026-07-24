import { describe, expect, test, vi } from "vitest";

import {
  createMockCloudflareR2Binding,
  createMockCloudflareR2Client,
} from "../../../tests/cloudflare.ts";
import { createBytesStorageCodec } from "../../codec/bytes.ts";
import { createSuperJsonStorageCodec } from "../../codec/super-json.ts";
import { createStorage } from "../../storage.ts";
import { CloudflareR2StorageEngine } from "./r2.ts";

describe("Cloudflare R2 engine", () => {
  test("uses an R2 binding for object operations, prefixes, and TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const binding = createMockCloudflareR2Binding();
    const storage = createStorage({
      codec: createSuperJsonStorageCodec({ format: "bytes" }),
      engine: new CloudflareR2StorageEngine({
        binding,
        prefix: "app",
      }),
    });

    await storage.set("users:1", { name: "Verso" });
    await storage.set("users:2", { name: "Maelle" });
    await storage.set("sessions:1", "active", { ttl: 1000 });

    expect(await storage.get("users:1")).toEqual({ name: "Verso" });
    expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);

    vi.advanceTimersByTime(1001);
    expect(await storage.has("sessions:1")).toBe(false);
    expect(await storage.delete("missing")).toBe(false);
    expect(await storage.deleteMany(["users:1", "users:2"])).toBe(2);
    expect(await storage.keys()).toEqual([]);

    vi.useRealTimers();
  });

  test("resolves a named R2 binding", async () => {
    const binding = createMockCloudflareR2Binding();
    const storage = createStorage({
      codec: createSuperJsonStorageCodec({ format: "bytes" }),
      engine: new CloudflareR2StorageEngine({
        binding: "BUCKET",
        bindings: { BUCKET: binding },
      }),
    });

    await storage.set("key", "value");
    expect(await storage.get("key")).toBe("value");
  });

  test("uses the Cloudflare R2 HTTP API", async () => {
    const { client, deleteObject, get, list, objects, upload } = createMockCloudflareR2Client();
    const storage = createStorage({
      codec: createSuperJsonStorageCodec({ format: "bytes" }),
      engine: new CloudflareR2StorageEngine({
        accountId: "account",
        bucketName: "bucket",
        client,
        prefix: "app",
      }),
    });

    await storage.set("key", "value");
    expect(await storage.get("key")).toBe("value");
    expect(upload).toHaveBeenCalledWith(
      "app:key",
      expect.any(Uint8Array),
      expect.objectContaining({
        account_id: "account",
        bucket_name: "bucket",
      }),
    );
    expect(get).toHaveBeenCalledWith("app:key", {
      account_id: "account",
      bucket_name: "bucket",
      jurisdiction: undefined,
    });

    expect(await storage.keys()).toEqual(["key"]);
    expect(list).toHaveBeenCalledWith("bucket", {
      account_id: "account",
      jurisdiction: undefined,
      prefix: "app:",
    });

    expect(await storage.delete("key")).toBe(true);
    expect(deleteObject).toHaveBeenCalledWith("app:key", {
      account_id: "account",
      bucket_name: "bucket",
      jurisdiction: undefined,
    });
    expect(objects.size).toBe(0);
  });

  test("round-trips arbitrary bytes and expires HTTP objects", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { client, objects } = createMockCloudflareR2Client();
    const storage = createStorage({
      codec: createBytesStorageCodec(),
      engine: new CloudflareR2StorageEngine({
        accountId: "account",
        bucketName: "bucket",
        client,
      }),
    });
    const bytes = new Uint8Array([0, 255, 128, 1]);

    await storage.set("binary", bytes, { ttl: 1000 });
    expect(await storage.getMany(["binary"])).toEqual([bytes]);

    vi.advanceTimersByTime(1001);
    expect(await storage.get("binary")).toBeUndefined();
    expect(objects.size).toBe(0);
    vi.useRealTimers();
  });

  test("requires HTTP configuration when an operation is attempted", async () => {
    const engine = new CloudflareR2StorageEngine({});

    await expect(engine.get("key")).rejects.toThrow(
      "Cloudflare R2 HTTP mode requires accountId and bucketName",
    );
  });
});
