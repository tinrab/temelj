import { RedisContainer } from "@testcontainers/redis";
import { expect, test } from "vitest";

import { createStorage } from "../storage.ts";
import { RedisStorageEngine } from "./redis.ts";

test(
  "redis engine stores values, scans prefixes, and expires keys",
  { tags: ["container"] },
  async () => {
    await using container = await new RedisContainer("redis:8.6-alpine").start();
    const storage = createStorage({
      engine: new RedisStorageEngine({
        url: container.getConnectionUrl(),
        prefix: `temelj-storage-${Date.now()}`,
        scanCount: 10,
      }),
    });

    try {
      await storage.set("users:1", { name: "Verso" });
      await storage.set("users:2", { name: "Maelle" });
      await storage.set("sessions:1", "active", { ttl: 100 });
      await storage.set("sessions:expired", "gone", { ttl: 0 });

      expect(await storage.get("users:1")).toEqual({ name: "Verso" });
      expect(await storage.has("users:2")).toBe(true);
      expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);
      expect(await storage.get("sessions:expired")).toBeUndefined();

      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(await storage.get("sessions:1")).toBeUndefined();

      expect(await storage.delete("users:2")).toBe(true);
      await storage.clear();
      expect(await storage.keys()).toEqual([]);
    } finally {
      await storage.dispose();
    }
  },
);

test("redis engine treats scan prefixes as literal strings", { tags: ["container"] }, async () => {
  await using container = await new RedisContainer("redis:8.6-alpine").start();
  const namespace = `temelj-storage-[literal]*?-${Date.now()}`;
  const storage = createStorage({
    engine: new RedisStorageEngine({
      url: container.getConnectionUrl(),
      prefix: namespace,
      scanCount: 10,
    }),
  });
  const adjacentStorage = createStorage({
    engine: new RedisStorageEngine({
      url: container.getConnectionUrl(),
      prefix: namespace.replace("[literal]*?", "X"),
      scanCount: 10,
    }),
  });

  try {
    await storage.set("literal*:one", 1);
    await storage.set("literalX:two", 2);
    await adjacentStorage.set("literal*:outside", 3);

    expect(await storage.keys({ prefix: "literal*:" })).toEqual(["literal*:one"]);

    await storage.clear({ prefix: "literal*:" });
    expect(await storage.keys()).toEqual(["literalX:two"]);
    expect(await adjacentStorage.get("literal*:outside")).toBe(3);
  } finally {
    await storage.dispose();
    await adjacentStorage.dispose();
  }
});
