import type { StorageValue } from "@temelj/storage";

import { z } from "zod";

import type { WorkflowErrorRecord } from "./error.ts";
import type { MessageId } from "./message-id.ts";
import type { RunId, WorkflowMaterializedStepType } from "./run.ts";
import type { StepId } from "./step-id.ts";
import type { WorkflowChildWorkflowCancellationPolicy } from "./step.ts";
import type {
  WorkflowRunFailureSummary,
  WorkflowRunRetrySummary,
  WorkflowRunStatusCounts,
} from "./summary.ts";

import {
  temporalInstantSchema,
  nonBlankStringSchema,
  positiveSafeIntegerSchema,
} from "./common.ts";
import { workflowErrorRecordSchema } from "./error.ts";
import { messageIdSchema } from "./message-id.ts";
import { runIdSchema } from "./run-id.ts";
import { workflowMaterializedStepTypeSchema, workflowPersistedValueSchema } from "./run.ts";
import { stepIdSchema } from "./step-id.ts";
import { workflowChildWorkflowCancellationPolicySchema } from "./step.ts";

export const workflowStepAttemptStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "abandoned",
]);

export const workflowStepAttemptRecordSchema = z.object({
  runId: runIdSchema,
  stepId: stepIdSchema,
  stepName: nonBlankStringSchema,
  kind: workflowMaterializedStepTypeSchema,
  status: workflowStepAttemptStatusSchema,
  attempt: positiveSafeIntegerSchema,
  count: positiveSafeIntegerSchema.optional(),
  output: workflowPersistedValueSchema.optional(),
  error: workflowErrorRecordSchema.optional(),
  until: temporalInstantSchema.optional(),
  duration: z.instanceof(Temporal.Duration, { error: "Expected a Temporal.Duration" }).optional(),
  childRunId: runIdSchema.optional(),
  workflowName: nonBlankStringSchema.optional(),
  workflowVersion: nonBlankStringSchema.optional(),
  cancellation: workflowChildWorkflowCancellationPolicySchema.optional(),
  input: workflowPersistedValueSchema.optional(),
  timeoutAt: temporalInstantSchema.optional(),
  messageId: messageIdSchema.optional(),
  targetRunId: runIdSchema.optional(),
  payload: workflowPersistedValueSchema.optional(),
  messageTimestamp: temporalInstantSchema.optional(),
  createdAt: temporalInstantSchema,
  startedAt: temporalInstantSchema,
  finishedAt: temporalInstantSchema.optional(),
});

/** Status values for workflow step attempt. */
export type WorkflowStepAttemptStatus = "running" | "completed" | "failed" | "abandoned";

/** Stored record for workflow step attempt. */
export interface WorkflowStepAttemptRecord {
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly kind: WorkflowMaterializedStepType;
  readonly status: WorkflowStepAttemptStatus;
  readonly attempt: number;
  readonly count?: number;
  readonly output?: StorageValue;
  readonly error?: WorkflowErrorRecord;
  readonly until?: Temporal.Instant;
  readonly duration?: Temporal.Duration;
  readonly childRunId?: RunId;
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly cancellation?: WorkflowChildWorkflowCancellationPolicy;
  readonly input?: StorageValue;
  readonly timeoutAt?: Temporal.Instant;
  readonly messageId?: MessageId;
  readonly targetRunId?: RunId;
  readonly payload?: StorageValue;
  readonly messageTimestamp?: Temporal.Instant;
  readonly createdAt: Temporal.Instant;
  readonly startedAt: Temporal.Instant;
  readonly finishedAt?: Temporal.Instant;
}

/** Options for workflow list step attempts. */
export interface WorkflowListStepAttemptsOptions {
  readonly status?: WorkflowStepAttemptStatus | readonly WorkflowStepAttemptStatus[];
  readonly kind?: WorkflowMaterializedStepType | readonly WorkflowMaterializedStepType[];
  readonly stepId?: StepId;
  readonly stepName?: string;
  readonly attempt?: number;
  readonly childRunId?: RunId;
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly messageId?: MessageId;
  readonly targetRunId?: RunId;
  readonly createdAtFrom?: Temporal.Instant;
  readonly createdAtTo?: Temporal.Instant;
  readonly startedAtFrom?: Temporal.Instant;
  readonly startedAtTo?: Temporal.Instant;
  readonly finishedAtFrom?: Temporal.Instant;
  readonly finishedAtTo?: Temporal.Instant;
  readonly untilFrom?: Temporal.Instant;
  readonly untilTo?: Temporal.Instant;
  readonly durationFrom?: Temporal.Duration;
  readonly durationTo?: Temporal.Duration;
  readonly timeoutAtFrom?: Temporal.Instant;
  readonly timeoutAtTo?: Temporal.Instant;
  readonly messageTimestampFrom?: Temporal.Instant;
  readonly messageTimestampTo?: Temporal.Instant;
  readonly limit?: number;
}

type WorkflowStepAttemptSummaryStringArray = readonly string[];

