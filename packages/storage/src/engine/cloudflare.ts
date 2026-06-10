import type Cloudflare from "cloudflare";
import type { ClientOptions } from "cloudflare";
import type {
  NamespaceBulkDeleteResponse,
  NamespaceBulkGetResponse,
  NamespaceBulkUpdateParams,
  NamespaceBulkUpdateResponse,
} from "cloudflare/resources/kv/namespaces/namespaces";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

import { chunkArray } from "../utility.ts";

const CLOUDFLARE_KV_BULK_GET_LIMIT = 100;
const CLOUDFLARE_KV_BULK_MUTATION_LIMIT = 10_000;

/**
 * Minimal Cloudflare Workers KV binding interface used by {@link CloudflareKvStorageEngine}.
 */
export interface CloudflareKvBinding {
  delete(key: string): Promise<void>;
  get(key: string, options: { readonly type: "arrayBuffer" }): Promise<ArrayBuffer | null>;
  list(options?: {
    readonly prefix?: string;
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<CloudflareKvBindingListResult>;
  put(key: string, value: Uint8Array, options?: { readonly expirationTtl?: number }): Promise<void>;
}

/**
 * Result returned by Cloudflare KV binding list calls.
 */
export interface CloudflareKvBindingListResult {
  readonly keys: readonly CloudflareKvKey[];
  readonly list_complete: boolean;
  readonly cursor?: string;
}

/**
 * Cloudflare KV key descriptor.
 */
export interface CloudflareKvKey {
  readonly name: string;
}

/**
 * Cloudflare Worker environment bindings map.
 */
export type CloudflareBindings = { readonly [name: string]: unknown };

/**
 * Options for {@link CloudflareKvStorageEngine}.
 */
export interface CloudflareKvEngineOptions extends ClientOptions {
  /**
   * KV binding object or binding name. Binding mode is preferred in Cloudflare Workers.
   */
  readonly binding?: CloudflareKvBinding | string;

  /**
   * Worker environment bindings map used when `binding` is a string.
   */
  readonly bindings?: CloudflareBindings;

  /**
   * Existing Cloudflare API client for client mode.
   */
  readonly client?: Cloudflare;

  /**
   * Cloudflare account ID for API client mode.
   */
  readonly accountId?: string;

  /**
   * Cloudflare KV namespace ID for API client mode.
   */
  readonly namespaceId?: string;

  /**
   * Prefix namespace applied to all KV keys.
   */
  readonly prefix?: string;

  /**
   * Separator between prefix and key. Defaults to `":"`.
   */
  readonly separator?: string;

  /**
   * Maximum number of keys requested per binding list page.
   */
  readonly listLimit?: number;

  /**
   * Default TTL in milliseconds when a write does not provide one.
   */
  readonly defaultTtl?: number;

  /**
   * Minimum TTL accepted by Cloudflare KV in milliseconds. Defaults to 60 seconds.
   */
  readonly minTtl?: number;
}

/**
 * Storage engine backed by Cloudflare KV.
 */
export class CloudflareKvStorageEngine implements StorageEngine {
  readonly name = "cloudflare-kv";

  #client: Cloudflare | undefined;
  readonly #options: CloudflareKvEngineOptions;
  readonly #keyPrefix: string;
  readonly #minTtl: number;

  constructor(options: CloudflareKvEngineOptions) {
    const prefix = options.prefix ?? "";
    const separator = options.separator ?? ":";

    this.#options = options;
    this.#client = options.client;
    this.#keyPrefix = prefix.length === 0 ? "" : `${prefix}${separator}`;
    this.#minTtl = options.minTtl ?? 60_000;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const storageKey = this.#prefixedKey(key);
    const binding = this.#getBinding();
    if (binding !== undefined) {
      const value = await binding.get(storageKey, { type: "arrayBuffer" });
      return value === null ? undefined : new Uint8Array(value).slice();
    }

    try {
      const value = await (
        await this.#getClient()
      ).kv.namespaces.values.get(this.#getNamespaceId(), storageKey, this.#getNamespaceParams());
      return new Uint8Array(await value.arrayBuffer()).slice();
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
    if (keys.length === 0) {
      return new Map();
    }

    const binding = this.#getBinding();
    if (binding !== undefined) {
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

    const values = new Map<string, Uint8Array>();
    const cloudflare = await this.#getClient();
    for (const keyBatch of chunkArray(keys, CLOUDFLARE_KV_BULK_GET_LIMIT)) {
      const storageKeys = keyBatch.map((key) => this.#prefixedKey(key));
      const result = await cloudflare.kv.namespaces.bulkGet(this.#getNamespaceId(), {
        ...this.#getNamespaceParams(),
        keys: storageKeys,
        type: "text",
      });

      for (const [storageKey, value] of Object.entries(result?.values ?? {})) {
        if (value !== null && value !== undefined) {
          values.set(this.#unprefixKey(storageKey), decodeCloudflareBulkValue(value));
        }
      }
    }
    return values;
  }

  async set(key: string, value: Uint8Array, setOptions?: StorageEngineSetOptions): Promise<void> {
    const storageKey = this.#prefixedKey(key);
    const ttl = resolveCloudflareTtl(setOptions, this.#options, this.#minTtl);
    if (ttl !== undefined && ttl <= 0) {
      await this.#remove(storageKey);
      return;
    }

    const binding = this.#getBinding();
    if (binding !== undefined) {
      await binding.put(storageKey, value.slice(), cloudflareBindingSetOptions(ttl));
      return;
    }

    const { toFile } = await import("cloudflare");
    await (
      await this.#getClient()
    ).kv.namespaces.values.update(this.#getNamespaceId(), storageKey, {
      ...this.#getNamespaceParams(),
      ...cloudflareApiSetOptions(ttl),
      value: await toFile(value, "value"),
    });
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const binding = this.#getBinding();
    if (binding !== undefined) {
      await Promise.all(items.map((item) => this.set(item.key, item.value, item.options)));
      return;
    }

    const writes: NamespaceBulkUpdateParams.Body[] = [];
    const deletes: string[] = [];
    for (const item of items) {
      const storageKey = this.#prefixedKey(item.key);
      const ttl = resolveCloudflareTtl(item.options, this.#options, this.#minTtl);
      if (ttl !== undefined && ttl <= 0) {
        deletes.push(storageKey);
        continue;
      }

      writes.push({
        key: storageKey,
        value: encodeCloudflareBulkValue(item.value),
        base64: true,
        ...cloudflareApiSetOptions(ttl),
      });
    }

    const cloudflare = await this.#getClient();
    for (const deleteBatch of chunkArray(deletes, CLOUDFLARE_KV_BULK_MUTATION_LIMIT)) {
      const result = await cloudflare.kv.namespaces.bulkDelete(this.#getNamespaceId(), {
        ...this.#getNamespaceParams(),
        body: [...deleteBatch],
      });
      checkCloudflareBulkOperation("delete", deleteBatch.length, result);
    }
    for (const writeBatch of chunkArray(writes, CLOUDFLARE_KV_BULK_MUTATION_LIMIT)) {
      const result = await cloudflare.kv.namespaces.bulkUpdate(this.#getNamespaceId(), {
        ...this.#getNamespaceParams(),
        body: [...writeBatch],
      });
      checkCloudflareBulkOperation("write", writeBatch.length, result);
    }
  }

  async delete(key: string): Promise<boolean> {
    const storageKey = this.#prefixedKey(key);
    const exists = (await this.get(key)) !== undefined;
    if (!exists) {
      return false;
    }
    await this.#remove(storageKey);
    return true;
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    const binding = this.#getBinding();
    if (binding !== undefined) {
      let deleted = 0;
      await Promise.all(
        keys.map(async (key) => {
          if (await this.delete(key)) {
            deleted++;
          }
        }),
      );
      return deleted;
    }

    return await this.#removeMany(keys.map((key) => this.#prefixedKey(key)));
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async keys(keyOptions?: StorageEngineKeyOptions): Promise<readonly string[]> {
    return (await this.#listKeys(keyOptions)).map((key) => this.#unprefixKey(key));
  }

  async clear(keyOptions?: StorageEngineKeyOptions): Promise<void> {
    const keys = await this.#listKeys(keyOptions);
    await this.#removeMany(keys);
  }

  async #getClient(): Promise<Cloudflare> {
    if (this.#client !== undefined) {
      return this.#client;
    }
    if (this.#options.accountId === undefined || this.#options.namespaceId === undefined) {
      throw new TypeError(
        "Cloudflare KV client mode requires accountId and namespaceId when no client is provided",
      );
    }

    const { default: CloudflareClient } = await import("cloudflare");
    this.#client = new CloudflareClient(cloudflareClientOptions(this.#options));

    return this.#client;
  }

  #getNamespaceParams(): { readonly account_id: string } {
    if (this.#options.accountId === undefined) {
      throw new TypeError("Cloudflare KV client mode requires accountId");
    }
    return { account_id: this.#options.accountId };
  }

  #getNamespaceId(): string {
    if (this.#options.namespaceId === undefined) {
      throw new TypeError("Cloudflare KV client mode requires namespaceId");
    }
    return this.#options.namespaceId;
  }

  #getBinding(): CloudflareKvBinding | undefined {
    return resolveCloudflareBinding(this.#options);
  }

  #prefixedKey(key: string): string {
    return `${this.#keyPrefix}${key}`;
  }

  #unprefixKey(key: string): string {
    return this.#keyPrefix.length === 0 ? key : key.slice(this.#keyPrefix.length);
  }

  #listPrefix(keyOptions: StorageEngineKeyOptions | undefined): string {
    return this.#prefixedKey(keyOptions?.prefix ?? "");
  }

  async #listKeys(keyOptions: StorageEngineKeyOptions | undefined): Promise<readonly string[]> {
    const matchPrefix = this.#listPrefix(keyOptions);
    const binding = this.#getBinding();
    if (binding !== undefined) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const result = await binding.list({
          cursor,
          limit: this.#options.listLimit,
          prefix: matchPrefix.length === 0 ? undefined : matchPrefix,
        });
        keys.push(...result.keys.map((key) => key.name));
        cursor = result.list_complete ? undefined : result.cursor;
      } while (cursor !== undefined);
      return keys;
    }

