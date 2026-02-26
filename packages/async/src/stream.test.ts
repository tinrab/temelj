import { expect, test } from "vitest";

import { debounce } from "./debounce";
import { delay } from "./delay";
import { AsyncStream } from "./stream";
import { throttle } from "./throttle";

test("debounce delays execution", async () => {
  let callCount = 0;
  const fn = debounce(async (n: number) => {
    callCount++;
    return n;
  }, 50);

  fn(1);
  fn(2);
  const p3 = fn(3);

  const result = await p3;
  expect(result).toBe(3);
  await delay(60);
  expect(callCount).toBe(1);
});

test("debounce leading edge", async () => {
  let callCount = 0;
  const fn = debounce(
    async (n: number) => {
      callCount++;
      return n;
    },
    50,
    { leading: true, trailing: false },
  );

  const result = await fn(1);
  expect(result).toBe(1);
  expect(callCount).toBe(1);
});

test("throttle limits call frequency", async () => {
  let callCount = 0;
  const fn = throttle(async (n: number) => {
    callCount++;
    return n;
  }, 50);

  const r1 = await fn(1);
  expect(r1).toBe(1);
  expect(callCount).toBe(1);

  fn(2);
  const p3 = fn(3);
  const r3 = await p3;
  expect(r3).toBe(3);
  await delay(60);
  expect(callCount).toBe(2);
});

test("AsyncStream.from().map().toArray()", async () => {
  const result = await AsyncStream.from([1, 2, 3])
    .map(async (x) => x * 2)
    .toArray();
  expect(result).toEqual([2, 4, 6]);
});

test("AsyncStream.from().filter().toArray()", async () => {
  const result = await AsyncStream.from([1, 2, 3, 4, 5])
    .filter((x) => x % 2 !== 0)
    .toArray();
  expect(result).toEqual([1, 3, 5]);
});

test("AsyncStream.from().map().filter().toArray()", async () => {
  const result = await AsyncStream.from([1, 2, 3, 4])
    .map(async (x) => x * 10)
    .filter((x) => x > 20)
    .toArray();
  expect(result).toEqual([30, 40]);
});

test("AsyncStream forEach", async () => {
  const results: number[] = [];
  await AsyncStream.from([1, 2, 3]).forEach((x) => {
    results.push(x);
  });
  expect(results).toEqual([1, 2, 3]);
});

test("AsyncStream reduce", async () => {
  const result = await AsyncStream.from([1, 2, 3, 4]).reduce(
    async (acc, x) => acc + x,
    0,
  );
  expect(result).toBe(10);
});

test("AsyncStream drain", async () => {
  let sideEffect = 0;
  await AsyncStream.from([1, 2, 3])
    .map(async (x) => {
      sideEffect += x;
      return x;
    })
    .drain();
  expect(sideEffect).toBe(6);
});

test("AsyncStream with async iterable source", async () => {
  async function* gen() {
    yield 10;
    yield 20;
    yield 30;
  }
  const result = await AsyncStream.from(gen())
    .map(async (x) => x + 1)
    .toArray();
  expect(result).toEqual([11, 21, 31]);
});

test("AsyncStream with concurrency", async () => {
  let active = 0;
  let maxActive = 0;

  const result = await AsyncStream.from([1, 2, 3, 4, 5])
    .map(
      async (x) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await delay(10);
        active--;
        return x;
      },
      { concurrency: 2 },
    )
    .toArray();

  expect(result).toEqual([1, 2, 3, 4, 5]);
  expect(maxActive).toBeLessThanOrEqual(2);
});
