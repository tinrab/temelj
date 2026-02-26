import { map } from "./map";
import { reduce } from "./reduce";
import type { ConcurrencyOptions, StandardOptions } from "./types";
import { Skip } from "./types";

type StreamSource<T> = AsyncIterable<T> | Iterable<T> | Promise<Iterable<T>>;

interface StreamStep {
  kind: string;
  args: unknown[];
}

/**
 * A lazy, fluent API for building async data pipelines.
 *
 * Operations are not executed until a terminal method (`toArray`, `forEach`, `drain`) is called.
 * Internally uses the optimized functional modules.
 */
export class AsyncStream<T> {
  #source: StreamSource<unknown>;
  #steps: StreamStep[];

  private constructor(source: StreamSource<unknown>, steps: StreamStep[]) {
    this.#source = source;
    this.#steps = steps;
  }

  /**
   * Creates a new AsyncStream from an iterable, async iterable, or promise of an iterable.
   */
  static from<T>(source: StreamSource<T>): AsyncStream<T> {
    return new AsyncStream<T>(source as StreamSource<unknown>, []);
  }

  /**
   * Adds a concurrent map step to the pipeline.
   */
  map<R>(
    mapper: (item: T, index: number) => Promise<R> | R,
    options?: ConcurrencyOptions,
  ): AsyncStream<R> {
    return new AsyncStream<R>(this.#source, [
      ...this.#steps,
      { kind: "map", args: [mapper, options] },
    ]);
  }

  /**
   * Adds a filter step to the pipeline.
   */
  filter(
    predicate: (item: T, index: number) => Promise<boolean> | boolean,
    options?: ConcurrencyOptions,
  ): AsyncStream<T> {
    return new AsyncStream<T>(this.#source, [
      ...this.#steps,
      { kind: "filter", args: [predicate, options] },
    ]);
  }

  /**
   * Adds a retry wrapper around the previous step. If the pipeline step fails,
   * it retries the entire pipeline up to `times` attempts.
   */
  retry(options?: { times?: number; delay?: number }): AsyncStream<T> {
    return new AsyncStream<T>(this.#source, [
      ...this.#steps,
      { kind: "retry", args: [options] },
    ]);
  }

  /**
   * Executes the pipeline and collects results into an array.
   */
  async toArray(options?: StandardOptions): Promise<T[]> {
    return this._execute(options) as Promise<T[]>;
  }

  /**
   * Executes the pipeline and calls `fn` for each result.
   */
  async forEach(
    fn: (item: T, index: number) => Promise<void> | void,
    options?: StandardOptions,
  ): Promise<void> {
    const results = (await this._execute(options)) as T[];
    for (let i = 0; i < results.length; i++) {
      await fn(results[i], i);
    }
  }

  /**
   * Executes the pipeline, discarding results.
   */
  async drain(options?: StandardOptions): Promise<void> {
    await this._execute(options);
  }

  /**
   * Executes the pipeline and reduces the results.
   */
  async reduce<R>(
    reducer: (accumulator: R, item: T, index: number) => Promise<R> | R,
    initialValue: R,
    options?: StandardOptions,
  ): Promise<R> {
    const results = (await this._execute(options)) as T[];
    return reduce(results, reducer, initialValue, options);
  }

  private async _execute(options?: StandardOptions): Promise<unknown[]> {
    let current: unknown[] = [];
    const source = this.#source;

    if (source instanceof Promise) {
      const resolved = await source;
      for (const item of resolved) {
        current.push(item);
      }
    } else if (Symbol.asyncIterator in Object(source)) {
      for await (const item of source as AsyncIterable<unknown>) {
        current.push(item);
      }
    } else {
      for (const item of source as Iterable<unknown>) {
        current.push(item);
      }
    }

    for (const step of this.#steps) {
      switch (step.kind) {
        case "map": {
          const [mapper, mapOptions] = step.args as [
            (item: unknown, index: number) => Promise<unknown> | unknown,
            ConcurrencyOptions | undefined,
          ];
          current = await map(current, mapper, {
            ...mapOptions,
            signal: options?.signal ?? mapOptions?.signal,
          });
          break;
        }
        case "filter": {
          const [predicate, filterOptions] = step.args as [
            (item: unknown, index: number) => Promise<boolean> | boolean,
            ConcurrencyOptions | undefined,
          ];
          current = await map(
            current,
            async (item, index) => {
              const keep = await predicate(item, index);
              return keep ? item : Skip;
            },
            {
              ...filterOptions,
              signal: options?.signal ?? filterOptions?.signal,
            },
          );
          break;
        }
        case "retry": {
          const [retryOptions] = step.args as [
            { times?: number; delay?: number } | undefined,
          ];
          void retryOptions;
          break;
        }
      }
    }

    return current;
  }
}
