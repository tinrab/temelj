import { ss, type Schema } from "@temelj/standard-schema";

import type { CleanupMarkerRecord, CleanupMode } from "../types/cleanup.ts";
import type { LockRecord } from "../types/lock.ts";
import type { ScheduleRecord } from "../types/schedule.ts";
import type { StepAttemptRecord, StepAttemptStatus } from "../types/step-attempts.ts";
import type { CleanupIndexKey, MessageIdempotencyIndex } from "../types/store.ts";

import {
  nonBlankStringSchema,
  temporalInstantSchema,
  idSchema,
  positiveSafeIntegerSchema,
  temporalDurationSchema,
  nonNegativeSafeIntegerSchema,
} from "./common.ts";
import { errorRecordSchema } from "./error.ts";
import { persistedValueIssue, persistedValueSchema } from "./persisted-value.ts";
import {
  materializedStepTypeSchema,
  childWorkflowCancellationPolicySchema,
  terminalRunStatusSchema,
} from "./run.ts";

export const lockRecordSchema: Schema<unknown, LockRecord> = ss.object({
  key: nonBlankStringSchema,
  namespace: nonBlankStringSchema,
  holderId: nonBlankStringSchema,
  holderRunId: ss.optional(idSchema),
  holderStepId: ss.optional(idSchema),
  fencingToken: positiveSafeIntegerSchema,
  acquiredAt: temporalInstantSchema,
  leaseExpiresAt: temporalInstantSchema,
  releasedAt: ss.optional(temporalInstantSchema),
});

export const cleanupModeSchema: Schema<unknown, CleanupMode> = ss.literal("best_effort");

export const cleanupMarkerRecordSchema: Schema<unknown, CleanupMarkerRecord> = ss.object({
  mode: cleanupModeSchema,
  runId: idSchema,
  workflowName: nonBlankStringSchema,
  workflowVersion: ss.optional(nonBlankStringSchema),
  status: terminalRunStatusSchema,
  createdAt: temporalInstantSchema,
  finishedAt: temporalInstantSchema,
  cleanupStartedAt: temporalInstantSchema,
  events: nonNegativeSafeIntegerSchema,
  stepAttempts: nonNegativeSafeIntegerSchema,
  idempotencyKeys: nonNegativeSafeIntegerSchema,
  messageIdempotencyKeys: nonNegativeSafeIntegerSchema,
});

const scheduleIdSchema = ss.refine(
  ss.string(),
  (value) => value.trim().length > 0,
  "Expected an ID",
);

const scheduleStatusSchema = ss.picklist(["active", "paused", "archived", "deleted"]);

const scheduleCatchUpPolicySchema = ss.picklist(["skip", "one", "all"]);

const scheduleOverlapPolicySchema = ss.picklist(["allow", "skip", "buffer", "cancel"]);

const schedulePositiveDurationSchema = ss.refine(
  temporalDurationSchema,
  (value) => value.total({ unit: "millisecond" }) > 0,
  "Expected a positive duration",
);

export const scheduleRecordSchema: Schema<unknown, ScheduleRecord> = ss.object({
  id: scheduleIdSchema,
  namespace: nonBlankStringSchema,
  workflowName: nonBlankStringSchema,
  workflowVersion: ss.optional(nonBlankStringSchema),
  input: ss.optional(persistedValueSchema),
  context: ss.optional(persistedValueSchema),
  status: scheduleStatusSchema,
  every: schedulePositiveDurationSchema,
  catchUp: scheduleCatchUpPolicySchema,
  maxCatchUpRuns: ss.optional(positiveSafeIntegerSchema),
  maxLateness: ss.optional(schedulePositiveDurationSchema),
  overlap: scheduleOverlapPolicySchema,
  createdAt: temporalInstantSchema,
  updatedAt: temporalInstantSchema,
  nextFireAt: temporalInstantSchema,
  endAt: ss.optional(temporalInstantSchema),
  bufferedFireAt: ss.optional(temporalInstantSchema),
  lastFireAt: ss.optional(temporalInstantSchema),
  lastRunId: ss.optional(idSchema),
  tickCount: ss.union([positiveSafeIntegerSchema, ss.literal(0)]),
});

export const stepAttemptStatusSchema: Schema<unknown, StepAttemptStatus> = ss.picklist([
  "running",
  "completed",
  "failed",
  "abandoned",
]);

export const stepAttemptRecordSchema: Schema<unknown, StepAttemptRecord> = ss.object({
  runId: idSchema,
  stepId: idSchema,
  stepName: nonBlankStringSchema,
  kind: materializedStepTypeSchema,
  status: stepAttemptStatusSchema,
  attempt: positiveSafeIntegerSchema,
  count: ss.optional(positiveSafeIntegerSchema),
  output: ss.optional(persistedValueSchema),
  error: ss.optional(errorRecordSchema),
  until: ss.optional(temporalInstantSchema),
  duration: ss.optional(ss.instanceOf(Temporal.Duration, "Expected a Temporal.Duration")),
  childRunId: ss.optional(idSchema),
  workflowName: ss.optional(nonBlankStringSchema),
  workflowVersion: ss.optional(nonBlankStringSchema),
  cancellation: ss.optional(childWorkflowCancellationPolicySchema),
  input: ss.optional(persistedValueSchema),
  timeoutAt: ss.optional(temporalInstantSchema),
  messageId: ss.optional(idSchema),
  targetRunId: ss.optional(idSchema),
  payload: ss.optional(persistedValueSchema),
  messageTimestamp: ss.optional(temporalInstantSchema),
  createdAt: temporalInstantSchema,
  startedAt: temporalInstantSchema,
  finishedAt: ss.optional(temporalInstantSchema),
});

export const cleanupIndexKeySchema: Schema<unknown, CleanupIndexKey> = ss.object({
  key: nonBlankStringSchema,
  value: ss.refine(
    persistedValueSchema,
    (value) =>
      value !== undefined &&
      persistedValueIssue(value, "value", new WeakSet<object>(), true) === undefined,
    "Expected a storage value",
  ),
});

export const messageIdempotencyIndexSchema: Schema<unknown, MessageIdempotencyIndex> = ss.object({
  runId: idSchema,
  messageId: idSchema,
  timestamp: temporalInstantSchema,
});
