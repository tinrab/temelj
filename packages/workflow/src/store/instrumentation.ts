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
export function instrumentWorkflowStorage(
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
      return await run("watch", async () => await storage.watch(callback));
    },

    async unwatch() {
      await run("unwatch", async () => await storage.unwatch());
    },

    async get(key: string) {
      return await run("get", async () => await storage.get(key));
    },

    async tryGet(key: string) {
      return await run("tryGet", async () => await storage.tryGet(key));
    },

    async set(key: string, value: StorageValue, options?: StorageSetOptions) {
      await run("set", async () => await storage.set(key, value, options));
    },

    async trySet(key: string, value: StorageValue, options?: StorageSetOptions) {
      return await run("trySet", async () => await storage.trySet(key, value, options));
    },

    async compareAndSet(
      key: string,
      expected: StorageValue | undefined,
      value: StorageValue | undefined,
      options?: StorageSetOptions,
    ) {
      return await run(
        "compareAndSet",
        async () => await storage.compareAndSet(key, expected, value, options),
      );
    },

    async tryCompareAndSet(
      key: string,
      expected: StorageValue | undefined,
      value: StorageValue | undefined,
      options?: StorageSetOptions,
    ) {
      return await run(
        "tryCompareAndSet",
        async () => await storage.tryCompareAndSet(key, expected, value, options),
      );
    },

    async compareAndSetMany(items: readonly StorageCompareAndSetManyItem<StorageValue>[]) {
      return await run("compareAndSetMany", async () => await storage.compareAndSetMany(items));
    },

    async tryCompareAndSetMany(items: readonly StorageCompareAndSetManyItem<StorageValue>[]) {
      return await run(
        "tryCompareAndSetMany",
        async () => await storage.tryCompareAndSetMany(items),
      );
    },

    async has(key: string) {
      return await run("has", async () => await storage.has(key));
    },

    async tryHas(key: string) {
      return await run("tryHas", async () => await storage.tryHas(key));
    },

    async delete(key: string) {
      return await run("delete", async () => await storage.delete(key));
    },

    async tryDelete(key: string) {
      return await run("tryDelete", async () => await storage.tryDelete(key));
    },

    async getMany(keys: readonly string[]) {
      return await run("getMany", async () => await storage.getMany(keys));
    },

    async tryGetMany(keys: readonly string[]) {
      return await run("tryGetMany", async () => await storage.tryGetMany(keys));
    },

    async setMany(items: readonly StorageSetManyItem<StorageValue>[]) {
      await run("setMany", async () => await storage.setMany(items));
    },

    async trySetMany(items: readonly StorageSetManyItem<StorageValue>[]) {
      return await run("trySetMany", async () => await storage.trySetMany(items));
    },

    async deleteMany(keys: readonly string[]) {
      return await run("deleteMany", async () => await storage.deleteMany(keys));
    },

    async tryDeleteMany(keys: readonly string[]) {
      return await run("tryDeleteMany", async () => await storage.tryDeleteMany(keys));
    },

    async keys(options?: StorageKeyOptions) {
      return await run("keys", async () => await storage.keys(options));
    },

    async tryKeys(options?: StorageKeyOptions) {
      return await run("tryKeys", async () => await storage.tryKeys(options));
    },

    async entries(options?: StorageKeyOptions) {
      return await run("entries", async () => await storage.entries(options));
    },

    async tryEntries(options?: StorageKeyOptions) {
      return await run("tryEntries", async () => await storage.tryEntries(options));
    },

    async clear(options?: StorageKeyOptions) {
      await run("clear", async () => await storage.clear(options));
    },

    async tryClear(options?: StorageKeyOptions) {
      return await run("tryClear", async () => await storage.tryClear(options));
    },

    async dispose() {
      await run("dispose", async () => await storage.dispose());
    },

    async [Symbol.asyncDispose](): Promise<void> {
      await instrumented.dispose();
    },

    async tryDispose() {
      return await run("tryDispose", async () => await storage.tryDispose());
    },
  };

  return instrumented;
}
