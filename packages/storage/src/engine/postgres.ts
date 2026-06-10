import type postgres from "postgres";

import { Buffer } from "node:buffer";

import type {
  StorageEngine,
  StorageEngineCompareAndSetManyItem,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

import { isExpired, resolveExpiresAt, toUint8Array } from "../utility.ts";

type PostgresRows<TRow extends object> = TRow[] & Iterable<TRow>;

interface PostgresEngineTransactionClient {
  unsafe<TRow extends object = Record<string, unknown>>(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresRows<TRow>>;
}

/**
 * Minimal postgres client interface used by {@link PostgresStorageEngine}.
 */
export interface PostgresEngineClient extends PostgresEngineTransactionClient {
  begin?<TResult>(
    callback: (client: PostgresEngineTransactionClient) => TResult | Promise<TResult>,
  ): Promise<TResult>;
  end?(options?: { readonly timeout?: number }): Promise<void>;
}

/**
 * Options for {@link PostgresStorageEngine}.
 */
export interface PostgresEngineOptions {
  /**
   * Existing postgres-compatible client.
   */
  readonly client?: PostgresEngineClient;

  /**
   * Postgres connection URL used when constructing a client.
   */
  readonly url?: string;

  /**
   * Connection options forwarded to postgres.
   */
  readonly connection?: postgres.Options<Record<string, postgres.PostgresType>>;

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
   * Whether `dispose` closes the client.
   * Defaults to `true` for internally created clients.
   */
  readonly dispose?: boolean;
}

interface PostgresValueRow {
  readonly value: Uint8Array;
  readonly expires_at: number | string | bigint | null;
}

/**
 * Storage engine backed by a Postgres table.
 */
export class PostgresStorageEngine implements StorageEngine {
  readonly name = "postgres";

  #client: PostgresEngineClient | undefined;
  #initialized = false;
  readonly #options: PostgresEngineOptions;
  readonly #tableName: string;
  readonly #prefix: string;
  readonly #separator: string;
  readonly #shouldInitialize: boolean;
  readonly #shouldDispose: boolean;

  constructor(options: PostgresEngineOptions = {}) {
    this.#options = options;
    this.#client = options.client;
    this.#tableName = quoteIdentifier(options.tableName ?? "temelj_storage");
    this.#prefix = options.prefix ?? "";
    this.#separator = options.separator ?? ":";
    this.#shouldInitialize = options.initialize ?? true;
    this.#shouldDispose = options.dispose ?? options.client === undefined;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const postgresClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    const rows = await postgresClient.unsafe<PostgresValueRow>(
      `SELECT value, expires_at FROM ${this.#tableName} WHERE key = $1`,
      [storageKey],
    );
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    if (isExpired(row.expires_at)) {
      await this.#deleteRecord(postgresClient, storageKey);
      return undefined;
    }
    return toUint8Array(row.value);
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
    if (keys.length === 0) {
      return new Map();
    }
    const postgresClient = await this.#getClient();
    await this.#deleteExpired(postgresClient);
    const storageKeys = keys.map((key) => this.#prefixKey(key));
    const rows = await postgresClient.unsafe<PostgresValueRow & { readonly key: string }>(
      `SELECT key, value FROM ${this.#tableName} WHERE key = ANY($1)`,
      [storageKeys],
    );
    const result = new Map<string, Uint8Array>();
    for (const row of rows) {
      result.set(this.#unprefixKey(row.key), toUint8Array(row.value));
    }
    return result;
  }

  async set(key: string, value: Uint8Array, setOptions?: StorageEngineSetOptions): Promise<void> {
    const postgresClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    const expiresAt = resolveExpiresAt(setOptions);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await this.#deleteRecord(postgresClient, storageKey);
      return;
    }
    await postgresClient.unsafe(
      `
        INSERT INTO ${this.#tableName} (key, value, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO UPDATE SET
          value = EXCLUDED.value,
          expires_at = EXCLUDED.expires_at
      `,
      [storageKey, Buffer.from(value), expiresAt ?? null],
    );
  }

  async compareAndSet(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
    setOptions?: StorageEngineSetOptions,
  ): Promise<boolean> {
    const postgresClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    await this.#deleteExpired(postgresClient);

    if (expected === undefined) {
      const existing = await postgresClient.unsafe<{ readonly exists: number }>(
        `SELECT 1 AS exists FROM ${this.#tableName} WHERE key = $1`,
        [storageKey],
      );
      if (existing.length > 0) {
        return false;
      }

      if (value === undefined) {
        return true;
      }

      const expiresAt = resolveExpiresAt(setOptions);
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        return true;
      }

      const rows = await postgresClient.unsafe<{ readonly inserted: number }>(
        `
          INSERT INTO ${this.#tableName} (key, value, expires_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (key) DO NOTHING
          RETURNING 1 AS inserted
        `,
        [storageKey, Buffer.from(value), expiresAt ?? null],
      );
      return rows.length > 0;
    }

    if (value === undefined) {
      const rows = await postgresClient.unsafe<{ readonly deleted: number }>(
        `
          DELETE FROM ${this.#tableName}
          WHERE key = $1 AND value = $2 AND (expires_at IS NULL OR expires_at > $3)
          RETURNING 1 AS deleted
        `,
        [storageKey, Buffer.from(expected), Date.now()],
      );
      return rows.length > 0;
    }

    const expiresAt = resolveExpiresAt(setOptions);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      const rows = await postgresClient.unsafe<{ readonly deleted: number }>(
        `
          DELETE FROM ${this.#tableName}
          WHERE key = $1 AND value = $2 AND (expires_at IS NULL OR expires_at > $3)
          RETURNING 1 AS deleted
        `,
        [storageKey, Buffer.from(expected), Date.now()],
      );
      return rows.length > 0;
    }

    const rows = await postgresClient.unsafe<{ readonly updated: number }>(
      `
        UPDATE ${this.#tableName}
        SET value = $1, expires_at = $2
        WHERE key = $3 AND value = $4 AND (expires_at IS NULL OR expires_at > $5)
        RETURNING 1 AS updated
      `,
      [Buffer.from(value), expiresAt ?? null, storageKey, Buffer.from(expected), Date.now()],
    );
    return rows.length > 0;
  }

  async compareAndSetMany(items: readonly StorageEngineCompareAndSetManyItem[]): Promise<boolean> {
    if (items.length === 0) {
      return true;
    }

    const now = Date.now();
    const storageKeys = items.map((item) => this.#prefixKey(item.key));

    const runTransaction = async (postgresClient: PostgresEngineTransactionClient) => {
      await postgresClient.unsafe(
        `DELETE FROM ${this.#tableName} WHERE expires_at IS NOT NULL AND expires_at <= $1`,
        [now],
      );

      const rows = await postgresClient.unsafe<PostgresValueRow & { readonly key: string }>(
        `SELECT key, value FROM ${this.#tableName} WHERE key = ANY($1) ORDER BY key FOR UPDATE`,
        [storageKeys],
      );
      const current = new Map(rows.map((row) => [row.key, row.value] as const));
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        const existing = current.get(storageKeys[index]!);
        if (item.expected === undefined) {
          if (existing !== undefined) {
            throw COMPARE_AND_SET_MANY_ROLLBACK;
          }
          continue;
        }
        if (existing === undefined || !Buffer.from(existing).equals(Buffer.from(item.expected))) {
          throw COMPARE_AND_SET_MANY_ROLLBACK;
        }
      }

      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        const storageKey = storageKeys[index]!;
        const expiresAt = resolveExpiresAt(item.options, now);
        if (item.value === undefined || (expiresAt !== undefined && expiresAt <= now)) {
          await postgresClient.unsafe(`DELETE FROM ${this.#tableName} WHERE key = $1`, [
            storageKey,
          ]);
          continue;
        }

        if (item.expected === undefined) {
          const rows = await postgresClient.unsafe<{ readonly inserted: number }>(
            `
              INSERT INTO ${this.#tableName} (key, value, expires_at)
              VALUES ($1, $2, $3)
              ON CONFLICT (key) DO NOTHING
              RETURNING 1 AS inserted
            `,
            [storageKey, Buffer.from(item.value), expiresAt ?? null],
          );
          if (rows.length === 0) {
            throw COMPARE_AND_SET_MANY_ROLLBACK;
          }
          continue;
        }

        await postgresClient.unsafe(
          `
            INSERT INTO ${this.#tableName} (key, value, expires_at)
            VALUES ($1, $2, $3)
            ON CONFLICT (key) DO UPDATE SET
              value = EXCLUDED.value,
              expires_at = EXCLUDED.expires_at
          `,
          [storageKey, Buffer.from(item.value), expiresAt ?? null],
        );
      }

      return true;
    };

    const postgresClient = await this.#getClient();
    if (postgresClient.begin !== undefined) {
      try {
        return await postgresClient.begin(runTransaction);
      } catch (error) {
        if (error === COMPARE_AND_SET_MANY_ROLLBACK) {
          return false;
        }
        throw error;
      }
    }

    await postgresClient.unsafe("BEGIN");
    try {
      await runTransaction(postgresClient);
      await postgresClient.unsafe("COMMIT");
      return true;
    } catch (error) {
      await postgresClient.unsafe("ROLLBACK");
      if (error === COMPARE_AND_SET_MANY_ROLLBACK) {
        return false;
      }
      throw error;
    }
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    for (const item of items) {
      await this.set(item.key, item.value, item.options);
    }
  }

  async delete(key: string): Promise<boolean> {
    const rows = await (
      await this.#getClient()
    ).unsafe<{ readonly count: number | string | bigint }>(
      `
        DELETE FROM ${this.#tableName}
        WHERE key = $1 AND (expires_at IS NULL OR expires_at > $2)
        RETURNING 1 AS count
      `,
      [this.#prefixKey(key), Date.now()],
    );
    return rows.length > 0;
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    const rows = await (
      await this.#getClient()
    ).unsafe<{ readonly count: number | string | bigint }>(
      `
        DELETE FROM ${this.#tableName}
        WHERE key = ANY($1) AND (expires_at IS NULL OR expires_at > $2)
        RETURNING 1 AS count
      `,
      [keys.map((key) => this.#prefixKey(key)), Date.now()],
    );
    return rows.length;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async keys(keyOptions?: StorageEngineKeyOptions): Promise<readonly string[]> {
    const postgresClient = await this.#getClient();
    await this.#deleteExpired(postgresClient);
    const rows = await postgresClient.unsafe<{ readonly key: string }>(
      `SELECT key FROM ${this.#tableName} WHERE key LIKE $1 ESCAPE '\\'`,
      [likePattern(this.#prefixKey(keyOptions?.prefix ?? ""))],
    );
    return rows.map((row) => this.#unprefixKey(row.key));
  }

  async clear(keyOptions?: StorageEngineKeyOptions): Promise<void> {
    await (
      await this.#getClient()
    ).unsafe(`DELETE FROM ${this.#tableName} WHERE key LIKE $1 ESCAPE '\\'`, [
      likePattern(this.#prefixKey(keyOptions?.prefix ?? "")),
    ]);
  }

  async dispose(): Promise<void> {
    if (this.#shouldDispose) {
      await this.#client?.end?.();
    }
    this.#client = undefined;
    this.#initialized = false;
  }

  async #getClient(): Promise<PostgresEngineClient> {
    if (this.#client === undefined) {
      const imported = await import("postgres");
      const createPostgres = imported.default;
      this.#client =
        this.#options.url === undefined
          ? createPostgres(this.#options.connection)
          : createPostgres(this.#options.url, this.#options.connection);
    }

    if (this.#shouldInitialize && !this.#initialized) {
      await this.#initializeTable(this.#client);
      this.#initialized = true;
    }
    return this.#client;
  }

  async #initializeTable(postgresClient: PostgresEngineClient): Promise<void> {
    await postgresClient.unsafe(`
      CREATE TABLE IF NOT EXISTS ${this.#tableName} (
        key TEXT PRIMARY KEY,
        value BYTEA NOT NULL,
        expires_at BIGINT
      )
    `);
  }

  async #deleteExpired(postgresClient: PostgresEngineClient): Promise<void> {
    await postgresClient.unsafe(
      `DELETE FROM ${this.#tableName} WHERE expires_at IS NOT NULL AND expires_at <= $1`,
      [Date.now()],
    );
  }

  async #deleteRecord(postgresClient: PostgresEngineClient, storageKey: string): Promise<void> {
    await postgresClient.unsafe(`DELETE FROM ${this.#tableName} WHERE key = $1`, [storageKey]);
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

const COMPARE_AND_SET_MANY_ROLLBACK = Symbol("compareAndSetManyRollback");

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function likePattern(prefix: string): string {
  return `${prefix.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

/**
 * Engine batch item types accepted by Postgres storage operations.
 */
export type { StorageEngineCompareAndSetManyItem, StorageEngineSetManyItem };
