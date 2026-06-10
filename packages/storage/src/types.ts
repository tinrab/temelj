import type { EventHandler, EventPattern, Unsubscribe } from "@temelj/event";
import type { Result } from "@temelj/result";

/**
 * Primitive value that can be represented directly in JSON.
 */
export type StoragePrimitive = null | boolean | number | string;

/**
 * Recursive JSON-compatible storage value.
 */
export type JsonStorageValue =
  | StoragePrimitive
  | readonly JsonStorageValue[]
  | { readonly [key: string]: JsonStorageValue };

/**
 * Rich value shape supported by the default SuperJSON codec.
 */
export type StorageValue =
  | JsonStorageValue
  | bigint
  | Date
  | RegExp
  | Uint8Array
  | ReadonlyMap<StorageValue, StorageValue>
  | ReadonlySet<StorageValue>
  | readonly StorageValue[]
  | { readonly [key: string]: StorageValue };

/**
 * Map from known storage keys to their value types.
 */
export type StorageItemMap = Record<string, StorageValue>;

/**
 * Empty item map used when storage keys are not statically declared.
 */
export type EmptyStorageItemMap = Record<never, never>;

/**
 * Union of values from an item map, or {@link StorageValue} for untyped maps.
 */
export type StorageItemValue<TItems extends StorageItemMap> = TItems[keyof TItems] extends never
  ? StorageValue
  : TItems[keyof TItems];

/**
 * String keys declared by an item map.
 */
export type StorageKey<TItems extends StorageItemMap> = Extract<keyof TItems, string>;

/**
 * Resolves the value type for a known key, falling back for dynamic keys.
 */
export type StorageValueFor<
  TItems extends StorageItemMap,
  TKey extends string,
  TFallback = StorageValue,
> = TKey extends keyof TItems ? TItems[TKey] : TFallback;

/**
 * Expiration options accepted by high-level storage writes.
 */
export interface StorageSetOptions {
  /**
   * Time to live in milliseconds.
   */
  readonly ttl?: number;

  /**
   * Absolute expiration time.
   */
  readonly expiresAt?: Date;
}

/**
 * Options for key scans, entry scans, and clear operations.
 */
export interface StorageKeyOptions {
  /**
   * Only keys that start with this prefix are returned or affected.
   */
  readonly prefix?: string;
}

/**
 * Key descriptor for APIs that operate on multiple keys.
 */
export interface StorageGetManyItem {
  /**
   * Storage key to read.
   */
  readonly key: string;
}

/**
 * Value descriptor for high-level batch writes.
 */
export interface StorageSetManyItem<TValue = StorageValue> {
  /**
   * Storage key to write.
   */
  readonly key: string;

  /**
   * Decoded value to encode and store.
   */
  readonly value: TValue;

  /**
   * Optional expiration for this item.
   */
  readonly options?: StorageSetOptions;
}

/**
 * Item used by high-level compare-and-set batch writes.
 */
export interface StorageCompareAndSetManyItem<TValue = StorageValue> {
  /**
   * Storage key to compare and update.
   */
  readonly key: string;

  /**
   * Expected decoded value, or `undefined` when the key must be absent.
   */
  readonly expected: TValue | undefined;

  /**
   * Replacement decoded value, or `undefined` to delete the key.
   */
  readonly value: TValue | undefined;

  /**
   * Optional expiration for the replacement value.
   */
  readonly options?: StorageSetOptions;
}

/**
 * Key descriptor for high-level batch deletes.
 */
export interface StorageDeleteManyItem {
  /**
   * Storage key to delete.
   */
  readonly key: string;
}

/**
 * Decoded storage entry returned by entry scans.
 */
export interface StorageEntry<TValue = StorageValue> {
  /**
   * Storage key.
   */
  readonly key: string;

  /**
   * Decoded value stored at the key.
   */
  readonly value: TValue;
}

/**
 * Converts values between the public storage API and raw engine bytes.
 */
export interface StorageCodec<TValue = StorageValue> {
  /**
   * Encodes a decoded storage value into bytes for an engine.
   */
  encode(value: TValue): Uint8Array;

  /**
   * Decodes bytes returned by an engine into a storage value.
   */
  decode(bytes: Uint8Array): TValue;
}

/**
 * Expiration options passed to storage engines.
 */
export interface StorageEngineSetOptions {
  /**
   * Time to live in milliseconds.
   */
  readonly ttl?: number;
}

/**
 * Key scan options passed to storage engines.
 */
export interface StorageEngineKeyOptions {
  /**
   * Only keys that start with this prefix are returned or affected.
   */
  readonly prefix?: string;
}

