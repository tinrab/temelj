import type { RetryOptions } from "./retry";
import type { ConcurrencyOptions, StandardOptions } from "./types";

import { map } from "./map";
import { reduce } from "./reduce";
import { retry } from "./retry";
import { Skip } from "./types";

type StreamSource<T> = AsyncIterable<T> | Iterable<T> | Promise<Iterable<T>>;

/**
 * A lazy async pipeline. Each operation retains its input and output types.
 * Terminal methods execute the pipeline from its source.
 */
export class AsyncStream<T> {
  readonly #execute: (options?: StandardOptions) => Promise<T[]>;

  private constructor(execute: (options?: StandardOptions) => Promise<T[]>) {
    this.#execute = execute;
  }

  static from<T>(source: StreamSource<T>): AsyncStream<T> {
    return new AsyncStream<T>(async (options) => {
      // The box preserves promise-valued items in synchronous iterables.
      const entries = await map(source, (value) => ({ value }), options);

      return entries.map((entry) => entry.value);
    });
  }

  map<R>(
    mapper: (item: T, index: number) => Promise<R> | R,
    options?: ConcurrencyOptions,
  ): AsyncStream<R> {
    return new AsyncStream<R>(async (executionOptions) =>
      map(await this.#execute(executionOptions), mapper, {
        ...options,
        signal: executionOptions?.signal ?? options?.signal,
      }),
    );
  }

  filter(
    predicate: (item: T, index: number) => Promise<boolean> | boolean,
    options?: ConcurrencyOptions,
  ): AsyncStream<T> {
    return new AsyncStream<T>(async (executionOptions) =>
      map(
        await this.#execute(executionOptions),
        async (item, index) => ((await predicate(item, index)) ? item : Skip),
        { ...options, signal: executionOptions?.signal ?? options?.signal },
      ),
    );
  }

  /** Retries the preceding pipeline, including its source, after a failure. */
  retry(options?: RetryOptions): AsyncStream<T> {
    return new AsyncStream<T>((executionOptions) =>
      retry(() => this.#execute(executionOptions), {
        ...options,
        signal: executionOptions?.signal ?? options?.signal,
      }),
    );
  }

  toArray(options?: StandardOptions): Promise<T[]> {
    return this.#execute(options);
  }

  async forEach(
    fn: (item: T, index: number) => Promise<void> | void,
    options?: StandardOptions,
  ): Promise<void> {
    const results = await this.#execute(options);

    for (let index = 0; index < results.length; index++) {
      await fn(results[index], index);
    }
  }

  async drain(options?: StandardOptions): Promise<void> {
    await this.#execute(options);
  }

  async reduce<R>(
    reducer: (accumulator: R, item: T, index: number) => Promise<R> | R,
    initialValue: R,
    options?: StandardOptions,
  ): Promise<R> {
    return reduce(await this.#execute(options), reducer, initialValue, options);
  }
}
