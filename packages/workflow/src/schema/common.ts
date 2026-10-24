// This module uses Temporal while loading, so the polyfill must be installed first.
import "temporal-polyfill/global";
import {
  ss,
  StandardSchemaValidationError,
  type Schema,
  type SchemaInput,
  type SchemaIssue,
  type SchemaOutput,
} from "@temelj/standard-schema";
import { isObject, isPlainObject, isString } from "@temelj/value";

import type { TelemetryContext } from "../types/telemetry.ts";

import { durationTotal } from "../temporal.ts";

export const temporalInstantSchema: Schema<unknown, Temporal.Instant> = ss.instanceOf(
  Temporal.Instant,
  "Expected a Temporal.Instant",
);

export const temporalDurationSchema: Schema<unknown, Temporal.Duration> = ss.instanceOf(
  Temporal.Duration,
  "Expected a Temporal.Duration",
);

export const temporalNonNegativeDurationSchema: Schema<unknown, Temporal.Duration> = ss.refine(
  temporalDurationSchema,
  (value) => durationTotal(value) >= 0,
  "Expected a non-negative duration",
);

export const nonBlankStringSchema: Schema<unknown, string> = ss.refine(
  ss.string(),
  (value) => value.trim().length > 0,
  "Expected a non-blank string",
);

export const nonBlankStringListSchema: Schema<unknown, string[]> = ss.array(nonBlankStringSchema);

export const positiveSafeIntegerSchema: Schema<unknown, number> = ss.positiveSafeInteger();

export const nonNegativeSafeIntegerSchema: Schema<unknown, number> = ss.nonNegativeSafeInteger();

export const idSchema: Schema<unknown, string> = ss.refine(
  ss.string("Expected an ID"),
  (value) => value.trim().length > 0,
  "Expected an ID",
);

export const telemetryContextSchema: Schema<unknown, TelemetryContext> = ss.object({
  traceparent: ss.optional(nonBlankStringSchema),
  tracestate: ss.optional(nonBlankStringSchema),
});

/** A record whose keys must also match `keySchema`. */
export function keyedRecord<TValue extends Schema>(
  keySchema: Schema<unknown, string>,
  valueSchema: TValue,
): Schema<unknown, Record<string, SchemaOutput<TValue>>> {
  const recordSchema = ss.record(valueSchema);

  return ss.schema((value) => {
    const record = ss.safeParseSync(recordSchema, value);

    if (!record.success) {
      return { issues: record.issues };
    }

    for (const key of Object.keys(record.value)) {
      const result = ss.safeParseSync(keySchema, key);

      if (!result.success) {
        return ss.failure(result.issues[0]?.message ?? "Invalid key", [key]);
      }
    }

    return ss.success(record.value);
  });
}

/** Picks the schema for a value by its `key` field, so errors come from that schema. */
export function discriminated<const TSchemas extends Record<string, Schema>>(
  key: string,
  schemas: TSchemas,
  message: string,
): Schema<unknown, SchemaOutput<TSchemas[keyof TSchemas]>> {
  return ss.schema((value) => {
    const tag = isPlainObject(value) ? new Map(Object.entries(value)).get(key) : undefined;
    const schema = isString(tag) && Object.hasOwn(schemas, tag) ? schemas[tag] : undefined;

    if (schema === undefined) {
      return ss.failure(message, [key]);
    }

    const result = ss.safeParseSync(schema, value);

    // SAFETY: The schema came from `schemas`, so its output is one of their outputs.
    return result.success
      ? ss.success(result.value as SchemaOutput<TSchemas[keyof TSchemas]>)
      : { issues: result.issues };
  });
}

/** Parses a value, throwing an error whose message names every issue. */
export function parse<TSchema extends Schema>(
  schema: TSchema,
  value: SchemaInput<TSchema>,
): SchemaOutput<TSchema> {
  const result = ss.safeParseSync(schema, value);

  if (result.success) {
    return result.value;
  }

  StandardSchemaValidationError.failed(issuesMessage(result.issues), result.issues);
}

function issuesMessage(issues: readonly SchemaIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path
        ?.map((segment) => (isObject(segment) ? String(segment.key) : String(segment)))
        .join(".");

      return path === undefined || path === "" ? issue.message : `${path}: ${issue.message}`;
    })
    .join("; ");
}