/**
 * Raw byte item passed to engine batch writes.
 */
export interface StorageEngineSetManyItem {
  /**
   * Engine key to write.
   */
  readonly key: string;

  /**
   * Encoded value bytes.
   */
  readonly value: Uint8Array;

  /**
   * Optional expiration for this item.
   */
  readonly options?: StorageEngineSetOptions;
}

/**
 * Raw byte item passed to engine compare-and-set batch writes.
 */
export interface StorageEngineCompareAndSetManyItem {
  /**
   * Engine key to compare and update.
   */
  readonly key: string;

  /**
   * Expected encoded bytes, or `undefined` when the key must be absent.
   */
  readonly expected: Uint8Array | undefined;

  /**
   * Replacement encoded bytes, or `undefined` to delete the key.
   */
  readonly value: Uint8Array | undefined;

  /**
   * Optional expiration for the replacement value.
   */
  readonly options?: StorageEngineSetOptions;
}

/**
 * Native change notification emitted by a storage engine.
 */
export type StorageEngineWatchEvent =
  | {
      readonly type: "set";
      readonly key: string;
    }
  | {
      readonly type: "delete";
      readonly key: string;
    }
  | {
      readonly type: "clear";
      readonly prefix?: string;
    };

/**
 * Callback invoked for native engine change notifications.
 */
export type StorageEngineWatchHandler = (event: StorageEngineWatchEvent) => void;

/**
 * Stops a native engine watch subscription.
 */
export type StorageEngineUnwatch = () => void | Promise<void>;

/**
 * Low-level byte storage provider used by {@link createStorage}.
 */
export interface StorageEngine {
  /**
   * Human-readable engine name used in operation errors.
   */
  readonly name: string;

  /**
   * Reads encoded bytes for a key.
   */
  get(key: string): Promise<Uint8Array | undefined>;

  /**
   * Stores encoded bytes for a key.
   */
  set(key: string, value: Uint8Array, options?: StorageEngineSetOptions): Promise<void>;

  /**
   * Atomically replaces or deletes a key when the current bytes match the expected bytes.
   */
  compareAndSet?(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
    options?: StorageEngineSetOptions,
  ): Promise<boolean>;

  /**
   * Deletes a key and reports whether it existed.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Checks whether a key exists.
   */
  has?(key: string): Promise<boolean>;

  /**
   * Lists keys, optionally restricted by prefix.
   */
  keys(options?: StorageEngineKeyOptions): Promise<readonly string[]>;

  /**
   * Deletes all keys, or all keys under a prefix.
   */
  clear(options?: StorageEngineKeyOptions): Promise<void>;

  /**
   * Reads multiple keys and returns only keys that exist.
   */
  getMany?(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>>;

  /**
   * Atomically applies multiple compare-and-set operations when every expected value matches.
   */
  compareAndSetMany?(items: readonly StorageEngineCompareAndSetManyItem[]): Promise<boolean>;

  /**
   * Stores multiple encoded values.
   */
  setMany?(items: readonly StorageEngineSetManyItem[]): Promise<void>;

  /**
   * Deletes multiple keys and returns the number of deleted keys.
   */
  deleteMany?(keys: readonly string[]): Promise<number>;

  /**
   * Subscribes to native engine change notifications.
   */
  watch?(handler: StorageEngineWatchHandler): StorageEngineUnwatch | Promise<StorageEngineUnwatch>;

  /**
   * Releases resources held by the engine.
   */
  dispose?(): Promise<void>;
}

/**
 * Options for creating a high-level storage instance.
 */
export interface CreateStorageOptions<TValue = StorageValue> {
  /**
   * Raw byte engine to use. Defaults to an in-memory engine.
   */
  readonly engine?: StorageEngine;

