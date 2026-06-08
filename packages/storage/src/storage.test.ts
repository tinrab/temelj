import { err } from "@temelj/result";
import { describe, expect, expectTypeOf, test, vi } from "vitest";

import {
  createBytesStorageCodec,
  createJsonStorageCodec,
  createPrimitivizedJsonStorageCodec,
  createSuperJsonStorageCodec,
  createTextStorageCodec,
} from "./codec/mod.ts";
import { createInMemoryEngine } from "./engine/memory.ts";
import { createStorage } from "./storage.ts";
import {
  StorageOperationError,
  StorageKeyError,
  StorageSerializationError,
  type StorageChangeEvent,
  type StorageEngine,
  type StorageEngineWatchHandler,
  type StorageEngineUnwatch,
} from "./types.ts";

type TestItems = {
  readonly "user:1": {
    readonly id: string;
    readonly name: string;
  };
  readonly "flags:enabled": boolean;
  readonly nullable: null;
};

describe("createStorage", () => {
  test("stores and reads typed JSON values", async () => {
    const storage = createStorage<TestItems>();

    await storage.set("user:1", { id: "1", name: "Verso" });
    await storage.set("flags:enabled", true);
    await storage.set("nullable", null);

    const user = await storage.get("user:1");
    expectTypeOf(user).toEqualTypeOf<TestItems["user:1"] | undefined>();
    expect(user).toEqual({ id: "1", name: "Verso" });
    expect(await storage.get("flags:enabled")).toBe(true);
    expect(await storage.get("nullable")).toBeNull();
    expect(await storage.get("missing")).toBeUndefined();
  });

  test("round-trips richer values with the default codec", async () => {
    const storage = createStorage();
    const createdAt = new Date("2026-06-06T00:00:00.000Z");

    await storage.set("date", createdAt);
    await storage.set("map", new Map([["a", 1]]));

    expect(await storage.get("date")).toEqual(createdAt);
    expect(await storage.get("map")).toEqual(new Map([["a", 1]]));
  });

  test("returns results from try methods", async () => {
    const storage = createStorage();

    await expect(storage.trySet("count", 1)).resolves.toEqual({ kind: "ok", value: undefined });
    await expect(storage.tryGet("count")).resolves.toEqual({ kind: "ok", value: 1 });
    await expect(storage.tryDelete("count")).resolves.toEqual({ kind: "ok", value: true });
    await expect(storage.tryHas("count")).resolves.toEqual({ kind: "ok", value: false });
  });

  test("supports batch operations and prefix scans", async () => {
    const storage = createStorage();

    await storage.setMany([
      { key: "users:1", value: { name: "Verso" } },
      { key: "users:2", value: { name: "Maelle" } },
      { key: "posts:1", value: { title: "Drafts" } },
    ]);

    expect(await storage.keys()).toEqual(["posts:1", "users:1", "users:2"]);
    expect(await storage.keys({ prefix: "users:" })).toEqual(["users:1", "users:2"]);
    expect(await storage.getMany(["users:1", "missing", "posts:1"])).toEqual([
      { name: "Verso" },
      undefined,
      { title: "Drafts" },
    ]);
    expect(await storage.entries({ prefix: "users:" })).toEqual([
      { key: "users:1", value: { name: "Verso" } },
      { key: "users:2", value: { name: "Maelle" } },
    ]);

    expect(await storage.deleteMany(["users:1", "missing"])).toBe(1);
    await storage.clear({ prefix: "users:" });
    expect(await storage.keys()).toEqual(["posts:1"]);
  });

  test("expires in-memory values by ttl", async () => {
    vi.useFakeTimers();
    try {
      const storage = createStorage();
      await storage.set("session", "active", { ttl: 1000 });

      expect(await storage.get("session")).toBe("active");
      await vi.advanceTimersByTimeAsync(1000);
      expect(await storage.get("session")).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects invalid expiration dates", async () => {
    const storage = createStorage();

    const result = await storage.trySet("session", "active", {
      expiresAt: new Date(Number.NaN),
    });

    expect(result).toEqual({
      kind: "error",
      error: expect.any(StorageKeyError),
    });
  });

  test("keeps long in-memory ttl values until their timestamp expires", async () => {
    vi.useFakeTimers();
    try {
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const storage = createStorage();

      await storage.set("session", "active", { ttl: 3_000_000_000 });

      expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 2_147_483_647);
      await vi.advanceTimersByTimeAsync(1);
      expect(await storage.get("session")).toBe("active");
    } finally {
      vi.useRealTimers();
    }
  });

  test("stores byte copies in the in-memory engine", async () => {
    const engine = createInMemoryEngine();
    const bytes = new Uint8Array([1, 2, 3]);

    await engine.set("bytes", bytes);
    bytes[0] = 9;

    const stored = await engine.get("bytes");
    expect(stored).toEqual(new Uint8Array([1, 2, 3]));
    if (stored !== undefined) {
      stored[1] = 9;
    }
    expect(await engine.get("bytes")).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("turns engine failures into operation errors", async () => {
    const failure = new Error("backend unavailable");
    const engine: StorageEngine = {
      name: "broken",
      async get() {
        throw failure;
      },
      async set() {
        throw failure;
      },
      async delete() {
        throw failure;
      },
      async keys() {
        throw failure;
      },
      async clear() {
        throw failure;
      },
    };
    const storage = createStorage({ engine });

    await expect(storage.get("key")).rejects.toThrow(StorageOperationError);
    const result = await storage.tryGet("key");
    expect(result).toEqual({
      kind: "error",
      error: expect.any(StorageOperationError),
    });
    expect(result.kind === "error" ? result.error.cause : undefined).toBe(failure);
  });

  test("returns key and serialization errors from try methods", async () => {
    const storage = createStorage();

    await expect(storage.get("")).rejects.toThrow(StorageKeyError);
    const keyResult = await storage.tryGet("");
    expect(keyResult.kind).toBe("error");

    const jsonStorage = createStorage({
      codec: createJsonStorageCodec(),
    });
    const value = undefined as never;
    const setResult = await jsonStorage.trySet("bad", value);
    expect(setResult).toEqual({
      kind: "error",
      error: expect.any(StorageSerializationError),
    });
  });

  test("try results can be matched with result helpers", async () => {
    const storage = createStorage({
      engine: {
        name: "broken",
        async get() {
          throw new Error("failure");
        },
        async set() {},
        async delete() {
          return false;
        },
        async keys() {
          return [];
        },
        async clear() {},
      },
    });

    const result = await storage.tryGet("key");
    expect(result).toEqual(err(result.kind === "error" ? result.error : undefined));
  });

  test("emits typed events for local storage mutations", async () => {
    const storage = createStorage();
    const changes: StorageChangeEvent[] = [];
    const setHandler = vi.fn<(event: unknown, eventName: string) => void>();
    const failingHandler = vi.fn<(event: unknown, eventName: string) => void>(() => {
      throw new Error("listener failed");
    });

    const offChange = storage.on("storage:change", (event) => {
      changes.push(event);
    });
    storage.on("storage:set", setHandler);
    storage.on("storage:set", failingHandler);

    await expect(storage.set("users:1", { name: "Verso" })).resolves.toBeUndefined();
    await storage.setMany([
      { key: "users:2", value: { name: "Maelle" } },
      { key: "posts:1", value: { title: "Drafts" } },
    ]);
    await storage.delete("missing");
    await storage.deleteMany(["users:1", "users:2"]);
    await storage.clear({ prefix: "posts:" });

    expect(setHandler).toHaveBeenCalledWith(
      {
        type: "set",
        key: "users:1",
        source: "storage",
      },
      "storage:set",
    );
    expect(failingHandler).toHaveBeenCalledTimes(1);
    expect(changes).toEqual([
      {
        type: "set",
        key: "users:1",
        source: "storage",
      },
      {
        type: "setMany",
        keys: ["users:2", "posts:1"],
        source: "storage",
      },
      {
        type: "delete",
        key: "missing",
        deleted: false,
        source: "storage",
      },
      {
        type: "deleteMany",
        keys: ["users:1", "users:2"],
        deleted: 2,
        source: "storage",
      },
      {
        type: "clear",
        prefix: "posts:",
        source: "storage",
      },
    ]);

    offChange();
    await storage.set("ignored", true);
    expect(changes).toHaveLength(5);
  });

  test("manages event listeners", async () => {
    const storage = createStorage();
    const once = vi.fn<() => void>();
    const persistent = vi.fn<() => void>();

    storage.once("storage:set", once);
    const off = storage.on("storage:set", persistent);

    expect(storage.listenerCount("storage:set")).toBe(2);
    expect(storage.listeners("storage:set")).toHaveLength(2);

    await storage.set("first", 1);
    await storage.set("second", 2);

    expect(once).toHaveBeenCalledTimes(1);
    expect(persistent).toHaveBeenCalledTimes(2);

    off();
    expect(storage.listenerCount("storage:set")).toBe(0);

    storage.on("storage:set", persistent);
    storage.clearListeners("storage:set");
    await storage.set("third", 3);
    expect(persistent).toHaveBeenCalledTimes(2);
  });

  test("watches local and engine-native changes until unsubscribed", async () => {
    let handler: StorageEngineWatchHandler | undefined;
    const unwatch = vi.fn<StorageEngineUnwatch>(() => {});
    const engine: StorageEngine = {
      name: "watchable",
      async get() {
        return undefined;
      },
      async set() {},
      async delete() {
        return true;
      },
      async keys() {
        return [];
      },
      async clear() {},
      watch(next) {
        handler = next;
        return unwatch;
      },
    };
    const storage = createStorage({ engine });
    const changes: StorageChangeEvent[] = [];

    const unsubscribe = await storage.watch((event) => {
      changes.push(event);
    });

    await storage.set("local", "value");
    handler?.({ type: "set", key: "remote" });
    handler?.({ type: "delete", key: "removed" });
    handler?.({ type: "clear", prefix: "remote:" });

    expect(changes).toEqual([
      {
        type: "set",
        key: "local",
        source: "storage",
      },
      {
        type: "set",
        key: "remote",
        source: "engine",
      },
      {
        type: "delete",
        key: "removed",
        deleted: true,
        source: "engine",
      },
      {
        type: "clear",
        prefix: "remote:",
        source: "engine",
      },
    ]);

    storage.clearListeners();
    await storage.set("still-watched", "value");
    expect(changes).toHaveLength(5);

    const failingUnsubscribe = await storage.watch(() => {
      throw new Error("watch failed");
    });
    await expect(storage.set("watch-failure", "value")).resolves.toBeUndefined();
    expect(changes).toHaveLength(6);

    await failingUnsubscribe();
    expect(unwatch).not.toHaveBeenCalled();

    await unsubscribe();
    expect(unwatch).toHaveBeenCalledTimes(1);

    await storage.set("after", "value");
    expect(changes).toHaveLength(6);
  });

  test("supports async disposal", async () => {
    const dispose = vi.fn<() => Promise<void>>(async () => {});
    const storage = createStorage({
      engine: {
        name: "disposable",
        async get() {
          return undefined;
        },
        async set() {},
        async delete() {
          return false;
        },
        async keys() {
          return [];
        },
        async clear() {},
        dispose,
      },
    });
    expectTypeOf(storage).toExtend<AsyncDisposable>();

    await storage[Symbol.asyncDispose]();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  test("stores plain text with the text codec", async () => {
    const storage = createStorage<{ readonly greeting: string }>({
      codec: createTextStorageCodec(),
    });

    await storage.set("greeting", "hello");

    expect(await storage.get("greeting")).toBe("hello");
    expect(await storage.engine.get("greeting")).toEqual(new TextEncoder().encode("hello"));
  });

  test("infers arbitrary key values from the codec", async () => {
    const storage = createStorage({
      codec: createTextStorageCodec(),
    });

    await storage.set("message", "hello");
    const assertTypes = () => {
      // @ts-expect-error Text storage only accepts string values.
      void storage.set("count", 1);
    };
    void assertTypes;

    await expect(storage.get("message")).resolves.toBe("hello");
  });

  test("stores byte arrays with the bytes codec without leaking mutation", async () => {
    const storage = createStorage<{ readonly bytes: Uint8Array }>({
      codec: createBytesStorageCodec(),
    });
    const bytes = new Uint8Array([1, 2, 3]);

    await storage.set("bytes", bytes);
    bytes[0] = 9;

    const stored = await storage.get("bytes");
    expect(stored).toEqual(new Uint8Array([1, 2, 3]));
    if (stored) {
      stored[1] = 9;
    }
    expect(await storage.get("bytes")).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("stores richer values with the superjson codec", async () => {
    type RichItems = {
      readonly profile: {
        readonly createdAt: Date;
        readonly visits: bigint;
        readonly roles: Set<string>;
      };
    };
    const storage = createStorage<RichItems>({
      codec: createSuperJsonStorageCodec<RichItems[keyof RichItems]>(),
    });
    const value = {
      createdAt: new Date("2026-06-06T12:00:00.000Z"),
      visits: 12n,
      roles: new Set(["admin", "editor"]),
    };

    await storage.set("profile", value);

    const stored = await storage.get("profile");
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(stored?.createdAt.toISOString()).toBe("2026-06-06T12:00:00.000Z");
    expect(stored?.visits).toBe(12n);
    expect(stored?.roles).toEqual(new Set(["admin", "editor"]));
  });

  test("stores primitivized values with the primitivized json codec", async () => {
    const storage = createStorage({
      codec: createPrimitivizedJsonStorageCodec(),
    });

    await storage.set("value", {
      entries: new Map([
        ["a", 1],
        ["b", 2],
      ]),
      items: new Set(["x", "y"]),
    });

    expect(await storage.get("value")).toEqual({
      entries: {
        a: 1,
        b: 2,
      },
      items: ["x", "y"],
    });
  });
});