    const cloudflare = await this.#getClient();
    const keys: string[] = [];
    for await (const key of cloudflare.kv.namespaces.keys.list(this.#getNamespaceId(), {
      ...this.#getNamespaceParams(),
      limit: this.#options.listLimit,
      prefix: matchPrefix.length === 0 ? undefined : matchPrefix,
    })) {
      keys.push(key.name);
    }
    return keys;
  }

  async #remove(storageKey: string): Promise<void> {
    const binding = this.#getBinding();
    if (binding !== undefined) {
      await binding.delete(storageKey);
      return;
    }
    await (
      await this.#getClient()
    ).kv.namespaces.values.delete(this.#getNamespaceId(), storageKey, this.#getNamespaceParams());
  }

  async #removeMany(storageKeys: readonly string[]): Promise<number> {
    if (storageKeys.length === 0) {
      return 0;
    }

    const binding = this.#getBinding();
    if (binding !== undefined) {
      await Promise.all(storageKeys.map((key) => binding.delete(key)));
      return storageKeys.length;
    }

    const cloudflare = await this.#getClient();
    let deleted = 0;
    for (const keyBatch of chunkArray(storageKeys, CLOUDFLARE_KV_BULK_MUTATION_LIMIT)) {
      const result = await cloudflare.kv.namespaces.bulkDelete(this.#getNamespaceId(), {
        ...this.#getNamespaceParams(),
        body: [...keyBatch],
      });
      checkCloudflareBulkOperation("delete", keyBatch.length, result);
      deleted += result?.successful_key_count ?? keyBatch.length;
    }
    return deleted;
  }
}

