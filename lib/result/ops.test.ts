import { assert } from "@std/assert";
import { err, isErr, isOk, ok } from "./ops.ts";

Deno.test("result", () => {
  assert(isOk(ok(42)));
  assert(!isOk(err(42)));

  assert(isErr(err("a")));
  assert(!isErr(ok(42)));
});
