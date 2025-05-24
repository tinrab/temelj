import { assertEquals } from "@std/assert";

import { Registry } from "../registry.ts";
import { getCoreHelpers } from "./core.ts";

Deno.test("Handlebars string helpers", () => {
  const r = new Registry();
  r.registerHelpers(getCoreHelpers(r));

  assertEquals(
    r.render(`
      {{~set a='hello,'~}}
      {{@a}}
      {{~#with 'level' as |level|~}}
        {{~set b='world!'~}}
        {{@a}} {{@b}}
      {{~/with~}}
    `),
    "hello,hello, world!",
  );

  assertEquals(r.render(`{{render '42'}}`), "42");
  assertEquals(r.render(`{{set x=42}}{{render '{{x}}' x=@x}}`), "42");
});
