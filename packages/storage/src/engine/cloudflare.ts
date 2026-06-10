import type { ClientOptions } from "cloudflare";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

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
 * Minimal Cloudflare API client interface used by {@link CloudflareKvStorageEngine}.
 */
export interface CloudflareKvClient {
  readonly kv: {
    readonly namespaces: {
      readonly keys: {
        list(
          namespaceId: string,
          params: {
            readonly account_id: string;
            readonly prefix?: string;
            readonly limit?: number;
          },
        ): AsyncIterable<CloudflareKvKey>;
      };
      readonly values: {
        delete(
          namespaceId: string,
          key: string,
          params: { readonly account_id: string },
        ): Promise<unknown>;
        get(
          namespaceId: string,
          key: string,
          params: { readonly account_id: string },
        ): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
        update(
          namespaceId: string,
          key: string,
          params: {
            readonly account_id: string;
            readonly value: unknown;
            readonly expiration_ttl?: number;
          },
        ): Promise<unknown>;
      };
    };
  };
}

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
  readonly client?: CloudflareKvClient;

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

  #client: CloudflareKvClient | undefined;
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
    await Promise.all(items.map((item) => this.set(item.key, item.value, item.options)));
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

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async keys(keyOptions?: StorageEngineKeyOptions): Promise<readonly string[]> {
    return (await this.#listKeys(keyOptions)).map((key) => this.#unprefixKey(key));
  }

  async clear(keyOptions?: StorageEngineKeyOptions): Promise<void> {
    const keys = await this.#listKeys(keyOptions);
    await Promise.all(keys.map((key) => this.#remove(key)));
  }

  async #getClient(): Promise<CloudflareKvClient> {
    if (this.#client !== undefined) {
      return this.#client;
    }
    if (this.#options.accountId === undefined || this.#options.namespaceId === undefined) {
      throw new TypeError(
        "Cloudflare KV client mode requires accountId and namespaceId when no client is provided",
      );
    }

    const { default: Cloudflare } = await import("cloudflare");
    this.#client = new Cloudflare(cloudflareClientOptions(this.#options));
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

export type { StorageEngineSetManyItem };
