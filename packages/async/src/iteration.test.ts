import { expect, test } from "vitest";

import { AbortError, TimeoutError } from "./errors";
import { map } from "./map";
import { reduce } from "./reduce";
import { Skip } from "./types";
import { wait } from "./wait";

test("map preserves order", async () => {
  const result = await map([3, 1, 2], async (x) => {
    await new Promise((r) => setTimeout(r, x * 10));
    return x * 2;
  });
  expect(result).toEqual([6, 2, 4]);
});

test("map with concurrency", async () => {
  let active = 0;
  let maxActive = 0;
  const result = await map(
    [1, 2, 3, 4, 5],
    async (x) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return x;
    },
    { concurrency: 2 },
  );
  expect(result).toEqual([1, 2, 3, 4, 5]);
  expect(maxActive).toBeLessThanOrEqual(2);
});

test("map with Skip", async () => {
  const result = await map([1, 2, 3, 4, 5], (x) => {
    if (x % 2 === 0) return Skip;
    return x;
  });
  expect(result).toEqual([1, 3, 5]);
});

test("map stopOnError: true (default)", async () => {
  await expect(
    map([1, 2, 3], async (x) => {
      if (x === 2) throw new Error("fail");
      return x;
    }),
  ).rejects.toThrow("fail");
});

test("map stopOnError: false collects errors", async () => {
  await expect(
    map(
      [1, 2, 3],
      async (x) => {
        if (x === 2) throw new Error("fail");
        return x;
      },
      { stopOnError: false },
    ),
  ).rejects.toBeInstanceOf(AggregateError);
});

test("map with abort", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    map([1, 2, 3], async (x) => x, { signal: controller.signal }),
  ).rejects.toBeInstanceOf(AbortError);
});

test("map with empty input", async () => {
  const result = await map([], async (x) => x);
  expect(result).toEqual([]);
});

test("map with async iterable", async () => {
  async function* gen() {
    yield 1;
    yield 2;
    yield 3;
  }
  const result = await map(gen(), async (x) => x * 2);
  expect(result).toEqual([2, 4, 6]);
});

test("map with promise input", async () => {
  const result = await map(Promise.resolve([1, 2, 3]), async (x) => x * 10);
  expect(result).toEqual([10, 20, 30]);
});

test("reduce works serially", async () => {
  const result = await reduce([1, 2, 3, 4], async (acc, item) => acc + item, 0);
  expect(result).toBe(10);
});

test("reduce with async iterable", async () => {
  async function* gen() {
    yield "a";
    yield "b";
    yield "c";
  }
  const result = await reduce(gen(), async (acc, item) => acc + item, "");
  expect(result).toBe("abc");
});

test("reduce with abort", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    reduce([1, 2, 3], async (acc, item) => acc + item, 0, {
      signal: controller.signal,
    }),
  ).rejects.toBeInstanceOf(AbortError);
});

test("wait resolves when predicate is true", async () => {
  let count = 0;
  await wait(
    () => {
      count++;
      return count >= 3;
    },
    { interval: 10 },
  );
  expect(count).toBe(3);
});

test("wait throws on timeout", async () => {
  await expect(
    wait(() => false, { interval: 10, timeout: 50 }),
  ).rejects.toBeInstanceOf(TimeoutError);
});

test("wait aborts", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    wait(() => false, { signal: controller.signal }),
  ).rejects.toBeInstanceOf(AbortError);
});
