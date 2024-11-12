import { assertEquals } from "@std/assert";

import { Registry } from "./registry.ts";

Deno.test("Handlebars switch helper", () => {
  const hbs = new Registry();
  const template = `
    {{#switch x}}
    {{#case 1}}A{{/case}}
    {{#case 2}}B{{/case}}
    {{#default}}C{{/default}}
    {{/switch}}
  `;
  assertEquals(
    hbs.renderTemplate(
      template,
      { x: 1 },
    ).trim(),
    "A",
  );
  assertEquals(
    hbs.renderTemplate(
      template,
      { x: 2 },
    ).trim(),
    "B",
  );

  assertEquals(
    hbs.renderTemplate(
      template,
      { x: 99 },
    ).trim(),
    "C",
  );
  assertEquals(
    hbs.renderTemplate(
      template,
    ).trim(),
    "C",
  );
});
