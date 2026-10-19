import type { RunId } from "./ids.ts";
import type { RunLinks, TerminalRunStatus } from "./run.ts";

/** Cleanup strategy used when deleting terminal run data from the store. */
export type CleanupMode = "best_effort";

export interface CleanupRunsOptions extends CleanupRunFilterOptions {
  readonly finishedAtBefore: Temporal.Instant;
}

export type CleanupStatusFilter = TerminalRunStatus | readonly TerminalRunStatus[];

export interface RetentionPolicyOptions extends CleanupRunFilterOptions {
  readonly olderThan: Temporal.Duration;
  readonly now?: Temporal.Instant;
}

interface CleanupRunFilterOptions extends RunLinks {
  readonly status?: CleanupStatusFilter;
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly dryRun?: boolean;
  readonly limit?: number;
}

export interface CleanupMarkerRecord {
  readonly mode: CleanupMode;
  readonly runId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly status: TerminalRunStatus;
  readonly createdAt: Temporal.Instant;
  readonly finishedAt: Temporal.Instant;
  readonly cleanupStartedAt: Temporal.Instant;
  readonly events: number;
  readonly stepAttempts: number;
  readonly idempotencyKeys: number;
  readonly messageIdempotencyKeys: number;
}

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

export interface CleanupRunResult extends RunLinks {
  readonly mode: CleanupMode;
  readonly runId: RunId;
  readonly workflowName: string;
  readonly workflowVersion?: string;
  readonly status: TerminalRunStatus;
  readonly createdAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
  readonly finishedAt: Temporal.Instant;
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
