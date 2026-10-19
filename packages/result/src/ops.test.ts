import { expect, expectTypeOf, test, vi } from "vitest";

import type { Result } from "./types";

import {
  err,
  fromPromise,
  fromThrowable,
  isErr,
  isOk,
  mapErr,
  ok,
  unwrap,
  unwrapErr,
  unwrapOr,
  unwrapOrElse,
} from "./ops";

test("make result", () => {
  expect(isOk(ok(42))).toBe(true);
  expect(isOk(err(42))).toBe(false);

  expect(isErr(err("a"))).toBe(true);
  expect(isErr(ok(42))).toBe(false);
});

test("map error type predicate", () => {
  type ResultA = Result<"A", string>;

  function _demo1(res: Result<number, string>): Result<number, number> {
    if (isErr(res)) {
      return mapErr(res, (err) => err.length);
    }

    return ok(0);
  }

  function _demo2(res: ResultA): Result<"B", number> {
    if (isErr(res)) {
      return mapErr(res, (err) => err.length);
    }

    return ok("B");
  }

  expect(unwrap(_demo1(ok(42)))).toBe(0);
  expect(unwrap(_demo2(ok("A")))).toBe("B");
  expect(unwrapErr(_demo1(err("abc")))).toBe(3);
  expect(unwrapErr(_demo2(err("abc")))).toBe(3);
  expectTypeOf(mapErr(ok(42), String)).toEqualTypeOf<Result<number, string>>();
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
  expect(unwrapErr(resErr)).toEqual(new Error("boom"));

  // Failure case (mapped)
  const resErrMapped = fromThrowable(
    () => {
      throw new Error("boom");
    },
    (cause) => {
      if (!(cause instanceof Error)) {
        throw cause;
      }

      return cause.message.toUpperCase();
    },
  );

  expect(isErr(resErrMapped)).toBe(true);
  expect(unwrapErr(resErrMapped)).toBe("BOOM");
});

test("unwrap defaults distinguish values from lazy computation", () => {
  const fallback = vi.fn<() => number>(() => 42);

  expect(unwrapOr(err("failure"), fallback)).toBe(fallback);
  expect(fallback).not.toHaveBeenCalled();
  expect(unwrapOrElse(ok(10), fallback)).toBe(10);
  expect(fallback).not.toHaveBeenCalled();
  expect(unwrapOrElse(err("failure"), fallback)).toBe(42);
  expect(fallback).toHaveBeenCalledOnce();
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