function cloudflareBindingSetOptions(
  ttl: number | undefined,
): { readonly expirationTtl?: number } | undefined {
  if (ttl === undefined) {
    return undefined;
  }
  return { expirationTtl: Math.ceil(ttl / 1000) };
}

function cloudflareApiSetOptions(
  ttl: number | undefined,
): { readonly expiration_ttl?: number } | undefined {
  if (ttl === undefined) {
    return undefined;
  }
  return { expiration_ttl: Math.ceil(ttl / 1000) };
}

function encodeCloudflareBulkValue(value: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value).toString("base64");
  }

  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeCloudflareBulkValue(value: CloudflareBulkGetValue): Uint8Array {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null
        ? JSON.stringify(value)
        : String(value);
  return new TextEncoder().encode(text);
}

function checkCloudflareBulkOperation(
  operation: string,
  expectedCount: number,
  result: NamespaceBulkDeleteResponse | NamespaceBulkUpdateResponse | null,
): void {
  const unsuccessfulKeys = result?.unsuccessful_keys ?? [];
  if (unsuccessfulKeys.length > 0) {
    throw new Error(
      `Cloudflare KV bulk ${operation} failed for keys: ${unsuccessfulKeys.join(", ")}`,
    );
  }
  if (result?.successful_key_count !== undefined && result.successful_key_count !== expectedCount) {
    throw new Error(
      `Cloudflare KV bulk ${operation} succeeded for ${result.successful_key_count} of ${expectedCount} keys`,
    );
  }
}

