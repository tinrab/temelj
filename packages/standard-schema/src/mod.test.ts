import { describe, expect, expectTypeOf, test } from "vitest";

import { ss, StandardSchemaValidationError, type SchemaOutput } from "./mod";

describe("ss", () => {
  test("validates primitives", () => {
    expect(ss.string()["~standard"].validate("hello")).toEqual({ value: "hello" });
    expect(ss.number()["~standard"].validate(1)).toEqual({ value: 1 });
    expect(ss.boolean()["~standard"].validate(false)).toEqual({ value: false });
    expect(ss.unknown()["~standard"].validate({ a: 1 })).toEqual({ value: { a: 1 } });
  });

  test("validates literal and picklist values", () => {
    expect(ss.literal("on")["~standard"].validate("on")).toEqual({ value: "on" });
    expect(ss.picklist(["dev", "prod"] as const)["~standard"].validate("dev")).toEqual({
      value: "dev",
    });

    const schema = ss.picklist(["dev", "prod"] as const);
    expectTypeOf<SchemaOutput<typeof schema>>().toEqualTypeOf<"dev" | "prod">();
  });

  test("validates unions", () => {
    const schema = ss.union([ss.string(), ss.boolean()]);

    expect(schema["~standard"].validate("yes")).toEqual({ value: "yes" });
    expect(schema["~standard"].validate(true)).toEqual({ value: true });
    expect(schema["~standard"].validate(1)).toEqual({
      issues: [{ message: "Expected a union match" }],
    });
    expectTypeOf<SchemaOutput<typeof schema>>().toEqualTypeOf<string | boolean>();
  });

  test("validates arrays and records with paths", () => {
    expect(ss.array(ss.string())["~standard"].validate(["a", "b"])).toEqual({ value: ["a", "b"] });
    expect(ss.array(ss.string())["~standard"].validate(["a", 1])).toEqual({
      issues: [{ message: "Expected a string", path: [1] }],
    });
    expect(ss.record(ss.boolean())["~standard"].validate({ enabled: "yes" })).toEqual({
      issues: [{ message: "Expected a boolean", path: ["enabled"] }],
    });
  });

  test("validates object shapes with paths", () => {
    const schema = ss.object({
      name: ss.string(),
      enabled: ss.optional(ss.boolean()),
    });

    expect(schema["~standard"].validate({ name: "Tin", enabled: true })).toEqual({
      value: { name: "Tin", enabled: true },
    });
    expect(schema["~standard"].validate({ name: 1 })).toEqual({
      issues: [{ message: "Expected a string", path: ["name"] }],
    });
    expectTypeOf<SchemaOutput<typeof schema>>().toEqualTypeOf<{
      readonly name: string;
      readonly enabled: boolean | undefined;
    }>();
  });

  test("validates optional and defaulted values", () => {
    expect(ss.optional(ss.string())["~standard"].validate(undefined)).toEqual({ value: undefined });
    expect(ss.defaulted(ss.string(), "fallback")["~standard"].validate(undefined)).toEqual({
      value: "fallback",
    });
    expect(ss.defaulted(ss.array(ss.string()), () => [])["~standard"].validate(undefined)).toEqual({
      value: [],
    });
  });

  test("validates and unwraps schemas", async () => {
    const schema = ss.object({ name: ss.string() });

    await expect(ss.validateStandardSchema(schema, { name: "Tin" })).resolves.toEqual({
      name: "Tin",
    });
    expect(ss.validateStandardSchemaSync(schema, { name: "Tin" })).toEqual({ name: "Tin" });
    expect(() => ss.validateStandardSchemaSync(schema, { name: 1 })).toThrow(
      StandardSchemaValidationError,
    );
  });
});
