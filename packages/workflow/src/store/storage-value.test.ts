// Installs Temporal when the runtime lacks it, before any module uses it.
import "temporal-polyfill/global";
import { ss } from "@temelj/standard-schema";
import { describe, expect, expectTypeOf, test } from "vitest";

import { omitUndefined } from "../collection.ts";
import { serializeError } from "../engine/serialization.ts";
import { WorkflowImplementationNotFoundError } from "../errors/implementation.ts";
import { workflowErrorFromRecord } from "../errors/records.ts";
import { parse } from "../schema/common.ts";
import { errorDetailsSchema, errorRecordSchema } from "../schema/error.ts";
import { toStorageValue } from "./storage-value.ts";

interface CyclicRecord {
  next?: CyclicRecord;
}

describe("workflow storage boundaries", () => {
  test("omits optional undefined record fields without changing rich values or the input", () => {
    const date = new Date("2026-09-10T00:00:00Z");
    const instant = Temporal.Instant.from("2026-09-10T00:00:00Z");
    const bytes = new Uint8Array([1, 2]);

    const input = {
      date,
      instant,
      bytes,
      optional: undefined,
      events: [{ value: 42, optional: undefined }],
    };

    expect(toStorageValue(input)).toEqual({ date, instant, bytes, events: [{ value: 42 }] });
    expect(input).toHaveProperty("optional");
    expect(input.events[0]).toHaveProperty("optional");
  });

  test("rejects cycles, invalid leaves, sparse arrays, and symbol keys", () => {
    const cycle: CyclicRecord = {};
    cycle.next = cycle;

    for (const value of [
      cycle,
      { callback: () => {} },
      [undefined],
      Array(1),
      { [Symbol("hidden")]: 42 },
      new Date(NaN),
    ]) {
      expect(() => toStorageValue(value)).toThrow(/Circular|Invalid|Symbol|not supported|must be/);
    }

    const shared = { value: 42 };
    expect(toStorageValue([shared, shared])).toEqual([shared, shared]);
  });

  test("keeps defined symbol fields and marks removed fields optional in record copies", () => {
    const key = Symbol("retained");
    const value = omitUndefined({ required: 42, absent: undefined, [key]: "value" });
    expectTypeOf(value.required).toEqualTypeOf<number>();
    expectTypeOf(value.absent).toEqualTypeOf<undefined>();
    expect(value).not.toHaveProperty("absent");
    expect(value[key]).toBe("value");
    expect(() => omitUndefined(new Date())).toThrow("Expected a plain record");
  });

  test("reconstructs known errors and treats unregistered prototype names as ordinary errors", () => {
    const original = new WorkflowImplementationNotFoundError("workflow", "v1");
    const restored = workflowErrorFromRecord(serializeError(original));
    expect(restored).toBeInstanceOf(WorkflowImplementationNotFoundError);
    expect(restored).toMatchObject({ workflowName: "workflow", workflowVersion: "v1" });

    for (const name of ["constructor", "toString", "__proto__"]) {
      expect(workflowErrorFromRecord({ name, message: "failure" })).toMatchObject({
        name,
        message: "failure",
      });
    }
  });

  test("parses only supported error fields and validates details before cloning", () => {
    class Details {
      field = "value";
    }

    expect(ss.safeParseSync(errorDetailsSchema, new Details()).success).toBe(false);
    expect(ss.safeParseSync(errorDetailsSchema, { field: "value", count: 2 }).success).toBe(true);
    expect(
      parse(errorRecordSchema, { name: "Error", message: "failure", unsupported: () => {} }),
    ).toEqual({ name: "Error", message: "failure" });
  });
});
