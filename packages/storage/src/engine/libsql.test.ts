import { describe, expect, test, vi } from "vitest";

import { createStorage } from "../storage.ts";
import { LibSqlStorageEngine } from "./libsql.ts";

describe("libSQL engine", () => {
  test("stores bytes, scans prefixes, and clears values", async () => {
    const storage = createStorage({
      engine: new LibSqlStorageEngine({
        prefix: "app",
      }),
    });

    try {
      await storage.set("users:1", { name: "Verso" });
      await storage.set("users:2", { name: "Maelle" });
      await storage.set("sessions:1", "active");

      expect(await storage.get("users:1")).toEqual({ name: "Verso" });
      expect(await storage.getMany(["users:1", "missing", "sessions:1"])).toEqual([
        { name: "Verso" },
        undefined,
        "active",
      ]);
      expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);

      await storage.clear({ prefix: "users:" });

      expect(await storage.keys()).toEqual(["sessions:1"]);
    } finally {
      await storage.dispose();
    }
  });

  test("expires values and does not count expired deletes", async () => {
    vi.useFakeTimers();
    const storage = createStorage({
      engine: new LibSqlStorageEngine(),
    });

    try {
      await storage.set("sessions:1", "active", { ttl: 100 });
      await storage.set("sessions:2", "active", { ttl: 100 });
      expect(await storage.get("sessions:1")).toBe("active");

      await vi.advanceTimersByTimeAsync(100);

      expect(await storage.get("sessions:1")).toBeUndefined();
      expect(await storage.delete("sessions:1")).toBe(false);
      expect(await storage.deleteMany(["sessions:2"])).toBe(0);

      await storage.set("sessions:3", "active");
      await storage.set("sessions:3", "expired", { ttl: 0 });
      expect(await storage.get("sessions:3")).toBeUndefined();
    } finally {
      vi.useRealTimers();
      await storage.dispose();
    }
  });

  test("supports setMany, deleteMany, and literal SQL wildcard prefixes", async () => {
    const storage = createStorage({
      engine: new LibSqlStorageEngine(),
    });

    try {
      await storage.setMany([
        { key: "users_%:1", value: { name: "Verso" } },
        { key: "usersX:2", value: { name: "Maelle" } },
        { key: "users_%:3", value: { name: "Renoir" } },
      ]);

      expect(await storage.keys({ prefix: "users_%:" })).toEqual(["users_%:1", "users_%:3"]);
      expect(await storage.deleteMany(["users_%:1", "missing", "users_%:3"])).toBe(2);
      expect(await storage.keys()).toEqual(["usersX:2"]);
    } finally {
      await storage.dispose();
    }
  });

  test("compares and sets values atomically", async () => {
    const storage = createStorage({
      engine: new LibSqlStorageEngine(),
    });

    try {
      await expect(storage.compareAndSet("users:1", undefined, { name: "Verso" })).resolves.toBe(
        true,
      );
      await expect(storage.compareAndSet("users:1", undefined, { name: "Ignored" })).resolves.toBe(
        false,
      );
      await expect(
        storage.compareAndSet("users:1", { name: "Maelle" }, { name: "Ignored" }),
      ).resolves.toBe(false);
      await expect(
        storage.compareAndSet("users:1", { name: "Verso" }, { name: "Maelle" }),
      ).resolves.toBe(true);
      expect(await storage.get("users:1")).toEqual({ name: "Maelle" });

      await expect(storage.compareAndSet("users:1", { name: "Maelle" }, undefined)).resolves.toBe(
        true,
      );
      expect(await storage.get("users:1")).toBeUndefined();
    } finally {
      await storage.dispose();
    }
  });

  test("treats expired compare-and-set rows as absent", async () => {
    vi.useFakeTimers();
    const storage = createStorage({
      engine: new LibSqlStorageEngine(),
    });

    try {
      await storage.set("sessions:1", "active", { ttl: 100 });
      await vi.advanceTimersByTimeAsync(100);

      await expect(storage.compareAndSet("sessions:1", "active", "stale")).resolves.toBe(false);
      await expect(storage.compareAndSet("sessions:1", undefined, "fresh")).resolves.toBe(true);
      expect(await storage.get("sessions:1")).toBe("fresh");
    } finally {
      vi.useRealTimers();
      await storage.dispose();
    }
  });

  test("compares and sets many rows atomically", async () => {
    const storage = createStorage({
      engine: new LibSqlStorageEngine({
        prefix: "app",
      }),
    });

    try {
      await storage.set("users:1", { name: "Verso" });
      await storage.set("users:2", { name: "Maelle" });

      await expect(
        storage.compareAndSetMany([
          { key: "users:1", expected: { name: "Verso" }, value: { name: "Renoir" } },
          { key: "users:2", expected: { name: "Maelle" }, value: undefined },
          { key: "users:3", expected: undefined, value: { name: "Cezanne" } },
        ]),
      ).resolves.toBe(true);
      expect(await storage.getMany(["users:1", "users:2", "users:3"])).toEqual([
        { name: "Renoir" },
        undefined,
        { name: "Cezanne" },
      ]);

      await expect(
        storage.compareAndSetMany([
          { key: "users:1", expected: { name: "Verso" }, value: { name: "Ignored" } },
          { key: "users:3", expected: { name: "Cezanne" }, value: undefined },
        ]),
      ).resolves.toBe(false);
      expect(await storage.getMany(["users:1", "users:3"])).toEqual([
        { name: "Renoir" },
        { name: "Cezanne" },
      ]);
    } finally {
      await storage.dispose();
    }
  });

  test("treats expired compare-and-set-many rows as absent", async () => {
    vi.useFakeTimers();
    const storage = createStorage({
      engine: new LibSqlStorageEngine(),
    });

    try {
      await storage.set("sessions:1", "active", { ttl: 100 });
      await storage.set("sessions:2", "waiting");
      await vi.advanceTimersByTimeAsync(100);

      await expect(
        storage.compareAndSetMany([
          { key: "sessions:1", expected: "active", value: "stale" },
          { key: "sessions:2", expected: "waiting", value: "ready" },
        ]),
      ).resolves.toBe(false);
      expect(await storage.get("sessions:2")).toBe("waiting");

      await expect(
        storage.compareAndSetMany([
          { key: "sessions:1", expected: undefined, value: "fresh" },
          { key: "sessions:2", expected: "waiting", value: "ready" },
        ]),
      ).resolves.toBe(true);
      expect(await storage.getMany(["sessions:1", "sessions:2"])).toEqual(["fresh", "ready"]);
    } finally {
      vi.useRealTimers();
      await storage.dispose();
    }
  });
});
