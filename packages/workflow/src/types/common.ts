import "temporal-polyfill/global";
import { z } from "zod";

import { durationTotal } from "../utility.ts";

export const temporalInstantSchema = z.instanceof(Temporal.Instant, {
  error: "Expected a Temporal.Instant",
});

export const temporalDurationSchema = z.instanceof(Temporal.Duration, {
  error: "Expected a Temporal.Duration",
});

export const temporalPositiveDurationSchema = temporalDurationSchema.refine(
  (value) => durationTotal(value) > 0,
  { error: "Expected a positive duration" },
);

export const temporalPositiveSafeDurationSchema = temporalPositiveDurationSchema.refine(
  (value) => Number.isSafeInteger(durationTotal(value)),
  { error: "Expected a positive safe duration" },
);

export const temporalNonNegativeDurationSchema = temporalDurationSchema.refine(
  (value) => durationTotal(value) >= 0,
  { error: "Expected a non-negative duration" },
);

export const temporalNonNegativeSafeDurationSchema = temporalNonNegativeDurationSchema.refine(
  (value) => Number.isSafeInteger(durationTotal(value)),
  { error: "Expected a non-negative safe duration" },
);

export const nonBlankStringSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected a non-blank string");
export const nonBlankStringListSchema = z.array(nonBlankStringSchema).readonly();
export const positiveSafeIntegerSchema = z.number().int().positive();
export const nonNegativeSafeIntegerSchema = z.number().int().nonnegative();

/** Timer delay after validation and runtime clamping. */
export interface TimerDelay {
  readonly duration: Temporal.Duration;
  readonly clampedDelay: number;
}
