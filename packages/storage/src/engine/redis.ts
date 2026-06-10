import type { ClusterNode, ClusterOptions, RedisOptions } from "ioredis";

import { Buffer } from "node:buffer";

import type {
  StorageEngine,
  StorageEngineCompareAndSetManyItem,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

import { toBuffer, toUint8Array } from "../utility.ts";

/**
 * How {@link RedisStorageEngine.dispose} closes the Redis connection.
 */
export type RedisEngineDisposeMode = "disconnect" | "quit" | false;

/**
 * Minimal ioredis client interface used by {@link RedisStorageEngine}.
 */
export interface RedisEngineClient {
  del(...keys: string[]): Promise<number>;
  disconnect(): void;
  eval(script: string, keyCount: number, ...args: unknown[]): Promise<unknown>;
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

/**
 * Options for {@link RedisStorageEngine}.
 */
export interface RedisEngineOptions extends RedisOptions {
  /**
   * Existing ioredis-compatible client.
   */
  readonly client?: RedisEngineClient;

  /**
   * Redis connection URL used when constructing a client.
   */
  readonly url?: string;

  /**
   * Cluster nodes used when constructing an ioredis cluster client.
   */
  readonly cluster?: readonly ClusterNode[];

  /**
   * Cluster options forwarded to ioredis.
   */
  readonly clusterOptions?: ClusterOptions;

  /**
   * Prefix namespace applied to all engine keys.
   */
  readonly prefix?: string;

  /**
   * Separator between prefix and key. Defaults to `":"`.
   */
  readonly separator?: string;

  /**
   * Optional Redis `SCAN` count hint for key iteration.
   */
  readonly scanCount?: number;

  /**
   * Default TTL in milliseconds when a write does not provide one.
   */
  readonly defaultTtl?: number;

  /**
   * Dispose behavior. Defaults to `"disconnect"` for internally created clients and `false` for provided clients.
   */
  readonly dispose?: RedisEngineDisposeMode;
}

/**
 * Storage engine backed by Redis.
 */
export class RedisStorageEngine implements StorageEngine {
  readonly name = "redis";

  #client: RedisEngineClient | undefined;
  readonly #options: RedisEngineOptions;
  readonly #prefix: string;
  readonly #separator: string;
  readonly #disposeMode: RedisEngineDisposeMode;

  constructor(options: RedisEngineOptions = {}) {
    this.#options = options;
    this.#client = options.client;
    this.#prefix = options.prefix ?? "";
    this.#separator = options.separator ?? ":";
    this.#disposeMode = options.dispose ?? (options.client ? false : "disconnect");
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const value = await (await this.#getClient()).getBuffer(this.#prefixKey(key));
    return value === null ? undefined : toUint8Array(value);
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
    if (keys.length === 0) {
      return new Map();
    }

    const prefixedKeys = keys.map((key) => this.#prefixKey(key));
    const values = await (await this.#getClient()).mgetBuffer(...prefixedKeys);
    const result = new Map<string, Uint8Array>();
    for (let index = 0; index < keys.length; index++) {
      const value = values[index];
      if (value !== null && value !== undefined) {
        result.set(keys[index]!, toUint8Array(value));
      }
    }
    return result;
  }

  async set(key: string, value: Uint8Array, setOptions?: StorageEngineSetOptions): Promise<void> {
    await setRedisValue(
      await this.#getClient(),
      this.#prefixKey(key),
      value,
      resolveRedisTtl(setOptions, this.#options),
    );
  }

  async compareAndSet(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
    setOptions?: StorageEngineSetOptions,
  ): Promise<boolean> {
    const redis = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    const ttl = resolveRedisTtl(setOptions, this.#options);

    if (expected === undefined) {
      if (value === undefined || (ttl !== undefined && ttl <= 0)) {
        return toRedisBoolean(await redis.eval(COMPARE_ABSENT_SCRIPT, 1, storageKey, "delete"));
      }

      return toRedisBoolean(
        await redis.eval(
          COMPARE_ABSENT_SCRIPT,
          1,
          storageKey,
          "set",
          ttl?.toString() ?? "",
          toBuffer(value),
        ),
      );
    }

    if (value === undefined || (ttl !== undefined && ttl <= 0)) {
      return toRedisBoolean(
        await redis.eval(COMPARE_EXPECTED_SCRIPT, 1, storageKey, toBuffer(expected), "delete"),
      );
    }

    return toRedisBoolean(
      await redis.eval(
        COMPARE_EXPECTED_SCRIPT,
        1,
        storageKey,
        toBuffer(expected),
        "set",
        ttl?.toString() ?? "",
        toBuffer(value),
      ),
    );
  }

  async compareAndSetMany(items: readonly StorageEngineCompareAndSetManyItem[]): Promise<boolean> {
    const redis = await this.#getClient();
    const keys = items.map((item) => this.#prefixKey(item.key));
    const args = items.flatMap((item) => {
      const ttl = resolveRedisTtl(item.options, this.#options);
      const deleteValue = item.value === undefined || (ttl !== undefined && ttl <= 0);
      return [
        item.expected === undefined ? "absent" : "value",
        item.expected === undefined ? "" : toBuffer(item.expected),
        deleteValue ? "delete" : "set",
        deleteValue ? "" : (ttl?.toString() ?? ""),
        deleteValue ? "" : toBuffer(item.value),
      ];
    });
    return toRedisBoolean(await redis.eval(COMPARE_MANY_SCRIPT, keys.length, ...keys, ...args));
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    const redis = await this.#getClient();
    await Promise.all(
      items.map((item) =>
        setRedisValue(
          redis,
          this.#prefixKey(item.key),
          item.value,
          resolveRedisTtl(item.options, this.#options),
        ),
      ),
    );
  }

  async delete(key: string): Promise<boolean> {
    return (await (await this.#getClient()).del(this.#prefixKey(key))) > 0;
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    return (await this.#getClient()).del(...keys.map((key) => this.#prefixKey(key)));
  }

  async has(key: string): Promise<boolean> {
    return (await (await this.#getClient()).exists(this.#prefixKey(key))) > 0;
  }

  async keys(keyOptions?: StorageEngineKeyOptions): Promise<readonly string[]> {
    return (await this.#scanKeys(keyOptions)).map((key) => this.#unprefixKey(key));
  }

  async clear(keyOptions?: StorageEngineKeyOptions): Promise<void> {
    const keys = await this.#scanKeys(keyOptions);
    if (keys.length === 0) {
      return;
    }
    await (await this.#getClient()).del(...keys);
  }

  async dispose(): Promise<void> {
    if (this.#client === undefined || this.#disposeMode === false) {
      return;
    }
    if (this.#disposeMode === "quit") {
      await this.#client.quit();
      return;
    }
    this.#client.disconnect();
  }

  async #getClient(): Promise<RedisEngineClient> {
    if (this.#client !== undefined) {
      return this.#client;
    }

    const ioredis = await import("ioredis");
    if (this.#options.cluster) {
      this.#client = new ioredis.Cluster([...this.#options.cluster], this.#options.clusterOptions);
      return this.#client;
    }

    if (this.#options.url) {
      this.#client = new ioredis.Redis(this.#options.url, this.#options);
      return this.#client;
    }

    this.#client = new ioredis.Redis(this.#options);
    return this.#client;
  }

  #prefixKey(key: string): string {
    if (this.#prefix.length === 0) {
      return key;
    }
    return `${this.#prefix}${this.#separator}${key}`;
  }

  #unprefixKey(key: string): string {
    if (this.#prefix.length === 0) {
      return key;
    }
    const expectedPrefix = `${this.#prefix}${this.#separator}`;
    return key.startsWith(expectedPrefix) ? key.slice(expectedPrefix.length) : key;
  }

  async #scanKeys(keyOptions: StorageEngineKeyOptions | undefined): Promise<string[]> {
    const redis = await this.#getClient();
    const pattern = `${escapeRedisGlob(this.#prefixKey(keyOptions?.prefix ?? ""))}*`;
    const keys: string[] = [];
    let cursor = "0";

    do {
      const [nextCursor, batch] =
        this.#options.scanCount === undefined
          ? await redis.scan(cursor, "MATCH", pattern)
          : await redis.scan(cursor, "MATCH", pattern, "COUNT", this.#options.scanCount.toString());
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== "0");

    return keys;
  }
}

const COMPARE_ABSENT_SCRIPT = `
  if redis.call("EXISTS", KEYS[1]) == 1 then
    return 0
  end

  if ARGV[1] == "delete" then
    return 1
  end

  if ARGV[2] == "" then
    redis.call("SET", KEYS[1], ARGV[3])
  else
    redis.call("PSETEX", KEYS[1], tonumber(ARGV[2]), ARGV[3])
  end

  return 1
`;

const COMPARE_EXPECTED_SCRIPT = `
  local current = redis.call("GET", KEYS[1])
  if current == false or current ~= ARGV[1] then
    return 0
  end

  if ARGV[2] == "delete" then
    redis.call("DEL", KEYS[1])
    return 1
  end

  if ARGV[3] == "" then
    redis.call("SET", KEYS[1], ARGV[4])
  else
    redis.call("PSETEX", KEYS[1], tonumber(ARGV[3]), ARGV[4])
  end

  return 1
`;

const COMPARE_MANY_SCRIPT = `
  local count = #KEYS

  for index = 1, count do
    local offset = ((index - 1) * 5)
    local expected_mode = ARGV[offset + 1]
    local expected_value = ARGV[offset + 2]
    local current = redis.call("GET", KEYS[index])

    if expected_mode == "absent" then
      if current ~= false then
        return 0
      end
    else
      if current == false or current ~= expected_value then
        return 0
      end
    end
  end

  for index = 1, count do
    local offset = ((index - 1) * 5)
    local operation = ARGV[offset + 3]
    local ttl = ARGV[offset + 4]
    local value = ARGV[offset + 5]

    if operation == "delete" then
      redis.call("DEL", KEYS[index])
    elseif ttl == "" then
      redis.call("SET", KEYS[index], value)
    else
      redis.call("PSETEX", KEYS[index], tonumber(ttl), value)
    end
  end

  return 1
`;

async function setRedisValue(
  client: RedisEngineClient,
  key: string,
  value: Uint8Array,
  ttl: number | undefined,
): Promise<void> {
  const buffer = toBuffer(value);
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

function toRedisBoolean(value: unknown): boolean {
  return Number(value) === 1;
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

/**
 * Engine batch item types accepted by Redis storage operations.
 */
export type { StorageEngineCompareAndSetManyItem, StorageEngineSetManyItem };
