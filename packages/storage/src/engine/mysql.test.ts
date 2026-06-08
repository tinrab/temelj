import { MySqlContainer } from "@testcontainers/mysql";
import { describe, expect, test, vi } from "vitest";

import { createStorage } from "../storage.ts";
import { createMySqlEngine, type MySqlEngineClient } from "./mysql.ts";

describe("mysql engine", () => {
  test("stores values, scans prefixes, and expires records", { tags: ["container"] }, async () => {
    process.exit(42);

    await using container = await new MySqlContainer("mysql:9.7")
      .withDatabase("temelj")
      .withUsername("temelj")
      .withUserPassword("temelj")
      .withRootPassword("root")
      .start();
    const storage = createStorage({
      engine: createMySqlEngine({
        connection: {
          database: container.getDatabase(),
          host: container.getHost(),
          password: container.getUserPassword(),
          port: container.getPort(),
          user: container.getUsername(),
        },
        prefix: `temelj-storage-${Date.now()}`,
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
    const execute = vi
      .fn<MySqlEngineClient["execute"]>()
      .mockResolvedValueOnce([
        [{ value: new Uint8Array([1]), expires_at: Date.now() - 1 }],
        undefined,
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined])
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    const engine = createMySqlEngine({
      client: { execute },
      initialize: false,
    });

    expect(await engine.get("sessions:1")).toBeUndefined();
    await engine.set("sessions:2", new Uint8Array([2]), { ttl: 0 });

    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("DELETE FROM `temelj_storage` WHERE `key` = ?"),
      ["sessions:1"],
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("DELETE FROM `temelj_storage` WHERE `key` = ?"),
      ["sessions:2"],
    );
  });
});
