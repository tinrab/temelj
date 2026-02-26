import { expect, test } from "vitest";

import { defer } from "./defer";
import { delay } from "./delay";
import { AbortError, TimeoutError } from "./errors";
import { timeout } from "./timeout";

test("delay resolves after ms", async () => {
  const start = Date.now();
  await delay(50);
  expect(Date.now() - start).toBeGreaterThanOrEqual(40);
});

test("delay rejects on abort", async () => {
  const controller = new AbortController();
  const p = delay(1000, { signal: controller.signal });
  controller.abort();
  await expect(p).rejects.toBeInstanceOf(AbortError);
});

test("delay rejects immediately if already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    delay(1000, { signal: controller.signal }),
  ).rejects.toBeInstanceOf(AbortError);
});

test("timeout resolves if promise is fast", async () => {
  const result = await timeout(Promise.resolve(42), 1000);
  expect(result).toBe(42);
});

test("timeout rejects with TimeoutError if slow", async () => {
  await expect(timeout(new Promise(() => {}), 50)).rejects.toBeInstanceOf(
    TimeoutError,
  );
});

test("timeout accepts a factory function", async () => {
  const result = await timeout(() => Promise.resolve("ok"), 1000);
  expect(result).toBe("ok");
});

test("timeout returns fallback on timeout", async () => {
  const result = await timeout(new Promise(() => {}), 50, {
    fallback: "default",
  });
  expect(result).toBe("default");
});

test("timeout rejects on abort", async () => {
  const controller = new AbortController();
  const p = timeout(new Promise(() => {}), 5000, {
    signal: controller.signal,
  });
  controller.abort();
  await expect(p).rejects.toBeInstanceOf(AbortError);
});

test("defer resolves", async () => {
  const d = defer<number>();
  d.resolve(42);
  await expect(d.promise).resolves.toBe(42);
});

test("defer rejects", async () => {
  const d = defer<number>();
  d.reject(new Error("fail"));
  await expect(d.promise).rejects.toThrow("fail");
});
