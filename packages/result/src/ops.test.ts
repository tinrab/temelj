import { expect, test } from "vitest";

import type { Result } from "./types";

import { err, fromPromise, fromThrowable, isErr, isOk, mapErr, ok, unwrap, unwrapErr } from "./ops";

test("make result", () => {
  expect(isOk(ok(42))).toBe(true);
  expect(isOk(err(42))).toBe(false);

  expect(isErr(err("a"))).toBe(true);
  expect(isErr(ok(42))).toBe(false);
});

test("map error type predicate", () => {
  type ResultA = Result<"A", string>;

  function _demo1(): Result<number, number> {
    const res = ok(42) as Result<number, string>;
    if (isErr(res)) {
      return mapErr(res, (err) => err.length);
    }
    return ok(0);
  }

  function _demo2(): Result<"B", number> {
    const res = ok("A") as ResultA;
    if (isErr(res)) {
      return mapErr(res, (err) => err.length);
    }
    return ok("B");
  }

  expect(unwrap(_demo1())).toBe(0);
  expect(unwrap(_demo2())).toBe("B");
});

test("fromThrowable (sync)", () => {
  // Success case
  const resOk = fromThrowable(() => 42);
  expect(isOk(resOk)).toBe(true);
  expect(unwrap(resOk)).toBe(42);

  // Failure case (default unknown)
  const resErr = fromThrowable(() => {
    throw new Error("boom");
  });
  expect(isErr(resErr)).toBe(true);
  expect((unwrapErr(resErr) as Error).message).toBe("boom");

  // Failure case (mapped)
  const resErrMapped = fromThrowable(
    () => {
      throw new Error("boom");
    },
    (e) => (e as Error).message.toUpperCase(),
  );
  expect(isErr(resErrMapped)).toBe(true);
  expect(unwrapErr(resErrMapped)).toBe("BOOM");
});

test("fromPromise (async)", async () => {
  // Success case
  const resOk = await fromPromise(() => Promise.resolve(42));
  expect(isOk(resOk)).toBe(true);
  expect(unwrap(resOk)).toBe(42);

  // Failure case (rejection)
  const resErr = await fromPromise(() => Promise.reject("fail"));
  expect(isErr(resErr)).toBe(true);
  expect(unwrapErr(resErr)).toBe("fail");

  // Failure case (sync throw inside async factory)
  const resSyncThrow = await fromPromise(async () => {
    throw "sync fail";
  });
  expect(isErr(resSyncThrow)).toBe(true);
  expect(unwrapErr(resSyncThrow)).toBe("sync fail");

  // Failure case (mapped)
  const resErrMapped = await fromPromise(
    () => Promise.reject("fail"),
    (e) => `Error: ${String(e)}`,
  );
  expect(isErr(resErrMapped)).toBe(true);
  expect(unwrapErr(resErrMapped)).toBe("Error: fail");
});
