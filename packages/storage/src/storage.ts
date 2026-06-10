import { createPubSub } from "@temelj/event";
import { err, ok, type Result } from "@temelj/result";

import { createSuperJsonStorageCodec } from "./codec/mod.ts";
import { InMemoryStorageEngine } from "./engine/memory.ts";
import { normalizeStorageKey, normalizeStoragePrefix, resolveTtl } from "./key.ts";
import {
  StorageError,
  StorageKeyError,
  StorageOperationError,
  type CreateStorageOptions,
  type EmptyStorageItemMap,
  type Storage,
  type StorageCodec,
  type StorageChangeEvent,
  type StorageClearEvent,
  type StorageEngineWatchEvent,
  type StorageEventHandler,
  type StorageEventMap,
  type StorageEventPattern,
  type StorageEntry,
  type StorageItemMap,
  type StorageItemValue,
  type StorageKeyOptions,
  type StorageCompareAndSetManyItem,
  type StorageSetManyItem,
  type StorageSetOptions,
  type StorageWatchCallback,
  type StorageWatchUnsubscribe,
} from "./types.ts";

/**
 * Creates a high-level storage instance over a byte engine and value codec.
 *
 * The default engine is {@link InMemoryStorageEngine}; the default codec is {@link createSuperJsonStorageCodec}.
 * Keys are validated before reaching the engine,
 * values are encoded and decoded through the codec, and engine failures are wrapped in storage error types.
 */
export function createStorage<
  TItems extends StorageItemMap = EmptyStorageItemMap,
  TValue = StorageItemValue<TItems>,
