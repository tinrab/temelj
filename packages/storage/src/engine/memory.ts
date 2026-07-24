import {
  type StorageEngine,
  type StorageEngineCompareAndSetManyItem,
  type StorageEngineKeyOptions,
  type StorageEngineSetManyItem,
  type StorageEngineSetOptions,
  type StoredValue,
} from "../types.ts";
import { storedValuesEqual } from "../utility.ts";

const MAX_TIMEOUT = 2_147_483_647;

/**
 * Options for {@link InMemoryStorageEngine}.
 */
export interface InMemoryEngineOptions<TStoredValue extends StoredValue = StoredValue> {
  /**
   * Initial encoded entries copied into the engine.
   */
  readonly initialEntries?: Iterable<readonly [string, TStoredValue]>;
}

interface InMemoryRecord<TStoredValue extends StoredValue> {
  readonly value: TStoredValue;
  readonly expiresAt?: number;
}

/**
 * In-memory engine interface with snapshot support.
 */
export interface InMemoryEngine<
  TStoredValue extends StoredValue = StoredValue,
> extends StorageEngine<TStoredValue> {
  /**
   * Returns a defensive copy of currently stored, non-expired records.
   */
  snapshot(): ReadonlyMap<string, TStoredValue>;
}

/**
 * Storage engine that keeps encoded values in process memory.
 */
export class InMemoryStorageEngine<
  TStoredValue extends StoredValue = StoredValue,
> implements InMemoryEngine<TStoredValue> {
  readonly name = "in-memory";
  readonly watch?: StorageEngine<TStoredValue>["watch"];

  readonly #records = new Map<string, InMemoryRecord<TStoredValue>>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: InMemoryEngineOptions<TStoredValue> = {}) {
    for (const [key, value] of options.initialEntries ?? []) {
      this.#records.set(key, { value: copyValue(value) });
    }
  }

  async get(key: string): Promise<TStoredValue | undefined> {
    if (this.#removeExpired(key)) {
      return undefined;
    }
    const record = this.#records.get(key);
    return record === undefined ? undefined : copyValue(record.value);
  }

  async set(key: string, value: TStoredValue, options?: StorageEngineSetOptions): Promise<void> {
    this.#setRecord(key, value, options);
  }

  async compareAndSet(
    key: string,
    expected: TStoredValue | undefined,
    value: TStoredValue | undefined,
    options?: StorageEngineSetOptions,
  ): Promise<boolean> {
    if (this.#removeExpired(key)) {
      this.#clearExpiry(key);
    }

    const current = this.#records.get(key)?.value;
    if (!storedValuesEqual(current, expected)) {
      return false;
    }

    if (value === undefined) {
      this.#clearExpiry(key);
      this.#records.delete(key);
      return true;
    }

    this.#setRecord(key, value, options);
    return true;
  }

  async compareAndSetMany(
    items: readonly StorageEngineCompareAndSetManyItem<TStoredValue>[],
  ): Promise<boolean> {
    for (const item of items) {
      if (this.#removeExpired(item.key)) {
        this.#clearExpiry(item.key);
      }
    }

    if (
      items.some((item) => !storedValuesEqual(this.#records.get(item.key)?.value, item.expected))
    ) {
      return false;
    }

    for (const item of items) {
      if (item.value === undefined) {
        this.#clearExpiry(item.key);
        this.#records.delete(item.key);
        continue;
      }
      this.#setRecord(item.key, item.value, item.options);
    }
    return true;
  }

  async setMany(items: readonly StorageEngineSetManyItem<TStoredValue>[]): Promise<void> {
    for (const item of items) {
      this.#setRecord(item.key, item.value, item.options);
    }
  }

  async delete(key: string): Promise<boolean> {
    this.#clearExpiry(key);
    return this.#records.delete(key);
  }

  async deleteMany(keys: readonly string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      this.#clearExpiry(key);
      if (this.#records.delete(key)) {
        deleted++;
      }
    }
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    if (this.#removeExpired(key)) {
      return false;
    }
    return this.#records.has(key);
  }

  async keys(options?: StorageEngineKeyOptions): Promise<readonly string[]> {
    this.#removeExpiredRecords();
    return [...this.#records.keys()].filter((key) => matchesPrefix(key, options));
  }

  async clear(options?: StorageEngineKeyOptions): Promise<void> {
    if (options?.prefix === undefined) {
      for (const timer of this.#timers.values()) {
        clearTimeout(timer);
      }
      this.#timers.clear();
      this.#records.clear();
      return;
    }

    for (const key of this.#records.keys()) {
      if (matchesPrefix(key, options)) {
        this.#clearExpiry(key);
        this.#records.delete(key);
      }
    }
  }

  async getMany(keys: readonly string[]): Promise<ReadonlyMap<string, TStoredValue>> {
    const values = new Map<string, TStoredValue>();
    for (const key of keys) {
      const value = await this.get(key);
      if (value !== undefined) {
        values.set(key, value);
      }
    }
    return values;
  }

  async dispose(): Promise<void> {
    await this.clear();
  }

  snapshot(): ReadonlyMap<string, TStoredValue> {
    this.#removeExpiredRecords();
    return new Map(
      [...this.#records.entries()].map(([key, record]) => [key, copyValue(record.value)]),
    );
  }

  #setRecord(key: string, value: TStoredValue, options: StorageEngineSetOptions | undefined): void {
    this.#clearExpiry(key);

    const expiresAt = options?.ttl === undefined ? undefined : Date.now() + options.ttl;
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.#records.delete(key);
      return;
    }

    this.#records.set(key, { value: copyValue(value), expiresAt });
    if (options?.ttl !== undefined) {
      this.#scheduleExpiry(key, options.ttl);
    }
  }

  #scheduleExpiry(key: string, ttl: number): void {
    const timer = setTimeout(
      () => {
        const record = this.#records.get(key);
        if (record?.expiresAt !== undefined && record.expiresAt <= Date.now()) {
          this.#records.delete(key);
          this.#timers.delete(key);
          return;
        }

        if (record?.expiresAt !== undefined) {
          this.#scheduleExpiry(key, record.expiresAt - Date.now());
        }
      },
      Math.min(ttl, MAX_TIMEOUT),
    );

    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }

    this.#timers.set(key, timer);
  }

  #clearExpiry(key: string): void {
    const timer = this.#timers.get(key);
    if (timer === undefined) {
      return;
    }
    clearTimeout(timer);
    this.#timers.delete(key);
  }

  #removeExpired(key: string): boolean {
    const record = this.#records.get(key);
    if (record?.expiresAt === undefined || record.expiresAt > Date.now()) {
      return false;
    }
    this.#clearExpiry(key);
    this.#records.delete(key);
    return true;
  }

  #removeExpiredRecords(): void {
    const now = Date.now();
    for (const [key, record] of this.#records) {
      if (record.expiresAt !== undefined && record.expiresAt <= now) {
        this.#clearExpiry(key);
        this.#records.delete(key);
      }
    }
  }
}

function matchesPrefix(key: string, options: StorageEngineKeyOptions | undefined): boolean {
  return options?.prefix === undefined || key.startsWith(options.prefix);
}

function copyValue<TValue extends StoredValue>(value: TValue): TValue {
  return (value instanceof Uint8Array ? value.slice() : value) as TValue;
}

/**
 * Engine batch item types accepted by in-memory storage operations.
 */
export type { StorageEngineCompareAndSetManyItem, StorageEngineSetManyItem };
