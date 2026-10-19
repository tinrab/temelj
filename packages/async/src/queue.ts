import { type Deferred, defer } from "./defer";
import { AbortError } from "./errors";

interface QueueTask {
  run: () => Promise<void>;
  priority: number;
  signal?: AbortSignal;
  reject: (cause?: unknown) => void;
}

interface QueueOptions {
  concurrency?: number;
  autoStart?: boolean;
}

interface AddOptions {
  priority?: number;
  signal?: AbortSignal;
}

/** Current queue counts and execution state. */
export interface QueueState {
  readonly size: number;
  readonly pending: number;
  readonly paused: boolean;
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
  #listeners = new Set<() => void>();
  #snapshot: QueueState;

  constructor(options?: QueueOptions) {
    this.#concurrency = options?.concurrency ?? Number.POSITIVE_INFINITY;
    this.#paused = options?.autoStart === false;
    this.#snapshot = { size: 0, pending: 0, paused: this.#paused };
  }

  /** Returns the same snapshot until queue state changes. */
  getSnapshot = (): QueueState => this.#snapshot;

  /** Subscribes to changes in waiting tasks, active tasks, or pause state. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => {
      this.#listeners.delete(listener);
    };
  };

  /**
   * Adds a task to the queue. Supports optional priority (higher executes sooner).
   */
  add<T>(fn: () => PromiseLike<T> | T, options?: AddOptions): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const signal = options?.signal;

      if (signal?.aborted) {
        reject(AbortError.create());

        return;
      }

      const task: QueueTask = {
        run: async () => {
          const value = await fn();

          if (signal?.aborted) {
            AbortError.aborted();
          }

          resolve(value);
        },
        priority: options?.priority ?? 0,
        signal,
        reject,
      };

      if (signal) {
        const onAbort = () => {
          const index = this.#pending.indexOf(task);

          if (index !== -1) {
            this.#pending.splice(index, 1);
          }

          task.reject(AbortError.create());
          this._notify();
          this._checkIdle();
        };

        signal.addEventListener("abort", onAbort, { once: true });

        const run = task.run;
        task.run = () => run().finally(() => signal.removeEventListener("abort", onAbort));

        const originalReject = task.reject;
        task.reject = (reason) => {
          signal.removeEventListener("abort", onAbort);
          originalReject(reason);
        };
      }

      this._enqueue(task);
      this._tryRun();
      this._notify();
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
    this._notify();
  }

  /**
   * Resumes execution of pending tasks.
   */
  resume(): void {
    this.#paused = false;
    this._tryRun();
    this._notify();
  }

  /**
   * Rejects pending tasks with AbortError. Active tasks continue.
   */
  clear(): void {
    const tasks = this.#pending;
    this.#pending = [];

    for (const task of tasks) task.reject(AbortError.create());
    this._notify();
    this._checkIdle();
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
        task.reject(AbortError.create());
        continue;
      }

      this.#activeCount++;
      this._runTask(task);
    }
  }

  private _runTask(task: QueueTask): void {
    task.run().then(
      () => {
        this.#activeCount--;

        this._tryRun();
        this._notify();
        this._checkIdle();
      },
      (error) => {
        this.#activeCount--;
        task.reject(error);
        this._tryRun();
        this._notify();
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

  private _notify(): void {
    const next = { size: this.size, pending: this.pending, paused: this.#paused };

    if (
      next.size === this.#snapshot.size &&
      next.pending === this.#snapshot.pending &&
      next.paused === this.#snapshot.paused
    )
      return;
    this.#snapshot = next;

    for (const listener of this.#listeners) listener();
  }
}
