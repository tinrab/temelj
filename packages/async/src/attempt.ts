import { AbortError } from "./errors";
import type { StandardOptions } from "./types";

/**
 * Safely executes a function (synchronous or asynchronous) and wraps its result in a Promise.
 * Optionally respects an AbortSignal.
 */
export function attempt<T, Args extends unknown[]>(
  fn: (...args: Args) => T | PromiseLike<T>,
  args: Args = [] as unknown as Args,
  options?: StandardOptions,
): Promise<T> {
  if (options?.signal?.aborted) {
    return Promise.reject(new AbortError());
  }

  return Promise.try(fn, ...args).then((result) => {
    if (options?.signal?.aborted) {
      throw new AbortError();
    }
    return result;
  });
}