  /**
   * Codec used to encode and decode values. Defaults to SuperJSON.
   */
  readonly codec?: StorageCodec<TValue>;
}

/**
 * Runtime feature flags for the selected storage engine.
 */
export interface StorageCapabilities {
  readonly compareAndSet: boolean;
  readonly compareAndSetMany: boolean;
  readonly getMany: boolean;
  readonly setMany: boolean;
  readonly deleteMany: boolean;
  readonly has: boolean;
  readonly watch: boolean;
  readonly dispose: boolean;
}

/**
 * Origin of a storage change event.
 */
export type StorageEventSource = "storage" | "engine";

/**
 * Event emitted after a single key is written.
 */
export interface StorageSetEvent {
  readonly type: "set";
  readonly key: string;
  readonly source: StorageEventSource;
}

/**
 * Event emitted after a batch write is performed through a native batch operation.
 */
export interface StorageSetManyEvent {
  readonly type: "setMany";
  readonly keys: readonly string[];
  readonly source: StorageEventSource;
}

/**
 * Event emitted after a single key is deleted.
 */
export interface StorageDeleteEvent {
  readonly type: "delete";
  readonly key: string;
  readonly deleted: boolean;
  readonly source: StorageEventSource;
}

/**
 * Event emitted after multiple keys are deleted through a native batch operation.
 */
export interface StorageDeleteManyEvent {
  readonly type: "deleteMany";
  readonly keys: readonly string[];
  readonly deleted: number;
  readonly source: StorageEventSource;
}

/**
 * Event emitted after all keys, or a prefixed key range, are cleared.
 */
export interface StorageClearEvent {
  readonly type: "clear";
  readonly prefix?: string;
  readonly source: StorageEventSource;
}

/**
 * Union of high-level storage change events.
 */
export type StorageChangeEvent =
  | StorageSetEvent
  | StorageSetManyEvent
  | StorageDeleteEvent
  | StorageDeleteManyEvent
  | StorageClearEvent;

/**
 * Event map used by storage event listeners.
 */
export interface StorageEventMap {
  readonly "storage:set": StorageSetEvent;
  readonly "storage:set-many": StorageSetManyEvent;
  readonly "storage:delete": StorageDeleteEvent;
  readonly "storage:delete-many": StorageDeleteManyEvent;
  readonly "storage:clear": StorageClearEvent;
  readonly "storage:change": StorageChangeEvent;
}

/**
 * Pattern accepted by storage event listener methods.
 */
export type StorageEventPattern = EventPattern<StorageEventMap>;

/**
 * Event handler type narrowed by an event pattern.
 */
export type StorageEventHandler<Pattern extends StorageEventPattern = StorageEventPattern> =
  EventHandler<StorageEventMap, Pattern>;

/**
 * Callback invoked by storage watchers.
 */
export type StorageWatchCallback = (event: StorageChangeEvent) => void;

/**
 * Stops a storage watch subscription.
 */
export type StorageWatchUnsubscribe = () => void | Promise<void>;

/**
 * High-level async key-value storage API.
 */
export interface Storage<
  TItems extends StorageItemMap = EmptyStorageItemMap,
  TValue = StorageItemValue<TItems>,
> extends AsyncDisposable {
  /**
   * Raw byte engine backing this storage instance.
   */
  readonly engine: StorageEngine;

  /**
   * Feature flags derived from optional methods implemented by the engine.
   */
  readonly capabilities: StorageCapabilities;

  /**
   * Subscribes to storage events matching a pattern.
   */
  on<Pattern extends StorageEventPattern>(
    pattern: Pattern,
    handler: StorageEventHandler<Pattern>,
  ): Unsubscribe;

  /**
   * Subscribes to the next storage event matching a pattern.
   */
  once<Pattern extends StorageEventPattern>(
    pattern: Pattern,
    handler: StorageEventHandler<Pattern>,
  ): Unsubscribe;

  /**
   * Removes a previously registered event handler.
   */
  off<Pattern extends StorageEventPattern>(
    pattern: Pattern,
    handler: StorageEventHandler<Pattern>,
  ): void;

  /**
   * Returns registered event handlers.
   */
  listeners(): readonly StorageEventHandler[];
  listeners<Pattern extends StorageEventPattern>(
    pattern: Pattern,
  ): readonly StorageEventHandler<Pattern>[];

  /**
   * Removes registered event handlers.
   */
  clearListeners(pattern?: StorageEventPattern): void;

  /**
   * Counts registered event handlers.
   */
  listenerCount(pattern?: StorageEventPattern): number;

  /**
   * Subscribes to storage changes and starts engine-native watching when available.
   */
  watch(callback: StorageWatchCallback): Promise<StorageWatchUnsubscribe>;

  /**
   * Stops all active storage watchers and engine-native watching.
   */
  unwatch(): Promise<void>;

  /**
   * Reads and decodes a value.
   */
  get<TKey extends StorageKey<TItems>>(
    key: TKey,
  ): Promise<StorageValueFor<TItems, TKey> | undefined>;
  get(key: string): Promise<TValue | undefined>;

  /**
   * Result-returning variant of {@link Storage.get}.
   */
  tryGet<TKey extends StorageKey<TItems>>(
    key: TKey,
  ): Promise<Result<StorageValueFor<TItems, TKey> | undefined, StorageError>>;
  tryGet(key: string): Promise<Result<TValue | undefined, StorageError>>;

  /**
   * Encodes and stores a value.
   */
  set<TKey extends StorageKey<TItems>>(
    key: TKey,
    value: StorageValueFor<TItems, TKey>,
    options?: StorageSetOptions,
  ): Promise<void>;
  set(key: string, value: TValue, options?: StorageSetOptions): Promise<void>;

  /**
   * Result-returning variant of {@link Storage.set}.
   */
  trySet<TKey extends StorageKey<TItems>>(
    key: TKey,
    value: StorageValueFor<TItems, TKey>,
    options?: StorageSetOptions,
  ): Promise<Result<void, StorageError>>;
  trySet(
    key: string,
    value: TValue,
    options?: StorageSetOptions,
  ): Promise<Result<void, StorageError>>;

  /**
   * Atomically replaces or deletes a value when the current value matches the expected value.
   */
  compareAndSet<TKey extends StorageKey<TItems>>(
    key: TKey,
    expected: StorageValueFor<TItems, TKey> | undefined,
    value: StorageValueFor<TItems, TKey> | undefined,
    options?: StorageSetOptions,
  ): Promise<boolean>;
  compareAndSet(
    key: string,
    expected: TValue | undefined,
    value: TValue | undefined,
    options?: StorageSetOptions,
  ): Promise<boolean>;

  /**
   * Result-returning variant of {@link Storage.compareAndSet}.
   */
  tryCompareAndSet<TKey extends StorageKey<TItems>>(
    key: TKey,
    expected: StorageValueFor<TItems, TKey> | undefined,
    value: StorageValueFor<TItems, TKey> | undefined,
    options?: StorageSetOptions,
  ): Promise<Result<boolean, StorageError>>;
  tryCompareAndSet(
    key: string,
    expected: TValue | undefined,
    value: TValue | undefined,
    options?: StorageSetOptions,
  ): Promise<Result<boolean, StorageError>>;

  /**
   * Atomically applies compare-and-set operations when every expected value matches.
   */
  compareAndSetMany(items: readonly StorageCompareAndSetManyItem<TValue>[]): Promise<boolean>;

  /**
   * Result-returning variant of {@link Storage.compareAndSetMany}.
   */
  tryCompareAndSetMany(
    items: readonly StorageCompareAndSetManyItem<TValue>[],
  ): Promise<Result<boolean, StorageError>>;

  /**
   * Checks whether a key exists.
   */
  has(key: string): Promise<boolean>;

  /**
   * Result-returning variant of {@link Storage.has}.
   */
  tryHas(key: string): Promise<Result<boolean, StorageError>>;

  /**
   * Deletes a key and reports whether it existed.
   */
  delete(key: string): Promise<boolean>;

  /**
   * Result-returning variant of {@link Storage.delete}.
   */
  tryDelete(key: string): Promise<Result<boolean, StorageError>>;

  /**
   * Reads and decodes multiple keys, preserving input order.
   */
  getMany<const TKeys extends readonly StorageKey<TItems>[]>(
    keys: TKeys,
  ): Promise<{
    readonly [TIndex in keyof TKeys]: StorageValueFor<TItems, TKeys[TIndex]> | undefined;
  }>;
  getMany(keys: readonly string[]): Promise<readonly (TValue | undefined)[]>;

  /**
   * Result-returning variant of {@link Storage.getMany}.
   */
  tryGetMany<const TKeys extends readonly StorageKey<TItems>[]>(
    keys: TKeys,
  ): Promise<
    Result<
      {
        readonly [TIndex in keyof TKeys]: StorageValueFor<TItems, TKeys[TIndex]> | undefined;
      },
      StorageError
    >
  >;
  tryGetMany(
    keys: readonly string[],
  ): Promise<Result<readonly (TValue | undefined)[], StorageError>>;

  /**
   * Encodes and stores multiple values.
   */
  setMany(items: readonly StorageSetManyItem<TValue>[]): Promise<void>;

  /**
   * Result-returning variant of {@link Storage.setMany}.
   */
  trySetMany(items: readonly StorageSetManyItem<TValue>[]): Promise<Result<void, StorageError>>;

  /**
   * Deletes multiple keys and returns the number of deleted keys.
   */
  deleteMany(keys: readonly string[]): Promise<number>;

  /**
   * Result-returning variant of {@link Storage.deleteMany}.
   */
  tryDeleteMany(keys: readonly string[]): Promise<Result<number, StorageError>>;

  /**
   * Lists keys, optionally restricted by prefix.
   */
  keys(options?: StorageKeyOptions): Promise<readonly string[]>;

  /**
   * Result-returning variant of {@link Storage.keys}.
   */
  tryKeys(options?: StorageKeyOptions): Promise<Result<readonly string[], StorageError>>;

  /**
   * Lists decoded entries, optionally restricted by prefix.
   */
  entries(options?: StorageKeyOptions): Promise<readonly StorageEntry<TValue>[]>;

  /**
   * Result-returning variant of {@link Storage.entries}.
   */
  tryEntries(
    options?: StorageKeyOptions,
  ): Promise<Result<readonly StorageEntry<TValue>[], StorageError>>;

  /**
   * Deletes all keys, or all keys under a prefix.
   */
  clear(options?: StorageKeyOptions): Promise<void>;

  /**
   * Result-returning variant of {@link Storage.clear}.
   */
  tryClear(options?: StorageKeyOptions): Promise<Result<void, StorageError>>;

  /**
   * Stops watchers, clears listeners, and disposes the engine when supported.
   */
  dispose(): Promise<void>;

  /**
   * Result-returning variant of {@link Storage.dispose}.
   */
  tryDispose(): Promise<Result<void, StorageError>>;
}

/**
 * Base class for high-level storage errors.
 */
export abstract class StorageError extends Error {
  protected constructor(message: string) {
    super(message);
  }
}

/**
 * Error thrown for invalid storage keys or expiration options.
 */
export class StorageKeyError extends StorageError {
  /**
   * Key associated with the validation failure.
   */
  public readonly key: string;

