import { describe, expect, expectTypeOf, test } from "vitest";

import type { JsonStorageValue, StorageCodec, StorageEngine, StoredValue } from "../types.ts";

import { CloudflareKvStorageEngine } from "../engine/cloudflare/kv.ts";
import { IndexedDbStorageEngine } from "../engine/indexed-db.ts";
import { InMemoryStorageEngine } from "../engine/memory.ts";
import { RedisStorageEngine } from "../engine/redis.ts";
import { createStorage } from "../storage.ts";
import { createIdentityStorageCodec } from "./identity.ts";
import { createJsonStorageCodec } from "./json.ts";

describe("typed persisted values", () => {
  test("JSON supports string and byte formats", () => {
    const stringCodec = createJsonStorageCodec({ format: "string" });
    const bytesCodec = createJsonStorageCodec({ format: "bytes" });

    expectTypeOf(stringCodec).toMatchTypeOf<StorageCodec<JsonStorageValue, string>>();
    expectTypeOf(bytesCodec).toMatchTypeOf<StorageCodec<JsonStorageValue, Uint8Array>>();
    expect(stringCodec.decode(stringCodec.encode({ answer: 42 }))).toEqual({ answer: 42 });
    expect(bytesCodec.decode(bytesCodec.encode({ answer: 42 }))).toEqual({ answer: 42 });
  });

  test("identity values and engines defensively copy bytes", async () => {
    const codec = createIdentityStorageCodec<StoredValue>();
    const source = new Uint8Array([1, 2, 3]);
    const encoded = codec.encode(source);
    source[0] = 9;
    expect(encoded).toEqual(new Uint8Array([1, 2, 3]));

    const engine = new InMemoryStorageEngine<StoredValue>();
    const storage = createStorage({ codec, engine });
    await storage.set("text", "value");
    await storage.set("number", 42);
    await storage.set("bytes", encoded);
    expect(await storage.getMany(["text", "number", "bytes"])).toEqual([
      "value",
      42,
      new Uint8Array([1, 2, 3]),
    ]);
    expect(await engine.compareAndSet("number", 42, 43)).toBe(true);
    expect(await engine.compareAndSet("text", "wrong", "next")).toBe(false);
    expect(await engine.compareAndSet("bytes", new Uint8Array([1, 2, 3]), source)).toBe(true);
  });

  test("matching engine and codec representations are inferred", () => {
    expectTypeOf(
      createStorage({
        codec: createIdentityStorageCodec<number>(),
        engine: new InMemoryStorageEngine<number>(),
      }).engine,
    ).toMatchTypeOf<StorageEngine<number>>();

    createStorage({
      // @ts-expect-error A string codec cannot write to a byte engine.
      codec: createJsonStorageCodec({ format: "string" }),
      engine: new InMemoryStorageEngine<Uint8Array>(),
    });

    expectTypeOf<IndexedDbStorageEngine<StoredValue>>().toMatchTypeOf<StorageEngine<StoredValue>>();
    expectTypeOf<RedisStorageEngine<"string">>().toMatchTypeOf<StorageEngine<string>>();
    expectTypeOf<RedisStorageEngine<"bytes">>().toMatchTypeOf<StorageEngine<Uint8Array>>();
    expectTypeOf<CloudflareKvStorageEngine<"string">>().toMatchTypeOf<StorageEngine<string>>();
  });
});
