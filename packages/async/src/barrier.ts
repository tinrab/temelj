import { AbortError, AsyncOptionsError } from "./errors";

/**
 * A synchronization barrier that waits until a specified number of tasks have called `wait`.
 * Once the capacity is reached, all waiting tasks are released simultaneously.
 */
export class Barrier {
  #capacity: number;
  #count = 0;
  #waiters: Array<{
    resolve: () => void;
    reject: (reason?: unknown) => void;
  }> = [];

  constructor(capacity: number) {
    if (capacity < 1) {
      AsyncOptionsError.barrierCapacity();
    }
    this.#capacity = capacity;
  }

  /**
   * Waits until the required number of tasks have reached the barrier.
   *
   * @param signal - Optional AbortSignal to cancel waiting.
   * @throws {AbortError} if the signal is aborted while waiting.
   */
  wait(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(AbortError.create());
    }

    this.#count++;

    if (this.#count >= this.#capacity) {
      for (const waiter of this.#waiters) {
        waiter.resolve();
      }
      this.#waiters = [];
      this.#count = 0;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };

      if (signal) {
        const onAbort = () => {
          const index = this.#waiters.indexOf(waiter);
          if (index !== -1) {
            this.#waiters.splice(index, 1);
            this.#count--;
          }
          reject(AbortError.create());
        };
        signal.addEventListener("abort", onAbort, { once: true });

        const originalResolve = resolve;
        waiter.resolve = () => {
          signal.removeEventListener("abort", onAbort);
          originalResolve();
        };
      }

      this.#waiters.push(waiter);
    });
  }
}
