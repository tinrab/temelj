import { describe, expect, test, vi } from "vitest";

import { createStorage } from "../storage.ts";
import { createLibSqlEngine } from "./libsql.ts";

describe("libSQL engine", () => {
  test("stores bytes, scans prefixes, and clears values", async () => {
    const storage = createStorage({
      engine: createLibSqlEngine({
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
      engine: createLibSqlEngine(),
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
      engine: createLibSqlEngine(),
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
});
