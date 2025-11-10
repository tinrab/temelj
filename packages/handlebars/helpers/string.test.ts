import { expect, test } from "vitest";
import { z } from "zod";

import { Registry } from "../registry";
import { getStringHelpers } from "./string";

test("Handlebars string helpers", () => {
  const r = new Registry();
  r.registerHelpers(getStringHelpers());

  expect(r.render(`{{splitPart "a/b/c" 1}}`)).toBe("b");
  expect(r.render(`{{splitPartSegment "a/b/c" 1 2}}`)).toBe("b/c");
  expect(r.render(`{{splitPartSegment "a_b_c" 1 2 "_"}}`)).toBe("b_c");

  expect(() => r.render(`{{splitPartSegment "a/b/c" 0}}`)).toThrow(Error);

  expect(r.render(`{{join (pascalCase "hello") ", World" "!"}}`)).toBe(
    "Hello, World!",
  );

  expect(() => r.render("{{camelCase 42}}")).toThrow(z.ZodError);
});
