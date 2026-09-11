import type { StandardOptions } from "./types";

import { AbortError, TimeoutError } from "./errors";

/**
 * Races a promise against a timer. Rejects with {@link TimeoutError} if the
 * promise does not resolve within `ms` milliseconds.
 *
 * If a `fallback` value is provided, it is returned instead of throwing on timeout.
 */
export function timeout<T>(
  promise: PromiseLike<T>,
  ms: number,
  options?: StandardOptions & { fallback?: T },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(AbortError.create());

      return;
    }

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();

      if (options?.fallback !== undefined) {
        resolve(options.fallback);
      } else {
        reject(TimeoutError.create());
      }
    }, ms);

    function onAbort() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(AbortError.create());
    }

    function cleanup() {
      options?.signal?.removeEventListener("abort", onAbort);
    }

    options?.signal?.addEventListener("abort", onAbort);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(error);
      },
    );
  });
}
