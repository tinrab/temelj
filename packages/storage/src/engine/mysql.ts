import type { PoolOptions } from "mysql2/promise";

import type { StorageEngine, StorageEngineSetManyItem, StorageEngineSetOptions } from "../types.ts";

export interface MySqlEngineClient {
  end?(): Promise<void>;
  execute(query: string, parameters?: unknown[]): Promise<readonly [unknown, unknown]>;
}

export interface MySqlEngineOptions {
  readonly client?: MySqlEngineClient;
  readonly url?: string;
  readonly connection?: PoolOptions;
  readonly tableName?: string;
  readonly prefix?: string;
  readonly separator?: string;
  readonly initialize?: boolean;
  readonly dispose?: boolean;
}

interface MySqlValueRow {
  readonly value: Uint8Array;
  readonly expires_at: number | string | bigint | null;
}

export function createMySqlEngine(options: MySqlEngineOptions = {}): StorageEngine {
  let client: MySqlEngineClient | undefined = options.client;
  let initialized = false;
  const tableName = quoteIdentifier(options.tableName ?? "temelj_storage");
  const prefix = options.prefix ?? "";
  const separator = options.separator ?? ":";
  const shouldInitialize = options.initialize ?? true;
  const shouldDispose = options.dispose ?? options.client === undefined;

  const prefixKey = (key: string): string =>
    prefix.length === 0 ? key : `${prefix}${separator}${key}`;
  const unprefixKey = (key: string): string => {
    if (prefix.length === 0) {
      return key;
    }
    const expectedPrefix = `${prefix}${separator}`;
    return key.startsWith(expectedPrefix) ? key.slice(expectedPrefix.length) : key;
  };

  const getClient = async (): Promise<MySqlEngineClient> => {
    if (client === undefined) {
      const mysql = await import("mysql2/promise");
      const createdClient =
        options.url === undefined
          ? mysql.createPool(options.connection ?? {})
          : mysql.createPool(options.url);
      client = createdClient as MySqlEngineClient;
    }

    if (shouldInitialize && !initialized) {
      await initializeTable(client);
      initialized = true;
    }
    return client;
  };

  const initializeTable = async (mysqlClient: MySqlEngineClient): Promise<void> => {
    await mysqlClient.execute(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        \`key\` VARCHAR(768) PRIMARY KEY,
        \`value\` LONGBLOB NOT NULL,
        \`expires_at\` BIGINT NULL
      )
    `);
  };

  const deleteExpired = async (mysqlClient: MySqlEngineClient): Promise<void> => {
    await mysqlClient.execute(
      `DELETE FROM ${tableName} WHERE \`expires_at\` IS NOT NULL AND \`expires_at\` <= ?`,
      [Date.now()],
    );
  };

  const deleteRecord = async (
    mysqlClient: MySqlEngineClient,
    storageKey: string,
  ): Promise<void> => {
    await mysqlClient.execute(`DELETE FROM ${tableName} WHERE \`key\` = ?`, [storageKey]);
  };

  return {
    name: "mysql",

    async get(key) {
      const mysqlClient = await getClient();
      const rows = await queryRows<MySqlValueRow>(
        mysqlClient,
        `SELECT \`value\`, \`expires_at\` FROM ${tableName} WHERE \`key\` = ?`,
        [prefixKey(key)],
      );
      const row = rows[0];
      if (row === undefined) {
        return undefined;
      }
      if (isExpired(row.expires_at)) {
        await deleteRecord(mysqlClient, prefixKey(key));
        return undefined;
      }
      return toUint8Array(row.value);
    },

    async getMany(keys) {
      if (keys.length === 0) {
        return new Map();
      }
      const mysqlClient = await getClient();
      await deleteExpired(mysqlClient);
      const storageKeys = keys.map((key) => prefixKey(key));
      const rows = await queryRows<MySqlValueRow & { readonly key: string }>(
        mysqlClient,
        `SELECT \`key\`, \`value\` FROM ${tableName} WHERE \`key\` IN (${placeholders(storageKeys.length)})`,
        storageKeys,
      );
      const result = new Map<string, Uint8Array>();
      for (const row of rows) {
        result.set(unprefixKey(row.key), toUint8Array(row.value));
      }
      return result;
    },

    async set(key, value, setOptions) {
      const mysqlClient = await getClient();
      const storageKey = prefixKey(key);
      const expiresAt = resolveExpiresAt(setOptions);
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        await deleteRecord(mysqlClient, storageKey);
        return;
      }
      await mysqlClient.execute(
        `
          INSERT INTO ${tableName} (\`key\`, \`value\`, \`expires_at\`)
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE
            \`value\` = VALUES(\`value\`),
            \`expires_at\` = VALUES(\`expires_at\`)
        `,
        [storageKey, value, expiresAt ?? null],
      );
    },

    async setMany(items) {
      for (const item of items) {
        await this.set(item.key, item.value, item.options);
      }
    },

    async delete(key) {
      const result = await executeResult(
        await getClient(),
        `
          DELETE FROM ${tableName}
          WHERE \`key\` = ? AND (\`expires_at\` IS NULL OR \`expires_at\` > ?)
        `,
        [prefixKey(key), Date.now()],
      );
      return result.affectedRows > 0;
    },

    async deleteMany(keys) {
      if (keys.length === 0) {
        return 0;
      }
      const result = await executeResult(
        await getClient(),
        `
          DELETE FROM ${tableName}
          WHERE \`key\` IN (${placeholders(keys.length)})
            AND (\`expires_at\` IS NULL OR \`expires_at\` > ?)
        `,
        [...keys.map((key) => prefixKey(key)), Date.now()],
      );
      return result.affectedRows;
    },

    async has(key) {
      return (await this.get(key)) !== undefined;
    },

    async keys(keyOptions) {
      const mysqlClient = await getClient();
      await deleteExpired(mysqlClient);
      const rows = await queryRows<{ readonly key: string }>(
        mysqlClient,
        `SELECT \`key\` FROM ${tableName} WHERE \`key\` LIKE ? ESCAPE '\\\\'`,
        [likePattern(prefixKey(keyOptions?.prefix ?? ""))],
      );
      return rows.map((row) => unprefixKey(row.key));
    },

    async clear(keyOptions) {
      await (
        await getClient()
      ).execute(`DELETE FROM ${tableName} WHERE \`key\` LIKE ? ESCAPE '\\\\'`, [
        likePattern(prefixKey(keyOptions?.prefix ?? "")),
      ]);
    },

    async dispose() {
      if (shouldDispose) {
        await client?.end?.();
      }
      client = undefined;
      initialized = false;
    },
  };
}

function resolveExpiresAt(options: StorageEngineSetOptions | undefined): number | undefined {
  return options?.ttl === undefined ? undefined : Date.now() + options.ttl;
}

function isExpired(value: number | string | bigint | null): boolean {
  return value !== null && Number(value) <= Date.now();
}

function toUint8Array(value: Uint8Array): Uint8Array {
  return value.slice();
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

export type { StorageEngineSetManyItem };
