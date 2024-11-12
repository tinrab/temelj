import { assertEquals } from "@std/assert";

import { Registry } from "./registry.ts";

Deno.test("Handlebars switch helper", () => {
  const r = new Registry();
  const template = `
    {{#switch x}}
    {{#case 1}}A{{/case}}
    {{#case 2}}B{{/case}}
    {{#default}}C{{/default}}
    {{/switch}}
  `;
  assertEquals(
    r.render(
      template,
      { x: 1 },
    ).trim(),
    "A",
  );
  assertEquals(
    r.render(
      template,
      { x: 2 },
    ).trim(),
    "B",
  );

  assertEquals(
    r.render(
      template,
      { x: 99 },
    ).trim(),
    "C",
  );
  assertEquals(
    r.render(
      template,
    ).trim(),
    "C",
  );
});