>(options: CreateStorageOptions<TValue> = {}): Storage<TItems, TValue> {
  const engine = options.engine ?? new InMemoryStorageEngine();
  const codec = (options.codec ?? createSuperJsonStorageCodec()) as StorageCodec<TValue>;
  const capabilities = {
    get compareAndSet() {
      return engine.compareAndSet !== undefined;
    },
    get compareAndSetMany() {
      return engine.compareAndSetMany !== undefined;
    },
    get getMany() {
      return engine.getMany !== undefined;
    },
    get setMany() {
      return engine.setMany !== undefined;
    },
    get deleteMany() {
      return engine.deleteMany !== undefined;
    },
    get has() {
      return engine.has !== undefined;
    },
    get watch() {
      return engine.watch !== undefined;
    },
    get dispose() {
      return engine.dispose !== undefined;
    },
  };

  const events = createPubSub<StorageEventMap>();
  const watchCallbacks = new Set<StorageWatchCallback>();
  let engineUnwatch: StorageWatchUnsubscribe | undefined;
  let engineWatchStart: Promise<void> | undefined;

  const toStorageError = (operation: string, error: unknown, key?: string): StorageError =>
    error instanceof StorageError
      ? error
      : new StorageOperationError({
          engine: engine.name,
          operation,
          key,
          cause: error,
        });

  const emitChange = (event: StorageChangeEvent): void => {
    switch (event.type) {
      case "set":
        events.emit("storage:set", event);
        break;
      case "setMany":
        events.emit("storage:set-many", event);
        break;
      case "delete":
        events.emit("storage:delete", event);
        break;
      case "deleteMany":
        events.emit("storage:delete-many", event);
        break;
      case "clear":
        events.emit("storage:clear", event);
        break;
    }

    events.emit("storage:change", event);
    for (const callback of watchCallbacks) {
      try {
        callback(event);
      } catch {
        // Watch callbacks shouldn't change storage operation outcomes.
      }
    }
  };

  const normalizeEngineWatchEvent = (event: StorageEngineWatchEvent): StorageChangeEvent => {
    switch (event.type) {
      case "set":
        return {
          type: "set",
          key: normalizeStorageKey(event.key),
          source: "engine",
        };
      case "delete":
        return {
          type: "delete",
          key: normalizeStorageKey(event.key),
          deleted: true,
          source: "engine",
        };
      case "clear": {
        const prefix = normalizeStoragePrefix(event.prefix);
        return prefix === undefined
          ? {
              type: "clear",
              source: "engine",
            }
          : {
              type: "clear",
              prefix,
              source: "engine",
            };
      }
    }
  };

  const startEngineWatch = async (): Promise<void> => {
    if (engine.watch === undefined || engineUnwatch !== undefined) {
      return;
    }

    if (engineWatchStart !== undefined) {
      await engineWatchStart;
      return;
    }

    engineWatchStart = Promise.resolve(
      engine.watch((event) => {
        emitChange(normalizeEngineWatchEvent(event));
      }),
    ).then((unwatch) => {
      engineUnwatch = unwatch;
      engineWatchStart = undefined;
    });

    await engineWatchStart;
  };

  const stopEngineWatch = async (): Promise<void> => {
    if (engineWatchStart !== undefined) {
      await engineWatchStart;
    }

    const unwatch = engineUnwatch;
    engineUnwatch = undefined;
    if (unwatch !== undefined) {
      await unwatch();
    }
  };

  const stopStorageWatch = async (): Promise<void> => {
    watchCallbacks.clear();
    await stopEngineWatch();
  };

  const storage = {
    engine,
    capabilities,

    on(pattern: StorageEventPattern, handler: StorageEventHandler) {
      return events.on(pattern, handler);
    },

    once(pattern: StorageEventPattern, handler: StorageEventHandler) {
      return events.once(pattern, handler);
    },

    off(pattern: StorageEventPattern, handler: StorageEventHandler) {
      events.off(pattern, handler);
    },

    listeners(pattern?: StorageEventPattern) {
      return pattern === undefined ? events.listeners() : events.listeners(pattern);
    },

    clearListeners(pattern?: StorageEventPattern) {
      events.clear(pattern);
    },

    listenerCount(pattern?: StorageEventPattern) {
      return events.listenerCount(pattern);
    },

    async watch(callback: StorageWatchCallback): Promise<StorageWatchUnsubscribe> {
      await startEngineWatch();

      let active = true;
      watchCallbacks.add(callback);
      const unsubscribe = async (): Promise<void> => {
        if (!active) {
          return;
        }

        active = false;
        watchCallbacks.delete(callback);
        if (watchCallbacks.size === 0) {
          await stopEngineWatch();
        }
      };

      return unsubscribe;
    },

    async unwatch(): Promise<void> {
      await stopStorageWatch();
    },

    async get(key: string): Promise<TValue | undefined> {
      try {
        const normalizedKey = normalizeStorageKey(key);
        const bytes = await engine.get(normalizedKey);
        return bytes === undefined ? undefined : codec.decode(bytes);
      } catch (error) {
        throw toStorageError("get", error, key);
      }
    },

    async tryGet(key: string): Promise<Result<TValue | undefined, StorageError>> {
      try {
        return ok(await storage.get(key));
      } catch (error) {
        return err(toStorageError("get", error, key));
      }
    },

    async set(key: string, value: TValue, options?: StorageSetOptions): Promise<void> {
      try {
        const normalizedKey = normalizeStorageKey(key);
        await engine.set(normalizedKey, codec.encode(value), { ttl: resolveTtl(options) });
        emitChange({
          type: "set",
          key: normalizedKey,
          source: "storage",
        });
      } catch (error) {
        throw toStorageError("set", error, key);
      }
    },

    async trySet(
      key: string,
      value: TValue,
      options?: StorageSetOptions,
    ): Promise<Result<void, StorageError>> {
      try {
        await storage.set(key, value, options);
        return ok(undefined);
      } catch (error) {
        return err(toStorageError("set", error, key));
      }
    },

    async compareAndSet(
      key: string,
      expected: TValue | undefined,
      value: TValue | undefined,
      options?: StorageSetOptions,
    ): Promise<boolean> {
      try {
        if (engine.compareAndSet === undefined) {
          throw StorageOperationError.unsupportedOperation(engine.name, "compareAndSet");
        }

        const normalizedKey = normalizeStorageKey(key);
        const updated = await engine.compareAndSet(
          normalizedKey,
          expected === undefined ? undefined : codec.encode(expected),
          value === undefined ? undefined : codec.encode(value),
          { ttl: resolveTtl(options) },
        );
        if (updated) {
          emitChange(
            value === undefined
              ? {
                  type: "delete",
                  key: normalizedKey,
                  deleted: true,
                  source: "storage",
                }
              : {
                  type: "set",
                  key: normalizedKey,
                  source: "storage",
                },
          );
        }
        return updated;
      } catch (error) {
        throw toStorageError("compareAndSet", error, key);
      }
    },

    async tryCompareAndSet(
      key: string,
      expected: TValue | undefined,
      value: TValue | undefined,
      options?: StorageSetOptions,
    ): Promise<Result<boolean, StorageError>> {
      try {
        return ok(await storage.compareAndSet(key, expected, value, options));
      } catch (error) {
        return err(toStorageError("compareAndSet", error, key));
      }
    },

    async compareAndSetMany(
      items: readonly StorageCompareAndSetManyItem<TValue>[],
    ): Promise<boolean> {
      try {
        if (engine.compareAndSetMany === undefined) {
          throw StorageOperationError.unsupportedOperation(engine.name, "compareAndSetMany");
        }

        const normalizedItems = items.map((item) => ({
          key: normalizeStorageKey(item.key),
          expected: item.expected,
          value: item.value,
          options: item.options,
        }));
        assertUniqueStorageKeys(
          "compareAndSetMany",
          normalizedItems.map((item) => item.key),
        );
        const updated = await engine.compareAndSetMany(
          normalizedItems.map((item) => ({
            key: item.key,
            expected: item.expected === undefined ? undefined : codec.encode(item.expected),
            value: item.value === undefined ? undefined : codec.encode(item.value),
            options: { ttl: resolveTtl(item.options) },
          })),
        );
        if (updated) {
          for (const item of normalizedItems) {
            emitChange(
              item.value === undefined
                ? {
                    type: "delete",
                    key: item.key,
                    deleted: true,
                    source: "storage",
                  }
                : {
                    type: "set",
                    key: item.key,
                    source: "storage",
                  },
            );
          }
        }
        return updated;
      } catch (error) {
        throw toStorageError("compareAndSetMany", error);
      }
    },

    async tryCompareAndSetMany(
      items: readonly StorageCompareAndSetManyItem<TValue>[],
    ): Promise<Result<boolean, StorageError>> {
      try {
        return ok(await storage.compareAndSetMany(items));
      } catch (error) {
        return err(toStorageError("compareAndSetMany", error));
      }
    },

    async has(key: string): Promise<boolean> {
      try {
        const normalizedKey = normalizeStorageKey(key);
        if (engine.has) {
          return await engine.has(normalizedKey);
        }
        return (await engine.get(normalizedKey)) !== undefined;
      } catch (error) {
        throw toStorageError("has", error, key);
      }
    },

    async tryHas(key: string): Promise<Result<boolean, StorageError>> {
      try {
        return ok(await storage.has(key));
      } catch (error) {
        return err(toStorageError("has", error, key));
      }
    },

    async delete(key: string): Promise<boolean> {
      try {
        const normalizedKey = normalizeStorageKey(key);
        const deleted = await engine.delete(normalizedKey);
        emitChange({
          type: "delete",
          key: normalizedKey,
          deleted,
          source: "storage",
        });
        return deleted;
      } catch (error) {
        throw toStorageError("delete", error, key);
      }
    },

    async tryDelete(key: string): Promise<Result<boolean, StorageError>> {
      try {
        return ok(await storage.delete(key));
      } catch (error) {
        return err(toStorageError("delete", error, key));
      }
    },

    async getMany(keys: readonly string[]): Promise<readonly (TValue | undefined)[]> {
      try {
        const normalizedKeys = keys.map((key) => normalizeStorageKey(key));
        if (engine.getMany) {
          const values = await engine.getMany(normalizedKeys);
          return normalizedKeys.map((key) => {
            const bytes = values.get(key);
            return bytes === undefined ? undefined : codec.decode(bytes);
          });
        }
        return await Promise.all(normalizedKeys.map((key) => storage.get(key)));
      } catch (error) {
        throw toStorageError("getMany", error);
      }
    },

    async tryGetMany(
      keys: readonly string[],
    ): Promise<Result<readonly (TValue | undefined)[], StorageError>> {
      try {
        return ok(await storage.getMany(keys));
      } catch (error) {
        return err(toStorageError("getMany", error));
      }
    },

    async setMany(items: readonly StorageSetManyItem<TValue>[]): Promise<void> {
      try {
        const normalizedItems = items.map((item) => ({
          key: normalizeStorageKey(item.key),
          value: item.value,
          options: item.options,
        }));
        if (engine.setMany) {
          await engine.setMany(
            normalizedItems.map((item) => ({
              key: item.key,
              value: codec.encode(item.value),
              options: { ttl: resolveTtl(item.options) },
            })),
          );
          emitChange({
            type: "setMany",
            keys: normalizedItems.map((item) => item.key),
            source: "storage",
          });
          return;
        }
        await Promise.all(
          normalizedItems.map((item) => storage.set(item.key, item.value, item.options)),
        );
      } catch (error) {
        throw toStorageError("setMany", error);
      }
    },

    async trySetMany(
      items: readonly StorageSetManyItem<TValue>[],
    ): Promise<Result<void, StorageError>> {
      try {
        await storage.setMany(items);
        return ok(undefined);
      } catch (error) {
        return err(toStorageError("setMany", error));
      }
    },

    async deleteMany(keys: readonly string[]): Promise<number> {
      try {
        const normalizedKeys = keys.map((key) => normalizeStorageKey(key));
        if (engine.deleteMany) {
          const deleted = await engine.deleteMany(normalizedKeys);
          emitChange({
            type: "deleteMany",
            keys: normalizedKeys,
            deleted,
            source: "storage",
          });
          return deleted;
        }
        const deleted = await Promise.all(normalizedKeys.map((key) => storage.delete(key)));
        return deleted.filter(Boolean).length;
      } catch (error) {
        throw toStorageError("deleteMany", error);
      }
    },

    async tryDeleteMany(keys: readonly string[]): Promise<Result<number, StorageError>> {
      try {
        return ok(await storage.deleteMany(keys));
      } catch (error) {
        return err(toStorageError("deleteMany", error));
      }
    },

    async keys(options?: StorageKeyOptions): Promise<readonly string[]> {
      try {
        const prefix = normalizeStoragePrefix(options?.prefix);
        return [...(await engine.keys({ prefix }))].sort();
      } catch (error) {
        throw toStorageError("keys", error);
      }
    },

    async tryKeys(options?: StorageKeyOptions): Promise<Result<readonly string[], StorageError>> {
      try {
        return ok(await storage.keys(options));
      } catch (error) {
        return err(toStorageError("keys", error));
      }
    },

    async entries(options?: StorageKeyOptions): Promise<readonly StorageEntry<TValue>[]> {
      try {
        const keys = await storage.keys(options);
        const values = await storage.getMany(keys);
        return keys.flatMap((key, index): readonly StorageEntry<TValue>[] => {
          const value = values[index];
          return value === undefined ? [] : [{ key, value }];
        });
      } catch (error) {
        throw toStorageError("entries", error);
      }
    },

    async tryEntries(
      options?: StorageKeyOptions,
    ): Promise<Result<readonly StorageEntry<TValue>[], StorageError>> {
      try {
        return ok(await storage.entries(options));
      } catch (error) {
        return err(toStorageError("entries", error));
      }
    },

    async clear(options?: StorageKeyOptions): Promise<void> {
      try {
        const prefix = normalizeStoragePrefix(options?.prefix);
        await engine.clear({ prefix });
        const event: StorageClearEvent =
          prefix === undefined
            ? {
                type: "clear",
                source: "storage",
              }
            : {
                type: "clear",
                prefix,
                source: "storage",
              };
        emitChange(event);
      } catch (error) {
        throw toStorageError("clear", error);
      }
    },

    async tryClear(options?: StorageKeyOptions): Promise<Result<void, StorageError>> {
      try {
        await storage.clear(options);
        return ok(undefined);
      } catch (error) {
        return err(toStorageError("clear", error));
      }
    },

    async dispose(): Promise<void> {
      try {
        await stopStorageWatch();
        events.clear();
        await engine.dispose?.();
      } catch (error) {
        throw toStorageError("dispose", error);
      }
    },

    async [Symbol.asyncDispose](): Promise<void> {
      return storage.dispose();
    },

    async tryDispose(): Promise<Result<void, StorageError>> {
      try {
        await storage.dispose();
        return ok(undefined);
      } catch (error) {
        return err(toStorageError("dispose", error));
      }
    },
  };

  return storage as Storage<TItems, TValue>;
}

function assertUniqueStorageKeys(operation: string, keys: readonly string[]): void {
  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      throw StorageKeyError.unique(operation, key);
    }
    seen.add(key);
  }
}

/**
 * Common high-level storage option and batch item types.
 */
export type { StorageKeyOptions, StorageSetManyItem, StorageSetOptions };
