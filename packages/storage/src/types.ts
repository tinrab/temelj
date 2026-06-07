import type { EventHandler, EventPattern, Unsubscribe } from "@temelj/event";
import type { Result } from "@temelj/result";

export type StoragePrimitive = null | boolean | number | string;

export type JsonStorageValue =
  | StoragePrimitive
  | readonly JsonStorageValue[]
  | { readonly [key: string]: JsonStorageValue };

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

export type StorageItemMap = Record<string, StorageValue>;
export type EmptyStorageItemMap = Record<never, never>;
export type StorageItemValue<TItems extends StorageItemMap> = TItems[keyof TItems] extends never
  ? StorageValue
  : TItems[keyof TItems];

export type StorageKey<TItems extends StorageItemMap> = Extract<keyof TItems, string>;

export type StorageValueFor<
  TItems extends StorageItemMap,
  TKey extends string,
  TFallback = StorageValue,
> = TKey extends keyof TItems ? TItems[TKey] : TFallback;

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

export interface StorageKeyOptions {
  /**
   * Only keys that start with this prefix are returned or affected.
   */
  readonly prefix?: string;
}

export interface StorageGetManyItem {
  readonly key: string;
}

export interface StorageSetManyItem<TValue = StorageValue> {
  readonly key: string;
  readonly value: TValue;
  readonly options?: StorageSetOptions;
}

export interface StorageDeleteManyItem {
  readonly key: string;
}

export interface StorageEntry<TValue = StorageValue> {
  readonly key: string;
  readonly value: TValue;
}

export interface StorageCodec<TValue = StorageValue> {
  encode(value: TValue): Uint8Array;
  decode(bytes: Uint8Array): TValue;
}

export interface StorageEngineSetOptions {
  /**
   * Time to live in milliseconds.
   */
  readonly ttl?: number;
}

export interface StorageEngineKeyOptions {
  readonly prefix?: string;
}

export interface StorageEngineSetManyItem {
  readonly key: string;
  readonly value: Uint8Array;
  readonly options?: StorageEngineSetOptions;
}

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

export type StorageEngineWatchHandler = (event: StorageEngineWatchEvent) => void;
export type StorageEngineUnwatch = () => void | Promise<void>;

export interface StorageEngine {
  readonly name: string;
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array, options?: StorageEngineSetOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  has?(key: string): Promise<boolean>;
  keys(options?: StorageEngineKeyOptions): Promise<readonly string[]>;
  clear(options?: StorageEngineKeyOptions): Promise<void>;
  getMany?(keys: readonly string[]): Promise<ReadonlyMap<string, Uint8Array>>;
  setMany?(items: readonly StorageEngineSetManyItem[]): Promise<void>;
  deleteMany?(keys: readonly string[]): Promise<number>;
  watch?(handler: StorageEngineWatchHandler): StorageEngineUnwatch | Promise<StorageEngineUnwatch>;
  dispose?(): Promise<void>;
}

export interface CreateStorageOptions<TValue = StorageValue> {
  readonly engine?: StorageEngine;
  readonly codec?: StorageCodec<TValue>;
}

export type StorageEventSource = "storage" | "engine";

export interface StorageSetEvent {
  readonly type: "set";
  readonly key: string;
  readonly source: StorageEventSource;
}

export interface StorageSetManyEvent {
  readonly type: "setMany";
  readonly keys: readonly string[];
  readonly source: StorageEventSource;
}

export interface StorageDeleteEvent {
  readonly type: "delete";
  readonly key: string;
  readonly deleted: boolean;
  readonly source: StorageEventSource;
}

export interface StorageDeleteManyEvent {
  readonly type: "deleteMany";
  readonly keys: readonly string[];
  readonly deleted: number;
  readonly source: StorageEventSource;
}

export interface StorageClearEvent {
  readonly type: "clear";
  readonly prefix?: string;
  readonly source: StorageEventSource;
}

export type StorageChangeEvent =
  | StorageSetEvent
  | StorageSetManyEvent
  | StorageDeleteEvent
  | StorageDeleteManyEvent
  | StorageClearEvent;

export interface StorageEventMap {
  readonly "storage:set": StorageSetEvent;
  readonly "storage:set-many": StorageSetManyEvent;
  readonly "storage:delete": StorageDeleteEvent;
  readonly "storage:delete-many": StorageDeleteManyEvent;
  readonly "storage:clear": StorageClearEvent;
  readonly "storage:change": StorageChangeEvent;
}

export type StorageEventPattern = EventPattern<StorageEventMap>;

export type StorageEventHandler<Pattern extends StorageEventPattern = StorageEventPattern> =
  EventHandler<StorageEventMap, Pattern>;

