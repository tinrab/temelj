import { type Deferred, defer } from "./defer";
import { AbortError } from "./errors";
import type { StandardOptions } from "./types";

/**
 * Creates an async-aware throttled function that only invokes `fn` at most
 * once per `intervalMs` milliseconds.
 */
export function throttle<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  intervalMs: number,
  options?: StandardOptions,
): (...args: Args) => Promise<R> {
  const signal = options?.signal;
  let lastCallTime = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingDeferred: Deferred<R> | undefined;
  let latestArgs: Args | undefined;

  function invoke(args: Args, d: Deferred<R>) {
    lastCallTime = Date.now();
    fn(...args).then(
      (value) => d.resolve(value),
      (error) => d.reject(error),
    );
  }

  const onAbort = () => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pendingDeferred) {
      pendingDeferred.reject(new AbortError());
      pendingDeferred = undefined;
    }
    latestArgs = undefined;
  };

  signal?.addEventListener("abort", onAbort, { once: true });

  return (...args: Args): Promise<R> => {
    if (signal?.aborted) {
      return Promise.reject(new AbortError());
    }

    const now = Date.now();
    const elapsed = now - lastCallTime;

    latestArgs = args;

    if (elapsed >= intervalMs) {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      const d = defer<R>();
      pendingDeferred = undefined;
      invoke(args, d);
      return d.promise;
    }

    if (!pendingDeferred) {
      pendingDeferred = defer<R>();
    }

    const currentDeferred = pendingDeferred;

    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        const d = pendingDeferred;
        pendingDeferred = undefined;
        if (d && latestArgs) {
          invoke(latestArgs, d);
          latestArgs = undefined;
        }
      }, intervalMs - elapsed);
    }

    return currentDeferred.promise;
  };
}
