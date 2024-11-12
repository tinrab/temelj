import { assertEquals } from "@std/assert";

import { Registry } from "../registry.ts";
import { getObjectHelpers } from "./object.ts";
import { getValueHelpers } from "./value.ts";

Deno.test("Handlebars object helpers", () => {
  const r = new Registry();
  r.registerHelpers({ ...getObjectHelpers(), ...getValueHelpers() });

  assertEquals(
    JSON.parse(r.render("{{{toJson (object s='hello' x=5 y=8)}}}")),
    {
      s: "hello",
      x: 5,
      y: 8,
    },
  );
});
