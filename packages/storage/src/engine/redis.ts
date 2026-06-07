import type { ClusterNode, ClusterOptions, RedisOptions } from "ioredis";

import { Buffer } from "node:buffer";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

export type RedisEngineDisposeMode = "disconnect" | "quit" | false;

export interface RedisEngineClient {
  del(...keys: string[]): Promise<number>;
  disconnect(): void;
  exists(key: string): Promise<number>;
  getBuffer(key: string): Promise<Buffer | null>;
  mgetBuffer(...keys: string[]): Promise<Array<Buffer | null>>;
  quit(): Promise<unknown>;
  scan(cursor: string, match: "MATCH", pattern: string): Promise<[string, string[]]>;
  scan(
    cursor: string,
    match: "MATCH",
    pattern: string,
    count: "COUNT",
    countValue: string,
  ): Promise<[string, string[]]>;
  set(key: string, value: Buffer): Promise<unknown>;
  set(key: string, value: Buffer, mode: "PX", ttl: number): Promise<unknown>;
}

export interface RedisEngineOptions extends RedisOptions {
  readonly client?: RedisEngineClient;
  readonly url?: string;
  readonly cluster?: readonly ClusterNode[];
  readonly clusterOptions?: ClusterOptions;
  readonly prefix?: string;
  readonly separator?: string;
  readonly scanCount?: number;
  readonly defaultTtl?: number;
  readonly dispose?: RedisEngineDisposeMode;
}

export function createRedisEngine(options: RedisEngineOptions = {}): StorageEngine {
  let client: RedisEngineClient | undefined = options.client;
  const prefix = options.prefix ?? "";
  const separator = options.separator ?? ":";
  const disposeMode = options.dispose ?? (options.client ? false : "disconnect");

  const getClient = async (): Promise<RedisEngineClient> => {
    if (client !== undefined) {
      return client;
    }

    const ioredis = await import("ioredis");
    if (options.cluster) {
      client = new ioredis.Cluster([...options.cluster], options.clusterOptions);
      return client;
    }

    if (options.url) {
      client = new ioredis.Redis(options.url, options);
      return client;
    }

    client = new ioredis.Redis(options);
    return client;
  };

  const prefixKey = (key: string): string => {
    if (prefix.length === 0) {
      return key;
    }
    return `${prefix}${separator}${key}`;
  };

  const unprefixKey = (key: string): string => {
    if (prefix.length === 0) {
      return key;
    }
    const expectedPrefix = `${prefix}${separator}`;
    return key.startsWith(expectedPrefix) ? key.slice(expectedPrefix.length) : key;
  };

  const scanKeys = async (keyOptions: StorageEngineKeyOptions | undefined): Promise<string[]> => {
    const redis = await getClient();
    const pattern = `${escapeRedisGlob(prefixKey(keyOptions?.prefix ?? ""))}*`;
    const keys: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] =
        options.scanCount === undefined
          ? await redis.scan(cursor, "MATCH", pattern)
          : await redis.scan(cursor, "MATCH", pattern, "COUNT", options.scanCount.toString());
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    return keys;
  };

  return {
    name: "redis",

    async get(key) {
      const value = await (await getClient()).getBuffer(prefixKey(key));
      return value === null ? undefined : toUint8Array(value);
    },

    async getMany(keys) {
      if (keys.length === 0) {
        return new Map();
      }

      const prefixedKeys = keys.map((key) => prefixKey(key));
      const values = await (await getClient()).mgetBuffer(...prefixedKeys);
      const result = new Map<string, Uint8Array>();
      for (let index = 0; index < keys.length; index++) {
        const value = values[index];
        if (value !== null && value !== undefined) {
          result.set(keys[index]!, toUint8Array(value));
        }
      }
      return result;
    },

    async set(key, value, setOptions) {
      await setRedisValue(
        await getClient(),
        prefixKey(key),
        value,
        resolveRedisTtl(setOptions, options),
      );
    },

    async setMany(items) {
      const redis = await getClient();
      await Promise.all(
        items.map((item) =>
          setRedisValue(
            redis,
            prefixKey(item.key),
            item.value,
            resolveRedisTtl(item.options, options),
          ),
        ),
      );
    },

    async delete(key) {
      return (await (await getClient()).del(prefixKey(key))) > 0;
    },

    async deleteMany(keys) {
      if (keys.length === 0) {
        return 0;
      }
      return (await getClient()).del(...keys.map((key) => prefixKey(key)));
    },

    async has(key) {
      return (await (await getClient()).exists(prefixKey(key))) > 0;
    },

    async keys(keyOptions) {
      return (await scanKeys(keyOptions)).map((key) => unprefixKey(key));
    },

    async clear(keyOptions) {
      const keys = await scanKeys(keyOptions);
      if (keys.length === 0) {
        return;
      }
      await (await getClient()).del(...keys);
    },

    async dispose() {
      if (client === undefined || disposeMode === false) {
        return;
      }
      if (disposeMode === "quit") {
        await client.quit();
        return;
      }
      client.disconnect();
    },
  };
}

async function setRedisValue(
  client: RedisEngineClient,
  key: string,
  value: Uint8Array,
  ttl: number | undefined,
): Promise<void> {
  const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (ttl !== undefined && ttl <= 0) {
    await client.del(key);
    return;
  }

  if (ttl === undefined) {
    await client.set(key, buffer);
    return;
  }
  await client.set(key, buffer, "PX", ttl);
}

function resolveRedisTtl(
  setOptions: StorageEngineSetOptions | undefined,
  engineOptions: RedisEngineOptions,
): number | undefined {
  return setOptions?.ttl ?? engineOptions.defaultTtl;
}

function toUint8Array(value: Buffer): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}

function escapeRedisGlob(value: string): string {
  let escaped = "";
  for (const character of value) {
    if (
      character === "*" ||
      character === "?" ||
      character === "[" ||
      character === "]" ||
      character === "\\"
    ) {
      escaped += "\\";
    }
    escaped += character;
  }
  return escaped;
}

export type { StorageEngineSetManyItem };
