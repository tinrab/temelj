import type { ClientOptions } from "cloudflare";

import { decodeBase64, encodeBase64 } from "@temelj/string";
import { isString, isNumber, isObject, isFunction } from "@temelj/value";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../../types.ts";
import type {
  DatabaseStoredValue,
  StoredValueFormat,
  StoredValueForFormat,
} from "../../utility.ts";
import type { CloudflareD1Client, CloudflareD1HttpResult } from "./client.ts";

import { normalizeStoredValue } from "../../utility.ts";
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

export type CloudflareD1Row = Readonly<Record<string, CloudflareD1Value>>;

const D1_HTTP_BYTES_PREFIX = "temelj:d1:bytes:v1:";

/**
 * Minimal prepared statement interface used by {@link CloudflareD1StorageEngine}.
 */
export interface CloudflareD1PreparedStatement {
  bind(...values: readonly CloudflareD1Value[]): CloudflareD1PreparedStatement;
  all<T = CloudflareD1Row>(): Promise<CloudflareD1Result<T>>;
  run<T = CloudflareD1Row>(): Promise<CloudflareD1Result<T>>;
}

/**
 * Minimal D1 query result.
 */
export interface CloudflareD1Result<T = CloudflareD1Row> {
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
  batch<T = CloudflareD1Row>(
    statements: CloudflareD1PreparedStatement[],
  ): Promise<readonly CloudflareD1Result<T>[]>;
  prepare(query: string): CloudflareD1PreparedStatement;
}

/**
 * Options for {@link CloudflareD1StorageEngine}.
 */
export interface CloudflareD1EngineOptions<
  TFormat extends StoredValueFormat = "string",
> extends ClientOptions {
  /** Persisted representation checked when reading rows. */
  readonly format: TFormat;

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
  readonly client?: CloudflareD1Client;

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
}

interface D1StorageRow {
  readonly key: string;
  readonly value: DatabaseStoredValue;
  readonly expires_at: number | string;
}

interface D1Query {
  readonly sql: string;
  readonly params: readonly CloudflareD1Value[];
}

/**
 * Storage engine backed by Cloudflare D1 through a Worker binding or the HTTP API.
 */
export class CloudflareD1StorageEngine<
  TFormat extends StoredValueFormat = "string",
