import { expect, test } from "vitest";

import { err, isErr, isOk, mapErr, ok } from "./ops";
import type { Result } from "./types";

test("make result", () => {
  expect(isOk(ok(42)));
  expect(!isOk(err(42)));

  expect(isErr(err("a")));
  expect(!isErr(ok(42)));
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
});
