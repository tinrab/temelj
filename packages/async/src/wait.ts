import type { StandardOptions } from "./types";

import { AbortError, TimeoutError } from "./errors";

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
  const timeout = options?.timeout;

  if (signal?.aborted) {
    AbortError.aborted();
  }

  const start = Date.now();

  while (true) {
    if (signal?.aborted) {
      AbortError.aborted();
    }

    if (timeout !== undefined && Date.now() - start >= timeout) {
      TimeoutError.timedOut("Wait timed out");
    }

    const result = await predicate();
    if (result) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(AbortError.create());
        return;
      }

      const timer = setTimeout(() => {
        cleanupSignal();
        resolve();
      }, interval);

      function onAbort() {
        clearTimeout(timer);
        cleanupSignal();
        reject(AbortError.create());
      }

      function cleanupSignal() {
        signal?.removeEventListener("abort", onAbort);
      }

      signal?.addEventListener("abort", onAbort);
    });
  }
}
