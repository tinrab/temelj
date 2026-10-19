import type { StandardOptions } from "./types";

import { delay } from "./delay";
import { AbortError } from "./errors";

export interface RetryOptions extends StandardOptions {
  /** Maximum number of attempts. Default: 3. */
  times?: number;
  /** Fixed delay between retries in milliseconds. */
  delay?: number;
  /** Computes the delay from the attempt number, overriding the fixed delay. */
  backoff?: (attempt: number) => number;
  /** Predicate to decide whether to retry on a given error. */
  shouldRetry?: (cause: unknown) => boolean;
}

/**
 * Retries a function upon failure with configurable backoff.
 *
 * @param fn - The async function to retry. Receives the current attempt number (0-indexed).
 * @param options - Retry configuration options.
 * @throws The last error if all attempts are exhausted.
 * @throws {AbortError} if the signal is aborted.
 */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const signal = options?.signal;
  const times = options?.times ?? 3;
  const shouldRetry = options?.shouldRetry;

  let lastError: unknown;

  for (let attempt = 0; attempt < times; attempt++) {
    if (signal?.aborted) {
      AbortError.aborted();
    }

    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      if (shouldRetry && !shouldRetry(error)) {
        throw error;
      }

      if (attempt < times - 1) {
        const ms = options?.backoff?.(attempt) ?? options?.delay ?? 0;

        if (ms > 0) {
          await delay(ms, { signal });
        }
      }
    }
  }

  throw lastError;
}
