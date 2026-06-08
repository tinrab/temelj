import {
  type StorageEngine,
  type StorageEngineKeyOptions,
  type StorageEngineSetManyItem,
  type StorageEngineSetOptions,
} from "../types.ts";

const MAX_TIMEOUT = 2_147_483_647;

export interface InMemoryEngineOptions {
  readonly initialEntries?: Iterable<readonly [string, Uint8Array]>;
}

interface InMemoryRecord {
  readonly value: Uint8Array;
  readonly expiresAt?: number;
}

export interface InMemoryEngine extends StorageEngine {
  snapshot(): ReadonlyMap<string, Uint8Array>;
}

export function createInMemoryEngine(options: InMemoryEngineOptions = {}): InMemoryEngine {
  const records = new Map<string, InMemoryRecord>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  for (const [key, value] of options.initialEntries ?? []) {
    records.set(key, { value: copyBytes(value) });
  }

  const removeExpired = (key: string): boolean => {
    const record = records.get(key);
    if (record?.expiresAt === undefined || record.expiresAt > Date.now()) {
      return false;
    }
    clearExpiry(timers, key);
    records.delete(key);
    return true;
  };

  const engine: InMemoryEngine = {
    name: "in-memory",

    async get(key) {
      if (removeExpired(key)) {
        return undefined;
      }
      const record = records.get(key);
      return record === undefined ? undefined : copyBytes(record.value);
    },

    async set(key, value, setOptions) {
      setRecord(records, timers, key, value, setOptions);
    },

    async setMany(items) {
      for (const item of items) {
        setRecord(records, timers, item.key, item.value, item.options);
      }
    },

    async delete(key) {
      clearExpiry(timers, key);
      return records.delete(key);
    },

    async deleteMany(keys) {
      let deleted = 0;
      for (const key of keys) {
        clearExpiry(timers, key);
        if (records.delete(key)) {
          deleted++;
        }
      }
      return deleted;
    },

    async has(key) {
      if (removeExpired(key)) {
        return false;
      }
      return records.has(key);
    },

    async keys(keyOptions) {
      removeExpiredRecords(records, timers);
      return [...records.keys()].filter((key) => matchesPrefix(key, keyOptions));
    },

    async clear(keyOptions) {
      if (keyOptions?.prefix === undefined) {
        for (const timer of timers.values()) {
          clearTimeout(timer);
        }
        timers.clear();
        records.clear();
        return;
      }

      for (const key of records.keys()) {
        if (matchesPrefix(key, keyOptions)) {
          clearExpiry(timers, key);
          records.delete(key);
        }
      }
    },

    async getMany(keys) {
      const values = new Map<string, Uint8Array>();
      for (const key of keys) {
        const value = await engine.get(key);
        if (value !== undefined) {
          values.set(key, value);
        }
      }
      return values;
    },

    async dispose() {
      await engine.clear();
    },

    snapshot() {
      removeExpiredRecords(records, timers);
      return new Map([...records.entries()].map(([key, record]) => [key, copyBytes(record.value)]));
    },
  };

  return engine;
}

function setRecord(
  records: Map<string, InMemoryRecord>,
  timers: Map<string, ReturnType<typeof setTimeout>>,
  key: string,
  value: Uint8Array,
  options: StorageEngineSetOptions | undefined,
): void {
  clearExpiry(timers, key);

  const expiresAt = options?.ttl === undefined ? undefined : Date.now() + options.ttl;
  if (expiresAt !== undefined && expiresAt <= Date.now()) {
    records.delete(key);
    return;
  }

  records.set(key, { value: copyBytes(value), expiresAt });
  if (options?.ttl !== undefined) {
    scheduleExpiry(records, timers, key, options.ttl);
  }
}

function scheduleExpiry(
  records: Map<string, InMemoryRecord>,
  timers: Map<string, ReturnType<typeof setTimeout>>,
  key: string,
  ttl: number,
): void {
  const timer = setTimeout(
    () => {
      const record = records.get(key);
      if (record?.expiresAt !== undefined && record.expiresAt <= Date.now()) {
        records.delete(key);
        timers.delete(key);
        return;
      }

      if (record?.expiresAt !== undefined) {
        scheduleExpiry(records, timers, key, record.expiresAt - Date.now());
      }
    },
    Math.min(ttl, MAX_TIMEOUT),
  );

  if (typeof timer === "object" && "unref" in timer) {
    timer.unref();
  }

  timers.set(key, timer);
}

function clearExpiry(timers: Map<string, ReturnType<typeof setTimeout>>, key: string): void {
  const timer = timers.get(key);
  if (timer === undefined) {
    return;
  }
  clearTimeout(timer);
  timers.delete(key);
}

function removeExpiredRecords(
  records: Map<string, InMemoryRecord>,
  timers: Map<string, ReturnType<typeof setTimeout>>,
): void {
  const now = Date.now();
  for (const [key, record] of records) {
    if (record.expiresAt !== undefined && record.expiresAt <= now) {
      clearExpiry(timers, key);
      records.delete(key);
    }
  }
}

function matchesPrefix(key: string, options: StorageEngineKeyOptions | undefined): boolean {
  return options?.prefix === undefined || key.startsWith(options.prefix);
}

function copyBytes(value: Uint8Array): Uint8Array {
  return value.slice();
}

export type { StorageEngineSetManyItem };
