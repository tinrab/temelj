import type {
  StorageCompareAndSetManyItem,
  StorageEventHandler,
  StorageEventPattern,
  StorageKeyOptions,
  StorageSetManyItem,
  StorageSetOptions,
  StorageValue,
  StorageWatchCallback,
} from "@temelj/storage";

import type { WorkflowStorage } from "../types/store.ts";
import type { StorageTelemetryOperation, Telemetry } from "../types/telemetry.ts";

import { withStorageTelemetry } from "../telemetry.ts";

/** Wraps workflow storage operations with telemetry. */
export function instrumentStorage(
  storage: WorkflowStorage,
  telemetry: Telemetry | undefined,
): WorkflowStorage {
  if (telemetry?.withStorageOperation === undefined) {
    return storage;
  }

  const backend = storage.engine.name;

  const run = async <T>(
    operation: StorageTelemetryOperation,
    callback: () => Promise<T>,
  ): Promise<T> => await withStorageTelemetry(telemetry, { operation, backend }, callback);

  const instrumented: WorkflowStorage = {
    engine: storage.engine,
    capabilities: storage.capabilities,

    on<Pattern extends StorageEventPattern>(
      pattern: Pattern,
      handler: StorageEventHandler<Pattern>,
    ) {
      return storage.on(pattern, handler);
    },

    once<Pattern extends StorageEventPattern>(
      pattern: Pattern,
      handler: StorageEventHandler<Pattern>,
    ) {
      return storage.once(pattern, handler);
    },

    off<Pattern extends StorageEventPattern>(
      pattern: Pattern,
      handler: StorageEventHandler<Pattern>,
    ) {
      storage.off(pattern, handler);
    },

    listeners(pattern?: StorageEventPattern) {
      return pattern === undefined ? storage.listeners() : storage.listeners(pattern);
    },

    clearListeners(pattern?: StorageEventPattern) {
      storage.clearListeners(pattern);
    },

    listenerCount(pattern?: StorageEventPattern) {
      return storage.listenerCount(pattern);
    },

    async watch(callback: StorageWatchCallback) {
      return await run("watch", () => storage.watch(callback));
    },

    async unwatch() {
      await run("unwatch", () => storage.unwatch());
    },

    async get(key: string) {
      return await run("get", () => storage.get(key));
    },

    async tryGet(key: string) {
      return await run("tryGet", () => storage.tryGet(key));
    },

    async set(key: string, value: StorageValue, options?: StorageSetOptions) {
      await run("set", () => storage.set(key, value, options));
    },

    async trySet(key: string, value: StorageValue, options?: StorageSetOptions) {
      return await run("trySet", () => storage.trySet(key, value, options));
    },

    async compareAndSet(
      key: string,
      expected: StorageValue | undefined,
      value: StorageValue | undefined,
      options?: StorageSetOptions,
    ) {
      return await run("compareAndSet", () => storage.compareAndSet(key, expected, value, options));
    },

    async tryCompareAndSet(
      key: string,
      expected: StorageValue | undefined,
      value: StorageValue | undefined,
      options?: StorageSetOptions,
    ) {
      return await run("tryCompareAndSet", () =>
        storage.tryCompareAndSet(key, expected, value, options),
      );
    },

    async compareAndSetMany(items: readonly StorageCompareAndSetManyItem<StorageValue>[]) {
      return await run("compareAndSetMany", () => storage.compareAndSetMany(items));
    },

    async tryCompareAndSetMany(items: readonly StorageCompareAndSetManyItem<StorageValue>[]) {
      return await run("tryCompareAndSetMany", () => storage.tryCompareAndSetMany(items));
    },

    async has(key: string) {
      return await run("has", () => storage.has(key));
    },

    async tryHas(key: string) {
      return await run("tryHas", () => storage.tryHas(key));
    },

    async delete(key: string) {
      return await run("delete", () => storage.delete(key));
    },

    async tryDelete(key: string) {
      return await run("tryDelete", () => storage.tryDelete(key));
    },

    async getMany(keys: readonly string[]) {
      return await run("getMany", () => storage.getMany(keys));
    },

    async tryGetMany(keys: readonly string[]) {
      return await run("tryGetMany", () => storage.tryGetMany(keys));
    },

    async setMany(items: readonly StorageSetManyItem<StorageValue>[]) {
      await run("setMany", () => storage.setMany(items));
    },

    async trySetMany(items: readonly StorageSetManyItem<StorageValue>[]) {
      return await run("trySetMany", () => storage.trySetMany(items));
    },

    async deleteMany(keys: readonly string[]) {
      return await run("deleteMany", () => storage.deleteMany(keys));
    },

    async tryDeleteMany(keys: readonly string[]) {
      return await run("tryDeleteMany", () => storage.tryDeleteMany(keys));
    },

    async keys(options?: StorageKeyOptions) {
      return await run("keys", () => storage.keys(options));
    },

    async tryKeys(options?: StorageKeyOptions) {
      return await run("tryKeys", () => storage.tryKeys(options));
    },

    async entries(options?: StorageKeyOptions) {
      return await run("entries", () => storage.entries(options));
    },

    async tryEntries(options?: StorageKeyOptions) {
      return await run("tryEntries", () => storage.tryEntries(options));
    },

    async clear(options?: StorageKeyOptions) {
      await run("clear", () => storage.clear(options));
    },

    async tryClear(options?: StorageKeyOptions) {
      return await run("tryClear", () => storage.tryClear(options));
    },

    async dispose() {
      await run("dispose", () => storage.dispose());
    },

    async [Symbol.asyncDispose](): Promise<void> {
      await instrumented.dispose();
    },

    async tryDispose() {
      return await run("tryDispose", () => storage.tryDispose());
    },
  };

  return instrumented;
}
