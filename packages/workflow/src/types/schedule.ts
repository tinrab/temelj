import type { StorageValue } from "@temelj/storage";

import { z } from "zod";

import type { PageOptions } from "./pagination.ts";
import type { RunId } from "./run.ts";

import {
  temporalDurationSchema,
  temporalInstantSchema,
  nonBlankStringSchema,
  positiveSafeIntegerSchema,
} from "./common.ts";
import { runIdSchema } from "./run-id.ts";
import { workflowPersistedValueSchema } from "./run.ts";

export const scheduleIdSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Expected an ID");

export const workflowScheduleStatusSchema = z.enum(["active", "paused", "archived", "deleted"]);

export const workflowScheduleCatchUpPolicySchema = z.enum(["skip", "one", "all"]);

export const workflowScheduleOverlapPolicySchema = z.enum(["allow", "skip", "buffer", "cancel"]);

export const workflowSchedulePositiveDurationSchema = temporalDurationSchema.refine(
  (value) => value.total({ unit: "millisecond" }) > 0,
  { error: "Expected a positive duration" },
);

export const workflowScheduleRecordSchema = z.object({
  id: scheduleIdSchema,
  namespace: nonBlankStringSchema,
  workflowName: nonBlankStringSchema,
  workflowVersion: nonBlankStringSchema.optional(),
  input: workflowPersistedValueSchema.optional(),
  context: workflowPersistedValueSchema.optional(),
  status: workflowScheduleStatusSchema,
  every: workflowSchedulePositiveDurationSchema,
  catchUp: workflowScheduleCatchUpPolicySchema,
  maxCatchUpRuns: positiveSafeIntegerSchema.optional(),
  maxLateness: workflowSchedulePositiveDurationSchema.optional(),
  overlap: workflowScheduleOverlapPolicySchema,
  createdAt: temporalInstantSchema,
  updatedAt: temporalInstantSchema,
  nextFireAt: temporalInstantSchema,
  endAt: temporalInstantSchema.optional(),
  bufferedFireAt: temporalInstantSchema.optional(),
  lastFireAt: temporalInstantSchema.optional(),
  lastRunId: runIdSchema.optional(),
  tickCount: z.union([positiveSafeIntegerSchema, z.literal(0)]),
});

export type ScheduleId = string;

/** Lifecycle status of a stored recurring workflow schedule. */
export type ScheduleStatus = "active" | "paused" | "archived" | "deleted";

/** Policy for handling missed recurring schedule fire times. */
export type ScheduleCatchUpPolicy = "skip" | "one" | "all";

/** Policy for handling schedule ticks while a prior scheduled run is still active. */
export type ScheduleOverlapPolicy = "allow" | "skip" | "buffer" | "cancel";

/** Stored recurring workflow schedule state. */
export interface ScheduleRecord<TInput = StorageValue> {
  readonly id: ScheduleId;
  readonly namespace: string;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly input?: TInput;
  readonly context?: StorageValue;
  readonly status: ScheduleStatus;
  readonly every: Temporal.Duration;
  readonly catchUp: ScheduleCatchUpPolicy;
  readonly maxCatchUpRuns?: number;
  readonly maxLateness?: Temporal.Duration;
  readonly overlap: ScheduleOverlapPolicy;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly nextFireAt: Temporal.Instant;
  readonly endAt?: Temporal.Instant;
  readonly bufferedFireAt?: Temporal.Instant;
  readonly lastFireAt?: Temporal.Instant;
  readonly lastRunId?: RunId;
  readonly tickCount: number;
}

/** Configuration for creating or replacing a recurring workflow schedule. */
export interface ScheduleConfig<TInput = unknown, TRawInput = TInput> {
  readonly id: ScheduleId;
  readonly every: Temporal.Duration;
  readonly input: TRawInput;
  readonly context?: unknown;
  readonly from?: Temporal.Instant;
  readonly endAt?: Temporal.Instant;
  readonly catchUp?: ScheduleCatchUpPolicy;
  readonly maxCatchUpRuns?: number;
  readonly maxLateness?: Temporal.Duration;
  readonly overlap?: ScheduleOverlapPolicy;
}

/** Filters for listing recurring workflow schedules. */
export interface ListSchedulesOptions {
  readonly status?: ScheduleStatus | readonly ScheduleStatus[];
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly limit?: number;
}

/** Paginated filters for listing recurring workflow schedules. */
export type ListSchedulesPageOptions = ListSchedulesOptions & PageOptions;

/** Options for advancing due recurring workflow schedules. */
export interface TickSchedulesOptions {
  readonly now?: Temporal.Instant;
  readonly limit?: number;
}

/** Summary returned after advancing due recurring workflow schedules. */
export interface TickSchedulesResult {
  readonly ticked: number;
  readonly runIds: readonly RunId[];
  readonly scheduleIds: readonly ScheduleId[];
  readonly nextScheduleAt?: Temporal.Instant;
}
