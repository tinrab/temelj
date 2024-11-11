import { assertEquals, assertThrows } from "@std/assert";

import { getStringHelpers } from "./string.ts";
import { Registry } from "../registry.ts";

Deno.test("Handlebars string helpers", () => {
  const r = new Registry();
  r.registerHelpers(getStringHelpers());

  assertEquals(r.renderTemplate(`{{splitPart "a/b/c" 1}}`), "b");
  assertEquals(r.renderTemplate(`{{splitPartSegment "a/b/c" 1 2}}`), "b/c");
  assertEquals(r.renderTemplate(`{{splitPartSegment "a_b_c" 1 2 "_"}}`), "b_c");

  assertThrows(
    () => r.renderTemplate(`{{splitPartSegment "a/b/c" 0}}`),
    Error,
    "Required",
  );
});
