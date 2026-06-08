import type postgres from "postgres";

import { Buffer } from "node:buffer";

import type { StorageEngine, StorageEngineSetManyItem, StorageEngineSetOptions } from "../types.ts";

type PostgresRows<TRow extends object> = TRow[] & Iterable<TRow>;

export interface PostgresEngineClient {
  unsafe<TRow extends object = Record<string, unknown>>(
    query: string,
    parameters?: readonly unknown[],
  ): Promise<PostgresRows<TRow>>;
  end?(options?: { readonly timeout?: number }): Promise<void>;
}

export interface PostgresEngineOptions {
  readonly client?: PostgresEngineClient;
  readonly url?: string;
  readonly connection?: postgres.Options<Record<string, postgres.PostgresType>>;
  readonly tableName?: string;
  readonly prefix?: string;
  readonly separator?: string;
  readonly initialize?: boolean;
  readonly dispose?: boolean;
}

interface PostgresValueRow {
  readonly value: Uint8Array;
  readonly expires_at: number | string | bigint | null;
}

export function createPostgresEngine(options: PostgresEngineOptions = {}): StorageEngine {
  let client: PostgresEngineClient | undefined = options.client;
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

  const getClient = async (): Promise<PostgresEngineClient> => {
    if (client === undefined) {
      const imported = await import("postgres");
      const createPostgres = imported.default;
      client =
        options.url === undefined
          ? createPostgres(options.connection)
          : createPostgres(options.url, options.connection);
    }

    if (shouldInitialize && !initialized) {
      await initializeTable(client);
      initialized = true;
    }
    return client;
  };

  const initializeTable = async (postgresClient: PostgresEngineClient): Promise<void> => {
    await postgresClient.unsafe(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        key TEXT PRIMARY KEY,
        value BYTEA NOT NULL,
        expires_at BIGINT
      )
    `);
  };

  const deleteExpired = async (postgresClient: PostgresEngineClient): Promise<void> => {
    await postgresClient.unsafe(
      `DELETE FROM ${tableName} WHERE expires_at IS NOT NULL AND expires_at <= $1`,
      [Date.now()],
    );
  };

  const deleteRecord = async (
    postgresClient: PostgresEngineClient,
    storageKey: string,
  ): Promise<void> => {
    await postgresClient.unsafe(`DELETE FROM ${tableName} WHERE key = $1`, [storageKey]);
  };

  return {
    name: "postgres",

    async get(key) {
      const postgresClient = await getClient();
      const storageKey = prefixKey(key);
      const rows = await postgresClient.unsafe<PostgresValueRow>(
        `SELECT value, expires_at FROM ${tableName} WHERE key = $1`,
        [storageKey],
      );
      const row = rows[0];
      if (row === undefined) {
        return undefined;
      }
      if (isExpired(row.expires_at)) {
        await deleteRecord(postgresClient, storageKey);
        return undefined;
      }
      return toUint8Array(row.value);
    },

    async getMany(keys) {
      if (keys.length === 0) {
        return new Map();
      }
      const postgresClient = await getClient();
      await deleteExpired(postgresClient);
      const storageKeys = keys.map((key) => prefixKey(key));
      const rows = await postgresClient.unsafe<PostgresValueRow & { readonly key: string }>(
        `SELECT key, value FROM ${tableName} WHERE key = ANY($1)`,
        [storageKeys],
      );
      const result = new Map<string, Uint8Array>();
      for (const row of rows) {
        result.set(unprefixKey(row.key), toUint8Array(row.value));
      }
      return result;
    },

    async set(key, value, setOptions) {
      const postgresClient = await getClient();
      const storageKey = prefixKey(key);
      const expiresAt = resolveExpiresAt(setOptions);
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        await deleteRecord(postgresClient, storageKey);
        return;
      }
      await postgresClient.unsafe(
        `
          INSERT INTO ${tableName} (key, value, expires_at)
          VALUES ($1, $2, $3)
          ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            expires_at = EXCLUDED.expires_at
        `,
        [storageKey, Buffer.from(value), expiresAt ?? null],
      );
    },

    async setMany(items) {
      for (const item of items) {
        await this.set(item.key, item.value, item.options);
      }
    },

    async delete(key) {
      const rows = await (
        await getClient()
      ).unsafe<{ readonly count: number | string | bigint }>(
        `
          DELETE FROM ${tableName}
          WHERE key = $1 AND (expires_at IS NULL OR expires_at > $2)
          RETURNING 1 AS count
        `,
        [prefixKey(key), Date.now()],
      );
      return rows.length > 0;
    },

    async deleteMany(keys) {
      if (keys.length === 0) {
        return 0;
      }
      const rows = await (
        await getClient()
      ).unsafe<{ readonly count: number | string | bigint }>(
        `
          DELETE FROM ${tableName}
          WHERE key = ANY($1) AND (expires_at IS NULL OR expires_at > $2)
          RETURNING 1 AS count
        `,
        [keys.map((key) => prefixKey(key)), Date.now()],
      );
      return rows.length;
    },

    async has(key) {
      return (await this.get(key)) !== undefined;
    },

    async keys(keyOptions) {
      const postgresClient = await getClient();
      await deleteExpired(postgresClient);
      const rows = await postgresClient.unsafe<{ readonly key: string }>(
        `SELECT key FROM ${tableName} WHERE key LIKE $1 ESCAPE '\\'`,
        [likePattern(prefixKey(keyOptions?.prefix ?? ""))],
      );
      return rows.map((row) => unprefixKey(row.key));
    },

    async clear(keyOptions) {
      await (
        await getClient()
      ).unsafe(`DELETE FROM ${tableName} WHERE key LIKE $1 ESCAPE '\\'`, [
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
  return `"${value.replaceAll('"', '""')}"`;
}

function likePattern(prefix: string): string {
  return `${prefix.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export type { StorageEngineSetManyItem };
