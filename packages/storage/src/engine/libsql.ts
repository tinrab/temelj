import type LibSqlDatabase from "libsql";

import { isString, isNumber, isBigInt, isObject } from "@temelj/value";

import type {
  StorageEngine,
  StorageEngineCompareAndSetManyItem,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
  StoredValue,
} from "../types.ts";
import type { DatabaseStoredValue, StoredValueFormat, StoredValueForFormat } from "../utility.ts";

import {
  isExpired,
  isDatabaseStoredValue,
  parseDatabaseRows,
  normalizeStoredValue,
  resolveExpiresAt,
  storedValueParameter,
  storedValuesEqual,
} from "../utility.ts";

/**
 * Minimal libSQL client interface used by {@link LibSqlStorageEngine}.
 */
export interface LibSqlEngineClient {
  close?(): void;
  exec(query: string): void;
  prepare(query: string): LibSqlEngineStatement;
}

/**
 * Minimal prepared statement interface used by the libSQL engine.
 */
export interface LibSqlEngineStatement {
  all(...parameters: readonly unknown[]): unknown[];
  get: LibSqlDatabase.Statement<unknown[]>["get"];
  run(...parameters: readonly unknown[]): { readonly changes: number | bigint };
}

/**
 * Connection options forwarded when creating a libSQL client.
 */
export interface LibSqlEngineConnectionOptions extends LibSqlDatabase.Options {
  /**
   * Authentication token for remote libSQL connections.
   */
  readonly authToken?: string;
}

/**
 * Options for {@link LibSqlStorageEngine}.
 */
export interface LibSqlEngineOptions<TFormat extends StoredValueFormat = "string"> {
  /** Persisted representation checked when reading rows. */
  readonly format: TFormat;

  /**
   * Existing libSQL-compatible client.
   */
  readonly client?: LibSqlEngineClient;

  /**
   * Local database path. Defaults to an in-memory database when no URL or path is set.
   */
  readonly path?: string;

  /**
   * Remote libSQL URL.
   */
  readonly url?: string;

  /**
   * Connection options used when constructing a client.
   */
  readonly connection?: LibSqlEngineConnectionOptions;

  /**
   * Table name used for storage records. Defaults to `"temelj_storage"`.
   */
  readonly tableName?: string;

  /**
   * Prefix namespace applied to all engine keys.
   */
  readonly prefix?: string;

  /**
   * Separator between prefix and key. Defaults to `":"`.
   */
  readonly separator?: string;

  /**
   * Whether `dispose` closes the client. Defaults to `true` for internally created clients.
   */
  readonly dispose?: boolean;
}

interface LibSqlValueRow {
  readonly key?: string;
  readonly value: DatabaseStoredValue;
  readonly expires_at?: number | string | bigint | null;
}

/**
 * Storage engine backed by a libSQL table.
 */
export class LibSqlStorageEngine<
  TFormat extends StoredValueFormat = "string",
