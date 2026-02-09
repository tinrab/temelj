import { type Deferred, defer } from "./defer";
import { AbortError } from "./errors";

interface QueueTask {
  fn: () => Promise<unknown>;
  priority: number;
  signal?: AbortSignal;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
}

interface QueueOptions {
  concurrency?: number;
  autoStart?: boolean;
}

interface AddOptions {
  priority?: number;
  signal?: AbortSignal;
}

/**
 * A class-based task runner with priority support and concurrency control.
 */
export class Queue {
  #concurrency: number;
  #pending: QueueTask[] = [];
  #activeCount = 0;
  #paused: boolean;
  #idleDeferred?: Deferred<void>;

  constructor(options?: QueueOptions) {
    this.#concurrency = options?.concurrency ?? Number.POSITIVE_INFINITY;
    this.#paused = options?.autoStart === false;
  }

  /**
   * Adds a task to the queue. Supports optional priority (higher executes sooner).
   */
  add<T>(fn: () => Promise<T>, options?: AddOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) {
        reject(new AbortError());
        return;
      }

      const task: QueueTask = {
        fn: fn as () => Promise<unknown>,
        priority: options?.priority ?? 0,
        signal,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      if (signal) {
        const onAbort = () => {
          const index = this.#pending.indexOf(task);
          if (index !== -1) {
            this.#pending.splice(index, 1);
          }
          reject(new AbortError());
        };
        signal.addEventListener("abort", onAbort, { once: true });

        const originalResolve = task.resolve;
        task.resolve = (value) => {
          signal.removeEventListener("abort", onAbort);
          originalResolve(value);
        };

        const originalReject = task.reject;
        task.reject = (reason) => {
          signal.removeEventListener("abort", onAbort);
          originalReject(reason);
        };
      }

      this._enqueue(task);
      this._tryRun();
    });
  }

  /**
   * Adds multiple tasks to the queue.
   */
  addAll<T>(fns: (() => Promise<T>)[], options?: AddOptions): Promise<T[]> {
    return Promise.all(fns.map((fn) => this.add(fn, options)));
  }

  /**
   * Pauses execution. Active tasks continue, pending tasks wait.
   */
  pause(): void {
    this.#paused = true;
  }

  /**
   * Resumes execution of pending tasks.
   */
  resume(): void {
    this.#paused = false;
    this._tryRun();
  }

  /**
   * Clears all pending tasks. Active tasks are not affected.
   */
  clear(): void {
    this.#pending = [];
  }

  /**
   * Number of items waiting to run.
   */
  get size(): number {
    return this.#pending.length;
  }

  /**
   * Number of items currently running.
   */
  get pending(): number {
    return this.#activeCount;
  }

  /**
   * Promise that resolves when the queue is empty and all tasks have completed.
   */
  get onIdle(): Promise<void> {
    if (this.#activeCount === 0 && this.#pending.length === 0) {
      return Promise.resolve();
    }
    if (!this.#idleDeferred) {
      this.#idleDeferred = defer<void>();
    }
    return this.#idleDeferred.promise;
  }

  private _enqueue(task: QueueTask): void {
    let inserted = false;
    for (let i = 0; i < this.#pending.length; i++) {
      if (task.priority > this.#pending[i].priority) {
        this.#pending.splice(i, 0, task);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.#pending.push(task);
    }
  }

  private _tryRun(): void {
    if (this.#paused) return;

    while (this.#activeCount < this.#concurrency && this.#pending.length > 0) {
      const task = this.#pending.shift();
      if (!task) break;

      if (task.signal?.aborted) {
        task.reject(new AbortError());
        continue;
      }

      this.#activeCount++;
      this._runTask(task);
    }
  }

  private _runTask(task: QueueTask): void {
    let aborted = false;

    function onAbort() {
      aborted = true;
    }

    task.signal?.addEventListener("abort", onAbort, { once: true });

    task.fn().then(
      (value) => {
        task.signal?.removeEventListener("abort", onAbort);
        this.#activeCount--;
        if (aborted) {
          task.reject(new AbortError());
        } else {
          task.resolve(value);
        }
        this._tryRun();
        this._checkIdle();
      },
      (error) => {
        task.signal?.removeEventListener("abort", onAbort);
        this.#activeCount--;
        task.reject(error);
        this._tryRun();
        this._checkIdle();
      },
    );
  }

  private _checkIdle(): void {
    if (this.#activeCount === 0 && this.#pending.length === 0) {
      this.#idleDeferred?.resolve();
      this.#idleDeferred = undefined;
    }
  }
}
