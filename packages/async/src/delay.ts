import { AbortError } from "./errors";
import type { StandardOptions } from "./types";

/**
 * Resolves after the specified duration in milliseconds.
 * Rejects immediately with {@link AbortError} if the signal is already aborted or becomes aborted.
 */
export function delay(ms: number, options?: StandardOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new AbortError());
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      cleanup();
      reject(new AbortError());
    }

    function cleanup() {
      options?.signal?.removeEventListener("abort", onAbort);
    }

    options?.signal?.addEventListener("abort", onAbort);
  });
}
