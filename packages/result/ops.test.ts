import { assert } from "@std/assert";

import { err, isErr, isOk, mapErr, ok } from "./ops.ts";
import type { Result } from "./types.ts";

Deno.test(function makeResult(): void {
  assert(isOk(ok(42)));
  assert(!isOk(err(42)));

  assert(isErr(err("a")));
  assert(!isErr(ok(42)));
});

Deno.test(function mapErrorTypePredicate(): void {
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
