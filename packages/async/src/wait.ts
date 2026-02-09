import { AbortError, TimeoutError } from "./errors";
import type { StandardOptions } from "./types";

/**
 * Waits until a predicate returns `true`, polling at a configurable interval.
 *
 * @throws {TimeoutError} if the predicate does not return `true` within the timeout.
 * @throws {AbortError} if the signal is aborted.
 */
export async function wait(
  predicate: () => Promise<boolean> | boolean,
  options?: StandardOptions & {
    interval?: number;
    timeout?: number;
  },
): Promise<void> {
  const signal = options?.signal;
  const interval = options?.interval ?? 100;
  const timeoutMs = options?.timeout;

  if (signal?.aborted) {
    throw new AbortError();
  }

  const start = Date.now();

  while (true) {
    if (signal?.aborted) {
      throw new AbortError();
    }

    if (timeoutMs !== undefined && Date.now() - start >= timeoutMs) {
      throw new TimeoutError("Wait timed out");
    }

    const result = await predicate();
    if (result) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortError());
        return;
      }

      const timer = setTimeout(() => {
        cleanupSignal();
        resolve();
      }, interval);

      function onAbort() {
        clearTimeout(timer);
        cleanupSignal();
        reject(new AbortError());
      }

      function cleanupSignal() {
        signal?.removeEventListener("abort", onAbort);
      }

      signal?.addEventListener("abort", onAbort);
    });
  }
}
