import { expect, test } from "vitest";

import { Registry } from "../registry";
import { getObjectHelpers } from "./object";
import { getValueHelpers } from "./value";

test("Handlebars object helpers", () => {
  const r = new Registry();
  r.registerHelpers({ ...getObjectHelpers(), ...getValueHelpers() });

  expect(JSON.parse(r.render("{{{json (object s='hello' x=5 y=8)}}}")), {
    s: "hello",
    x: 5,
    y: 8,
  });
});
