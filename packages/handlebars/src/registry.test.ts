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
  expect(r.render(template, { x: 1 }).trim()).toBe("A");
  expect(r.render(template, { x: 2 }).trim()).toBe("B");

  expect(r.render(template, { x: 99 }).trim()).toBe("C");
  expect(r.render(template).trim()).toBe("C");
});

test("safe string works", () => {
  const r = new Registry();
  r.registerHelper("safeString", () => new SafeString(`'hi'`));
  expect(r.render(`{{safeString}}`)).toBe(`'hi'`);
});
