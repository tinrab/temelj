import { hashCyrb53 } from "@temelj/string";
import { Buffer } from "node:buffer";
import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

export type FileSystemEngineStrategy = "file-per-key" | "bucket";

/**
 * Options for the Node.js file system storage engine.
 */
export interface FileSystemEngineOptions {
  /**
   * Directory where storage files are read and written.
   *
   * The path is resolved with `path.resolve`. Storage keys are encoded before
   * they are used in file names, so path-like keys are treated as literal keys.
   */
  readonly directory: string;

  /**
   * Namespace prefix added to every key before it is stored.
   *
   * The prefix is also applied before hashing in bucket mode.
   */
  readonly prefix?: string;

  /**
   * Separator inserted between `prefix` and the user key.
   *
   * @default ":"
   */
  readonly separator?: string;

  /**
   * On-disk storage layout.
   *
   * - `"file-per-key"` stores each encoded value in its own file.
   * - `"bucket"` stores values in a fixed number of JSON bucket files selected
   *   by `hashCyrb53(storageKey) % bucketCount`.
   *
   * @default "file-per-key"
   */
  readonly strategy?: FileSystemEngineStrategy;

  /**
   * Number of fixed bucket files used by the `"bucket"` strategy.
   *
   * Changing this value changes key placement for existing data.
   *
   * @default 256
   */
  readonly bucketCount?: number;

  /**
   * File name format used by the `"bucket"` strategy.
   *
   * The format must include `{bucket}`, which is replaced with the numeric
   * bucket id.
   *
   * @default "bucket-{bucket}.json"
   */
  readonly bucketFileNameFormat?: string;

  /**
   * File extension for value files created by the `"file-per-key"` strategy.
   *
   * @default ".bin"
   */
  readonly valueExtension?: string;

  /**
   * File extension for TTL metadata files created by the `"file-per-key"` strategy.
   *
   * @default ".meta.json"
   */
  readonly metadataExtension?: string;
}

interface FileSystemEngineConfig {
  readonly directory: string;
  readonly prefix: string;
  readonly separator: string;
  readonly strategy: FileSystemEngineStrategy;
  readonly bucketCount: number;
  readonly bucketFileNameFormat: string;
  readonly valueExtension: string;
  readonly metadataExtension: string;
}

interface FileSystemRecordMetadata {
  readonly expiresAt?: number;
}

interface FileSystemBucketRecord extends FileSystemRecordMetadata {
  readonly value: string;
}

interface FileSystemBucket {
  readonly records: Record<string, FileSystemBucketRecord>;
}

const DEFAULT_VALUE_EXTENSION = ".bin";
const DEFAULT_METADATA_EXTENSION = ".meta.json";
const DEFAULT_BUCKET_COUNT = 256;
const DEFAULT_BUCKET_FILE_NAME_FORMAT = "bucket-{bucket}.json";

export function createFileSystemEngine(options: FileSystemEngineOptions): StorageEngine {
  const config = resolveFileSystemEngineConfig(options);
  return config.strategy === "file-per-key"
    ? createFilePerKeyEngine(config)
    : createBucketEngine(config);
}

function createFilePerKeyEngine(config: FileSystemEngineConfig): StorageEngine {
  const valuePath = (key: string): string =>
    join(config.directory, `${encodeKey(key)}${config.valueExtension}`);
  const metadataPath = (key: string): string =>
    join(config.directory, `${encodeKey(key)}${config.metadataExtension}`);

  const readMetadata = async (key: string): Promise<FileSystemRecordMetadata> => {
    const metadata = await readOptionalFile(metadataPath(key));
    if (metadata === undefined) {
      return {};
    }
    return JSON.parse(new TextDecoder().decode(metadata)) as FileSystemRecordMetadata;
  };

  const removeRecord = async (key: string): Promise<void> => {
    await Promise.all([removeFile(valuePath(key)), removeFile(metadataPath(key))]);
  };

  const readRecord = async (key: string): Promise<Uint8Array | undefined> => {
    if (await isFileRecordExpired(key, readMetadata)) {
      await removeRecord(key);
      return undefined;
    }

    const value = await readOptionalFile(valuePath(key));
    if (value === undefined) {
      await removeFile(metadataPath(key));
      return undefined;
    }
    return value;
  };

  const allKeys = async (): Promise<readonly string[]> =>
    (await readDirectory(config.directory))
      .filter((entry) => entry.endsWith(config.valueExtension))
      .map((entry) => decodeKey(entry.slice(0, -config.valueExtension.length)));

  const matchingKeys = async (
    keyOptions: StorageEngineKeyOptions | undefined,
  ): Promise<readonly string[]> =>
    (await allKeys()).filter((key) => key.startsWith(prefixKey(config, keyOptions?.prefix ?? "")));

  return {
    name: "file-system",

    async get(key) {
      return readRecord(prefixKey(config, key));
    },

    async getMany(keys) {
      return getManyWith(this, keys);
    },

    async set(key, value, setOptions) {
      const storageKey = prefixKey(config, key);
      const expiresAt = resolveExpiresAt(setOptions);
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        await removeRecord(storageKey);
        return;
      }

      await mkdir(config.directory, { recursive: true });
      await writeFile(valuePath(storageKey), value);
      if (expiresAt === undefined) {
        await removeFile(metadataPath(storageKey));
        return;
      }
      await writeFile(metadataPath(storageKey), JSON.stringify({ expiresAt }));
    },

    async setMany(items) {
      for (const item of items) {
        await this.set(item.key, item.value, item.options);
      }
    },

    async delete(key) {
      const storageKey = prefixKey(config, key);
      const exists = (await readRecord(storageKey)) !== undefined;
      await removeRecord(storageKey);
      return exists;
    },

    async deleteMany(keys) {
      return deleteManyWith(this, keys);
    },

    async has(key) {
      return (await readRecord(prefixKey(config, key))) !== undefined;
    },

    async keys(keyOptions) {
      const result: string[] = [];
      for (const key of await matchingKeys(keyOptions)) {
        if ((await readRecord(key)) !== undefined) {
          result.push(unprefixKey(config, key));
        }
      }
      return result;
    },

    async clear(keyOptions) {
      if (keyOptions?.prefix === undefined && config.prefix.length === 0) {
        await rm(config.directory, { force: true, recursive: true });
        return;
      }

      for (const key of await matchingKeys(keyOptions)) {
        await removeRecord(key);
      }
    },
  };
}

