import { assertEquals, assertThrows } from "@std/assert";
import { Registry } from "~/handlebars/registry.ts";
import { getArrayHelpers } from "~/handlebars/helpers/array.ts";

Deno.test("Handlebars array helpers", () => {
  const r = new Registry();
  r.registerHelpers(getArrayHelpers());

  assertEquals(r.renderTemplate("{{array 1 2 3}}"), "1,2,3");
  assertEquals(r.renderTemplate("{{arrayItemAt (array 1 2 3) 1}}"), "2");
  assertEquals(
    r.renderTemplate("{{arrayContains (array 1 2 3) 2}}"),
    "true",
  );
  assertEquals(
    r.renderTemplate("{{arrayContains (array 1 2 3) 4}}"),
    "false",
  );
  assertEquals(
    r.renderTemplate(`{{arrayJoin (array 1 2 3) "|"}}`),
    "1|2|3",
  );

  assertThrows(
    () => r.renderTemplate("{{arrayItemAt (array)}}"),
    Error,
    "Required",
  );
  assertThrows(
    () => r.renderTemplate("{{arrayItemAt (array 1 2 3)}}"),
    Error,
    "Required",
  );
});
