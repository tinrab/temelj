type QueuedPromise<T> = {
  promise: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

export class PromiseQueue<T = void> {
  public busy: boolean;
  private readonly queue: QueuedPromise<T>[];

  constructor() {
    this.queue = [];
    this.busy = false;
  }

  public enqueue(promise: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        promise,
        resolve,
        reject,
      });
      this.dequeue();
    });
  }

  public dequeue(): boolean {
    if (this.busy) {
      return false;
    }

    const item = this.queue.shift();
    if (!item) {
      return false;
    }

    try {
      this.busy = true;
      item
        .promise()
        .then((value) => {
          this.busy = false;
          item.resolve(value);
          this.dequeue();
        })
        .catch((err) => {
          this.busy = false;
          item.reject(err);
          this.dequeue();
        });
    } catch (err) {
      this.busy = false;
      item.reject(err);
      this.dequeue();
    }

    return true;
  }
}
