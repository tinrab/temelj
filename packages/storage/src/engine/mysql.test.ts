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
        format: "string",
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
        format: "string",
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

    const engine = new MySqlStorageEngine({ format: "bytes", client: { execute } });

    expect(await engine.get("sessions:1")).toBeUndefined();
    await engine.set("sessions:2", new Uint8Array([2]), { ttl: 0 });

    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("WHERE `key` = ? AND `expires_at` IS NOT NULL AND `expires_at` <= ?"),
      ["sessions:1", expect.any(Number)],
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining("DELETE FROM `temelj_storage` WHERE `key` = ?"),
      ["sessions:2"],
    );
  });

  test("restarts the whole atomic claim after a confirmed deadlock", async () => {
    const execute = vi
      .fn<MySqlEngineConnection["execute"]>()
      .mockRejectedValueOnce(Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK" }))
      .mockResolvedValueOnce([{ affectedRows: 0 }, undefined])
      .mockResolvedValueOnce([[], undefined])
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    const commit = vi.fn<NonNullable<MySqlEngineConnection["commit"]>>().mockResolvedValue();
    const rollback = vi.fn<NonNullable<MySqlEngineConnection["rollback"]>>().mockResolvedValue();
    const release = vi.fn<NonNullable<MySqlEngineConnection["release"]>>();
    const beginTransaction = vi
      .fn<NonNullable<MySqlEngineConnection["beginTransaction"]>>()
      .mockResolvedValue();
    const getConnection = vi
      .fn<NonNullable<MySqlEngineClient["getConnection"]>>()
      .mockResolvedValue({
        beginTransaction,
        execute,
        commit,
        rollback,
        release,
      });
    const engine = new MySqlStorageEngine({ format: "string", client: { execute, getConnection } });
    expect(
      await engine.compareAndSetMany([{ key: "claim", expected: undefined, value: "owner" }]),
    ).toBe(true);
    expect(beginTransaction).toHaveBeenCalledTimes(2);
    expect(rollback).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("DELETE FROM"),
      expect.any(Array),
    );
  });

  test.each(["ER_LOCK_DEADLOCK", "ECONNRESET"])("bounds transaction retry for %s", async (code) => {
    const failure = Object.assign(new Error("driver failure"), { code });
    const release = vi.fn<NonNullable<MySqlEngineConnection["release"]>>();
    const rollback = vi.fn<NonNullable<MySqlEngineConnection["rollback"]>>().mockResolvedValue();
    const beginTransaction = vi
      .fn<NonNullable<MySqlEngineConnection["beginTransaction"]>>()
      .mockResolvedValue();
    const execute = vi.fn<MySqlEngineConnection["execute"]>().mockRejectedValue(failure);
    const getConnection = vi
      .fn<NonNullable<MySqlEngineClient["getConnection"]>>()
      .mockResolvedValue({
        beginTransaction,
        execute,
        rollback,
        release,
      });
    const engine = new MySqlStorageEngine({ format: "string", client: { execute, getConnection } });
    await expect(
      engine.compareAndSetMany([{ key: "claim", expected: undefined, value: "owner" }]),
    ).rejects.toBe(failure);
    const attempts = code === "ER_LOCK_DEADLOCK" ? 5 : 1;
    expect(getConnection).toHaveBeenCalledTimes(attempts);
    expect(beginTransaction).toHaveBeenCalledTimes(attempts);
    expect(rollback).toHaveBeenCalledTimes(attempts);
    expect(release).toHaveBeenCalledTimes(attempts);
  });

  test("does not repeat a claim after an ambiguous commit acknowledgement", async () => {
    const failure = Object.assign(new Error("connection lost during commit"), {
      code: "ECONNRESET",
    });
    const execute = vi
      .fn<MySqlEngineConnection["execute"]>()
      .mockResolvedValueOnce([{ affectedRows: 0 }, undefined])
      .mockResolvedValueOnce([[], undefined])
      .mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    const commit = vi.fn<NonNullable<MySqlEngineConnection["commit"]>>().mockRejectedValue(failure);
    const rollback = vi.fn<NonNullable<MySqlEngineConnection["rollback"]>>().mockResolvedValue();
    const release = vi.fn<NonNullable<MySqlEngineConnection["release"]>>();
    const beginTransaction = vi
      .fn<NonNullable<MySqlEngineConnection["beginTransaction"]>>()
      .mockResolvedValue();
    const getConnection = vi
      .fn<NonNullable<MySqlEngineClient["getConnection"]>>()
      .mockResolvedValue({ beginTransaction, execute, commit, rollback, release });
    const engine = new MySqlStorageEngine({ format: "string", client: { execute, getConnection } });
    await expect(
      engine.compareAndSetMany([{ key: "claim", expected: undefined, value: "owner" }]),
    ).rejects.toBe(failure);
    expect(commit).toHaveBeenCalledOnce();
    expect(getConnection).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(3);
    expect(release).toHaveBeenCalledOnce();
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
      format: "bytes",
      client: {
        execute: vi.fn<MySqlEngineClient["execute"]>(),
        getConnection: async () => connection,
      },
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
