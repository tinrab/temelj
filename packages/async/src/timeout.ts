import { AbortError, TimeoutError } from "./errors";
import type { StandardOptions } from "./types";

/**
 * Races a promise against a timer. Rejects with {@link TimeoutError} if the
 * promise does not resolve within `ms` milliseconds.
 *
 * If a `fallback` value is provided, it is returned instead of throwing on timeout.
 */
export function timeout<T>(
  promise: Promise<T> | (() => Promise<T>),
  ms: number,
  options?: StandardOptions & { fallback?: T },
): Promise<T> {
  const p = typeof promise === "function" ? promise() : promise;

  return new Promise<T>((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new AbortError());
      return;
    }

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      if (options && "fallback" in options) {
        resolve(options.fallback as T);
      } else {
        reject(new TimeoutError());
      }
    }, ms);

    function onAbort() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new AbortError());
    }

    function cleanup() {
      options?.signal?.removeEventListener("abort", onAbort);
    }

    options?.signal?.addEventListener("abort", onAbort);

    p.then(
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