function createBucketEngine(config: FileSystemEngineConfig): StorageEngine {
  const bucketPath = (bucketId: number): string =>
    join(config.directory, formatBucketFileName(config.bucketFileNameFormat, bucketId));

  const readBucket = async (bucketId: number): Promise<FileSystemBucket> => {
    const bytes = await readOptionalFile(bucketPath(bucketId));
    if (bytes === undefined) {
      return { records: {} };
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as FileSystemBucket;
  };

  const writeBucket = async (bucketId: number, bucket: FileSystemBucket): Promise<void> => {
    await mkdir(config.directory, { recursive: true });
    await writeFile(bucketPath(bucketId), JSON.stringify(bucket));
  };

  const removeBucket = async (bucketId: number): Promise<void> => {
    await removeFile(bucketPath(bucketId));
  };

  const writeOrRemoveBucket = async (bucketId: number, bucket: FileSystemBucket): Promise<void> => {
    if (Object.keys(bucket.records).length === 0) {
      await removeBucket(bucketId);
      return;
    }
    await writeBucket(bucketId, bucket);
  };

  const readPrunedBucket = async (bucketId: number): Promise<FileSystemBucket> => {
    const bucket = await readBucket(bucketId);
    const prunedBucket = pruneBucket(bucket);
    if (Object.keys(prunedBucket.records).length !== Object.keys(bucket.records).length) {
      await writeOrRemoveBucket(bucketId, prunedBucket);
    }
    return prunedBucket;
  };

  const bucketIdForKey = (storageKey: string): number =>
    hashCyrb53(storageKey) % config.bucketCount;

  const readRecord = async (storageKey: string): Promise<Uint8Array | undefined> => {
    const bucket = await readPrunedBucket(bucketIdForKey(storageKey));
    const record = bucket.records[storageKey];
    return record === undefined ? undefined : decodeBytes(record.value);
  };

  const removeRecord = async (storageKey: string): Promise<boolean> => {
    const bucketId = bucketIdForKey(storageKey);
    const bucket = await readPrunedBucket(bucketId);
    if (bucket.records[storageKey] === undefined) {
      return false;
    }

    const records = { ...bucket.records };
    delete records[storageKey];
    await writeOrRemoveBucket(bucketId, { records });
    return true;
  };

  const allKeys = async (): Promise<readonly string[]> => {
    const keys: string[] = [];
    for (let bucketId = 0; bucketId < config.bucketCount; bucketId++) {
      keys.push(...Object.keys((await readPrunedBucket(bucketId)).records));
    }
    return keys;
  };

  const matchingKeys = async (
    keyOptions: StorageEngineKeyOptions | undefined,
  ): Promise<readonly string[]> =>
    (await allKeys()).filter((key) => key.startsWith(prefixKey(config, keyOptions?.prefix ?? "")));

  return {
    name: "file-system",

    async get(key) {
      return readRecord(prefixKey(config, key));
    },

    async getMany(keys) {
      return getManyWith(this, keys);
    },

    async set(key, value, setOptions) {
      const storageKey = prefixKey(config, key);
      const expiresAt = resolveExpiresAt(setOptions);
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        await removeRecord(storageKey);
        return;
      }

      const bucketId = bucketIdForKey(storageKey);
      const bucket = await readPrunedBucket(bucketId);
      await writeBucket(bucketId, {
        records: {
          ...bucket.records,
          [storageKey]: createBucketRecord(value, expiresAt),
        },
      });
    },

    async setMany(items) {
      for (const item of items) {
        await this.set(item.key, item.value, item.options);
      }
    },

    async delete(key) {
      return removeRecord(prefixKey(config, key));
    },

    async deleteMany(keys) {
      return deleteManyWith(this, keys);
    },

    async has(key) {
      return (await readRecord(prefixKey(config, key))) !== undefined;
    },

    async keys(keyOptions) {
      return (await matchingKeys(keyOptions)).map((key) => unprefixKey(config, key));
    },

    async clear(keyOptions) {
      if (keyOptions?.prefix === undefined && config.prefix.length === 0) {
        await rm(config.directory, { force: true, recursive: true });
        return;
      }

      for (const key of await matchingKeys(keyOptions)) {
        await removeRecord(key);
      }
    },
  };
}

