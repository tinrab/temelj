import type { PoolOptions } from "mysql2/promise";

import type {
  StorageEngine,
  StorageEngineCompareAndSetManyItem,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

import { isExpired, resolveExpiresAt, toBuffer, toUint8Array } from "../utility.ts";

/**
 * Minimal mysql2 client or pool interface used by {@link MySqlStorageEngine}.
 */
export interface MySqlEngineClient {
  beginTransaction?(): Promise<void>;
  commit?(): Promise<void>;
  end?(): Promise<void>;
  execute(query: string, parameters?: unknown[]): Promise<readonly [unknown, unknown]>;
  getConnection?(): Promise<MySqlEngineConnection>;
  rollback?(): Promise<void>;
}

/**
 * Minimal mysql2 connection interface used for transaction-scoped operations.
 */
export interface MySqlEngineConnection extends MySqlEngineClient {
  release?(): void;
}

/**
 * Options for {@link MySqlStorageEngine}.
 */
export interface MySqlEngineOptions {
  /**
   * Existing mysql2-compatible client or pool.
   */
  readonly client?: MySqlEngineClient;

  /**
   * MySQL connection URL used when constructing a pool.
   */
  readonly url?: string;

  /**
   * Pool options forwarded to mysql2.
   */
  readonly connection?: PoolOptions;

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

interface MySqlValueRow {
  readonly value: Uint8Array;
  readonly expires_at: number | string | bigint | null;
}

/**
 * Storage engine backed by a MySQL table.
 */
export class MySqlStorageEngine implements StorageEngine {
  readonly name = "mysql";

  #client: MySqlEngineClient | undefined;
  #initialized = false;
  readonly #options: MySqlEngineOptions;
  readonly #tableName: string;
  readonly #prefix: string;
  readonly #separator: string;
  readonly #shouldInitialize: boolean;
  readonly #shouldDispose: boolean;

  constructor(options: MySqlEngineOptions = {}) {
    this.#options = options;
    this.#client = options.client;
    this.#tableName = quoteIdentifier(options.tableName ?? "temelj_storage");
    this.#prefix = options.prefix ?? "";
    this.#separator = options.separator ?? ":";
    this.#shouldInitialize = options.initialize ?? true;
    this.#shouldDispose = options.dispose ?? options.client === undefined;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const mysqlClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    const rows = await queryRows<MySqlValueRow>(
      mysqlClient,
      `SELECT \`value\`, \`expires_at\` FROM ${this.#tableName} WHERE \`key\` = ?`,
      [storageKey],
    );
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    if (isExpired(row.expires_at)) {
      await this.#deleteRecord(mysqlClient, storageKey);
      return undefined;
    }
    return toUint8Array(row.value);
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
    if (keys.length === 0) {
      return new Map();
    }
    const mysqlClient = await this.#getClient();
    await this.#deleteExpired(mysqlClient);
    const storageKeys = keys.map((key) => this.#prefixKey(key));
    const rows = await queryRows<MySqlValueRow & { readonly key: string }>(
      mysqlClient,
      `SELECT \`key\`, \`value\` FROM ${this.#tableName} WHERE \`key\` IN (${placeholders(storageKeys.length)})`,
      storageKeys,
    );
    const result = new Map<string, Uint8Array>();
    for (const row of rows) {
      result.set(this.#unprefixKey(row.key), toUint8Array(row.value));
    }
    return result;
  }

  async set(key: string, value: Uint8Array, setOptions?: StorageEngineSetOptions): Promise<void> {
    const mysqlClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    const expiresAt = resolveExpiresAt(setOptions);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await this.#deleteRecord(mysqlClient, storageKey);
      return;
    }
    await mysqlClient.execute(
      `
        INSERT INTO ${this.#tableName} (\`key\`, \`value\`, \`expires_at\`)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE
          \`value\` = VALUES(\`value\`),
          \`expires_at\` = VALUES(\`expires_at\`)
      `,
      [storageKey, value, expiresAt ?? null],
    );
  }

  async compareAndSet(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
    setOptions?: StorageEngineSetOptions,
  ): Promise<boolean> {
    const mysqlClient = await this.#getClient();
    const storageKey = this.#prefixKey(key);
    await this.#deleteExpired(mysqlClient);

    if (expected === undefined) {
      const rows = await queryRows<{ readonly exists: number }>(
        mysqlClient,
        `SELECT 1 AS \`exists\` FROM ${this.#tableName} WHERE \`key\` = ?`,
        [storageKey],
      );
      if (rows.length > 0) {
        return false;
      }

      if (value === undefined) {
        return true;
      }

      const expiresAt = resolveExpiresAt(setOptions);
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        return true;
      }

      const result = await executeResult(
        mysqlClient,
        `
          INSERT IGNORE INTO ${this.#tableName} (\`key\`, \`value\`, \`expires_at\`)
          VALUES (?, ?, ?)
        `,
        [storageKey, value, expiresAt ?? null],
      );
      return result.affectedRows > 0;
    }

    if (value === undefined) {
      const result = await executeResult(
        mysqlClient,
        `
          DELETE FROM ${this.#tableName}
          WHERE \`key\` = ? AND \`value\` = ?
            AND (\`expires_at\` IS NULL OR \`expires_at\` > ?)
        `,
        [storageKey, expected, Date.now()],
      );
      return result.affectedRows > 0;
    }

    const expiresAt = resolveExpiresAt(setOptions);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      const result = await executeResult(
        mysqlClient,
        `
          DELETE FROM ${this.#tableName}
          WHERE \`key\` = ? AND \`value\` = ?
            AND (\`expires_at\` IS NULL OR \`expires_at\` > ?)
        `,
        [storageKey, expected, Date.now()],
      );
      return result.affectedRows > 0;
    }

    const result = await executeResult(
      mysqlClient,
      `
        UPDATE ${this.#tableName}
        SET \`value\` = ?, \`expires_at\` = ?
        WHERE \`key\` = ? AND \`value\` = ?
          AND (\`expires_at\` IS NULL OR \`expires_at\` > ?)
      `,
      [value, expiresAt ?? null, storageKey, expected, Date.now()],
    );
    return result.affectedRows > 0;
  }

  async compareAndSetMany(items: readonly StorageEngineCompareAndSetManyItem[]): Promise<boolean> {
    if (items.length === 0) {
      return true;
    }

    const now = Date.now();
    const storageKeys = items.map((item) => this.#prefixKey(item.key));

    const runTransaction = async (mysqlClient: MySqlEngineClient) => {
      await mysqlClient.execute(
        `DELETE FROM ${this.#tableName} WHERE \`expires_at\` IS NOT NULL AND \`expires_at\` <= ?`,
        [now],
      );

      const rows = await queryRows<MySqlValueRow & { readonly key: string }>(
        mysqlClient,
        `
          SELECT \`key\`, \`value\`
          FROM ${this.#tableName}
          WHERE \`key\` IN (${placeholders(storageKeys.length)})
          ORDER BY \`key\`
          FOR UPDATE
        `,
        storageKeys,
      );
      const current = new Map(rows.map((row) => [row.key, row.value] as const));
      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        const existing = current.get(storageKeys[index]!);
        if (item.expected === undefined) {
          if (existing !== undefined) {
            return false;
          }
          continue;
        }
        if (existing === undefined || !toBuffer(existing).equals(toBuffer(item.expected))) {
          return false;
        }
      }

      for (let index = 0; index < items.length; index++) {
        const item = items[index]!;
        const storageKey = storageKeys[index]!;
        const expiresAt = resolveExpiresAt(item.options, now);
        if (item.value === undefined || (expiresAt !== undefined && expiresAt <= now)) {
          await mysqlClient.execute(`DELETE FROM ${this.#tableName} WHERE \`key\` = ?`, [
            storageKey,
          ]);
          continue;
        }

        if (item.expected === undefined) {
          const result = await executeResult(
            mysqlClient,
            `
              INSERT IGNORE INTO ${this.#tableName} (\`key\`, \`value\`, \`expires_at\`)
              VALUES (?, ?, ?)
            `,
            [storageKey, item.value, expiresAt ?? null],
          );
          if (result.affectedRows === 0) {
            return false;
          }
          continue;
        }

        await mysqlClient.execute(
          `
            INSERT INTO ${this.#tableName} (\`key\`, \`value\`, \`expires_at\`)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE
              \`value\` = VALUES(\`value\`),
              \`expires_at\` = VALUES(\`expires_at\`)
          `,
          [storageKey, item.value, expiresAt ?? null],
        );
      }

      return true;
    };

    const mysqlClient = await this.#getClient();
    const transactionClient = await mysqlClient.getConnection?.();
    const activeClient = transactionClient ?? mysqlClient;
    let transactionStarted = false;
    try {
      await startTransaction(activeClient);
      transactionStarted = true;

      const updated = await runTransaction(activeClient);
      if (!updated) {
        await rollbackTransaction(activeClient);
        transactionStarted = false;
        return false;
      }

      await commitTransaction(activeClient);
      transactionStarted = false;
      return true;
    } catch (error) {
      if (transactionStarted) {
        await rollbackTransaction(activeClient);
      }
      throw error;
    } finally {
      transactionClient?.release?.();
    }
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    for (const item of items) {
      await this.set(item.key, item.value, item.options);
    }
  }

  async delete(key: string): Promise<boolean> {
    const result = await executeResult(
      await this.#getClient(),
      `
        DELETE FROM ${this.#tableName}
        WHERE \`key\` = ? AND (\`expires_at\` IS NULL OR \`expires_at\` > ?)
      `,
      [this.#prefixKey(key), Date.now()],
    );
    return result.affectedRows > 0;
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    if (keys.length === 0) {
      return 0;
    }
    const result = await executeResult(
      await this.#getClient(),
      `
        DELETE FROM ${this.#tableName}
        WHERE \`key\` IN (${placeholders(keys.length)})
          AND (\`expires_at\` IS NULL OR \`expires_at\` > ?)
      `,
      [...keys.map((key) => this.#prefixKey(key)), Date.now()],
    );
    return result.affectedRows;
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async keys(keyOptions?: StorageEngineKeyOptions): Promise<readonly string[]> {
    const mysqlClient = await this.#getClient();
    await this.#deleteExpired(mysqlClient);
    const rows = await queryRows<{ readonly key: string }>(
      mysqlClient,
      `SELECT \`key\` FROM ${this.#tableName} WHERE \`key\` LIKE ? ESCAPE '\\\\'`,
      [likePattern(this.#prefixKey(keyOptions?.prefix ?? ""))],
    );
    return rows.map((row) => this.#unprefixKey(row.key));
  }

  async clear(keyOptions?: StorageEngineKeyOptions): Promise<void> {
    await (
      await this.#getClient()
    ).execute(`DELETE FROM ${this.#tableName} WHERE \`key\` LIKE ? ESCAPE '\\\\'`, [
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

  async #getClient(): Promise<MySqlEngineClient> {
    if (this.#client === undefined) {
      const mysql = await import("mysql2/promise");
      const createdClient =
        this.#options.url === undefined
          ? mysql.createPool(this.#options.connection ?? {})
          : mysql.createPool(this.#options.url);
      this.#client = createdClient as MySqlEngineClient;
    }

    if (this.#shouldInitialize && !this.#initialized) {
      await this.#initializeTable(this.#client);
      this.#initialized = true;
    }
    return this.#client;
  }

  async #initializeTable(mysqlClient: MySqlEngineClient): Promise<void> {
    await mysqlClient.execute(`
      CREATE TABLE IF NOT EXISTS ${this.#tableName} (
        \`key\` VARCHAR(768) PRIMARY KEY,
        \`value\` LONGBLOB NOT NULL,
        \`expires_at\` BIGINT NULL
      )
    `);
  }

  async #deleteExpired(mysqlClient: MySqlEngineClient): Promise<void> {
    await mysqlClient.execute(
      `DELETE FROM ${this.#tableName} WHERE \`expires_at\` IS NOT NULL AND \`expires_at\` <= ?`,
      [Date.now()],
    );
  }

  async #deleteRecord(mysqlClient: MySqlEngineClient, storageKey: string): Promise<void> {
    await mysqlClient.execute(`DELETE FROM ${this.#tableName} WHERE \`key\` = ?`, [storageKey]);
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

function quoteIdentifier(value: string): string {
  return `\`${value.replaceAll("`", "``")}\``;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

function likePattern(prefix: string): string {
  return `${prefix.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

async function queryRows<TRow>(
  client: MySqlEngineClient,
  query: string,
  parameters?: readonly unknown[],
): Promise<TRow[]> {
  const [rows] = await client.execute(
    query,
    parameters === undefined ? undefined : [...parameters],
  );
  return Array.isArray(rows) ? (rows as TRow[]) : [];
}

async function executeResult(
  client: MySqlEngineClient,
  query: string,
  parameters?: readonly unknown[],
): Promise<{ readonly affectedRows: number }> {
  const [result] = await client.execute(
    query,
    parameters === undefined ? undefined : [...parameters],
  );
  return typeof result === "object" && result !== null && "affectedRows" in result
    ? (result as { readonly affectedRows: number })
    : { affectedRows: 0 };
}

async function startTransaction(client: MySqlEngineClient): Promise<void> {
  if (client.beginTransaction !== undefined) {
    await client.beginTransaction();
    return;
  }
  await client.execute("START TRANSACTION");
}

async function commitTransaction(client: MySqlEngineClient): Promise<void> {
  if (client.commit !== undefined) {
    await client.commit();
    return;
  }
  await client.execute("COMMIT");
}

async function rollbackTransaction(client: MySqlEngineClient): Promise<void> {
  if (client.rollback !== undefined) {
    await client.rollback();
    return;
  }
  await client.execute("ROLLBACK");
}

/**
 * Engine batch item types accepted by MySQL storage operations.
 */
export type { StorageEngineCompareAndSetManyItem, StorageEngineSetManyItem };
