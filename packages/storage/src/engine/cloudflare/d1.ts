import type Cloudflare from "cloudflare";
import type { ClientOptions } from "cloudflare";

import { decodeBase64, encodeBase64 } from "@temelj/string";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../../types.ts";

import {
  cloudflareClientOptions,
  resolveCloudflareBinding,
  resolveCloudflareExpiresAt,
  type CloudflareBindings,
} from "./utility.ts";

/**
 * Value accepted by the D1 binding API.
 */
export type CloudflareD1Value = null | number | string | ArrayBuffer | Uint8Array;

/**
 * Minimal prepared statement interface used by {@link CloudflareD1StorageEngine}.
 */
export interface CloudflareD1PreparedStatement {
  bind(...values: readonly CloudflareD1Value[]): CloudflareD1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<CloudflareD1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<CloudflareD1Result<T>>;
}

/**
 * Minimal D1 query result.
 */
export interface CloudflareD1Result<T = Record<string, unknown>> {
  readonly results?: readonly T[];
  readonly success?: boolean;
  readonly meta?: {
    readonly changes?: number;
    readonly rows_written?: number;
  };
}

/**
 * Minimal Cloudflare D1 Worker binding.
 */
export interface CloudflareD1Binding {
  batch<T = Record<string, unknown>>(
    statements: CloudflareD1PreparedStatement[],
  ): Promise<readonly CloudflareD1Result<T>[]>;
  prepare(query: string): CloudflareD1PreparedStatement;
}

/**
 * Options for {@link CloudflareD1StorageEngine}.
 */
export interface CloudflareD1EngineOptions extends ClientOptions {
  /**
   * D1 binding object or binding name. When omitted, the HTTP API is used.
   */
  readonly binding?: CloudflareD1Binding | string;

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
   * D1 database ID for HTTP API mode.
   */
  readonly databaseId?: string;

  /**
   * SQLite table used by the engine. Defaults to `"temelj_storage"`.
   */
  readonly tableName?: string;

  /**
   * Prefix namespace applied to every key.
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
   * Whether to create the storage table lazily. Defaults to `true`.
   */
  readonly initialize?: boolean;
}

interface D1StorageRow {
  readonly key: string;
  readonly value: string;
  readonly expires_at: number | string;
}

interface D1Query {
  readonly sql: string;
  readonly params: readonly CloudflareD1Value[];
}

/**
 * Storage engine backed by Cloudflare D1 through a Worker binding or the HTTP API.
 */
export class CloudflareD1StorageEngine implements StorageEngine {
  readonly name = "cloudflare-d1";

  #client: Cloudflare | undefined;
  #initializePromise: Promise<void> | undefined;
  readonly #binding: CloudflareD1Binding | undefined;
  readonly #keyPrefix: string;
  readonly #options: CloudflareD1EngineOptions;
  readonly #shouldInitialize: boolean;
  readonly #tableName: string;

