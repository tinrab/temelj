import { expect, test } from "vitest";

import { Registry } from "./registry";
import { SafeString } from "./types";

test("switch helper", () => {
  const r = new Registry();
  const template = `
    {{#switch x}}
    {{#case 1}}A{{/case}}
    {{#case 2}}B{{/case}}
    {{#default}}C{{/default}}
    {{/switch}}
  `;
  expect(r.render(template, { x: 1 }).trim(), "A");
  expect(r.render(template, { x: 2 }).trim(), "B");

  expect(r.render(template, { x: 99 }).trim(), "C");
  expect(r.render(template).trim(), "C");
});

test("safe string works", () => {
  const r = new Registry();
  r.registerHelper("safeString", () => new SafeString(`'hi'`));
  expect(r.render(`{{safeString}}`), `'hi'`);
});
