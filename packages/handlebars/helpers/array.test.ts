import { assertEquals, assertThrows } from "@std/assert";

import { Registry } from "../registry.ts";

Deno.test("Handlebars array helpers", () => {
  const r = new Registry().includeAllHelpers();

  assertEquals(r.render("{{array 1 2 3}}"), "1,2,3");
  assertEquals(r.render("{{arrayItemAt (array 1 2 3) 1}}"), "2");
  assertEquals(
    r.render("{{arrayContains (array 1 2 3) 2}}"),
    "true",
  );
  assertEquals(
    r.render("{{arrayContains (array 1 2 3) 4}}"),
    "false",
  );
  assertEquals(
    r.render(`{{arrayJoin (array 1 2 3) "|"}}`),
    "1|2|3",
  );

  assertThrows(
    () => r.render("{{arrayItemAt (array)}}"),
    Error,
    "Required",
  );
  assertThrows(
    () => r.render("{{arrayItemAt (array 1 2 3)}}"),
    Error,
    "Required",
  );
});
