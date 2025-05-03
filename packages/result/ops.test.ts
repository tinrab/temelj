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
  function _demo(): Result<number, number> {
    const res: Result<number, string> = ok(42);
    if (isErr(res)) {
      return mapErr(res, (err) => err.length);
    }
    return ok(0);
  }
});
