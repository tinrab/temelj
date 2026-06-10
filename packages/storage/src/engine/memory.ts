import {
  type StorageEngine,
  type StorageEngineCompareAndSetManyItem,
  type StorageEngineKeyOptions,
  type StorageEngineSetManyItem,
  type StorageEngineSetOptions,
} from "../types.ts";
import { bytesEqual } from "../utility.ts";

const MAX_TIMEOUT = 2_147_483_647;

/**
 * Options for {@link InMemoryStorageEngine}.
 */
export interface InMemoryEngineOptions {
  /**
   * Initial encoded entries copied into the engine.
   */
  readonly initialEntries?: Iterable<readonly [string, Uint8Array]>;
}

interface InMemoryRecord {
  readonly value: Uint8Array;
  readonly expiresAt?: number;
}

/**
 * In-memory engine interface with snapshot support.
 */
export interface InMemoryEngine extends StorageEngine {
  /**
   * Returns a defensive copy of currently stored, non-expired records.
   */
  snapshot(): ReadonlyMap<string, Uint8Array>;
}

/**
 * Storage engine that keeps encoded values in process memory.
 */
export class InMemoryStorageEngine implements InMemoryEngine {
  readonly name = "in-memory";
  readonly watch?: StorageEngine["watch"];

  readonly #records = new Map<string, InMemoryRecord>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: InMemoryEngineOptions = {}) {
    for (const [key, value] of options.initialEntries ?? []) {
      this.#records.set(key, { value: copyBytes(value) });
    }
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    if (this.#removeExpired(key)) {
      return undefined;
    }
    const record = this.#records.get(key);
    return record === undefined ? undefined : copyBytes(record.value);
  }

  async set(key: string, value: Uint8Array, options?: StorageEngineSetOptions): Promise<void> {
    this.#setRecord(key, value, options);
  }

  async compareAndSet(
    key: string,
    expected: Uint8Array | undefined,
    value: Uint8Array | undefined,
    options?: StorageEngineSetOptions,
  ): Promise<boolean> {
    if (this.#removeExpired(key)) {
      this.#clearExpiry(key);
    }

    const current = this.#records.get(key)?.value;
    if (!bytesEqual(current, expected)) {
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

  async compareAndSetMany(items: readonly StorageEngineCompareAndSetManyItem[]): Promise<boolean> {
    for (const item of items) {
      if (this.#removeExpired(item.key)) {
        this.#clearExpiry(item.key);
      }
    }

    if (items.some((item) => !bytesEqual(this.#records.get(item.key)?.value, item.expected))) {
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

  async setMany(items: readonly StorageEngineSetManyItem[]): Promise<void> {
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

  async dispose(): Promise<void> {
    await this.clear();
  }

  snapshot(): ReadonlyMap<string, Uint8Array> {
    this.#removeExpiredRecords();
    return new Map(
      [...this.#records.entries()].map(([key, record]) => [key, copyBytes(record.value)]),
    );
  }

  #setRecord(key: string, value: Uint8Array, options: StorageEngineSetOptions | undefined): void {
    this.#clearExpiry(key);

    const expiresAt = options?.ttl === undefined ? undefined : Date.now() + options.ttl;
    if (expiresAt !== undefined && expiresAt <= Date.now()) {
      this.#records.delete(key);
      return;
    }

    this.#records.set(key, { value: copyBytes(value), expiresAt });
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

function copyBytes(value: Uint8Array): Uint8Array {
  return value.slice();
}

/**
 * Engine batch item types accepted by in-memory storage operations.
 */
export type { StorageEngineCompareAndSetManyItem, StorageEngineSetManyItem };
