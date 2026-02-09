import { type Deferred, defer } from "./defer";
import { AbortError } from "./errors";
import type { StandardOptions } from "./types";

/**
 * Returns a wrapper around `fn` that enforces concurrency limits.
 * All calls to the wrapper share the same concurrency pool.
 */
export function limit<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  concurrency: number,
  options?: StandardOptions,
): (...args: Args) => Promise<R> {
  const signal = options?.signal;
  let activeCount = 0;
  const waiting: Array<{
    run: () => void;
    reject: (reason?: unknown) => void;
  }> = [];

  return (...args: Args): Promise<R> => {
    if (signal?.aborted) {
      return Promise.reject(new AbortError());
    }

    const deferred = defer<R>() as {
      -readonly [P in keyof Deferred<R>]: Deferred<R>[P];
    };

    const run = () => {
      activeCount++;
      fn(...args).then(
        (value) => {
          activeCount--;
          deferred.resolve(value);
          if (waiting.length > 0) {
            waiting.shift()?.run();
          }
        },
        (error) => {
          activeCount--;
          deferred.reject(error);
          if (waiting.length > 0) {
            waiting.shift()?.run();
          }
        },
      );
    };

    if (activeCount < concurrency) {
      run();
    } else {
      const waiter = { run, reject: deferred.reject };
      waiting.push(waiter);

      if (signal) {
        const onAbort = () => {
          const index = waiting.indexOf(waiter);
          if (index !== -1) {
            waiting.splice(index, 1);
          }
          deferred.reject(new AbortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });

        const originalResolve = deferred.resolve;
        deferred.resolve = (value) => {
          signal.removeEventListener("abort", onAbort);
          originalResolve(value);
        };

        const originalReject = deferred.reject;
        deferred.reject = (reason) => {
          signal.removeEventListener("abort", onAbort);
          originalReject(reason);
        };
      }
    }

    return deferred.promise;
  };
}