function cloudflareClientOptions(options: CloudflareKvEngineOptions): ClientOptions {
  return {
    apiEmail: options.apiEmail,
    apiKey: options.apiKey,
    apiToken: options.apiToken,
    apiVersion: options.apiVersion,
    baseURL: options.baseURL,
    defaultHeaders: options.defaultHeaders,
    defaultQuery: options.defaultQuery,
    fetch: options.fetch,
    httpAgent: options.httpAgent,
    maxRetries: options.maxRetries,
    timeout: options.timeout,
    userServiceKey: options.userServiceKey,
  };
}

function resolveCloudflareBinding(
  options: CloudflareKvEngineOptions,
): CloudflareKvBinding | undefined {
  if (options.binding === undefined) {
    return undefined;
  }
  if (typeof options.binding !== "string") {
    return options.binding;
  }
  const binding = options.bindings?.[options.binding];
  if (binding === undefined) {
    throw new TypeError(`Cloudflare binding ${options.binding} was not found`);
  }
  if (!isCloudflareKvBinding(binding)) {
    throw new TypeError(`Cloudflare binding ${options.binding} is not a KV binding`);
  }
  return binding;
}

function isCloudflareKvBinding(value: unknown): value is CloudflareKvBinding {
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

function resolveCloudflareTtl(
  setOptions: StorageEngineSetOptions | undefined,
  engineOptions: CloudflareKvEngineOptions,
  minTtl: number,
): number | undefined {
  const ttl = setOptions?.ttl ?? engineOptions.defaultTtl;
  if (ttl === undefined || ttl <= 0) {
    return ttl;
  }
  return Math.max(ttl, minTtl);
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { readonly status?: unknown }).status === 404
  );
}

type CloudflareBulkGetValue =
  NonNullable<NonNullable<NamespaceBulkGetResponse["values"]>[string]> extends infer TValue
    ? TValue extends { readonly value: infer TMetadataValue }
      ? TMetadataValue
      : TValue
    : never;

export type { StorageEngineSetManyItem };
