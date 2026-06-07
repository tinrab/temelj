import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, expect, test } from "vitest";

import { createStorage } from "../storage.ts";
import { createPostgresEngine, type PostgresEngineClient } from "./postgres.ts";

describe("postgres engine", () => {
  test("stores values, scans prefixes, and expires records", { tags: ["container"] }, async () => {
    await using container = await new PostgreSqlContainer("postgres:18.4-alpine")
      .withDatabase("temelj")
      .withUsername("temelj")
      .withPassword("temelj")
      .start();
    const storage = createStorage({
      engine: createPostgresEngine({
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
    const engine = createPostgresEngine({
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
});