> implements StorageEngine<StoredValueForFormat<TFormat>> {
  readonly name = "libsql";

  #client: LibSqlEngineClient | undefined;
  readonly #options: LibSqlEngineOptions<TFormat>;
  readonly #tableName: string;
  readonly #prefix: string;
  readonly #separator: string;
  readonly #shouldDispose: boolean;

  constructor(options: LibSqlEngineOptions<TFormat>) {
    this.#options = options;
    this.#client = options.client;
    this.#tableName = quoteIdentifier(options.tableName ?? "temelj_storage");
    this.#prefix = options.prefix ?? "";
    this.#separator = options.separator ?? ":";
    this.#shouldDispose = options.dispose ?? options.client === undefined;
  }

  async #getClient(): Promise<LibSqlEngineClient> {
    if (this.#client === undefined) {
      const { default: Database } = await import("libsql");
      this.#client ??= new Database(
        this.#options.url ?? this.#options.path ?? ":memory:",
        this.#options.connection,
      );
    }

    return this.#client;
  }

  #deleteExpired(libSqlClient: LibSqlEngineClient): void {
    libSqlClient
      .prepare(`DELETE FROM ${this.#tableName} WHERE expires_at IS NOT NULL AND expires_at <= ?`)
      .run(Date.now());
  }

  #deleteRecord(libSqlClient: LibSqlEngineClient, storageKey: string): void {
    libSqlClient.prepare(`DELETE FROM ${this.#tableName} WHERE key = ?`).run(storageKey);
  }

  async get(key: string): Promise<StoredValueForFormat<TFormat> | undefined> {
    const libSqlClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);

    const row = parseDatabaseRows(
      libSqlClient
        .prepare(`SELECT value, expires_at FROM ${this.#tableName} WHERE key = ?`)
        .all(storageKey),
      isLibSqlValueRow,
    )[0];

    if (row === undefined) {
      return undefined;
    }

    if (isExpired(row.expires_at ?? null)) {
      this.#deleteRecord(libSqlClient, storageKey);

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

    const libSqlClient = await this.#getClient();
    this.#deleteExpired(libSqlClient);
    const storageKeys = keys.map((key) => this.#prefixKey(key));

    const rows = parseDatabaseRows(
      libSqlClient
        .prepare(
          `SELECT key, value FROM ${this.#tableName} WHERE key IN (${placeholders(storageKeys.length)})`,
        )
        .all(...storageKeys),
      isLibSqlValueRow,
    );

    const result = new Map<string, StoredValueForFormat<TFormat>>();

    for (const row of rows) {
      if (row.key !== undefined) {
        result.set(
          this.#unprefixKey(row.key),
          normalizeStoredValue(row.value, this.#options.format),
        );
      }
    }

    return result;
  }

  async set(
    key: string,
    value: StoredValueForFormat<TFormat>,
    setOptions?: StorageEngineSetOptions,
  ): Promise<void> {
    const libSqlClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    const expiresAt = resolveExpiresAt(setOptions);

    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.#deleteRecord(libSqlClient, storageKey);

      return;
    }

    libSqlClient
      .prepare(
        `
            INSERT INTO ${this.#tableName} (key, value, expires_at)
            VALUES (?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET
              value = excluded.value,
              expires_at = excluded.expires_at
          `,
      )
      .run(storageKey, storedValueParameter(value), expiresAt ?? null);
  }

  async compareAndSet(
    key: string,
    expected: StoredValueForFormat<TFormat> | undefined,
    value: StoredValueForFormat<TFormat> | undefined,
    setOptions?: StorageEngineSetOptions,
  ): Promise<boolean> {
    const libSqlClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    this.#deleteExpired(libSqlClient);

    if (expected === undefined) {
      const row = libSqlClient
        .prepare(`SELECT 1 FROM ${this.#tableName} WHERE key = ?`)
        .get(storageKey);

      if (row !== undefined) {
        return false;
      }

      if (value === undefined) {
        return true;
      }

      const expiresAt = resolveExpiresAt(setOptions);

      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        return true;
      }

      const result = libSqlClient
        .prepare(
          `INSERT OR IGNORE INTO ${this.#tableName} (key, value, expires_at) VALUES (?, ?, ?)`,
        )
        .run(storageKey, storedValueParameter(value), expiresAt ?? null);

      return Number(result.changes) > 0;
    }

    if (value === undefined) {
      const result = libSqlClient
        .prepare(
          `
            DELETE FROM ${this.#tableName}
            WHERE key = ? AND value = ? AND (expires_at IS NULL OR expires_at > ?)
          `,
        )
        .run(storageKey, storedValueParameter(expected), Date.now());

      return Number(result.changes) > 0;
    }

    const expiresAt = resolveExpiresAt(setOptions);

    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      const result = libSqlClient
        .prepare(
          `
            DELETE FROM ${this.#tableName}
            WHERE key = ? AND value = ? AND (expires_at IS NULL OR expires_at > ?)
          `,
        )
        .run(storageKey, storedValueParameter(expected), Date.now());

      return Number(result.changes) > 0;
    }

    const result = libSqlClient
      .prepare(
        `
          UPDATE ${this.#tableName}
          SET value = ?, expires_at = ?
          WHERE key = ? AND value = ? AND (expires_at IS NULL OR expires_at > ?)
        `,
      )
      .run(
        storedValueParameter(value),
        expiresAt ?? null,
        storageKey,
        storedValueParameter(expected),
        Date.now(),
      );

    return Number(result.changes) > 0;
  }

  async compareAndSetMany(
    items: readonly StorageEngineCompareAndSetManyItem<StoredValueForFormat<TFormat>>[],
  ): Promise<boolean> {
    const libSqlClient = await this.#getClient();

    const storageItems = items.map((item) => ({
      key: this.#prefixKey(item.key),
      expected: item.expected,
      value: item.value,
      expiresAt: resolveExpiresAt(item.options),
    }));

    libSqlClient.exec("BEGIN IMMEDIATE");

    try {
      this.#deleteExpired(libSqlClient);
      const currentValues = new Map<string, StoredValueForFormat<TFormat> | undefined>();

      for (const item of storageItems) {
        currentValues.set(
          item.key,
          getCurrentValue(libSqlClient, this.#tableName, item.key, this.#options.format),
        );
      }

      if (
        storageItems.some((item) => !expectedMatches(currentValues.get(item.key), item.expected))
      ) {
        libSqlClient.exec("ROLLBACK");

        return false;
      }

      for (const item of storageItems) {
        if (
          item.value === undefined ||
          (item.expiresAt !== undefined && item.expiresAt <= Date.now())
        ) {
          this.#deleteRecord(libSqlClient, item.key);
          continue;
        }

        libSqlClient
          .prepare(
            `
              INSERT INTO ${this.#tableName} (key, value, expires_at)
              VALUES (?, ?, ?)
              ON CONFLICT (key) DO UPDATE SET
                value = excluded.value,
                expires_at = excluded.expires_at
            `,
          )
          .run(item.key, storedValueParameter(item.value), item.expiresAt ?? null);
      }

      libSqlClient.exec("COMMIT");

      return true;
    } catch (error) {
      libSqlClient.exec("ROLLBACK");
      throw error;
    }
  }

  async setMany(
    items: readonly StorageEngineSetManyItem<StoredValueForFormat<TFormat>>[],
  ): Promise<void> {
    for (const item of items) {
      await this.set(item.key, item.value, item.options);
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = (await this.#getClient())
      .prepare(
        `
          DELETE FROM ${this.#tableName}
          WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)
        `,
      )
      .run(this.#prefixKey(key), Date.now());

    return Number(result.changes) > 0;
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }

    const result = (await this.#getClient())
      .prepare(
        `
          DELETE FROM ${this.#tableName}
          WHERE key IN (${placeholders(keys.length)})
            AND (expires_at IS NULL OR expires_at > ?)
        `,
      )
      .run(...keys.map((key) => this.#prefixKey(key)), Date.now());

    return Number(result.changes);
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async keys(keyOptions?: StorageEngineKeyOptions): Promise<readonly string[]> {
    const libSqlClient = await this.#getClient();
    this.#deleteExpired(libSqlClient);

    const rows = parseDatabaseRows(
      libSqlClient
        .prepare(`SELECT key FROM ${this.#tableName} WHERE key LIKE ? ESCAPE '\\'`)
        .all(likePattern(this.#prefixKey(keyOptions?.prefix ?? ""))),
      isKeyRow,
    );

    return rows.map((row) => this.#unprefixKey(row.key));
  }

  async clear(keyOptions?: StorageEngineKeyOptions): Promise<void> {
    (await this.#getClient())
      .prepare(`DELETE FROM ${this.#tableName} WHERE key LIKE ? ESCAPE '\\'`)
      .run(likePattern(this.#prefixKey(keyOptions?.prefix ?? "")));
  }

  async dispose(): Promise<void> {
    if (this.#shouldDispose) {
      this.#client?.close?.();
    }

    this.#client = undefined;
  }

  #prefixKey(key: string): string {
    return this.#prefix.length === 0 ? key : `${this.#prefix}${this.#separator}${key}`;
  }

  #unprefixKey(key: string): string {
    if (this.#prefix.length === 0) {
      return key;
    }

    const expectedPrefix = `${this.#prefix}${this.#separator}`;

    return key.startsWith(expectedPrefix) ? key.slice(expectedPrefix.length) : key;
  }
}

function getCurrentValue<TFormat extends StoredValueFormat>(
  libSqlClient: LibSqlEngineClient,
  tableName: string,
  storageKey: string,
  format: TFormat,
): StoredValueForFormat<TFormat> | undefined {
  const row = parseDatabaseRows(
    libSqlClient.prepare(`SELECT value FROM ${tableName} WHERE key = ?`).all(storageKey),
    isLibSqlValueRow,
  )[0];

  return row === undefined ? undefined : normalizeStoredValue(row.value, format);
}

function expectedMatches<TStoredValue extends StoredValue>(
  current: TStoredValue | undefined,
  expected: TStoredValue | undefined,
): boolean {
  return storedValuesEqual(current, expected);
}

function isLibSqlValueRow(value: unknown): value is LibSqlValueRow {
  return (
    isObject(value) &&
    "value" in value &&
    isDatabaseStoredValue(value.value) &&
    (!("key" in value) || value.key === undefined || isString(value.key)) &&
    (!("expires_at" in value) ||
      value.expires_at === undefined ||
      value.expires_at === null ||
      isString(value.expires_at) ||
      isNumber(value.expires_at) ||
      isBigInt(value.expires_at))
  );
}

function isKeyRow(value: unknown): value is { readonly key: string } {
  return isObject(value) && "key" in value && isString(value.key);
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

/**
 * Engine batch item types accepted by libSQL storage operations.
 */
export type { StorageEngineCompareAndSetManyItem, StorageEngineSetManyItem };
