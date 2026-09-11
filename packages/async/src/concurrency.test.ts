import { expect, test } from "vitest";

import { Barrier } from "./barrier";
import { defer } from "./defer";
import { AbortError } from "./errors";
import { limit } from "./limit";
import { Mutex } from "./mutex";
import { Queue } from "./queue";
import { retry } from "./retry";

test("Queue runs tasks with concurrency", async () => {
  const q = new Queue({ concurrency: 2 });
  let active = 0;
  let maxActive = 0;
  const results: number[] = [];

  const tasks = [1, 2, 3, 4].map((n) =>
    q.add(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      results.push(n);

      return n;
    }),
  );

  const values = await Promise.all(tasks);
  expect(values).toEqual([1, 2, 3, 4]);
  expect(maxActive).toBeLessThanOrEqual(2);
});

test("Queue respects priority", async () => {
  const q = new Queue({ concurrency: 1 });
  const order: number[] = [];

  const first = q.add(async () => {
    await new Promise((r) => setTimeout(r, 50));
    order.push(0);
  });

  const lowPri = q.add(
    async () => {
      order.push(1);
    },
    { priority: 0 },
  );

  const highPri = q.add(
    async () => {
      order.push(2);
    },
    { priority: 10 },
  );

  await Promise.all([first, lowPri, highPri]);
  expect(order).toEqual([0, 2, 1]);
});

test("Queue pause/resume", async () => {
  const q = new Queue({ concurrency: 1, autoStart: false });
  const results: number[] = [];

  void q.add(async () => {
    results.push(1);

    return 1;
  });
  void q.add(async () => {
    results.push(2);

    return 2;
  });

  expect(q.size).toBe(2);
  expect(results).toEqual([]);

  q.resume();
  await q.onIdle;
  expect(results).toEqual([1, 2]);
});

test("Queue addAll", async () => {
  const q = new Queue({ concurrency: 2 });
  const results = await q.addAll([async () => 1, async () => 2, async () => 3]);
  expect(results).toEqual([1, 2, 3]);
});

test("Queue clear rejects pending work and settles idle waiters", async () => {
  const queue = new Queue({ autoStart: false });
  let started = false;

  const pending = queue.add(() => {
    started = true;
  });

  const rejected = pending.catch((cause: unknown) => cause);
  const idle = queue.onIdle;
  queue.clear();
  expect(await rejected).toBeInstanceOf(AbortError);
  await idle;
  expect(queue.size).toBe(0);
  expect(started).toBe(false);
});

test("Queue snapshots follow execution, cancellation, and subscription cleanup", async () => {
  const queue = new Queue({ concurrency: 1 });
  const snapshots: ReturnType<typeof queue.getSnapshot>[] = [];
  const unsubscribe = queue.subscribe(() => snapshots.push(queue.getSnapshot()));
  const first = defer<string>();
  const running = queue.add(() => first.promise);
  const waiting = queue.add(() => 42);
  expect(queue.getSnapshot()).toEqual({ size: 1, pending: 1, paused: false });
  const current = queue.getSnapshot();
  expect(queue.getSnapshot()).toBe(current);
  first.resolve("done");
  await Promise.all([running, waiting]);
  await queue.onIdle;
  expect(snapshots).toContainEqual({ size: 0, pending: 1, paused: false });
  expect(queue.getSnapshot()).toEqual({ size: 0, pending: 0, paused: false });
  const count = snapshots.length;
  unsubscribe();
  queue.pause();
  expect(snapshots).toHaveLength(count);
});

test("Queue onIdle resolves when empty", async () => {
  const q = new Queue({ concurrency: 1 });
  await q.onIdle;
  expect(q.size).toBe(0);
});

test("Queue retains distinct task result types", async () => {
  const queue = new Queue({ concurrency: 2 });

  const number = queue.add(() => 42);
  const text = queue.add(() => "ready");

  expect(await number).toBe(42);
  expect(await text).toBe("ready");
  await queue.onIdle;
});

test("Queue settles idle waiters when pending work is aborted", async () => {
  const queue = new Queue({ autoStart: false });
  const controller = new AbortController();
  let started = false;

  const result = queue.add(
    () => {
      started = true;

      return 42;
    },
    { signal: controller.signal },
  );

  const rejected = result.catch((cause: unknown) => cause);
  const idle = queue.onIdle;

  controller.abort();
  expect(await rejected).toBeInstanceOf(AbortError);
  await idle;
  expect(started).toBe(false);
  expect(queue.size).toBe(0);
});

