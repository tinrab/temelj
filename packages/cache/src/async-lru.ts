import { AbortError } from "@temelj/async";

import type { CacheSetOptions } from "./types.ts";

import { LruCache, type LruCacheOptions } from "./lru.ts";

export interface LruCacheLoadContext<K, V> {
  readonly key: K;
  readonly cache: LruCache<K, V>;
  readonly signal?: AbortSignal;
}

export type LruCacheLoader<K, V> = (
  key: K,
  context: LruCacheLoadContext<K, V>,
) => Promise<V | undefined>;

export interface AsyncLruCacheOptions<K, V> extends LruCacheOptions<K, V> {
  readonly loader?: LruCacheLoader<K, V>;
}

export interface AsyncLruCacheGetOptions extends CacheSetOptions {
  readonly signal?: AbortSignal;
}

interface PendingLoad<V> {
  readonly promise: Promise<V | undefined>;
  readonly controller: AbortController;
}

export class AsyncLruCache<K, V> {
  readonly cache: LruCache<K, V>;
  readonly #loader: LruCacheLoader<K, V> | undefined;
  readonly #pending = new Map<K, PendingLoad<V>>();

  constructor(options: AsyncLruCacheOptions<K, V> = {}) {
    this.cache = new LruCache(options);
    this.#loader = options.loader;
  }

  get size(): number {
    return this.cache.size;
  }

  get maxEntries(): number {
    return this.cache.maxEntries;
  }

  get calculatedSize(): number {
    return this.cache.calculatedSize;
  }

  get maxSize(): number {
    return this.cache.maxSize;
  }

  get pending(): number {
    return this.#pending.size;
  }

  set(key: K, value: V, options?: CacheSetOptions): boolean {
    return this.cache.set(key, value, options);
  }

  get(key: K): Promise<V | undefined> {
    return this.getOrLoad(key);
  }

  peek(key: K): V | undefined {
    return this.cache.peek(key);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    this.cancel(key);
    return this.cache.delete(key);
  }

  clear(): void {
    this.cancelAll();
    this.cache.clear();
  }

  async getOrLoad(
    key: K,
    loaderOrOptions?: LruCacheLoader<K, V> | AsyncLruCacheGetOptions,
    options: AsyncLruCacheGetOptions = {},
  ): Promise<V | undefined> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const loader = typeof loaderOrOptions === "function" ? loaderOrOptions : this.#loader;
    const setOptions = typeof loaderOrOptions === "function" ? options : (loaderOrOptions ?? {});
    if (loader === undefined) {
      return undefined;
    }
    if (setOptions.signal?.aborted) {
      throw new AbortError();
    }

    const pending = this.#pending.get(key) ?? this.#load(key, loader, setOptions);
    return abortablePromise(pending.promise, setOptions.signal);
  }

  cancel(key: K): boolean {
    const pending = this.#pending.get(key);
    if (pending === undefined) {
      return false;
    }
    pending.controller.abort();
    this.#pending.delete(key);
    return true;
  }

  cancelAll(): void {
    for (const pending of this.#pending.values()) {
      pending.controller.abort();
    }
    this.#pending.clear();
  }

  #load(key: K, loader: LruCacheLoader<K, V>, options: AsyncLruCacheGetOptions): PendingLoad<V> {
    const controller = new AbortController();
    const promise = Promise.resolve()
      .then(() => loader(key, { key, cache: this.cache, signal: controller.signal }))
      .then((value) => {
        if (value !== undefined && !controller.signal.aborted) {
          this.cache.set(key, value, options);
        }
        return value;
      })
      .finally(() => {
        const current = this.#pending.get(key);
        if (current?.promise === promise) {
          this.#pending.delete(key);
        }
      });

    const pending = { promise, controller };
    this.#pending.set(key, pending);
    return pending;
  }
}

export function memoizeLru<Args extends readonly unknown[], V>(
  fn: (...args: Args) => Promise<V>,
  options: Omit<AsyncLruCacheOptions<string, V>, "loader"> & {
    readonly key?: (...args: Args) => string;
  } = {},
): (...args: Args) => Promise<V> {
  const keyOf = options.key ?? ((...args) => JSON.stringify(args));
  const cache = new LruCache<string, V>(options);
  const pending = new Map<string, Promise<V>>();

  return (...args) => {
    const key = keyOf(...args);
    const cached = cache.get(key);
    if (cached !== undefined) {
      return Promise.resolve(cached);
    }

    const current = pending.get(key);
    if (current !== undefined) {
      return current;
    }

    const promise = fn(...args)
      .then((value) => {
        cache.set(key, value);
        return value;
      })
      .finally(() => {
        pending.delete(key);
      });

    pending.set(key, promise);
    return promise;
  };
}

function abortablePromise<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(new AbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new AbortError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}