/** Summary data for workflow step attempt. */
export interface WorkflowStepAttemptSummary {
  readonly total: number;
  readonly status: WorkflowStepAttemptStatusCounts;
  readonly statusStepIds: WorkflowStepAttemptStatusStepIds;
  readonly statusAttemptKeys: WorkflowStepAttemptStatusAttemptKeys;
  readonly kind: WorkflowStepAttemptKindCounts;
  readonly kindStepIds: WorkflowStepAttemptKindStepIds;
  readonly kindAttemptKeys: WorkflowStepAttemptKindAttemptKeys;
  readonly failure?: WorkflowStepAttemptFailureSummary;
  readonly oldestRunningAt?: Temporal.Instant;
  readonly latestFinishedAt?: Temporal.Instant;
  readonly activeSleepStepIds?: WorkflowStepAttemptSummaryStringArray;
  readonly activeSleepAttemptKeys?: WorkflowStepAttemptSummaryStringArray;
  readonly nextSleepUntil?: Temporal.Instant;
  readonly nextSleepStepId?: StepId;
  readonly nextSleepAttemptKey?: string;
  readonly nextSleepDuration?: Temporal.Duration;
  readonly activeChildWorkflows?: WorkflowActiveChildWorkflowSummary;
  readonly activeMessageWaits?: WorkflowActiveMessageWaitSummary;
}

/** Counts grouped by step attempt status. */
export type WorkflowStepAttemptStatusCounts = Readonly<Record<WorkflowStepAttemptStatus, number>>;

/** Step IDs grouped by step attempt status. */
export type WorkflowStepAttemptStatusStepIds = Readonly<
  Record<WorkflowStepAttemptStatus, WorkflowStepAttemptSummaryStringArray>
>;

/** Step attempt keys grouped by step attempt status. */
export type WorkflowStepAttemptStatusAttemptKeys = Readonly<
  Record<WorkflowStepAttemptStatus, WorkflowStepAttemptSummaryStringArray>
>;

/** Counts grouped by step attempt kind. */
export type WorkflowStepAttemptKindCounts = Readonly<Record<WorkflowMaterializedStepType, number>>;

/** Step IDs grouped by step attempt kind. */
export type WorkflowStepAttemptKindStepIds = Readonly<
  Record<WorkflowMaterializedStepType, WorkflowStepAttemptSummaryStringArray>
>;

/** Step attempt keys grouped by step attempt kind. */
export type WorkflowStepAttemptKindAttemptKeys = Readonly<
  Record<WorkflowMaterializedStepType, WorkflowStepAttemptSummaryStringArray>
>;

/** Summary data for workflow step attempt failure. */
export interface WorkflowStepAttemptFailureSummary {
  readonly total: number;
  readonly failedStepIds: WorkflowStepAttemptSummaryStringArray;
  readonly failedAttemptKeys: WorkflowStepAttemptSummaryStringArray;
  readonly errors: readonly WorkflowStepAttemptFailureErrorSummary[];
  readonly latestFailedAt?: Temporal.Instant;
}

/** Summary data for workflow step attempt failure error. */
export interface WorkflowStepAttemptFailureErrorSummary {
  readonly name: string;
  readonly count: number;
  readonly failedStepIds: WorkflowStepAttemptSummaryStringArray;
  readonly failedAttemptKeys: WorkflowStepAttemptSummaryStringArray;
  readonly latestFailedAt?: Temporal.Instant;
}

/** Summary data for workflow active message wait. */
export interface WorkflowActiveMessageWaitSummary {
  readonly total: number;
  readonly stepIds: WorkflowStepAttemptSummaryStringArray;
  readonly attemptKeys: WorkflowStepAttemptSummaryStringArray;
  readonly messages: WorkflowStepAttemptSummaryStringArray;
  readonly oldestStartedAt?: Temporal.Instant;
  readonly nextTimeoutAt?: Temporal.Instant;
  readonly nextTimeoutStepId?: StepId;
  readonly nextTimeoutAttemptKey?: string;
}

/** Summary data for workflow active child workflow. */
export interface WorkflowActiveChildWorkflowSummary {
  readonly total: number;
  readonly stepIds: WorkflowStepAttemptSummaryStringArray;
  readonly attemptKeys: WorkflowStepAttemptSummaryStringArray;
  readonly childRunIds: WorkflowStepAttemptSummaryStringArray;
  readonly retryChildRunIds?: WorkflowStepAttemptSummaryStringArray;
  readonly failedChildRunIds?: WorkflowStepAttemptSummaryStringArray;
  readonly canceledChildRunIds?: WorkflowStepAttemptSummaryStringArray;
  readonly workflows: WorkflowStepAttemptSummaryStringArray;
  readonly childStatus: WorkflowRunStatusCounts;
  readonly childRetry?: WorkflowRunRetrySummary;
  readonly childFailure?: WorkflowRunFailureSummary;
  readonly oldestStartedAt?: Temporal.Instant;
  readonly nextTimeoutAt?: Temporal.Instant;
  readonly nextTimeoutStepId?: StepId;
  readonly nextTimeoutAttemptKey?: string;
}
