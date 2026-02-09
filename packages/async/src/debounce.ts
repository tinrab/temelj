import { type Deferred, defer } from "./defer";
import { AbortError } from "./errors";

interface DebounceOptions {
  /** Fire on the leading edge. Default: false. */
  leading?: boolean;
  /** Fire on the trailing edge. Default: true. */
  trailing?: boolean;
  /** Optional AbortSignal to cancel debouncing. */
  signal?: AbortSignal;
}

/**
 * Creates a debounced function that delays invoking `fn` until
 * after `waitMs` milliseconds have elapsed since the last time the debounced
 * function was invoked.
 */
export function debounce<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  waitMs: number,
  options?: DebounceOptions,
): (...args: Args) => Promise<R> {
  const leading = options?.leading ?? false;
  const trailing = options?.trailing ?? true;
  const signal = options?.signal;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingDeferred: Deferred<R> | undefined;
  let latestArgs: Args | undefined;
  let isLeadingInvoked = false;

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
    isLeadingInvoked = false;
  };

  signal?.addEventListener("abort", onAbort, { once: true });

  return (...args: Args): Promise<R> => {
    if (signal?.aborted) {
      return Promise.reject(new AbortError());
    }

    latestArgs = args;

    if (timer !== undefined) {
      clearTimeout(timer);
    }

    if (!pendingDeferred) {
      pendingDeferred = defer<R>();
    }

    const currentDeferred = pendingDeferred;

    if (leading && !isLeadingInvoked) {
      isLeadingInvoked = true;
      fn(...args).then(
        (value) => currentDeferred.resolve(value),
        (error) => currentDeferred.reject(error),
      );
    }

    timer = setTimeout(() => {
      timer = undefined;
      isLeadingInvoked = false;

      if (trailing && latestArgs) {
        const d = pendingDeferred;
        if (!d) return;
        pendingDeferred = undefined;
        if (!leading || latestArgs !== args) {
          fn(...latestArgs).then(
            (value) => d.resolve(value),
            (error) => d.reject(error),
          );
        }
        latestArgs = undefined;
      } else {
        pendingDeferred = undefined;
        latestArgs = undefined;
      }
    }, waitMs);

    return currentDeferred.promise;
  };
}
