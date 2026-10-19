import {
  InMemoryStorageEngine,
  createStorage,
  type StorageKeyOptions,
  type StorageSetOptions,
  type StorageValue,
} from "@temelj/storage";

import type { WorkflowStorage } from "../types/store.ts";

interface FakeStorageOptions {
  /** Which atomic writes the engine supports: all of them, single keys only, or none. */
  readonly conditionalWrites?: "all" | "single-key" | "none";
  /** Replaces `set`; call `next` to perform the real write. */
  readonly set?: (
    key: string,
    value: StorageValue,
    options: StorageSetOptions | undefined,
    next: WorkflowStorage["set"],
  ) => Promise<void>;
  /** Replaces the engine's `set`, so a thrown error surfaces the way a backend failure would. */
  readonly engineSet?: (
    key: string,
    value: string,
    options: StorageSetOptions | undefined,
    next: InMemoryStorageEngine<string>["set"],
  ) => Promise<void>;
  /** Replaces `entries`; call `next` to perform the real scan. */
  readonly entries?: (
    options: StorageKeyOptions | undefined,
    next: WorkflowStorage["entries"],
  ) => ReturnType<WorkflowStorage["entries"]>;
}

/** In-memory storage with limited capabilities or intercepted writes, for failure tests. */
export function fakeStorage(options: FakeStorageOptions = {}): WorkflowStorage {
  const engine = new InMemoryStorageEngine<string>();
  const conditionalWrites = options.conditionalWrites ?? "all";

  // The store reads capabilities from the engine, so missing methods disable those code paths.
  if (conditionalWrites !== "all") {
    Object.defineProperty(engine, "compareAndSetMany", { configurable: true, value: undefined });
  }

  if (conditionalWrites === "none") {
    Object.defineProperty(engine, "compareAndSet", { configurable: true, value: undefined });
  }

  const { engineSet } = options;

  if (engineSet !== undefined) {
    const next = engine.set.bind(engine);
    engine.set = async (key, value, setOptions) => await engineSet(key, value, setOptions, next);
  }

  const storage: WorkflowStorage = createStorage({ engine });
  const { set, entries } = options;

  if (set !== undefined) {
    const next = storage.set.bind(storage);
    storage.set = async (key: string, value: StorageValue, setOptions?: StorageSetOptions) =>
      await set(key, value, setOptions, next);
  }

  if (entries !== undefined) {
    const next = storage.entries.bind(storage);
    storage.entries = (keyOptions) => entries(keyOptions, next);
  }

  return storage;
}
