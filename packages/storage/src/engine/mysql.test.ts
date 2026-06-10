import { MySqlContainer } from "@testcontainers/mysql";
import { describe, expect, test, vi } from "vitest";

import { createStorage } from "../storage.ts";
import { MySqlStorageEngine, type MySqlEngineClient, type MySqlEngineConnection } from "./mysql.ts";

describe("mysql engine", () => {
  test("stores values, scans prefixes, and expires records", { tags: ["container"] }, async () => {
    await using container = await new MySqlContainer("mysql:9.7")
      .withDatabase("temelj")
      .withUsername("temelj")
      .withUserPassword("temelj")
      .withRootPassword("root")
      .start();
    const storage = createStorage({
      engine: new MySqlStorageEngine({
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

  test("compares and sets many records atomically", { tags: ["container"] }, async () => {
    await using container = await new MySqlContainer("mysql:9.7")
      .withDatabase("temelj")
      .withUsername("temelj")
      .withUserPassword("temelj")
      .withRootPassword("root")
      .start();
    const storage = createStorage({
      engine: new MySqlStorageEngine({
        connection: {
          database: container.getDatabase(),
          host: container.getHost(),
          password: container.getUserPassword(),
          port: container.getPort(),
          user: container.getUsername(),
        },
        prefix: `temelj-storage-cas-${Date.now()}`,
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
    const execute = vi
      .fn<MySqlEngineClient["execute"]>()
      .mockResolvedValueOnce([
        [{ value: new Uint8Array([1]), expires_at: Date.now() - 1 }],
        undefined,
      ])
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined])
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    const engine = new MySqlStorageEngine({
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

  test("releases transaction connection when transaction start fails", async () => {
    const startError = new Error("start failed");
    const release = vi.fn<NonNullable<MySqlEngineConnection["release"]>>();
    const rollback = vi.fn<NonNullable<MySqlEngineConnection["rollback"]>>();
    const connection: MySqlEngineConnection = {
      beginTransaction: vi
        .fn<NonNullable<MySqlEngineConnection["beginTransaction"]>>()
        .mockRejectedValue(startError),
      execute: vi.fn<MySqlEngineConnection["execute"]>(),
      release,
      rollback,
    };
    const engine = new MySqlStorageEngine({
      client: {
        execute: vi.fn<MySqlEngineClient["execute"]>(),
        getConnection: async () => connection,
      },
      initialize: false,
    });

    await expect(
      engine.compareAndSetMany?.([
        { key: "users:1", expected: undefined, value: new Uint8Array([1]) },
      ]),
    ).rejects.toBe(startError);
    expect(release).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
  });
});
