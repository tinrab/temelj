import { ss, type Schema } from "@temelj/standard-schema";

import type { MaterializedStepType, RunRecord, TerminalRunStatus } from "../types/run.ts";
import type { ChildWorkflowCancellationPolicy } from "../types/step.ts";

import { runAttributesSchema as workflowRunAttributesSchema } from "../attributes.ts";
import {
  temporalInstantSchema,
  nonBlankStringSchema,
  nonNegativeSafeIntegerSchema,
  positiveSafeIntegerSchema,
  idSchema,
  telemetryContextSchema,
} from "./common.ts";
import { errorRecordSchema } from "./error.ts";
import { persistedValueSchema as workflowPersistedValueSchema } from "./persisted-value.ts";

const runStatusSchema = ss.picklist([
  "pending",
  "running",
  "waiting",
  "completed",
  "failed",
  "canceled",
]);

export const terminalRunStatusSchema: Schema<unknown, TerminalRunStatus> = ss.picklist([
  "completed",
  "failed",
  "canceled",
]);

const runRetryReasonSchema = ss.picklist(["workflow", "step", "missing_implementation"]);

const runTransitionReasonSchema = ss.picklist([
  "created",
  "claimed",
  "reclaimed",
  "started",
  "waiting",
  "rescheduled",
  "lease_released",
  "manual_retry",
  "permanent_failure",
  "retry",
  "missing_implementation",
  "completed",
  "failed",
  "deadline",
  "canceled",
]);

export const materializedStepTypeSchema: Schema<unknown, MaterializedStepType> = ss.picklist([
  "run",
  "sleep",
  "workflow",
  "message-send",
  "message-wait",
  "stream",
  "deterministic",
]);

export const runRecordSchema: Schema<unknown, RunRecord> = ss.object({
  id: idSchema,
  namespace: nonBlankStringSchema,
  workflowName: nonBlankStringSchema,
  workflowVersion: ss.optional(nonBlankStringSchema),
  status: runStatusSchema,
  input: ss.optional(workflowPersistedValueSchema),
  context: ss.optional(workflowPersistedValueSchema),
  telemetryContext: ss.optional(telemetryContextSchema),
  metadata: ss.optional(workflowPersistedValueSchema),
  attributes: ss.optional(workflowRunAttributesSchema),
  output: ss.optional(workflowPersistedValueSchema),
  error: ss.optional(errorRecordSchema),
  attempts: ss.optional(nonNegativeSafeIntegerSchema),
  idempotencyKey: ss.optional(nonBlankStringSchema),
  parentRunId: ss.optional(idSchema),
  parentStepId: ss.optional(idSchema),
  parentStepName: ss.optional(nonBlankStringSchema),
  parentStepAttempt: ss.optional(positiveSafeIntegerSchema),
  workerId: ss.optional(idSchema),
  createdAt: temporalInstantSchema,
  updatedAt: temporalInstantSchema,
  lastTransitionAt: temporalInstantSchema,
  lastTransitionReason: runTransitionReasonSchema,
  availableAt: ss.optional(temporalInstantSchema),
  retryAt: ss.optional(temporalInstantSchema),
  retryReason: ss.optional(runRetryReasonSchema),
  retryAttempt: ss.optional(positiveSafeIntegerSchema),
  retryStepId: ss.optional(idSchema),
  retryStepName: ss.optional(nonBlankStringSchema),
  deadlineAt: ss.optional(temporalInstantSchema),
  leaseExpiresAt: ss.optional(temporalInstantSchema),
  startedAt: ss.optional(temporalInstantSchema),
  finishedAt: ss.optional(temporalInstantSchema),
});

export const childWorkflowCancellationPolicySchema: Schema<
  unknown,
  ChildWorkflowCancellationPolicy
> = ss.picklist(["cascade", "detach"]);
