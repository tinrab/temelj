import type LibSqlDatabase from "libsql";

import { Buffer } from "node:buffer";

import type {
  StorageEngine,
  StorageEngineCompareAndSetManyItem,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

import { isExpired, resolveExpiresAt, toUint8Array } from "../utility.ts";

/**
 * Minimal libSQL client interface used by {@link LibSqlStorageEngine}.
 */
export interface LibSqlEngineClient {
  close?(): unknown;
  exec(query: string): unknown;
  prepare(query: string): LibSqlEngineStatement;
}

/**
 * Minimal prepared statement interface used by the libSQL engine.
 */
export interface LibSqlEngineStatement {
  all(...parameters: readonly unknown[]): unknown[];
  get(...parameters: readonly unknown[]): unknown;
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
export interface LibSqlEngineOptions {
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
   * Whether to create the storage table lazily. Defaults to `true`.
   */
  readonly initialize?: boolean;

  /**
   * Whether `dispose` closes the client. Defaults to `true` for internally created clients.
   */
  readonly dispose?: boolean;
}

interface LibSqlValueRow {
  readonly key?: string;
  readonly value: ArrayBuffer | Uint8Array;
  readonly expires_at?: number | string | bigint | null;
}

/**
 * Storage engine backed by a libSQL table.
 */
export class LibSqlStorageEngine implements StorageEngine {
  readonly name = "libsql";

  #client: LibSqlEngineClient | undefined;
  #initialized = false;
  readonly #options: LibSqlEngineOptions;
  readonly #tableName: string;
  readonly #prefix: string;
  readonly #separator: string;
  readonly #shouldInitialize: boolean;
  readonly #shouldDispose: boolean;

  constructor(options: LibSqlEngineOptions = {}) {
    this.#options = options;
    this.#client = options.client;
    this.#tableName = quoteIdentifier(options.tableName ?? "temelj_storage");
    this.#prefix = options.prefix ?? "";
    this.#separator = options.separator ?? ":";
    this.#shouldInitialize = options.initialize ?? true;
    this.#shouldDispose = options.dispose ?? options.client === undefined;
  }

  async #getClient(): Promise<LibSqlEngineClient> {
    if (this.#client === undefined) {
      const { default: Database } = await import("libsql");
      this.#client = new Database(
        this.#options.url ?? this.#options.path ?? ":memory:",
        this.#options.connection,
      );
    }

    if (this.#shouldInitialize && !this.#initialized) {
      this.#initializeTable(this.#client);
      this.#initialized = true;
    }
    return this.#client;
  }

  #initializeTable(libSqlClient: LibSqlEngineClient): void {
    libSqlClient.exec(`
      CREATE TABLE IF NOT EXISTS ${this.#tableName} (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL,
        expires_at INTEGER
      )
    `);
  }

  #deleteExpired(libSqlClient: LibSqlEngineClient): void {
    libSqlClient
      .prepare(`DELETE FROM ${this.#tableName} WHERE expires_at IS NOT NULL AND expires_at <= ?`)
      .run(Date.now());
  }

  #deleteRecord(libSqlClient: LibSqlEngineClient, storageKey: string): void {
    libSqlClient.prepare(`DELETE FROM ${this.#tableName} WHERE key = ?`).run(storageKey);
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const libSqlClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    const row = libSqlClient
      .prepare(`SELECT value, expires_at FROM ${this.#tableName} WHERE key = ?`)
      .get(storageKey) as LibSqlValueRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    if (isExpired(row.expires_at ?? null)) {
      this.#deleteRecord(libSqlClient, storageKey);
      return undefined;
    }
    return toUint8Array(row.value);
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
    if (keys.length === 0) {
      return new Map();
    }
    const libSqlClient = await this.#getClient();
    this.#deleteExpired(libSqlClient);
    const storageKeys = keys.map((key) => this.#prefixKey(key));
    const rows = libSqlClient
      .prepare(
        `SELECT key, value FROM ${this.#tableName} WHERE key IN (${placeholders(storageKeys.length)})`,
      )
      .all(...storageKeys) as LibSqlValueRow[];
    const result = new Map<string, Uint8Array>();
    for (const row of rows) {
      if (row.key !== undefined) {
        result.set(this.#unprefixKey(row.key), toUint8Array(row.value));
      }
    }
    return result;
  }

  async set(key: string, value: Uint8Array, setOptions?: StorageEngineSetOptions): Promise<void> {
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
      .run(storageKey, Buffer.from(value), expiresAt ?? null);
  }

  async compareAndSet(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
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
        .run(storageKey, Buffer.from(value), expiresAt ?? null);
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
        .run(storageKey, Buffer.from(expected), Date.now());
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
        .run(storageKey, Buffer.from(expected), Date.now());
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
      .run(Buffer.from(value), expiresAt ?? null, storageKey, Buffer.from(expected), Date.now());
    return Number(result.changes) > 0;
  }

  async compareAndSetMany(items: readonly StorageEngineCompareAndSetManyItem[]): Promise<boolean> {
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
      const currentValues = new Map<string, Uint8Array | undefined>();
      for (const item of storageItems) {
        currentValues.set(item.key, getCurrentValue(libSqlClient, this.#tableName, item.key));
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
          .run(item.key, Buffer.from(item.value), item.expiresAt ?? null);
      }
      libSqlClient.exec("COMMIT");
      return true;
    } catch (error) {
      libSqlClient.exec("ROLLBACK");
      throw error;
    }
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
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
    const rows = libSqlClient
      .prepare(`SELECT key FROM ${this.#tableName} WHERE key LIKE ? ESCAPE '\\'`)
      .all(likePattern(this.#prefixKey(keyOptions?.prefix ?? ""))) as Array<{
      readonly key: string;
    }>;
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
    this.#initialized = false;
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

function getCurrentValue(
  libSqlClient: LibSqlEngineClient,
  tableName: string,
  storageKey: string,
): Uint8Array | undefined {
  const row = libSqlClient
    .prepare(`SELECT value FROM ${tableName} WHERE key = ?`)
    .get(storageKey) as Pick<LibSqlValueRow, "value"> | undefined;
  return row === undefined ? undefined : toUint8Array(row.value);
}

function expectedMatches(
  current: Uint8Array | undefined,
  expected: Uint8Array | undefined,
): boolean {
  if (current === undefined || expected === undefined) {
    return current === expected;
  }
  if (current.byteLength !== expected.byteLength) {
    return false;
  }
  for (let index = 0; index < current.byteLength; index++) {
    if (current[index] !== expected[index]) {
      return false;
    }
  }
  return true;
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
