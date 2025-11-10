import { expect, test } from "vitest";

import { Registry } from "../registry";
import { getCoreHelpers } from "./core";

test("Handlebars string helpers", () => {
  const r = new Registry();
  r.registerHelpers(getCoreHelpers(r));

  expect(
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

  expect(r.render(`{{render '42'}}`), "42");
  expect(r.render(`{{set x=42}}{{render '{{x}}' x=@x}}`), "42");
});
