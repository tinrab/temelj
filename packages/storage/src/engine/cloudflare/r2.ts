import type Cloudflare from "cloudflare";
import type { ClientOptions } from "cloudflare";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../../types.ts";

import {
  cloudflareClientOptions,
  isCloudflareNotFoundError,
  resolveCloudflareBinding,
  resolveCloudflareExpiresAt,
  type CloudflareBindings,
} from "./utility.ts";

const STORAGE_HEADER_LENGTH = 12;
const STORAGE_MAGIC = new Uint8Array([84, 77, 82, 50]);

/**
 * R2 object descriptor needed by the storage engine.
 */
export interface CloudflareR2Object {
  readonly key: string;
}

/**
 * R2 object body returned by binding reads.
 */
export interface CloudflareR2ObjectBody extends CloudflareR2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Result of an R2 binding list operation.
 */
export interface CloudflareR2Objects {
  readonly objects: readonly CloudflareR2Object[];
  readonly truncated: boolean;
  readonly cursor?: string;
}

/**
 * Minimal Cloudflare R2 Worker binding.
 */
export interface CloudflareR2Binding {
  delete(keys: string | string[]): Promise<void>;
  get(key: string): Promise<CloudflareR2ObjectBody | null>;
  list(options?: {
    readonly prefix?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<CloudflareR2Objects>;
  put(key: string, value: Uint8Array): Promise<CloudflareR2Object | null>;
}

/**
 * R2 data-location jurisdiction.
 */
export type CloudflareR2Jurisdiction = "default" | "eu" | "fedramp";

/**
 * Options for {@link CloudflareR2StorageEngine}.
 */
export interface CloudflareR2EngineOptions extends ClientOptions {
  /**
   * R2 binding object or binding name. When omitted, the Cloudflare HTTP API is used.
   */
  readonly binding?: CloudflareR2Binding | string;

  /**
   * Worker environment bindings map used when `binding` is a string.
   */
  readonly bindings?: CloudflareBindings;

  /**
   * Existing Cloudflare API client for HTTP API mode.
   */
  readonly client?: Cloudflare;

  /**
   * Cloudflare account ID for HTTP API mode.
   */
  readonly accountId?: string;

  /**
   * R2 bucket name for HTTP API mode.
   */
  readonly bucketName?: string;

  /**
   * Bucket jurisdiction for HTTP API mode.
   */
  readonly jurisdiction?: CloudflareR2Jurisdiction;

  /**
   * Prefix namespace applied to every object key.
   */
  readonly prefix?: string;

  /**
   * Separator between prefix and key. Defaults to `":"`.
   */
  readonly separator?: string;

  /**
   * Default TTL in milliseconds when a write does not provide one.
   */
  readonly defaultTtl?: number;

  /**
   * Maximum number of objects requested per binding list page.
   */
  readonly listLimit?: number;
}

interface StoredR2Value {
  readonly expiresAt: number;
  readonly value: Uint8Array;
}

/**
 * Storage engine backed by Cloudflare R2 through a Worker binding or the Cloudflare HTTP API.
 */
export class CloudflareR2StorageEngine implements StorageEngine {
  readonly name = "cloudflare-r2";

  #client: Cloudflare | undefined;
  readonly #binding: CloudflareR2Binding | undefined;
  readonly #keyPrefix: string;
  readonly #options: CloudflareR2EngineOptions;

  constructor(options: CloudflareR2EngineOptions) {
    this.#options = options;
    this.#client = options.client;
    this.#binding = resolveCloudflareBinding(
      options.binding,
      options.bindings,
      "R2",
      isCloudflareR2Binding,
    );
    const prefix = options.prefix ?? "";
    this.#keyPrefix = prefix.length === 0 ? "" : `${prefix}${options.separator ?? ":"}`;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const storageKey = this.#prefixedKey(key);
    const stored = await this.#getStoredValue(storageKey);
    if (stored === undefined) {
      return undefined;
    }
    if (stored.expiresAt !== 0 && stored.expiresAt <= Date.now()) {
      await this.#remove(storageKey);
      return undefined;
    }
    return stored.value;
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
    const values = new Map<string, Uint8Array>();
    await Promise.all(
      keys.map(async (key) => {
        const value = await this.get(key);
        if (value !== undefined) {
          values.set(key, value);
        }
      }),
    );
    return values;
  }

  async set(key: string, value: Uint8Array, options?: StorageEngineSetOptions): Promise<void> {
    const storageKey = this.#prefixedKey(key);
    const expiresAt = resolveCloudflareExpiresAt(options, this.#options.defaultTtl);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await this.#remove(storageKey);
      return;
    }

    const stored = encodeStoredValue(value, expiresAt ?? 0);
    if (this.#binding !== undefined) {
      await this.#binding.put(storageKey, stored);
      return;
    }
    await (
      await this.#getClient()
    ).r2.buckets.objects.upload(storageKey, stored, {
      ...this.#httpParams(),
      bucket_name: this.#getBucketName(),
    });
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    await Promise.all(items.map((item) => this.set(item.key, item.value, item.options)));
  }

  async delete(key: string): Promise<boolean> {
    const storageKey = this.#prefixedKey(key);
    if ((await this.get(key)) === undefined) {
      return false;
    }
    await this.#remove(storageKey);
    return true;
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    const existing = (
      await Promise.all(
        keys.map(async (key) => ((await this.get(key)) === undefined ? undefined : key)),
      )
    ).filter((key): key is string => key !== undefined);
    if (existing.length === 0) {
      return 0;
    }

    const storageKeys = existing.map((key) => this.#prefixedKey(key));
    if (this.#binding !== undefined) {
      await this.#binding.delete(storageKeys);
    } else {
      await Promise.all(storageKeys.map(async (key) => this.#remove(key)));
    }
    return storageKeys.length;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async keys(options?: StorageEngineKeyOptions): Promise<readonly string[]> {
    const storageKeys = await this.#listStorageKeys(options);
    const keys: string[] = [];
    for (const storageKey of storageKeys) {
      const stored = await this.#getStoredValue(storageKey);
      if (stored === undefined) {
        continue;
      }
      if (stored.expiresAt !== 0 && stored.expiresAt <= Date.now()) {
        await this.#remove(storageKey);
        continue;
      }
      keys.push(this.#unprefixKey(storageKey));
    }
    return keys;
  }

  async clear(options?: StorageEngineKeyOptions): Promise<void> {
    const keys = await this.#listStorageKeys(options);
    if (keys.length === 0) {
      return;
    }
    if (this.#binding !== undefined) {
      await this.#binding.delete(keys);
      return;
    }
    await Promise.all(keys.map(async (key) => this.#remove(key)));
  }

  async #getStoredValue(storageKey: string): Promise<StoredR2Value | undefined> {
    if (this.#binding !== undefined) {
      const object = await this.#binding.get(storageKey);
      return object === null
        ? undefined
        : decodeStoredValue(new Uint8Array(await object.arrayBuffer()));
    }

    try {
      const response = await (
        await this.#getClient()
      ).r2.buckets.objects.get(storageKey, {
        ...this.#httpParams(),
        bucket_name: this.#getBucketName(),
      });
      return decodeStoredValue(new Uint8Array(await response.arrayBuffer()));
    } catch (error) {
      if (isCloudflareNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async #listStorageKeys(options: StorageEngineKeyOptions | undefined): Promise<string[]> {
    const prefix = this.#prefixedKey(options?.prefix ?? "");
    if (this.#binding !== undefined) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const result = await this.#binding.list({
          cursor,
          limit: this.#options.listLimit,
          prefix,
        });
        keys.push(...result.objects.map((object) => object.key));
        cursor = result.truncated ? result.cursor : undefined;
      } while (cursor !== undefined);
      return keys;
    }

    const keys: string[] = [];
    const cloudflare = await this.#getClient();
    for await (const object of cloudflare.r2.buckets.objects.list(this.#getBucketName(), {
      ...this.#httpParams(),
      prefix,
    })) {
      if (object.key !== undefined) {
        keys.push(object.key);
      }
    }
    return keys;
  }

  async #remove(storageKey: string): Promise<void> {
    if (this.#binding !== undefined) {
      await this.#binding.delete(storageKey);
      return;
    }
    await (
      await this.#getClient()
    ).r2.buckets.objects.delete(storageKey, {
      ...this.#httpParams(),
      bucket_name: this.#getBucketName(),
    });
  }

  async #getClient(): Promise<Cloudflare> {
    if (this.#client !== undefined) {
      return this.#client;
    }
    if (this.#options.accountId === undefined || this.#options.bucketName === undefined) {
      throw new TypeError(
        "Cloudflare R2 HTTP mode requires accountId and bucketName when no binding is provided",
      );
    }
    const { default: CloudflareClient } = await import("cloudflare");
    this.#client = new CloudflareClient(cloudflareClientOptions(this.#options));
    return this.#client;
  }

  #httpParams(): {
    readonly account_id: string;
    readonly jurisdiction?: CloudflareR2Jurisdiction;
  } {
    if (this.#options.accountId === undefined) {
      throw new TypeError("Cloudflare R2 HTTP mode requires accountId");
    }
    return {
      account_id: this.#options.accountId,
      jurisdiction: this.#options.jurisdiction,
    };
  }

  #getBucketName(): string {
    if (this.#options.bucketName === undefined) {
      throw new TypeError("Cloudflare R2 HTTP mode requires bucketName");
    }
    return this.#options.bucketName;
  }

  #prefixedKey(key: string): string {
    return `${this.#keyPrefix}${key}`;
  }

