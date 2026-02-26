import { AbortError } from "./errors";
import type { StandardOptions } from "./types";

type AsyncInput<T> = AsyncIterable<T> | Iterable<T>;

/**
 * Performs an async reduction over an iterable, processing items serially.
 */
export async function reduce<T, R>(
  input: AsyncInput<T>,
  reducer: (accumulator: R, item: T, index: number) => Promise<R> | R,
  initialValue: R,
  options?: StandardOptions,
): Promise<R> {
  const signal = options?.signal;

  if (signal?.aborted) {
    throw new AbortError();
  }

  let accumulator = initialValue;
  let index = 0;

  if (Symbol.asyncIterator in Object(input)) {
    for await (const item of input as AsyncIterable<T>) {
      if (signal?.aborted) {
        throw new AbortError();
      }
      accumulator = await reducer(accumulator, item, index++);
    }
  } else {
    for (const item of input as Iterable<T>) {
      if (signal?.aborted) {
        throw new AbortError();
      }
      accumulator = await reducer(accumulator, item, index++);
    }
  }

  return accumulator;
}
