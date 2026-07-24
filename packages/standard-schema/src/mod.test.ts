import { describe, expect, expectTypeOf, test } from "vitest";

import { ss, StandardSchemaValidationError, type SchemaInput, type SchemaOutput } from "./mod";

describe("ss", () => {
  test("validates primitives", () => {
    expect(ss.string()["~standard"].validate("hello")).toEqual({ value: "hello" });
    expect(ss.number()["~standard"].validate(1)).toEqual({ value: 1 });
    expect(ss.boolean()["~standard"].validate(false)).toEqual({ value: false });
    const callable = () => undefined;
    expect(ss.fn()["~standard"].validate(callable)).toEqual({ value: callable });
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

  test("infers schema input types", () => {
    const schema = ss.schema<string, { readonly userId: string }>((value) =>
      typeof value === "string" ? ss.success({ userId: value }) : ss.failure("Expected user id"),
    );

    expectTypeOf<SchemaInput<typeof schema>>().toEqualTypeOf<string>();
    expectTypeOf<SchemaOutput<typeof schema>>().toEqualTypeOf<{ readonly userId: string }>();
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
    expect(schema["~standard"].validate({ name: "Tin" })).toEqual({
      value: { name: "Tin" },
    });
    expect(schema["~standard"].validate({ name: "Tin", enabled: undefined })).toEqual({
      value: { name: "Tin", enabled: undefined },
    });
    expect(schema["~standard"].validate({ name: 1 })).toEqual({
      issues: [{ message: "Expected a string", path: ["name"] }],
    });
    expectTypeOf<SchemaOutput<typeof schema>>().toEqualTypeOf<{
      readonly name: string;
      readonly enabled: boolean | undefined;
    }>();
  });

  test("validates strict and loose objects", () => {
    const strict = ss.strictObject({ name: ss.string() });
    const loose = ss.looseObject({ name: ss.string() });

    expect(strict["~standard"].validate({ name: "Tin", extra: true })).toEqual({
      issues: [{ message: "Unexpected key", path: ["extra"] }],
    });
    expect(loose["~standard"].validate({ name: "Tin", extra: true })).toEqual({
      value: { name: "Tin", extra: true },
    });
  });

  test("validates instances and refinements", () => {
    const instant = Temporal.Instant.from("2025-01-01T00:00:00Z");
    const schema = ss.instanceOf(Temporal.Instant, "Expected an instant");
    const positive = ss.positiveSafeInteger();

    expect(schema["~standard"].validate(instant)).toEqual({ value: instant });
    expect(schema["~standard"].validate("2025-01-01T00:00:00Z")).toEqual({
      issues: [{ message: "Expected an instant" }],
    });
    expect(positive["~standard"].validate(1)).toEqual({ value: 1 });
    expect(positive["~standard"].validate(0)).toEqual({
      issues: [{ message: "Expected a positive safe integer" }],
    });
  });

  test("transforms and pipes schemas", () => {
    const trimmed = ss.transform(ss.string(), (value) => value.trim());
    const nonBlankTrimmed = ss.pipe(trimmed, ss.nonBlankString());

    expect(nonBlankTrimmed["~standard"].validate(" Tin ")).toEqual({ value: "Tin" });
    expect(nonBlankTrimmed["~standard"].validate("   ")).toEqual({
      issues: [{ message: "Expected a non-blank string" }],
    });
    expectTypeOf<SchemaOutput<typeof nonBlankTrimmed>>().toEqualTypeOf<string>();
  });

  test("composes object shapes", () => {
    const base = {
      name: ss.string(),
      version: ss.optional(ss.string()),
    };
    const extended = ss.extend(base, { enabled: ss.boolean() });
    const picked = ss.pick(extended, ["name", "enabled"] as const);
    const partial = ss.partial(picked);

    const schema = ss.object(partial);
    expect(schema["~standard"].validate({ name: "Tin" })).toEqual({
      value: { name: "Tin" },
    });
    expectTypeOf<SchemaOutput<typeof schema>>().toEqualTypeOf<{
      readonly name: string | undefined;
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
    expect(ss.safeParseSync(schema, { name: "Tin" })).toEqual({
      success: true,
      value: { name: "Tin" },
    });
    expect(ss.safeParseSync(schema, { name: 1 })).toEqual({
      success: false,
      issues: [{ message: "Expected a string", path: ["name"] }],
    });
  });
});