  #unprefixKey(key: string): string {
    return this.#keyPrefix.length === 0 ? key : key.slice(this.#keyPrefix.length);
  }
}

function isCloudflareR2Binding(value: unknown): value is CloudflareR2Binding {
  return (
    typeof value === "object" &&
    value !== null &&
    "delete" in value &&
    "get" in value &&
    "list" in value &&
    "put" in value &&
    typeof value.delete === "function" &&
    typeof value.get === "function" &&
    typeof value.list === "function" &&
    typeof value.put === "function"
  );
}

function encodeStoredValue(value: Uint8Array, expiresAt: number): Uint8Array {
  const stored = new Uint8Array(STORAGE_HEADER_LENGTH + value.byteLength);
  stored.set(STORAGE_MAGIC);
  new DataView(stored.buffer).setFloat64(STORAGE_MAGIC.byteLength, expiresAt);
  stored.set(value, STORAGE_HEADER_LENGTH);
  return stored;
}

function decodeStoredValue(stored: Uint8Array): StoredR2Value {
  if (
    stored.byteLength < STORAGE_HEADER_LENGTH ||
    !STORAGE_MAGIC.every((byte, index) => stored[index] === byte)
  ) {
    throw new TypeError("Cloudflare R2 storage object has an invalid header");
  }
  return {
    expiresAt: new DataView(
      stored.buffer,
      stored.byteOffset + STORAGE_MAGIC.byteLength,
      8,
    ).getFloat64(0),
    value: stored.slice(STORAGE_HEADER_LENGTH),
  };
}

export type { StorageEngineSetManyItem };
