import { AbortError } from "./errors";

/**
 * A mutual exclusion lock that ensures only one task accesses a resource at a time.
 */
export class Mutex {
  #locked = false;
  #waiting: Array<{
    resolve: (release: () => void) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  /**
   * Acquires the lock. Returns a release function that must be called to unlock.
   *
   * @param signal - Optional AbortSignal to cancel waiting for the lock.
   * @throws {AbortError} if the signal is aborted while waiting.
   */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      return Promise.reject(new AbortError());
    }

    if (!this.#locked) {
      this.#locked = true;
      return Promise.resolve(this._createRelease());
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter = { resolve, reject };

      if (signal) {
        const onAbort = () => {
          const index = this.#waiting.indexOf(waiter);
          if (index !== -1) {
            this.#waiting.splice(index, 1);
          }
          reject(new AbortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });

        const originalResolve = resolve;
        waiter.resolve = (release) => {
          signal.removeEventListener("abort", onAbort);
          originalResolve(release);
        };
      }

      this.#waiting.push(waiter);
    });
  }

  /**
   * Acquires the lock, runs the function exclusively, and automatically releases the lock.
   *
   * @param fn - The function to run exclusively.
   * @param signal - Optional AbortSignal to cancel waiting for the lock.
   */
  async runExclusive<T>(
    fn: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const release = await this.acquire(signal);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private _createRelease(): () => void {
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      if (this.#waiting.length > 0) {
        const next = this.#waiting.shift();
        next?.resolve(this._createRelease());
      } else {
        this.#locked = false;
      }
    };
  }
}