test("Queue waits for running work after aborting its result", async () => {
  const queue = new Queue({ concurrency: 1 });
  const controller = new AbortController();
  const work = defer<number>();
  const result = queue.add(() => work.promise, { signal: controller.signal });
  const rejected = result.catch((cause: unknown) => cause);

  controller.abort();
  expect(await rejected).toBeInstanceOf(AbortError);
  expect(queue.pending).toBe(1);
  work.resolve(42);
  await queue.onIdle;
  expect(queue.pending).toBe(0);
});

test("limit enforces concurrency", async () => {
  let active = 0;
  let maxActive = 0;

  const limited = limit(async (n: number) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 20));
    active--;

    return n * 2;
  }, 2);

  const results = await Promise.all([1, 2, 3, 4, 5].map((n) => limited(n)));
  expect(results).toEqual([2, 4, 6, 8, 10]);
  expect(maxActive).toBeLessThanOrEqual(2);
});

test("retry succeeds on nth attempt", async () => {
  let attempt = 0;

  const result = await retry(
    async () => {
      attempt++;

      if (attempt < 3) throw new Error("not yet");

      return "ok";
    },
    { times: 3 },
  );

  expect(result).toBe("ok");
  expect(attempt).toBe(3);
});

test("retry fails after max attempts", async () => {
  await expect(
    retry(
      async () => {
        throw new Error("fail");
      },
      { times: 2 },
    ),
  ).rejects.toThrow("fail");
});

test("retry with delay", async () => {
  let attempt = 0;
  const start = Date.now();

  const result = await retry(
    async () => {
      attempt++;

      if (attempt < 2) throw new Error("not yet");

      return "ok";
    },
    { times: 3, delay: 30 },
  );

  expect(result).toBe("ok");
  expect(Date.now() - start).toBeGreaterThanOrEqual(20);
});

test("retry with shouldRetry", async () => {
  await expect(
    retry(
      async () => {
        throw new Error("fatal");
      },
      { times: 5, shouldRetry: () => false },
    ),
  ).rejects.toThrow("fatal");
});

test("retry with abort", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(retry(async () => "ok", { signal: controller.signal })).rejects.toBeInstanceOf(
    AbortError,
  );
});

test("retry with backoff function", async () => {
  let attempt = 0;
  const delays: number[] = [];
  await retry(
    async () => {
      attempt++;

      if (attempt < 3) throw new Error("not yet");

      return "ok";
    },
    {
      times: 3,
      backoff: (att) => {
        const d = (att + 1) * 10;
        delays.push(d);

        return d;
      },
    },
  );
  expect(delays).toEqual([10, 20]);
});

test("Mutex provides exclusive access", async () => {
  const mutex = new Mutex();
  const order: string[] = [];

  const task = async (name: string, duration: number) => {
    const release = await mutex.acquire();
    order.push(`${name}-start`);
    await new Promise((r) => setTimeout(r, duration));
    order.push(`${name}-end`);
    release();
  };

  await Promise.all([task("a", 30), task("b", 10)]);
  expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
});

test("Mutex runExclusive", async () => {
  const mutex = new Mutex();
  const result = await mutex.runExclusive(async () => 42);
  expect(result).toBe(42);
});

test("Mutex acquire with abort", async () => {
  const mutex = new Mutex();
  await mutex.acquire(); // lock it

  const controller = new AbortController();
  const p = mutex.acquire(controller.signal);
  controller.abort();
  await expect(p).rejects.toBeInstanceOf(AbortError);
});

test("Barrier releases when capacity reached", async () => {
  const barrier = new Barrier(3);
  const results: number[] = [];

  const tasks = [1, 2, 3].map((n) =>
    (async () => {
      await barrier.wait();
      results.push(n);
    })(),
  );

  await Promise.all(tasks);
  expect(results.length).toBe(3);
});

test("Barrier rejects on invalid capacity", () => {
  expect(() => new Barrier(0)).toThrow(RangeError);
});

test("Barrier abort while waiting", async () => {
  const barrier = new Barrier(3);
  const controller = new AbortController();

  const p = barrier.wait(controller.signal);
  controller.abort();
  await expect(p).rejects.toBeInstanceOf(AbortError);
});