export type StorageWatchCallback = (event: StorageChangeEvent) => void;
export type StorageWatchUnsubscribe = () => void | Promise<void>;

export interface Storage<
  TItems extends StorageItemMap = EmptyStorageItemMap,
  TValue = StorageItemValue<TItems>,
> extends AsyncDisposable {
  readonly engine: StorageEngine;

  on<Pattern extends StorageEventPattern>(
    pattern: Pattern,
    handler: StorageEventHandler<Pattern>,
  ): Unsubscribe;

  once<Pattern extends StorageEventPattern>(
    pattern: Pattern,
    handler: StorageEventHandler<Pattern>,
  ): Unsubscribe;

  off<Pattern extends StorageEventPattern>(
    pattern: Pattern,
    handler: StorageEventHandler<Pattern>,
  ): void;

  listeners(): readonly StorageEventHandler[];
  listeners<Pattern extends StorageEventPattern>(
    pattern: Pattern,
  ): readonly StorageEventHandler<Pattern>[];

  clearListeners(pattern?: StorageEventPattern): void;
  listenerCount(pattern?: StorageEventPattern): number;

  watch(callback: StorageWatchCallback): Promise<StorageWatchUnsubscribe>;
  unwatch(): Promise<void>;

  get<TKey extends StorageKey<TItems>>(
    key: TKey,
  ): Promise<StorageValueFor<TItems, TKey> | undefined>;
  get(key: string): Promise<TValue | undefined>;

  tryGet<TKey extends StorageKey<TItems>>(
    key: TKey,
  ): Promise<Result<StorageValueFor<TItems, TKey> | undefined, StorageError>>;
  tryGet(key: string): Promise<Result<TValue | undefined, StorageError>>;

  set<TKey extends StorageKey<TItems>>(
    key: TKey,
    value: StorageValueFor<TItems, TKey>,
    options?: StorageSetOptions,
  ): Promise<void>;
  set(key: string, value: TValue, options?: StorageSetOptions): Promise<void>;

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

  has(key: string): Promise<boolean>;
  tryHas(key: string): Promise<Result<boolean, StorageError>>;

  delete(key: string): Promise<boolean>;
  tryDelete(key: string): Promise<Result<boolean, StorageError>>;

  getMany<const TKeys extends readonly StorageKey<TItems>[]>(
    keys: TKeys,
  ): Promise<{
    readonly [TIndex in keyof TKeys]: StorageValueFor<TItems, TKeys[TIndex]> | undefined;
  }>;
  getMany(keys: readonly string[]): Promise<readonly (TValue | undefined)[]>;

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

  setMany(items: readonly StorageSetManyItem<TValue>[]): Promise<void>;
  trySetMany(items: readonly StorageSetManyItem<TValue>[]): Promise<Result<void, StorageError>>;

  deleteMany(keys: readonly string[]): Promise<number>;
  tryDeleteMany(keys: readonly string[]): Promise<Result<number, StorageError>>;

  keys(options?: StorageKeyOptions): Promise<readonly string[]>;
  tryKeys(options?: StorageKeyOptions): Promise<Result<readonly string[], StorageError>>;

  entries(options?: StorageKeyOptions): Promise<readonly StorageEntry<TValue>[]>;
  tryEntries(
    options?: StorageKeyOptions,
  ): Promise<Result<readonly StorageEntry<TValue>[], StorageError>>;

  clear(options?: StorageKeyOptions): Promise<void>;
  tryClear(options?: StorageKeyOptions): Promise<Result<void, StorageError>>;

  dispose(): Promise<void>;
  tryDispose(): Promise<Result<void, StorageError>>;
}

export abstract class StorageError extends Error {
  protected constructor(message: string) {
    super(message);
  }
}

export class StorageKeyError extends StorageError {
  public readonly key: string;

  constructor(key: string, message = "Storage key must be a non-empty string") {
    super(message);
    this.name = "StorageKeyError";
    this.key = key;
  }
}

export class StorageSerializationError extends StorageError {
  public readonly operation: "encode" | "decode";
  public override readonly cause: unknown;

  constructor(operation: "encode" | "decode", cause: unknown) {
    super(`Storage value could not be ${operation}d`);
    this.name = "StorageSerializationError";
    this.operation = operation;
    this.cause = cause;
  }
}

export class StorageOperationError extends StorageError {
  public readonly engine: string;
  public readonly operation: string;
  public readonly key: string | undefined;
  public override readonly cause: unknown;

  constructor(options: {
    readonly engine: string;
    readonly operation: string;
    readonly key?: string;
    readonly cause: unknown;
  }) {
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
  }
}