function resolveFileSystemEngineConfig(options: FileSystemEngineOptions): FileSystemEngineConfig {
  const config = {
    directory: resolve(options.directory),
    prefix: options.prefix ?? "",
    separator: options.separator ?? ":",
    strategy: options.strategy ?? "file-per-key",
    bucketCount: options.bucketCount ?? DEFAULT_BUCKET_COUNT,
    bucketFileNameFormat: options.bucketFileNameFormat ?? DEFAULT_BUCKET_FILE_NAME_FORMAT,
    valueExtension: options.valueExtension ?? DEFAULT_VALUE_EXTENSION,
    metadataExtension: options.metadataExtension ?? DEFAULT_METADATA_EXTENSION,
  };

  assertFileExtension(config.valueExtension, "valueExtension");
  assertFileExtension(config.metadataExtension, "metadataExtension");
  assertBucketCount(config.bucketCount);
  assertBucketFileNameFormat(config.bucketFileNameFormat);

  return config;
}

async function getManyWith(
  engine: StorageEngine,
  keys: readonly string[],
): Promise<ReadonlyMap<string, Uint8Array>> {
  const values = new Map<string, Uint8Array>();
  for (const key of keys) {
    const value = await engine.get(key);
    if (value !== undefined) {
      values.set(key, value);
    }
  }
  return values;
}

async function deleteManyWith(engine: StorageEngine, keys: readonly string[]): Promise<number> {
  let deleted = 0;
  for (const key of keys) {
    if (await engine.delete(key)) {
      deleted++;
    }
  }
  return deleted;
}

function createBucketRecord(
  value: Uint8Array,
  expiresAt: number | undefined,
): FileSystemBucketRecord {
  return expiresAt === undefined
    ? { value: encodeBytes(value) }
    : { value: encodeBytes(value), expiresAt };
}

function pruneBucket(bucket: FileSystemBucket): FileSystemBucket {
  const records: Record<string, FileSystemBucketRecord> = {};
  for (const [key, record] of Object.entries(bucket.records)) {
    if (!isBucketRecordExpired(record)) {
      records[key] = record;
    }
  }
  return { records };
}

function isBucketRecordExpired(record: FileSystemBucketRecord): boolean {
  return record.expiresAt !== undefined && record.expiresAt <= Date.now();
}

async function isFileRecordExpired(
  key: string,
  readMetadata: (key: string) => Promise<FileSystemRecordMetadata>,
): Promise<boolean> {
  const metadata = await readMetadata(key);
  return metadata.expiresAt !== undefined && metadata.expiresAt <= Date.now();
}

function prefixKey(config: FileSystemEngineConfig, key: string): string {
  return config.prefix.length === 0 ? key : `${config.prefix}${config.separator}${key}`;
}

function unprefixKey(config: FileSystemEngineConfig, key: string): string {
  return config.prefix.length === 0 ? key : key.slice(`${config.prefix}${config.separator}`.length);
}

function formatBucketFileName(format: string, bucketId: number): string {
  return format.replaceAll("{bucket}", String(bucketId));
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

function resolveExpiresAt(options: StorageEngineSetOptions | undefined): number | undefined {
  return options?.ttl === undefined ? undefined : Date.now() + options.ttl;
}

function encodeKey(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

function decodeKey(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function encodeBytes(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBytes(value: string): Uint8Array {
  return Buffer.from(value, "base64url");
}

function assertFileExtension(value: string, optionName: string): void {
  if (value.length === 0) {
    throw new RangeError(`File system storage ${optionName} must not be empty.`);
  }
}

function assertBucketCount(value: number): void {
  if (value < 1 || !Number.isInteger(value)) {
    throw new RangeError("File system storage bucketCount must be a positive integer.");
  }
}

function assertBucketFileNameFormat(value: string): void {
  if (!value.includes("{bucket}")) {
    throw new RangeError('File system storage bucketFileNameFormat must include "{bucket}".');
  }
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

export type { StorageEngineSetManyItem };