  constructor(options: CloudflareD1EngineOptions) {
    this.#options = options;
    this.#client = options.client;
    this.#binding = resolveCloudflareBinding(
      options.binding,
      options.bindings,
      "D1",
      isCloudflareD1Binding,
    );
    this.#tableName = quoteIdentifier(options.tableName ?? "temelj_storage");
    const prefix = options.prefix ?? "";
    this.#keyPrefix = prefix.length === 0 ? "" : `${prefix}${options.separator ?? ":"}`;
    this.#shouldInitialize = options.initialize ?? true;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const storageKey = this.#prefixedKey(key);
    const rows = await this.#query<D1StorageRow>(
      `SELECT key, value, expires_at FROM ${this.#tableName} WHERE key = ? LIMIT 1`,
      [storageKey],
    );
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    if (Number(row.expires_at) !== 0 && Number(row.expires_at) <= Date.now()) {
      await this.#execute(`DELETE FROM ${this.#tableName} WHERE key = ?`, [storageKey]);
      return undefined;
    }
    return decodeBase64(row.value);
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
    if (keys.length === 0) {
      return new Map();
    }
    await this.#deleteExpired();
    const storageKeys = keys.map((key) => this.#prefixedKey(key));
    const rows = await this.#query<D1StorageRow>(
      `SELECT key, value, expires_at FROM ${this.#tableName}
       WHERE key IN (${placeholders(storageKeys.length)})`,
      storageKeys,
    );
    return new Map(rows.map((row) => [this.#unprefixKey(row.key), decodeBase64(row.value)]));
  }

  async set(key: string, value: Uint8Array, options?: StorageEngineSetOptions): Promise<void> {
    const storageKey = this.#prefixedKey(key);
    const expiresAt = resolveCloudflareExpiresAt(options, this.#options.defaultTtl);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await this.#execute(`DELETE FROM ${this.#tableName} WHERE key = ?`, [storageKey]);
      return;
    }
    await this.#execute(
      `INSERT INTO ${this.#tableName} (key, value, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      [storageKey, encodeBase64(value), expiresAt ?? 0],
    );
  }

  async compareAndSet(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
    options?: StorageEngineSetOptions,
  ): Promise<boolean> {
    const storageKey = this.#prefixedKey(key);
    const now = Date.now();
    const expiresAt = resolveCloudflareExpiresAt(options, this.#options.defaultTtl, now);
    const replacement =
      value === undefined || (expiresAt !== undefined && expiresAt <= now) ? undefined : value;

    if (expected === undefined && replacement === undefined) {
      const rows = await this.#query<{ readonly matches: number | string }>(
        `SELECT NOT EXISTS (
          SELECT 1 FROM ${this.#tableName}
          WHERE key = ? AND (expires_at = 0 OR expires_at > ?)
        ) AS matches`,
        [storageKey, now],
      );
      return Number(rows[0]?.matches) === 1;
    }

    if (expected === undefined) {
      const rows = await this.#query<Pick<D1StorageRow, "key">>(
        `INSERT INTO ${this.#tableName} (key, value, expires_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           expires_at = excluded.expires_at
         WHERE ${this.#tableName}.expires_at != 0 AND ${this.#tableName}.expires_at <= ?
         RETURNING key`,
        [storageKey, encodeBase64(replacement!), expiresAt ?? 0, now],
      );
      return rows.length > 0;
    }

    if (replacement === undefined) {
      const rows = await this.#query<Pick<D1StorageRow, "key">>(
        `DELETE FROM ${this.#tableName}
         WHERE key = ? AND value = ? AND (expires_at = 0 OR expires_at > ?)
         RETURNING key`,
        [storageKey, encodeBase64(expected), now],
      );
      return rows.length > 0;
    }

    const rows = await this.#query<Pick<D1StorageRow, "key">>(
      `UPDATE ${this.#tableName}
       SET value = ?, expires_at = ?
       WHERE key = ? AND value = ? AND (expires_at = 0 OR expires_at > ?)
       RETURNING key`,
      [encodeBase64(replacement), expiresAt ?? 0, storageKey, encodeBase64(expected), now],
    );
    return rows.length > 0;
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    if (items.length === 0) {
      return;
    }
    const now = Date.now();
    await this.#batch(
      items.map((item): D1Query => {
        const expiresAt = resolveCloudflareExpiresAt(item.options, this.#options.defaultTtl, now);
        const storageKey = this.#prefixedKey(item.key);
        if (expiresAt !== undefined && expiresAt <= now) {
          return {
            sql: `DELETE FROM ${this.#tableName} WHERE key = ?`,
            params: [storageKey],
          };
        }
        return {
          sql: `INSERT INTO ${this.#tableName} (key, value, expires_at) VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                  value = excluded.value,
                  expires_at = excluded.expires_at`,
          params: [storageKey, encodeBase64(item.value), expiresAt ?? 0],
        };
      }),
    );
  }

  async delete(key: string): Promise<boolean> {
    const rows = await this.#query<Pick<D1StorageRow, "key">>(
      `DELETE FROM ${this.#tableName}
       WHERE key = ? AND (expires_at = 0 OR expires_at > ?)
       RETURNING key`,
      [this.#prefixedKey(key), Date.now()],
    );
    return rows.length > 0;
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    const rows = await this.#query<Pick<D1StorageRow, "key">>(
      `DELETE FROM ${this.#tableName}
       WHERE key IN (${placeholders(keys.length)}) AND (expires_at = 0 OR expires_at > ?)
       RETURNING key`,
      [...keys.map((key) => this.#prefixedKey(key)), Date.now()],
    );
    return rows.length;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async keys(options?: StorageEngineKeyOptions): Promise<readonly string[]> {
    await this.#deleteExpired();
    const rows = await this.#query<Pick<D1StorageRow, "key">>(
      `SELECT key FROM ${this.#tableName} WHERE key LIKE ? ESCAPE '\\' ORDER BY key`,
      [likePattern(this.#prefixedKey(options?.prefix ?? ""))],
    );
    return rows.map((row) => this.#unprefixKey(row.key));
  }

  async clear(options?: StorageEngineKeyOptions): Promise<void> {
    await this.#execute(`DELETE FROM ${this.#tableName} WHERE key LIKE ? ESCAPE '\\'`, [
      likePattern(this.#prefixedKey(options?.prefix ?? "")),
    ]);
  }

  async #initialize(): Promise<void> {
    if (!this.#shouldInitialize) {
      return;
    }
    this.#initializePromise ??= this.#execute(
      `CREATE TABLE IF NOT EXISTS ${this.#tableName} (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
      [],
      false,
    );
    await this.#initializePromise;
  }

  async #deleteExpired(): Promise<void> {
    await this.#execute(
      `DELETE FROM ${this.#tableName} WHERE expires_at != 0 AND expires_at <= ?`,
      [Date.now()],
    );
  }

  async #query<TRow>(
    sql: string,
    params: readonly CloudflareD1Value[],
    initialize = true,
  ): Promise<readonly TRow[]> {
    return (
      ((await this.#batch([{ sql, params }], initialize))[0]?.results as
        | readonly TRow[]
        | undefined) ?? []
    );
  }

  async #execute(
    sql: string,
    params: readonly CloudflareD1Value[],
    initialize = true,
  ): Promise<void> {
    await this.#batch([{ sql, params }], initialize);
  }

  async #batch(
    queries: readonly D1Query[],
    initialize = true,
  ): Promise<readonly CloudflareD1Result[]> {
    if (initialize) {
      await this.#initialize();
    }
    if (queries.length === 0) {
      return [];
    }
    if (this.#binding !== undefined) {
      const results = await this.#binding.batch(
        queries.map((query) => this.#binding!.prepare(query.sql).bind(...query.params)),
      );
      checkResults(results, "binding");
      return results;
    }

    const results: CloudflareD1Result[] = [];
    for await (const result of (await this.#getClient()).d1.database.query(this.#getDatabaseId(), {
      account_id: this.#getAccountId(),
      batch: queries.map((query) => ({
        params: query.params.map(toHttpParameter),
        sql: query.sql,
      })),
    })) {
      results.push(result as CloudflareD1Result);
    }
    checkResults(results, "HTTP");
    return results;
  }

  async #getClient(): Promise<Cloudflare> {
    if (this.#client !== undefined) {
      return this.#client;
    }
    if (this.#options.accountId === undefined || this.#options.databaseId === undefined) {
      throw new TypeError(
        "Cloudflare D1 HTTP mode requires accountId and databaseId when no binding is provided",
      );
    }
    const { default: CloudflareClient } = await import("cloudflare");
    this.#client = new CloudflareClient(cloudflareClientOptions(this.#options));
    return this.#client;
  }

  #getAccountId(): string {
    if (this.#options.accountId === undefined) {
      throw new TypeError("Cloudflare D1 HTTP mode requires accountId");
    }
    return this.#options.accountId;
  }

  #getDatabaseId(): string {
    if (this.#options.databaseId === undefined) {
      throw new TypeError("Cloudflare D1 HTTP mode requires databaseId");
    }
    return this.#options.databaseId;
  }

  #prefixedKey(key: string): string {
    return `${this.#keyPrefix}${key}`;
  }

  #unprefixKey(key: string): string {
    return this.#keyPrefix.length === 0 ? key : key.slice(this.#keyPrefix.length);
  }
}

function isCloudflareD1Binding(value: unknown): value is CloudflareD1Binding {
  return (
    typeof value === "object" &&
    value !== null &&
    "batch" in value &&
    "prepare" in value &&
    typeof value.batch === "function" &&
    typeof value.prepare === "function"
  );
}

function checkResults(results: readonly CloudflareD1Result[], mode: string): void {
  if (results.some((result) => result.success === false)) {
    throw new Error(`Cloudflare D1 ${mode} query failed`);
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function likePattern(prefix: string): string {
  return `${prefix.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function toHttpParameter(value: CloudflareD1Value): string {
  if (value === null) {
    throw new TypeError("Cloudflare D1 HTTP parameters cannot contain null");
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return encodeBase64(value instanceof Uint8Array ? value : new Uint8Array(value));
}

export type { StorageEngineSetManyItem };
