import { expect, test } from "vitest";

import { Registry } from "../registry";
import { getObjectHelpers } from "./object";
import { getValueHelpers } from "./value";

test("Handlebars object helpers", () => {
  const r = new Registry();
  r.registerHelpers({ ...getObjectHelpers(), ...getValueHelpers() });

  expect(JSON.parse(r.render("{{{json (object s='hello' x=5 y=8)}}}"))).toEqual({
    s: "hello",
    x: 5,
    y: 8,
  });
});

test("objectPick preserves an own __proto__ property", () => {
  const registry = new Registry();
  registry.registerHelpers({ ...getObjectHelpers(), ...getValueHelpers() });
  const source = { ["__proto__"]: { marker: "kept" }, omitted: true };
  const rendered = registry.render('{{{json (objectPick source "__proto__")}}}', { source });
  expect(JSON.parse(rendered)).toEqual({ ["__proto__"]: { marker: "kept" } });
});
