import type Cloudflare from "cloudflare";

import { describe, expect, test, vi } from "vitest";

import { createMockCloudflareD1Binding } from "../../../tests/cloudflare.ts";
import { createSuperJsonStorageCodec } from "../../codec/super-json.ts";
import { createStorage } from "../../storage.ts";
import { CloudflareD1StorageEngine, type CloudflareD1Result } from "./d1.ts";

describe("Cloudflare D1 engine", () => {
  test("uses a D1 binding for relational storage operations", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const binding = createMockCloudflareD1Binding();
    const storage = createStorage({
      engine: new CloudflareD1StorageEngine({
        binding,
        prefix: "app",
      }),
    });

    await storage.setMany([
      { key: "users:1", value: { name: "Verso" } },
      { key: "users:2", value: { name: "Maelle" } },
      { key: "sessions:1", value: "active", options: { ttl: 1000 } },
    ]);

    expect(await storage.getMany(["users:1", "missing", "users:2"])).toEqual([
      { name: "Verso" },
      undefined,
      { name: "Maelle" },
    ]);
    expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);
    expect(await storage.compareAndSet("users:1", { name: "wrong" }, { name: "Renoir" })).toBe(
      false,
    );
    expect(await storage.compareAndSet("users:1", { name: "Verso" }, { name: "Renoir" })).toBe(
      true,
    );
    expect(await storage.get("users:1")).toEqual({ name: "Renoir" });

    vi.advanceTimersByTime(1001);
    expect(await storage.get("sessions:1")).toBeUndefined();
    expect(await storage.deleteMany(["users:1", "missing"])).toBe(1);
    await storage.clear({ prefix: "users:" });
    expect(await storage.keys()).toEqual([]);

    vi.useRealTimers();
  });

  test("resolves a named D1 binding and quotes table names", async () => {
    const binding = createMockCloudflareD1Binding();
    await binding
      .prepare(
        `CREATE TABLE "app storage" (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
      )
      .run();
    const storage = createStorage({
      engine: new CloudflareD1StorageEngine({
        binding: "DATABASE",
        bindings: { DATABASE: binding },
        tableName: "app storage",
      }),
    });

    await storage.set("key", "value");
    expect(await storage.get("key")).toBe("value");
  });

  test("uses the D1 HTTP batch query API", async () => {
    const binding = createMockCloudflareD1Binding();
    const query = vi.fn<
      (
        databaseId: string,
        options: {
          readonly account_id: string;
          readonly batch: readonly {
            readonly sql: string;
            readonly params?: readonly string[];
          }[];
        },
      ) => AsyncIterable<CloudflareD1Result>
    >((_databaseId, options) => ({
      async *[Symbol.asyncIterator](): AsyncGenerator<CloudflareD1Result> {
        const statements = options.batch.map((query) =>
          binding.prepare(query.sql).bind(...(query.params ?? [])),
        );
        yield* await binding.batch(statements);
      },
    }));
    const client = {
      d1: {
        database: {
          query,
        },
      },
    } as unknown as Cloudflare;
    const storage = createStorage({
      engine: new CloudflareD1StorageEngine({
        accountId: "account",
        client,
        databaseId: "database",
        prefix: "app",
      }),
    });

    await storage.setMany([
      { key: "key:1", value: "one" },
      { key: "key:2", value: "two" },
    ]);

    expect(await storage.getMany(["key:1", "key:2"])).toEqual(["one", "two"]);
    expect(query).toHaveBeenCalledWith(
      "database",
      expect.objectContaining({
        account_id: "account",
        batch: expect.arrayContaining([
          expect.objectContaining({
            params: ["app:key:1", expect.any(String), "0"],
            sql: expect.stringContaining("INSERT INTO"),
          }),
        ]),
      }),
    );

    const binaryStorage = createStorage({
      codec: createSuperJsonStorageCodec({ format: "bytes" }),
      engine: new CloudflareD1StorageEngine<Uint8Array>({
        accountId: "account",
        client,
        databaseId: "database",
        prefix: "binary",
      }),
    });
    const value = {
      bytes: new Uint8Array([0, 127, 128, 255]),
      name: "binary payload",
    };

    await binaryStorage.set("key", value);
    expect(await binaryStorage.get("key")).toEqual(value);
    expect(
      query.mock.calls.some(([, options]) =>
        options.batch.some((item) =>
          item.params?.some((parameter) => parameter.startsWith("temelj:d1:bytes:v1:")),
        ),
      ),
    ).toBe(true);
  });

  test("can use a pre-created table without initialization", async () => {
    const binding = createMockCloudflareD1Binding();
    await binding
      .prepare(
        `CREATE TABLE custom_storage (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )`,
      )
      .run();
    const storage = createStorage({
      engine: new CloudflareD1StorageEngine({
        binding,
        tableName: "custom_storage",
      }),
    });

    await storage.set("key", "value");
    expect(await storage.get("key")).toBe("value");
  });
});
