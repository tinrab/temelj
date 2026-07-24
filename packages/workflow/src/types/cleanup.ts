import { z } from "zod";

import type { RunId, WorkflowTerminalRunStatus } from "./run.ts";
import type { StepId } from "./step-id.ts";

import {
  temporalInstantSchema,
  nonBlankStringSchema,
  nonNegativeSafeIntegerSchema,
} from "./common.ts";
import { runIdSchema } from "./run-id.ts";
import { workflowTerminalRunStatusSchema } from "./run.ts";

export const workflowCleanupModeSchema = z.literal("best_effort");

export const workflowCleanupMarkerRecordSchema = z.object({
  mode: workflowCleanupModeSchema,
  runId: runIdSchema,
  workflowName: nonBlankStringSchema,
  workflowVersion: nonBlankStringSchema.optional(),
  status: workflowTerminalRunStatusSchema,
  createdAt: temporalInstantSchema,
  finishedAt: temporalInstantSchema,
  cleanupStartedAt: temporalInstantSchema,
  events: nonNegativeSafeIntegerSchema,
  stepAttempts: nonNegativeSafeIntegerSchema,
  idempotencyKeys: nonNegativeSafeIntegerSchema,
  messageIdempotencyKeys: nonNegativeSafeIntegerSchema,
});

/** Cleanup strategy used when deleting terminal run data from the store. */
export type CleanupMode = "best_effort";

/** Options for workflow cleanup runs. */
export interface CleanupRunsOptions extends WorkflowCleanupRunFilterOptions {
  readonly finishedAtBefore: Temporal.Instant;
}

/** Status filter accepted by workflow cleanup operations. */
export type CleanupStatusFilter = WorkflowTerminalRunStatus | readonly WorkflowTerminalRunStatus[];

/** Options for workflow retention policy. */
export interface RetentionPolicyOptions extends WorkflowCleanupRunFilterOptions {
  readonly olderThan: Temporal.Duration;
  readonly now?: Temporal.Instant;
}

interface WorkflowCleanupRunFilterOptions {
  readonly status?: CleanupStatusFilter;
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly idempotencyKey?: string;
  readonly parentRunId?: RunId;
  readonly parentStepId?: StepId;
  readonly parentStepName?: string;
  readonly parentStepAttempt?: number;
  readonly dryRun?: boolean;
  readonly limit?: number;
}

/** Stored record for workflow cleanup marker. */
export interface CleanupMarkerRecord {
  readonly mode: CleanupMode;
  readonly runId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly status: WorkflowTerminalRunStatus;
  readonly createdAt: Temporal.Instant;
  readonly finishedAt: Temporal.Instant;
  readonly cleanupStartedAt: Temporal.Instant;
  readonly events: number;
  readonly stepAttempts: number;
  readonly idempotencyKeys: number;
  readonly messageIdempotencyKeys: number;
}

/** Result returned by workflow cleanup runs. */
export interface CleanupRunsResult {
  readonly mode: CleanupMode;
  readonly runIds: readonly RunId[];
  readonly runs: readonly CleanupRunResult[];
  readonly dryRun?: boolean;
  readonly matchedRuns?: number;
  readonly matchedEvents?: number;
  readonly matchedStepAttempts?: number;
  readonly matchedIdempotencyKeys?: number;
  readonly matchedMessageIdempotencyKeys?: number;
  readonly deletedRuns: number;
  readonly createdCleanupMarkers: number;
  readonly deletedCleanupMarkers: number;
  readonly deletedEvents: number;
  readonly deletedStepAttempts: number;
  readonly deletedIdempotencyKeys: number;
  readonly deletedMessageIdempotencyKeys: number;
}

/** Result returned by workflow cleanup run. */
export interface CleanupRunResult {
  readonly mode: CleanupMode;
  readonly runId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly status: WorkflowTerminalRunStatus;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly finishedAt: Temporal.Instant;
  readonly idempotencyKey?: string;
  readonly parentRunId?: RunId;
  readonly parentStepId?: StepId;
  readonly parentStepName?: string;
  readonly parentStepAttempt?: number;
  readonly events: number;
  readonly stepAttempts: number;
  readonly idempotencyKeys: number;
  readonly messageIdempotencyKeys: number;
  readonly cleanupMarkerCreated: boolean;
  readonly cleanupMarkerDeleted: boolean;
  readonly runDeleted: boolean;
  readonly deletedEvents: number;
  readonly deletedStepAttempts: number;
  readonly deletedIdempotencyKeys: number;
  readonly deletedMessageIdempotencyKeys: number;
}
