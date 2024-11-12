import { assertEquals, assertThrows } from "@std/assert";

import { getStringHelpers } from "./string.ts";
import { Registry } from "../registry.ts";

Deno.test("Handlebars string helpers", () => {
  const r = new Registry();
  r.registerHelpers(getStringHelpers());

  assertEquals(r.render(`{{splitPart "a/b/c" 1}}`), "b");
  assertEquals(r.render(`{{splitPartSegment "a/b/c" 1 2}}`), "b/c");
  assertEquals(r.render(`{{splitPartSegment "a_b_c" 1 2 "_"}}`), "b_c");

  assertThrows(
    () => r.render(`{{splitPartSegment "a/b/c" 0}}`),
    Error,
    "Required",
  );

  assertEquals(
    r.render(`{{join (pascalCase "hello") ", World" "!"}}`),
    "Hello, World!",
  );
});
