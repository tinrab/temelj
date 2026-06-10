import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type {
  StorageEngine,
  StorageEngineKeyOptions,
  StorageEngineSetManyItem,
  StorageEngineSetOptions,
} from "../types.ts";

/**
 * Minimal AWS S3 client interface used by {@link S3StorageEngine}.
 */
export interface S3EngineClient {
  send: S3Client["send"];
  destroy?: S3Client["destroy"];
}

/**
 * Options for {@link S3StorageEngine}.
 */
export interface S3EngineOptions extends S3ClientConfig {
  /**
   * Existing S3-compatible client.
   */
  readonly client?: S3EngineClient;

  /**
   * Bucket where storage objects are stored.
   */
  readonly bucket: string;

  /**
   * Prefix namespace applied to all object keys.
   */
  readonly prefix?: string;

  /**
   * Separator between prefix and key. Defaults to `":"`.
   */
  readonly separator?: string;

  /**
   * Default TTL in milliseconds when a write does not provide one.
   */
  readonly defaultTtl?: number;

  /**
   * Whether `dispose` destroys the client.
   * Defaults to `true` for internally created clients.
   */
  readonly dispose?: boolean;
}

interface S3HeadObjectResult {
  readonly Metadata?: Record<string, string>;
}

interface S3GetObjectResult extends S3HeadObjectResult {
  readonly Body?: unknown;
}

interface S3ListObjectsResult {
  readonly Contents?: readonly S3ListObject[];
  readonly IsTruncated?: boolean;
  readonly NextContinuationToken?: string;
}

interface S3ListObject {
  readonly Key?: string;
}

const EXPIRES_AT_METADATA_KEY = "expires-at";
const DELETE_OBJECT_BATCH_SIZE = 1000;

/**
 * Storage engine backed by objects in an S3 bucket.
 */
export class S3StorageEngine implements StorageEngine {
  readonly name = "s3";

  #client: S3EngineClient | undefined;
  readonly #options: S3EngineOptions;
  readonly #prefix: string;
  readonly #separator: string;
  readonly #shouldDispose: boolean;

