import { assert } from "@std/assert";
import { isObjectDeepPrimitive, isObjectPrimitive } from "./check.ts";

Deno.test("isObjectPlain() works", () => {
  assert(isObjectPrimitive({ x: 42 }));

  assert(!isObjectPrimitive(42));
  assert(!isObjectPrimitive("abc"));
  assert(!isObjectPrimitive(new Date()));
  assert(!isObjectPrimitive(new Map()));
});

Deno.test("isObjectDeepPlain() works", () => {
  assert(isObjectDeepPrimitive({ x: 42 }));
  assert(isObjectDeepPrimitive({ x: 42, y: { z: 42 } }));

  assert(!isObjectDeepPrimitive({ x: 42, d: new Date() }));
});
