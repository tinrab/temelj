import { assertEquals } from "@std/assert";
import { Registry } from "../registry.ts";
import { getValueHelpers } from "./value.ts";
import { getArrayHelpers } from "./array.ts";

Deno.test("Handlebars value isEmpty helper", () => {
  const r = new Registry();
  r.registerHelpers({ ...getValueHelpers(), ...getArrayHelpers() });

  assertEquals(r.renderTemplate("{{isEmpty 0}}"), "true");
  assertEquals(r.renderTemplate("{{isEmpty undefined}}"), "true");
  assertEquals(r.renderTemplate("{{isEmpty false}}"), "true");
  assertEquals(r.renderTemplate("{{isEmpty ''}}"), "true");
  assertEquals(r.renderTemplate('{{isEmpty ""}}'), "true");

  assertEquals(r.renderTemplate('{{isEmpty "a"}}'), "false");
  assertEquals(r.renderTemplate('{{isEmpty " "}}'), "false");
  assertEquals(r.renderTemplate("{{isEmpty 42}}"), "false");
  assertEquals(r.renderTemplate("{{isEmpty (array 4 2)}}"), "false");
});