  constructor(options: S3EngineOptions) {
    this.#options = options;
    this.#client = options.client;
    this.#prefix = options.prefix ?? "";
    this.#separator = options.separator ?? ":";
    this.#shouldDispose = options.dispose ?? options.client === undefined;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const storageKey = this.#prefixKey(key);
    try {
      const result = (await this.#getClient().send(
        new GetObjectCommand({
          Bucket: this.#options.bucket,
          Key: storageKey,
        }),
      )) as S3GetObjectResult;

      if (await this.#deleteIfExpired(storageKey, result.Metadata)) {
        return undefined;
      }
      return result.Body === undefined ? undefined : await bodyToUint8Array(result.Body);
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>> {
    const values = new Map<string, Uint8Array>();
    await Promise.all(
      keys.map(async (key) => {
        const value = await this.get(key);
        if (value !== undefined) {
          values.set(key, value);
        }
      }),
    );
    return values;
  }

  async set(key: string, value: Uint8Array, setOptions?: StorageEngineSetOptions): Promise<void> {
    const storageKey = this.#prefixKey(key);
    const expiresAt = resolveExpiresAt(setOptions, this.#options);
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      await this.#removeObject(storageKey);
      return;
    }

    await this.#getClient().send(
      new PutObjectCommand({
        Body: value,
        Bucket: this.#options.bucket,
        Key: storageKey,
        Metadata:
          expiresAt === undefined ? undefined : { [EXPIRES_AT_METADATA_KEY]: String(expiresAt) },
      }),
    );
  }

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
    await Promise.all(items.map((item) => this.set(item.key, item.value, item.options)));
  }

  async delete(key: string): Promise<boolean> {
    const storageKey = this.#prefixKey(key);
    if (!(await this.#existingObject(storageKey))) {
      return false;
    }
    await this.#removeObject(storageKey);
    return true;
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    const results = await Promise.all(keys.map((key) => this.delete(key)));
    return results.filter(Boolean).length;
  }

  async has(key: string): Promise<boolean> {
    return await this.#existingObject(this.#prefixKey(key));
  }

  async keys(keyOptions?: StorageEngineKeyOptions): Promise<readonly string[]> {
    return (await this.#liveStorageKeys(keyOptions)).map((key) => this.#unprefixKey(key));
  }

  async clear(keyOptions?: StorageEngineKeyOptions): Promise<void> {
    const keys = await this.#listStorageKeys(keyOptions);
    for (let index = 0; index < keys.length; index += DELETE_OBJECT_BATCH_SIZE) {
      const batch = keys.slice(index, index + DELETE_OBJECT_BATCH_SIZE);
      await this.#getClient().send(
        new DeleteObjectsCommand({
          Bucket: this.#options.bucket,
          Delete: {
            Objects: batch.map((key) => ({ Key: key })),
            Quiet: true,
          },
        }),
      );
    }
  }

  async dispose(): Promise<void> {
    if (this.#shouldDispose) {
      this.#client?.destroy?.();
    }
    this.#client = undefined;
  }

  #getClient(): S3EngineClient {
    this.#client ??= new S3Client(this.#options);
    return this.#client;
  }

  #prefixKey(key: string): string {
    return this.#prefix.length === 0 ? key : `${this.#prefix}${this.#separator}${key}`;
  }

  #unprefixKey(key: string): string {
    return this.#prefix.length === 0 ? key : key.slice(`${this.#prefix}${this.#separator}`.length);
  }

  #listPrefix(keyOptions: StorageEngineKeyOptions | undefined): string {
    return this.#prefixKey(keyOptions?.prefix ?? "");
  }

  async #removeObject(storageKey: string): Promise<void> {
    await this.#getClient().send(
      new DeleteObjectCommand({
        Bucket: this.#options.bucket,
        Key: storageKey,
      }),
    );
  }

  async #headObject(storageKey: string): Promise<S3HeadObjectResult | undefined> {
    try {
      return (await this.#getClient().send(
        new HeadObjectCommand({
          Bucket: this.#options.bucket,
          Key: storageKey,
        }),
      )) as S3HeadObjectResult;
    } catch (error) {
      if (isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  async #deleteIfExpired(
    storageKey: string,
    metadata: Record<string, string> | undefined,
  ): Promise<boolean> {
    if (!isExpired(metadata)) {
      return false;
    }
    await this.#removeObject(storageKey);
    return true;
  }

  async #existingObject(storageKey: string): Promise<boolean> {
    const head = await this.#headObject(storageKey);
    if (head === undefined) {
      return false;
    }
    return !(await this.#deleteIfExpired(storageKey, head.Metadata));
  }

  async #listStorageKeys(keyOptions: StorageEngineKeyOptions | undefined): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const result = (await this.#getClient().send(
        new ListObjectsV2Command({
          Bucket: this.#options.bucket,
          ContinuationToken: continuationToken,
          Prefix: this.#listPrefix(keyOptions),
        }),
      )) as S3ListObjectsResult;

      for (const item of result.Contents ?? []) {
        if (item.Key !== undefined) {
          keys.push(item.Key);
        }
      }
      continuationToken = result.IsTruncated === true ? result.NextContinuationToken : undefined;
    } while (continuationToken !== undefined);

    return keys;
  }

  async #liveStorageKeys(keyOptions: StorageEngineKeyOptions | undefined): Promise<string[]> {
    const keys: string[] = [];
    for (const storageKey of await this.#listStorageKeys(keyOptions)) {
      if (await this.#existingObject(storageKey)) {
        keys.push(storageKey);
      }
    }
    return keys;
  }
}

function resolveExpiresAt(
  setOptions: StorageEngineSetOptions | undefined,
  engineOptions: S3EngineOptions,
): number | undefined {
  const ttl = setOptions?.ttl ?? engineOptions.defaultTtl;
  return ttl === undefined ? undefined : Date.now() + ttl;
}

function isExpired(metadata: Record<string, string> | undefined): boolean {
  const expiresAt = metadata?.[EXPIRES_AT_METADATA_KEY];
  return expiresAt !== undefined && Number(expiresAt) <= Date.now();
}

async function bodyToUint8Array(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    return body.slice();
  }
  if (body instanceof ArrayBuffer) {
    return new Uint8Array(body).slice();
  }
  if (isTransformableBody(body)) {
    return await body.transformToByteArray();
  }
  if (isAsyncIterableBody(body)) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of body) {
      chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    }
    return concatenate(chunks);
  }
  throw new TypeError("S3 object body cannot be converted to Uint8Array.");
}

function isTransformableBody(
  value: unknown,
): value is { transformToByteArray(): Promise<Uint8Array> } {
  return (
    typeof value === "object" &&
    value !== null &&
    "transformToByteArray" in value &&
    typeof value.transformToByteArray === "function"
  );
}

function isAsyncIterableBody(value: unknown): value is AsyncIterable<Uint8Array | ArrayBuffer> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    readonly $metadata?: { readonly httpStatusCode?: number };
    readonly name?: string;
    readonly Code?: string;
    readonly code?: string;
  };
  return (
    candidate.$metadata?.httpStatusCode === 404 ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.Code === "NoSuchKey" ||
    candidate.Code === "NotFound" ||
    candidate.code === "NoSuchKey" ||
    candidate.code === "NotFound"
  );
}

/**
 * Engine batch item type accepted by S3 storage operations.
 */
export type { StorageEngineSetManyItem };
