import type LibSqlDatabase from "libsql";

import { Buffer } from "node:buffer";

import type { StorageEngine, StorageEngineSetManyItem, StorageEngineSetOptions } from "../types.ts";

export interface LibSqlEngineClient {
  close?(): unknown;
  exec(query: string): unknown;
  prepare(query: string): LibSqlEngineStatement;
}

export interface LibSqlEngineStatement {
  all(...parameters: readonly unknown[]): unknown[];
  get(...parameters: readonly unknown[]): unknown;
  run(...parameters: readonly unknown[]): { readonly changes: number | bigint };
}

export interface LibSqlEngineConnectionOptions extends LibSqlDatabase.Options {
  readonly authToken?: string;
}

export interface LibSqlEngineOptions {
  readonly client?: LibSqlEngineClient;
  readonly path?: string;
  readonly url?: string;
  readonly connection?: LibSqlEngineConnectionOptions;
  readonly tableName?: string;
  readonly prefix?: string;
  readonly separator?: string;
  readonly initialize?: boolean;
  readonly dispose?: boolean;
}

interface LibSqlValueRow {
  readonly key?: string;
  readonly value: ArrayBuffer | Uint8Array;
  readonly expires_at?: number | string | bigint | null;
}

export function createLibSqlEngine(options: LibSqlEngineOptions = {}): StorageEngine {
  let client: LibSqlEngineClient | undefined = options.client;
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

  const getClient = async (): Promise<LibSqlEngineClient> => {
    if (client === undefined) {
      const { default: Database } = await import("libsql");
      client = new Database(options.url ?? options.path ?? ":memory:", options.connection);
    }

    if (shouldInitialize && !initialized) {
      initializeTable(client);
      initialized = true;
    }
    return client;
  };

  const initializeTable = (libSqlClient: LibSqlEngineClient): void => {
    libSqlClient.exec(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        key TEXT PRIMARY KEY,
        value BLOB NOT NULL,
        expires_at INTEGER
      )
    `);
  };

  const deleteExpired = (libSqlClient: LibSqlEngineClient): void => {
    libSqlClient
      .prepare(`DELETE FROM ${tableName} WHERE expires_at IS NOT NULL AND expires_at <= ?`)
      .run(Date.now());
  };

  const deleteRecord = (libSqlClient: LibSqlEngineClient, storageKey: string): void => {
    libSqlClient.prepare(`DELETE FROM ${tableName} WHERE key = ?`).run(storageKey);
  };

  return {
    name: "libsql",

    async get(key) {
      const libSqlClient = await getClient();
      const row = libSqlClient
        .prepare(`SELECT value, expires_at FROM ${tableName} WHERE key = ?`)
        .get(prefixKey(key)) as LibSqlValueRow | undefined;
      if (row === undefined) {
        return undefined;
      }
      if (isExpired(row.expires_at ?? null)) {
        deleteRecord(libSqlClient, prefixKey(key));
        return undefined;
      }
      return toUint8Array(row.value);
    },

    async getMany(keys) {
      if (keys.length === 0) {
        return new Map();
      }
      const libSqlClient = await getClient();
      deleteExpired(libSqlClient);
      const storageKeys = keys.map((key) => prefixKey(key));
      const rows = libSqlClient
        .prepare(
          `SELECT key, value FROM ${tableName} WHERE key IN (${placeholders(storageKeys.length)})`,
        )
        .all(...storageKeys) as LibSqlValueRow[];
      const result = new Map<string, Uint8Array>();
      for (const row of rows) {
        if (row.key !== undefined) {
          result.set(unprefixKey(row.key), toUint8Array(row.value));
        }
      }
      return result;
    },

    async set(key, value, setOptions) {
      const libSqlClient = await getClient();
      const storageKey = prefixKey(key);
      const expiresAt = resolveExpiresAt(setOptions);
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        deleteRecord(libSqlClient, storageKey);
        return;
      }
      libSqlClient
        .prepare(
          `
            INSERT INTO ${tableName} (key, value, expires_at)
            VALUES (?, ?, ?)
            ON CONFLICT (key) DO UPDATE SET
              value = excluded.value,
              expires_at = excluded.expires_at
          `,
        )
        .run(storageKey, Buffer.from(value), expiresAt ?? null);
    },

    async setMany(items) {
      for (const item of items) {
        await this.set(item.key, item.value, item.options);
      }
    },

    async delete(key) {
      const result = (await getClient())
        .prepare(
          `
            DELETE FROM ${tableName}
            WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)
          `,
        )
        .run(prefixKey(key), Date.now());
      return Number(result.changes) > 0;
    },

    async deleteMany(keys) {
      if (keys.length === 0) {
        return 0;
      }
      const result = (await getClient())
        .prepare(
          `
            DELETE FROM ${tableName}
            WHERE key IN (${placeholders(keys.length)})
              AND (expires_at IS NULL OR expires_at > ?)
          `,
        )
        .run(...keys.map((key) => prefixKey(key)), Date.now());
      return Number(result.changes);
    },

    async has(key) {
      return (await this.get(key)) !== undefined;
    },

    async keys(keyOptions) {
      const libSqlClient = await getClient();
      deleteExpired(libSqlClient);
      const rows = libSqlClient
        .prepare(`SELECT key FROM ${tableName} WHERE key LIKE ? ESCAPE '\\'`)
        .all(likePattern(prefixKey(keyOptions?.prefix ?? ""))) as Array<{ readonly key: string }>;
      return rows.map((row) => unprefixKey(row.key));
    },

    async clear(keyOptions) {
      (await getClient())
        .prepare(`DELETE FROM ${tableName} WHERE key LIKE ? ESCAPE '\\'`)
        .run(likePattern(prefixKey(keyOptions?.prefix ?? "")));
    },

    async dispose() {
      if (shouldDispose) {
        client?.close?.();
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

function toUint8Array(value: ArrayBuffer | Uint8Array): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value).slice();
  }
  return new Uint8Array(value).slice();
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

export type { StorageEngineSetManyItem };
