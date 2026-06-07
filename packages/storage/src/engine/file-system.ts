import { Buffer } from "node:buffer";
import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

export interface FileSystemEngineOptions {
  readonly directory: string;
  readonly prefix?: string;
  readonly separator?: string;
}

interface FileSystemRecordMetadata {
  readonly expiresAt?: number;
}

const VALUE_EXTENSION = ".bin";
const METADATA_EXTENSION = ".meta.json";

export function createFileSystemEngine(options: FileSystemEngineOptions): StorageEngine {
  const directory = resolve(options.directory);
  const prefix = options.prefix ?? "";
  const separator = options.separator ?? ":";
  const prefixKey = (key: string): string =>
    prefix.length === 0 ? key : `${prefix}${separator}${key}`;
  const unprefixKey = (key: string): string =>
    prefix.length === 0 ? key : key.slice(`${prefix}${separator}`.length);

  const valuePath = (key: string): string => join(directory, `${encodeKey(key)}${VALUE_EXTENSION}`);
  const metadataPath = (key: string): string =>
    join(directory, `${encodeKey(key)}${METADATA_EXTENSION}`);

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

  const isExpired = async (key: string): Promise<boolean> => {
    const metadata = await readMetadata(key);
    return metadata.expiresAt !== undefined && metadata.expiresAt <= Date.now();
  };

  const readRecord = async (key: string): Promise<Uint8Array | undefined> => {
    if (await isExpired(key)) {
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

  const allKeys = async (): Promise<readonly string[]> => {
    const entries = await readDirectory(directory);
    return entries
      .filter((entry) => entry.endsWith(VALUE_EXTENSION))
      .map((entry) => decodeKey(entry.slice(0, -VALUE_EXTENSION.length)));
  };

  const matchingKeys = async (
    keyOptions: StorageEngineKeyOptions | undefined,
  ): Promise<readonly string[]> => {
    const matchPrefix = prefixKey(keyOptions?.prefix ?? "");
    return (await allKeys()).filter((key) => key.startsWith(matchPrefix));
  };

  return {
    name: "file-system",

    async get(key) {
      return readRecord(prefixKey(key));
    },

    async getMany(keys) {
      const values = new Map<string, Uint8Array>();
      for (const key of keys) {
        const value = await this.get(key);
        if (value !== undefined) {
          values.set(key, value);
        }
      }
      return values;
    },

    async set(key, value, setOptions) {
      const storageKey = prefixKey(key);
      const expiresAt = resolveExpiresAt(setOptions);
      if (expiresAt !== undefined && expiresAt <= Date.now()) {
        await removeRecord(storageKey);
        return;
      }

      await mkdir(directory, { recursive: true });
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
      const storageKey = prefixKey(key);
      const exists = (await readRecord(storageKey)) !== undefined;
      await removeRecord(storageKey);
      return exists;
    },

    async deleteMany(keys) {
      let deleted = 0;
      for (const key of keys) {
        if (await this.delete(key)) {
          deleted++;
        }
      }
      return deleted;
    },

    async has(key) {
      return (await readRecord(prefixKey(key))) !== undefined;
    },

    async keys(keyOptions) {
      const result: string[] = [];
      for (const key of await matchingKeys(keyOptions)) {
        if ((await readRecord(key)) !== undefined) {
          result.push(unprefixKey(key));
        }
      }
      return result;
    },

    async clear(keyOptions) {
      if (keyOptions?.prefix === undefined && prefix.length === 0) {
        await rm(directory, { force: true, recursive: true });
        return;
      }

      for (const key of await matchingKeys(keyOptions)) {
        await removeRecord(key);
      }
    },
  };
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
