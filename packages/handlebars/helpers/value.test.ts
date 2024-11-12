import { assertEquals } from "@std/assert";

import { Registry } from "../registry.ts";
import { getValueHelpers } from "./value.ts";
import { getArrayHelpers } from "./array.ts";

Deno.test("Handlebars value isEmpty helper", () => {
  const r = new Registry();
  r.registerHelpers({ ...getValueHelpers(), ...getArrayHelpers() });

  assertEquals(r.render("{{isEmpty 0}}"), "true");
  assertEquals(r.render("{{isEmpty undefined}}"), "true");
  assertEquals(r.render("{{isEmpty false}}"), "true");
  assertEquals(r.render("{{isEmpty ''}}"), "true");
  assertEquals(r.render('{{isEmpty ""}}'), "true");

  assertEquals(r.render('{{isEmpty "a"}}'), "false");
  assertEquals(r.render('{{isEmpty " "}}'), "false");
  assertEquals(r.render("{{isEmpty 42}}"), "false");
  assertEquals(r.render("{{isEmpty (array 4 2)}}"), "false");
});
