import { ss } from "@temelj/standard-schema";
import { expect, expectTypeOf, test, vi } from "vitest";

import { createHelper, StandardSchemaValidationError } from "./helper_builder";
import { Registry } from "./registry";

test("keeps hash and context positions when validation returns undefined", () => {
  const registry = new Registry();
  const hashSchema = ss.transform(ss.object({}), () => undefined);
  registry.registerHelper(
    "paramsFirst",
    createHelper()
      .params(ss.string(), ss.optional(ss.number()))
      .hash(hashSchema)
      .handle(([label, count], hash, context) => {
        expectTypeOf(label).toEqualTypeOf<string>();
        expectTypeOf(count).toEqualTypeOf<number | undefined>();
        expectTypeOf(hash).toEqualTypeOf<undefined>();
        expect(hash).toBeUndefined();

        return `${label}:${count ?? "missing"}:${context.name}`;
      }),
  );
  registry.registerHelper(
    "hashFirst",
    createHelper()
      .hash(hashSchema)
      .params(ss.number())
      .handle(([count], hash, context) => {
        expect(hash).toBeUndefined();

        return `${count}:${context.name}`;
      }),
  );
  registry.registerHelper(
    "hashOnly",
    createHelper()
      .hash(hashSchema)
      .handle((hash, context) => {
        expect(hash).toBeUndefined();

        return context.name;
      }),
  );
  expect(registry.render('{{paramsFirst "label"}}')).toBe("label:missing:paramsFirst");
  expect(registry.render("{{hashFirst 3}}")).toBe("3:hashFirst");
  expect(registry.render("{{hashOnly}}")).toBe("hashOnly");
});

test("does not invoke a handler when its parameter fails validation", () => {
  const registry = new Registry();
  const handler = vi.fn<() => string>(() => "called");
  registry.registerHelper("number", createHelper().params(ss.number()).handle(handler));
  expect(() => registry.render('{{number "wrong"}}')).toThrow(StandardSchemaValidationError);
  expect(handler).not.toHaveBeenCalled();
});

test("restores switch nesting after a helper throws", () => {
  const registry = new Registry();
  registry.registerHelper("explode", () => {
    throw new Error("failed");
  });
  expect(() => registry.render('{{#switch "outer"}}{{explode}}{{/switch}}')).toThrow("failed");
  expect(registry.render('{{#case "outer"}}leaked{{/case}}')).toBe("");
});
