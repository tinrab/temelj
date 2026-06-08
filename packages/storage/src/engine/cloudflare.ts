import type { ClientOptions } from "cloudflare";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

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

export interface CloudflareKvBindingListResult {
  readonly keys: readonly CloudflareKvKey[];
  readonly list_complete: boolean;
  readonly cursor?: string;
}

export interface CloudflareKvKey {
  readonly name: string;
}

export type CloudflareBindings = { readonly [name: string]: unknown };

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

export interface CloudflareKvEngineOptions extends ClientOptions {
  readonly binding?: CloudflareKvBinding | string;
  readonly bindings?: CloudflareBindings;
  readonly client?: CloudflareKvClient;
  readonly accountId?: string;
  readonly namespaceId?: string;
  readonly prefix?: string;
  readonly separator?: string;
  readonly listLimit?: number;
  readonly defaultTtl?: number;
  readonly minTtl?: number;
}

export function createCloudflareKvEngine(options: CloudflareKvEngineOptions): StorageEngine {
  const prefix = options.prefix ?? "";
  const separator = options.separator ?? ":";
  const keyPrefix = prefix.length === 0 ? "" : `${prefix}${separator}`;
  const minTtl = options.minTtl ?? 60_000;
  let client: CloudflareKvClient | undefined = options.client;
  const getBinding = (): CloudflareKvBinding | undefined => resolveCloudflareBinding(options);

  const prefixedKey = (key: string): string => `${keyPrefix}${key}`;
  const unprefixKey = (key: string): string =>
    keyPrefix.length === 0 ? key : key.slice(keyPrefix.length);
  const listPrefix = (keyOptions: StorageEngineKeyOptions | undefined): string =>
    prefixedKey(keyOptions?.prefix ?? "");

  const getClient = async (): Promise<CloudflareKvClient> => {
    if (client !== undefined) {
      return client;
    }
    if (options.accountId === undefined || options.namespaceId === undefined) {
      throw new TypeError(
        "Cloudflare KV client mode requires accountId and namespaceId when no client is provided",
      );
    }

    const { default: Cloudflare } = await import("cloudflare");
    client = new Cloudflare(cloudflareClientOptions(options));
    return client;
  };

  const getNamespaceParams = (): { readonly account_id: string } => {
    if (options.accountId === undefined) {
      throw new TypeError("Cloudflare KV client mode requires accountId");
    }
    return { account_id: options.accountId };
  };

  const getNamespaceId = (): string => {
    if (options.namespaceId === undefined) {
      throw new TypeError("Cloudflare KV client mode requires namespaceId");
    }
    return options.namespaceId;
  };

  const listKeys = async (
    keyOptions: StorageEngineKeyOptions | undefined,
  ): Promise<readonly string[]> => {
    const matchPrefix = listPrefix(keyOptions);
    const binding = getBinding();
    if (binding !== undefined) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const result = await binding.list({
          cursor,
          limit: options.listLimit,
          prefix: matchPrefix.length === 0 ? undefined : matchPrefix,
        });
        keys.push(...result.keys.map((key) => key.name));
        cursor = result.list_complete ? undefined : result.cursor;
      } while (cursor !== undefined);
      return keys;
    }

    const cloudflare = await getClient();
    const keys: string[] = [];
    for await (const key of cloudflare.kv.namespaces.keys.list(getNamespaceId(), {
      ...getNamespaceParams(),
      limit: options.listLimit,
      prefix: matchPrefix.length === 0 ? undefined : matchPrefix,
    })) {
      keys.push(key.name);
    }
    return keys;
  };

  const get = async (key: string): Promise<Uint8Array | undefined> => {
    const storageKey = prefixedKey(key);
    const binding = getBinding();
    if (binding !== undefined) {
      const value = await binding.get(storageKey, { type: "arrayBuffer" });
      return value === null ? undefined : new Uint8Array(value).slice();
    }

    try {
      const value = await (
        await getClient()
      ).kv.namespaces.values.get(getNamespaceId(), storageKey, getNamespaceParams());
      return new Uint8Array(await value.arrayBuffer()).slice();
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  };

  const set = async (
    key: string,
    value: Uint8Array,
    setOptions: StorageEngineSetOptions | undefined,
  ): Promise<void> => {
    const storageKey = prefixedKey(key);
    const ttl = resolveCloudflareTtl(setOptions, options, minTtl);
    if (ttl !== undefined && ttl <= 0) {
      await remove(storageKey);
      return;
    }

    const binding = getBinding();
    if (binding !== undefined) {
      await binding.put(storageKey, value.slice(), cloudflareBindingSetOptions(ttl));
      return;
    }

    const { toFile } = await import("cloudflare");
    await (
      await getClient()
    ).kv.namespaces.values.update(getNamespaceId(), storageKey, {
      ...getNamespaceParams(),
      ...cloudflareApiSetOptions(ttl),
      value: await toFile(value, "value"),
    });
  };

  const remove = async (storageKey: string): Promise<void> => {
    const binding = getBinding();
    if (binding !== undefined) {
      await binding.delete(storageKey);
      return;
    }
    await (
      await getClient()
    ).kv.namespaces.values.delete(getNamespaceId(), storageKey, getNamespaceParams());
  };

  return {
    name: "cloudflare-kv",

    get,

    async getMany(keys) {
      const values = new Map<string, Uint8Array>();
      await Promise.all(
        keys.map(async (key) => {
          const value = await get(key);
          if (value !== undefined) {
            values.set(key, value);
          }
        }),
      );
      return values;
    },

    set,

    async setMany(items) {
      await Promise.all(items.map((item) => set(item.key, item.value, item.options)));
    },

    async delete(key) {
      const storageKey = prefixedKey(key);
      const exists = (await get(key)) !== undefined;
      if (!exists) {
        return false;
      }
      await remove(storageKey);
      return true;
    },

    async deleteMany(keys) {
      let deleted = 0;
      await Promise.all(
        keys.map(async (key) => {
          if (await this.delete(key)) {
            deleted++;
          }
        }),
      );
      return deleted;
    },

    async has(key) {
      return (await get(key)) !== undefined;
    },

    async keys(keyOptions) {
      return (await listKeys(keyOptions)).map((key) => unprefixKey(key));
    },

    async clear(keyOptions) {
      const keys = await listKeys(keyOptions);
      await Promise.all(keys.map((key) => remove(key)));
    },
  };
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