  constructor(key: string, message: string, context?: Function) {
    super(message);
    this.name = "StorageKeyError";
    this.key = key;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static invalidFormat(key: string): never {
    throw new StorageKeyError(
      key,
      "Storage key must be a non-empty string",
      // eslint-disable-next-line unbound-method
      StorageKeyError.invalidFormat,
    );
  }

  static unique(operation: string, key: string): never {
    throw new StorageKeyError(
      key,
      `Storage ${operation} key must be unique: ${key}`,
      // eslint-disable-next-line unbound-method
      StorageKeyError.unique,
    );
  }

  static nullBytes(key: string): never {
    throw new StorageKeyError(
      key,
      "Storage key must not contain null bytes",
      // eslint-disable-next-line unbound-method
      StorageKeyError.nullBytes,
    );
  }

  static invalidTtl(): never {
    throw new StorageKeyError(
      "",
      "Storage ttl must be a finite non-negative number",
      // eslint-disable-next-line unbound-method
      StorageKeyError.invalidTtl,
    );
  }

  static invalidExpiresAt(): never {
    throw new StorageKeyError(
      "",
      "Storage expiresAt must be a valid date",
      // eslint-disable-next-line unbound-method
      StorageKeyError.invalidExpiresAt,
    );
  }
}

/**
 * Error thrown when a codec cannot encode or decode a value.
 */
export class StorageSerializationError extends StorageError {
  /**
   * Serialization operation that failed.
   */
  public readonly operation: "encode" | "decode";

