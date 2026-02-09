import { AbortError } from "./errors";
import type {
  ConcurrencyOptions,
  ResilienceOptions,
  SkipSymbol,
} from "./types";
import { Skip } from "./types";

type AsyncInput<T> = AsyncIterable<T> | Iterable<T> | Promise<Iterable<T>>;

/**
 * Maps over an iterable concurrently with configurable concurrency and resilience.
 *
 * - Preserves order of output even if tasks finish out of order.
 * - Supports the {@link Skip} symbol to act as a combined map+filter.
 * - Accepts `Iterable<T>`, `AsyncIterable<T>`, or `Promise<Iterable<T>>`.
 */
export async function map<T, R>(
  input: AsyncInput<T>,
  mapper: (item: T, index: number) => Promise<R | SkipSymbol> | R | SkipSymbol,
  options?: ConcurrencyOptions & ResilienceOptions,
): Promise<R[]> {
  const signal = options?.signal;
  const concurrency = options?.concurrency ?? Number.POSITIVE_INFINITY;
  const stopOnError = options?.stopOnError ?? true;

  if (signal?.aborted) {
    throw new AbortError();
  }

  const results: Map<number, R> = new Map();
  const skipped = new Set<number>();
  const errors: unknown[] = [];
  let activeCount = 0;
  let settled = false;
  let nextIndex = 0;
  let maxIndex = -1;
  let inputDone = false;

  let resolvePromise: (value: R[]) => void;
  let rejectPromise: (reason?: unknown) => void;
  const promise = new Promise<R[]>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  function onAbort() {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(new AbortError());
  }

  function cleanup() {
    signal?.removeEventListener("abort", onAbort);
  }

  signal?.addEventListener("abort", onAbort);

  function checkDone() {
    if (settled) return;
    if (inputDone && activeCount === 0) {
      settled = true;
      cleanup();
      if (errors.length > 0) {
        rejectPromise(new AggregateError(errors, "Some operations failed"));
      } else {
        const output: R[] = [];
        for (let i = 0; i <= maxIndex; i++) {
          if (!skipped.has(i)) {
            output.push(results.get(i) as R);
          }
        }
        resolvePromise(output);
      }
    }
  }

  function handleError(error: unknown) {
    if (settled) return;
    if (stopOnError) {
      settled = true;
      cleanup();
      rejectPromise(error);
      return;
    }
    errors.push(error);
    activeCount--;
    checkDone();
    consume();
  }

  function handleResult(index: number, value: R | SkipSymbol) {
    if (settled) return;
    if (value === Skip) {
      skipped.add(index);
    } else {
      results.set(index, value);
    }
    activeCount--;
    checkDone();
    consume();
  }

  let iterator: Iterator<T> | AsyncIterator<T>;
  if (input instanceof Promise) {
    const resolved = await input;
    iterator = resolved[Symbol.iterator]();
  } else if (Symbol.asyncIterator in Object(input)) {
    iterator = (input as AsyncIterable<T>)[Symbol.asyncIterator]();
  } else {
    iterator = (input as Iterable<T>)[Symbol.iterator]();
  }

  async function consume() {
    while (!settled && !inputDone && activeCount < concurrency) {
      activeCount++;

      try {
        const { done, value } = await iterator.next();
        if (done) {
          inputDone = true;
          activeCount--;
          checkDone();
          break;
        }

        const index = nextIndex++;
        maxIndex = Math.max(maxIndex, index);

        const result = mapper(value, index);
        if (result instanceof Promise) {
          result.then(
            (val) => handleResult(index, val),
            (err) => handleError(err),
          );
        } else {
          handleResult(index, result);
        }
      } catch (error) {
        handleError(error);
      }
    }
  }

  consume();

  return promise;
}
