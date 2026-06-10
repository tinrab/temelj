import { Buffer } from "node:buffer";
import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  StorageEngine,
  StorageEngineCompareAndSetManyItem,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

import { bytesEqual, resolveExpiresAt } from "../utility.ts";

/**
 * Options for {@link FileSystemStorageEngine}.
 */
export interface FileSystemEngineOptions {
  /**
   * Directory where encoded value and metadata files are stored.
   */
  readonly directory: string;

  /**
   * Extension used for TTL metadata files. Defaults to `.meta.json`.
   */
  readonly metadataExtension?: string;

  /**
   * Prefix namespace applied to all engine keys.
   */
  readonly prefix?: string;

  /**
   * Separator between prefix and key. Defaults to `":"`.
   */
  readonly separator?: string;

  /**
   * Extension used for encoded value files. Defaults to `.bin`.
   */
  readonly valueExtension?: string;
}

interface FileSystemRecordMetadata {
  readonly expiresAt?: number;
}

const DEFAULT_VALUE_EXTENSION = ".bin";
const DEFAULT_METADATA_EXTENSION = ".meta.json";

/**
 * Storage engine that stores each encoded value as a file on disk.
 */
export class FileSystemStorageEngine implements StorageEngine {
  readonly name = "file-system";

  readonly #directory: string;
  readonly #metadataExtension: string;
  readonly #prefix: string;
  readonly #separator: string;
  readonly #valueExtension: string;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(options: FileSystemEngineOptions) {
    this.#directory = resolve(options.directory);
    this.#metadataExtension = options.metadataExtension ?? DEFAULT_METADATA_EXTENSION;
    this.#prefix = options.prefix ?? "";
    this.#separator = options.separator ?? ":";
    this.#valueExtension = options.valueExtension ?? DEFAULT_VALUE_EXTENSION;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    return await this.#readRecord(this.#prefixKey(key));
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
    const values = new Map<string, Uint8Array>();
    for (const key of keys) {
      const value = await this.get(key);
      if (value !== undefined) {
        values.set(key, value);
      }
    }
    return values;
  }

  async set(key: string, value: Uint8Array, options?: StorageEngineSetOptions): Promise<void> {
    const storageKey = this.#prefixKey(key);
    await this.#withKeyLock(storageKey, async () => {
      await this.#writeRecord(storageKey, value, resolveExpiresAt(options));
    });
  }

  async compareAndSet(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
    options?: StorageEngineSetOptions,
  ): Promise<boolean> {
    const storageKey = this.#prefixKey(key);
    return await this.#withKeyLock(storageKey, async () => {
      const current = await this.#readRecord(storageKey);
      if (!bytesEqual(current, expected)) {
        return false;
      }

      if (value === undefined) {
        await this.#removeRecord(storageKey);
        return true;
      }

      await this.#writeRecord(storageKey, value, resolveExpiresAt(options));
      return true;
    });
  }

  async compareAndSetMany(items: readonly StorageEngineCompareAndSetManyItem[]): Promise<boolean> {
    const storageItems = items.map((item) => ({
      key: this.#prefixKey(item.key),
      expected: item.expected,
      value: item.value,
      options: item.options,
    }));
    return await this.#withKeyLocks(
      storageItems.map((item) => item.key),
      async () => {
        for (const item of storageItems) {
          const current = await this.#readRecord(item.key);
          if (!bytesEqual(current, item.expected)) {
            return false;
          }
        }

        for (const item of storageItems) {
          if (item.value === undefined) {
            await this.#removeRecord(item.key);
            continue;
          }
          await this.#writeRecord(item.key, item.value, resolveExpiresAt(item.options));
        }
        return true;
      },
    );
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    for (const item of items) {
      await this.set(item.key, item.value, item.options);
    }
  }

  async delete(key: string): Promise<boolean> {
    const storageKey = this.#prefixKey(key);
    return await this.#withKeyLock(storageKey, async () => {
      const exists = (await this.#readRecord(storageKey)) !== undefined;
      await this.#removeRecord(storageKey);
      return exists;
    });
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (await this.delete(key)) {
        deleted++;
      }
    }
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    return (await this.#readRecord(this.#prefixKey(key))) !== undefined;
  }

  async keys(options?: StorageEngineKeyOptions): Promise<readonly string[]> {
    const result: string[] = [];
    for (const key of await this.#matchingKeys(options)) {
      if ((await this.#readRecord(key)) !== undefined) {
        result.push(this.#unprefixKey(key));
      }
    }
    return result;
  }

  async clear(options?: StorageEngineKeyOptions): Promise<void> {
    if (options?.prefix === undefined && this.#prefix.length === 0) {
      await rm(this.#directory, { force: true, recursive: true });
      return;
    }

    for (const key of await this.#matchingKeys(options)) {
      await this.#removeRecord(key);
    }
  }

  #prefixKey(key: string): string {
    return this.#prefix.length === 0 ? key : `${this.#prefix}${this.#separator}${key}`;
  }

  #unprefixKey(key: string): string {
    return this.#prefix.length === 0 ? key : key.slice(`${this.#prefix}${this.#separator}`.length);
  }

  #valuePath(key: string): string {
    return join(this.#directory, `${encodeKey(key)}${this.#valueExtension}`);
  }

  #metadataPath(key: string): string {
    return join(this.#directory, `${encodeKey(key)}${this.#metadataExtension}`);
  }

  async #readMetadata(key: string): Promise<FileSystemRecordMetadata> {
    const metadata = await readOptionalFile(this.#metadataPath(key));
    if (metadata === undefined) {
      return {};
    }
    return JSON.parse(new TextDecoder().decode(metadata)) as FileSystemRecordMetadata;
  }

  async #removeRecord(key: string): Promise<void> {
    await Promise.all([removeFile(this.#valuePath(key)), removeFile(this.#metadataPath(key))]);
  }

  async #writeRecord(key: string, value: Uint8Array, expiresAt: number | undefined): Promise<void> {
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await this.#removeRecord(key);
      return;
    }

    await mkdir(this.#directory, { recursive: true });
    await writeFile(this.#valuePath(key), value);
    if (expiresAt === undefined) {
      await removeFile(this.#metadataPath(key));
      return;
    }
    await writeFile(this.#metadataPath(key), JSON.stringify({ expiresAt }));
  }

  async #withKeyLock<T>(key: string, callback: () => Promise<T>): Promise<T> {
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    const next = previous.then(
      () => current,
      () => current,
    );
    this.#locks.set(key, next);

    await previous;
    try {
      return await callback();
    } finally {
      release();
      if (this.#locks.get(key) === next) {
        this.#locks.delete(key);
      }
    }
  }

  async #withKeyLocks<T>(keys: readonly string[], callback: () => Promise<T>): Promise<T> {
    const [key, ...rest] = [...new Set(keys)].sort();
    if (key === undefined) {
      return await callback();
    }
    return await this.#withKeyLock(key, async () => await this.#withKeyLocks(rest, callback));
  }

  async #isExpired(key: string): Promise<boolean> {
    const metadata = await this.#readMetadata(key);
    return metadata.expiresAt !== undefined && metadata.expiresAt <= Date.now();
  }

  async #readRecord(key: string): Promise<Uint8Array | undefined> {
    if (await this.#isExpired(key)) {
      await this.#removeRecord(key);
      return undefined;
    }

    const value = await readOptionalFile(this.#valuePath(key));
    if (value === undefined) {
      await removeFile(this.#metadataPath(key));
      return undefined;
    }
    return value;
  }

  async #allKeys(): Promise<readonly string[]> {
    const entries = await readDirectory(this.#directory);
    return entries
      .filter((entry) => entry.endsWith(this.#valueExtension))
      .map((entry) => decodeKey(entry.slice(0, -this.#valueExtension.length)));
  }

  async #matchingKeys(options: StorageEngineKeyOptions | undefined): Promise<readonly string[]> {
    const matchPrefix = this.#prefixKey(options?.prefix ?? "");
    return (await this.#allKeys()).filter((key) => key.startsWith(matchPrefix));
  }
}

async function readOptionalFile(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

async function readDirectory(path: string): Promise<readonly string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function removeFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNotFoundError(error)) {
      throw error;
    }
  }
}

function encodeKey(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

function decodeKey(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "ENOENT" ||
      (error as { readonly code?: unknown }).code === "EISDIR")
  );
}

/**
 * Engine batch item types accepted by file-system storage operations.
 */
export type { StorageEngineCompareAndSetManyItem, StorageEngineSetManyItem };
