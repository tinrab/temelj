import { expect, test } from "vitest";

import { Barrier } from "./barrier";
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

  q.add(async () => {
    results.push(1);
    return 1;
  });
  q.add(async () => {
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

test("Queue clear", async () => {
  const q = new Queue({ concurrency: 1 });
  q.add(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });
  q.add(async () => "should not run");
  q.add(async () => "should not run");
  expect(q.size).toBe(2);
  q.clear();
  expect(q.size).toBe(0);
});

test("Queue onIdle resolves when empty", async () => {
  const q = new Queue({ concurrency: 1 });
  await q.onIdle;
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
  await expect(
    retry(async () => "ok", { signal: controller.signal }),
  ).rejects.toBeInstanceOf(AbortError);
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
      delay: (att) => {
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
