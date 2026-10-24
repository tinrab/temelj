import { isFunction, isObject } from "@temelj/value";
import { Redis } from "ioredis";
import { createPool, type Pool } from "mysql2/promise";
import { expect, test, vi } from "vitest";

import { MySqlStorageEngine } from "./mysql.ts";
import { RedisStorageEngine } from "./redis.ts";

test("concurrent first MySQL operations share one native pool", async () => {
  const seed = createPool({});
  const prototype: unknown = Object.getPrototypeOf(seed);
  await seed.end();

  if (!isObject(prototype) || !("execute" in prototype) || !isFunction(prototype.execute)) {
    throw new Error("Expected the native MySQL pool prototype");
  }

  const clients = new Set<Pool>();

  // SAFETY: This is the checked prototype of createPool's result, with the driver's execute contract.
  const execute = vi
    .spyOn(prototype as Pick<Pool, "execute">, "execute")
    .mockImplementation(function (this: Pool) {
      clients.add(this);

      return Promise.resolve([[], []]);
    });

  const engine = new MySqlStorageEngine({ format: "string" });

  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => engine.get(`key-${index}`)));
    expect(clients.size).toBe(1);
  } finally {
    execute.mockRestore();
    await engine.dispose();

    for (const client of clients) {
      await client.end();
    }
  }
});

test("concurrent first Redis operations share one native client", async () => {
  const clients = new Set<Redis>();

  const get = vi.spyOn(Redis.prototype, "get").mockImplementation(function (this: Redis) {
    clients.add(this);

    return Promise.resolve(null);
  });

  const engine = new RedisStorageEngine({ format: "string", lazyConnect: true });

  try {
    await Promise.all(Array.from({ length: 8 }, (_, index) => engine.get(`key-${index}`)));
    expect(clients.size).toBe(1);
  } finally {
    get.mockRestore();
    await engine.dispose();

    for (const client of clients) {
      client.disconnect();
    }
  }
});