  /**
   * Original codec error.
   */
  public override readonly cause: unknown;

  constructor(operation: "encode" | "decode", cause: unknown) {
    super(`Storage value could not be ${operation}d`);
    this.name = "StorageSerializationError";
    this.operation = operation;
    this.cause = cause;
  }
}

/**
 * Error thrown when an engine operation fails or is unsupported.
 */
export class StorageOperationError extends StorageError {
  /**
   * Engine name that reported the failure.
   */
  public readonly engine: string;

  /**
   * Storage operation that failed.
   */
  public readonly operation: string;

  /**
   * Key associated with the failure, when available.
   */
  public readonly key: string | undefined;

  /**
   * Original engine error.
   */
  public override readonly cause: unknown;

  constructor(
    options: {
      readonly engine: string;
      readonly operation: string;
      readonly key?: string;
      readonly cause?: unknown;
    },
    context?: Function,
  ) {
    super(
      options.key === undefined
        ? `Storage engine ${options.engine} failed during ${options.operation}`
        : `Storage engine ${options.engine} failed during ${options.operation} for key ${options.key}`,
    );
    this.name = "StorageOperationError";
    this.engine = options.engine;
    this.operation = options.operation;
    this.key = options.key;
    this.cause = options.cause;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, context ?? this.constructor);
    }
  }

  static unsupportedOperation(engine: string, operation: string): never {
    throw new StorageOperationError(
      {
        engine,
        operation,
        key: "",
        cause: new Error(`Storage engine does not support '${operation}': ${engine}`),
      },
      // eslint-disable-next-line unbound-method
      StorageOperationError.unsupportedOperation,
    );
  }
}
