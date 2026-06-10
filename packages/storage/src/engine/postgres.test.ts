import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, test } from "vitest";

import { createStorage } from "../storage.ts";
import { PostgresStorageEngine, type PostgresEngineClient } from "./postgres.ts";

describe("postgres engine", () => {
  test("stores values, scans prefixes, and expires records", { tags: ["container"] }, async () => {
    await using container = await new PostgreSqlContainer("postgres:18.4-alpine")
      .withDatabase("temelj")
      .withUsername("temelj")
      .withPassword("temelj")
      .start();
    const storage = createStorage({
      engine: new PostgresStorageEngine({
        prefix: `temelj-storage-${Date.now()}`,
        url: container.getConnectionUri(),
      }),
    });

    try {
      await storage.set("users:1", { name: "Verso" });
      await storage.set("users:2", { name: "Maelle" });
      await storage.set("sessions:1", "active", { ttl: 100 });
      await storage.set("sessions:expired", "gone", { ttl: 0 });
      await storage.set("sessions:delete-expired", "gone", { ttl: 20 });
      await storage.set("sessions:delete-many-expired", "gone", { ttl: 20 });

      expect(await storage.get("users:1")).toEqual({ name: "Verso" });
      expect(await storage.has("users:2")).toBe(true);
      expect(await storage.keys({ prefix: "users:" })).toEqual(
        expect.arrayContaining(["users:1", "users:2"]),
      );
      expect(await storage.get("sessions:expired")).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await storage.get("sessions:1")).toBeUndefined();
      expect(await storage.delete("sessions:delete-expired")).toBe(false);
      expect(await storage.deleteMany(["sessions:delete-many-expired"])).toBe(0);

      expect(await storage.deleteMany(["users:1", "users:2"])).toBe(2);
      await storage.clear();
      expect(await storage.keys()).toEqual([]);
    } finally {
      await storage.dispose();
    }
  });

  test("compares and sets many records atomically", { tags: ["container"] }, async () => {
    await using container = await new PostgreSqlContainer("postgres:18.4-alpine")
      .withDatabase("temelj")
      .withUsername("temelj")
      .withPassword("temelj")
      .start();
    const storage = createStorage({
      engine: new PostgresStorageEngine({
        prefix: `temelj-storage-cas-${Date.now()}`,
        url: container.getConnectionUri(),
      }),
    });

    try {
      await storage.set("cas:1", "one");

      await expect(
        storage.compareAndSetMany([
          { key: "cas:1", expected: "one", value: "two" },
          { key: "cas:2", expected: undefined, value: "created" },
        ]),
      ).resolves.toBe(true);
      await expect(storage.getMany(["cas:1", "cas:2"])).resolves.toEqual(["two", "created"]);

      await expect(
        storage.compareAndSetMany([
          { key: "cas:1", expected: "one", value: "failed" },
          { key: "cas:3", expected: undefined, value: "should-not-exist" },
        ]),
      ).resolves.toBe(false);
      await expect(storage.getMany(["cas:1", "cas:2", "cas:3"])).resolves.toEqual([
        "two",
        "created",
        undefined,
      ]);
    } finally {
      await storage.dispose();
    }
  });

  test("removes expired rows during get and zero-ttl set", async () => {
    const rows: object[][] = [[{ value: new Uint8Array([1]), expires_at: Date.now() - 1 }], [], []];
    const calls: Array<{ readonly query: string; readonly parameters?: readonly unknown[] }> = [];
    const unsafe: PostgresEngineClient["unsafe"] = async <TRow extends object>(
      query: string,
      parameters?: readonly unknown[],
    ): Promise<TRow[]> => {
      calls.push({ query, parameters });
      return (rows.shift() ?? []) as TRow[];
    };
    const engine = new PostgresStorageEngine({
      client: { unsafe },
      initialize: false,
    });

    expect(await engine.get("sessions:1")).toBeUndefined();
    await engine.set("sessions:2", new Uint8Array([2]), { ttl: 0 });

    expect(calls[1]?.query).toContain('DELETE FROM "temelj_storage" WHERE key = $1');
    expect(calls[1]?.parameters).toEqual(["sessions:1"]);
    expect(calls[2]?.query).toContain('DELETE FROM "temelj_storage" WHERE key = $1');
    expect(calls[2]?.parameters).toEqual(["sessions:2"]);
  });

  test("compares and sets rows conditionally", async () => {
    const rows: object[][] = [
      [],
      [],
      [{ inserted: 1 }],
      [],
      [{ exists: 1 }],
      [],
      [],
      [],
      [{ updated: 1 }],
      [],
      [{ deleted: 1 }],
    ];
    const calls: Array<{ readonly query: string; readonly parameters?: readonly unknown[] }> = [];
    const unsafe: PostgresEngineClient["unsafe"] = async <TRow extends object>(
      query: string,
      parameters?: readonly unknown[],
    ): Promise<TRow[]> => {
      calls.push({ query, parameters });
      return (rows.shift() ?? []) as TRow[];
    };
    const engine = new PostgresStorageEngine({
      client: { unsafe },
      initialize: false,
    });

    await expect(engine.compareAndSet?.("users:1", undefined, new Uint8Array([1]))).resolves.toBe(
      true,
    );
    await expect(engine.compareAndSet?.("users:1", undefined, new Uint8Array([2]))).resolves.toBe(
      false,
    );
    await expect(
      engine.compareAndSet?.("users:1", new Uint8Array([2]), new Uint8Array([3])),
    ).resolves.toBe(false);
    await expect(
      engine.compareAndSet?.("users:1", new Uint8Array([1]), new Uint8Array([2])),
    ).resolves.toBe(true);
    await expect(engine.compareAndSet?.("users:1", new Uint8Array([2]), undefined)).resolves.toBe(
      true,
    );

    expect(calls[2]?.query).toContain("ON CONFLICT (key) DO NOTHING");
    expect(calls[2]?.parameters?.[0]).toBe("users:1");
    expect(calls[6]?.query).toContain("UPDATE");
    expect(calls[6]?.query).toContain("WHERE key = $3 AND value = $4");
    expect(calls[8]?.query).toContain("UPDATE");
    expect(calls[10]?.query).toContain("DELETE FROM");
    expect(calls[10]?.query).toContain("WHERE key = $1 AND value = $2");
  });

  test("compares and sets many rows in a transaction", async () => {
    const rows: object[][] = [
      [],
      [],
      [{ key: "users:1", value: new Uint8Array([1]) }],
      [],
      [{ inserted: 1 }],
      [],
      [],
      [],
      [{ key: "users:1", value: new Uint8Array([2]) }],
      [],
    ];
    const calls: Array<{ readonly query: string; readonly parameters?: readonly unknown[] }> = [];
    const unsafe: PostgresEngineClient["unsafe"] = async <TRow extends object>(
      query: string,
      parameters?: readonly unknown[],
    ): Promise<TRow[]> => {
      calls.push({ query, parameters });
      return (rows.shift() ?? []) as TRow[];
    };
    const engine = new PostgresStorageEngine({
      client: { unsafe },
      initialize: false,
    });

    await expect(
      engine.compareAndSetMany?.([
        { key: "users:1", expected: new Uint8Array([1]), value: new Uint8Array([2]) },
        { key: "users:2", expected: undefined, value: new Uint8Array([3]) },
        { key: "users:3", expected: undefined, value: undefined },
      ]),
    ).resolves.toBe(true);
    await expect(
      engine.compareAndSetMany?.([
        { key: "users:1", expected: new Uint8Array([1]), value: new Uint8Array([4]) },
        { key: "users:2", expected: undefined, value: new Uint8Array([5]) },
      ]),
    ).resolves.toBe(false);

    expect(calls[0]?.query).toBe("BEGIN");
    expect(calls[2]?.query).toContain("FOR UPDATE");
    expect(calls[2]?.parameters).toEqual([["users:1", "users:2", "users:3"]]);
    expect(calls[3]?.query).toContain("INSERT INTO");
    expect(calls[4]?.query).toContain("INSERT INTO");
    expect(calls[5]?.query).toContain('DELETE FROM "temelj_storage" WHERE key = $1');
    expect(calls[6]?.query).toBe("COMMIT");
    expect(calls[7]?.query).toBe("BEGIN");
    expect(calls[9]?.query).toContain("FOR UPDATE");
    expect(calls[10]?.query).toBe("ROLLBACK");
  });
});