> implements StorageEngine<StoredValueForFormat<TFormat>> {
  readonly name = "cloudflare-d1";

  #client: CloudflareD1Client | undefined;
  readonly #binding: CloudflareD1Binding | undefined;
  readonly #keyPrefix: string;
  readonly #options: CloudflareD1EngineOptions<TFormat>;
  readonly #tableName: string;

  constructor(options: CloudflareD1EngineOptions<TFormat>) {
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
  }

  async get(key: string): Promise<StoredValueForFormat<TFormat> | undefined> {
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

    return normalizeStoredValue(row.value, this.#options.format);
  }

  async getMany(
    keys: readonly string[],
  ): Promise<ReadonlyMap<string, StoredValueForFormat<TFormat>>> {
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

    return new Map(
      rows.map((row) => [
        this.#unprefixKey(row.key),
        normalizeStoredValue(row.value, this.#options.format),
      ]),
    );
  }

  async set(
    key: string,
    value: StoredValueForFormat<TFormat>,
    options?: StorageEngineSetOptions,
  ): Promise<void> {
    const storageKey = this.#prefixedKey(key);
    const expiresAt = resolveCloudflareExpiresAt(options, this.#options.defaultTtl);

    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await this.#execute(`DELETE FROM ${this.#tableName} WHERE key = ?`, [storageKey]);

      return;
    }

    await this.#execute(
      `INSERT INTO ${this.#tableName} (key, value, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
      [storageKey, value, expiresAt ?? 0],
    );
  }

  async compareAndSet(
    key: string,
    expected: StoredValueForFormat<TFormat> | undefined,
    value: StoredValueForFormat<TFormat> | undefined,
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
        [storageKey, replacement!, expiresAt ?? 0, now],
      );

      return rows.length > 0;
    }

    if (replacement === undefined) {
      const rows = await this.#query<Pick<D1StorageRow, "key">>(
        `DELETE FROM ${this.#tableName}
         WHERE key = ? AND value = ? AND (expires_at = 0 OR expires_at > ?)
         RETURNING key`,
        [storageKey, expected, now],
      );

      return rows.length > 0;
    }

    const rows = await this.#query<Pick<D1StorageRow, "key">>(
      `UPDATE ${this.#tableName}
       SET value = ?, expires_at = ?
       WHERE key = ? AND value = ? AND (expires_at = 0 OR expires_at > ?)
       RETURNING key`,
      [replacement, expiresAt ?? 0, storageKey, expected, now],
    );

    return rows.length > 0;
  }

  async setMany(
    items: readonly StorageEngineSetManyItem<StoredValueForFormat<TFormat>>[],
  ): Promise<void> {
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
          params: [storageKey, item.value, expiresAt ?? 0],
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

  async #deleteExpired(): Promise<void> {
    await this.#execute(
      `DELETE FROM ${this.#tableName} WHERE expires_at != 0 AND expires_at <= ?`,
      [Date.now()],
    );
  }

  async #query<TRow>(sql: string, params: readonly CloudflareD1Value[]): Promise<readonly TRow[]> {
    // SAFETY: Each private call specifies the fields projected by its SQL; HTTP rows are validated before reaching this method.
    return (
      ((await this.#batch([{ sql, params }]))[0]?.results as readonly TRow[] | undefined) ?? []
    );
  }

  async #execute(sql: string, params: readonly CloudflareD1Value[]): Promise<void> {
    await this.#batch([{ sql, params }]);
  }

  async #batch(queries: readonly D1Query[]): Promise<readonly CloudflareD1Result[]> {
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
      results.push(decodeHttpResult(result));
    }

    checkResults(results, "HTTP");

    return results;
  }

  async #getClient(): Promise<CloudflareD1Client> {
    if (this.#client !== undefined) {
      return this.#client;
    }

    if (this.#options.accountId === undefined || this.#options.databaseId === undefined) {
      throw new TypeError(
        "Cloudflare D1 HTTP mode requires accountId and databaseId when no binding is provided",
      );
    }

    const { default: CloudflareClient } = await import("cloudflare");
    this.#client ??= new CloudflareClient(cloudflareClientOptions(this.#options));

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
    isObject(value) &&
    value !== null &&
    "batch" in value &&
    "prepare" in value &&
    isFunction(value.batch) &&
    isFunction(value.prepare)
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

  if (isString(value)) {
    return value;
  }

  if (isNumber(value)) {
    return String(value);
  }

  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);

  return `${D1_HTTP_BYTES_PREFIX}${encodeBase64(bytes)}`;
}

function decodeHttpResult(result: CloudflareD1HttpResult): CloudflareD1Result {
  if (result.results === undefined) {
    const { results: _results, ...metadata } = result;

    return metadata;
  }

  return {
    ...result,
    results: result.results.map((row) => {
      if (!isObject(row)) {
        throw new TypeError("Invalid D1 response row");
      }

      return Object.fromEntries(
        Object.entries(row).map(([key, value]) => {
          if (!isCloudflareD1Value(value)) {
            throw new TypeError("Invalid D1 response value");
          }

          return [key, decodeHttpValue(value)];
        }),
      );
    }),
  };
}

function isCloudflareD1Value(value: unknown): value is CloudflareD1Value {
  return (
    value === null ||
    isString(value) ||
    isNumber(value) ||
    value instanceof ArrayBuffer ||
    value instanceof Uint8Array
  );
}

function decodeHttpValue(value: CloudflareD1Value): CloudflareD1Value {
  return isString(value) && value.startsWith(D1_HTTP_BYTES_PREFIX)
    ? decodeBase64(value.slice(D1_HTTP_BYTES_PREFIX.length))
    : value;
}

export type { StorageEngineSetManyItem };
