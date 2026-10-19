import type { StorageValue } from "@temelj/storage";

import type { WorkflowErrorRecord } from "./error.ts";
import type { MessageId, RunId, StepId } from "./ids.ts";
import type { MaterializedStepType } from "./run.ts";
import type { ChildWorkflowCancellationPolicy } from "./step.ts";
import type { RunFailureSummary, RunRetrySummary, RunStatusCounts } from "./summary.ts";

export type StepAttemptStatus = "running" | "completed" | "failed" | "abandoned";

export interface StepAttemptRecord {
  readonly runId: RunId;
  readonly stepId: StepId;
  readonly stepName: string;
  readonly kind: MaterializedStepType;
  readonly status: StepAttemptStatus;
  readonly attempt: number;
  readonly count?: number;
  readonly output?: StorageValue;
  readonly error?: WorkflowErrorRecord;
  readonly until?: Temporal.Instant;
  readonly duration?: Temporal.Duration;
  readonly childRunId?: RunId;
  readonly workflowName?: string;
  readonly workflowVersion?: string;
  readonly cancellation?: ChildWorkflowCancellationPolicy;
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

export interface ListStepAttemptsOptions {
  readonly status?: StepAttemptStatus | readonly StepAttemptStatus[];
  readonly kind?: MaterializedStepType | readonly MaterializedStepType[];
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

type StepAttemptSummaryStringArray = readonly string[];

export interface StepAttemptSummary {
  readonly total: number;
  readonly statusStepIds: StepAttemptStatusStepIds;
  readonly statusAttemptKeys: StepAttemptStatusAttemptKeys;
  readonly kindStepIds: StepAttemptKindStepIds;
  readonly kindAttemptKeys: StepAttemptKindAttemptKeys;
  readonly failure?: StepAttemptFailureSummary;
  readonly oldestRunningAt?: Temporal.Instant;
  readonly latestFinishedAt?: Temporal.Instant;
  readonly sleep?: ActiveSleepSummary;
  readonly childWorkflow?: ActiveChildWorkflowSummary;
  readonly message?: ActiveMessageWaitSummary;
}

/** The step attempt in this run whose wake-up or timeout comes first. */
export interface NextAttempt {
  readonly at: Temporal.Instant;
  readonly stepId: StepId;
  readonly attemptKey: string;
}

export interface NextAttemptSleep extends NextAttempt {
  readonly duration?: Temporal.Duration;
}

/** Step IDs grouped by step attempt status. */
export type StepAttemptStatusStepIds = Readonly<
  Record<StepAttemptStatus, StepAttemptSummaryStringArray>
>;

export type StepAttemptStatusAttemptKeys = Readonly<
  Record<StepAttemptStatus, StepAttemptSummaryStringArray>
>;

/** Step IDs grouped by step attempt kind. */
export type StepAttemptKindStepIds = Readonly<
  Record<MaterializedStepType, StepAttemptSummaryStringArray>
>;

export type StepAttemptKindAttemptKeys = Readonly<
  Record<MaterializedStepType, StepAttemptSummaryStringArray>
>;

export interface StepAttemptFailureSummary {
  readonly stepIds: StepAttemptSummaryStringArray;
  readonly attemptKeys: StepAttemptSummaryStringArray;
  readonly errors: readonly StepAttemptFailureErrorSummary[];
  readonly latestFailedAt?: Temporal.Instant;
}

export interface StepAttemptFailureErrorSummary {
  readonly name: string;
  readonly stepIds: StepAttemptSummaryStringArray;
  readonly attemptKeys: StepAttemptSummaryStringArray;
  readonly latestFailedAt?: Temporal.Instant;
}

export interface ActiveSleepSummary {
  readonly stepIds: StepAttemptSummaryStringArray;
  readonly attemptKeys: StepAttemptSummaryStringArray;
  readonly next?: NextAttemptSleep;
}

export interface ActiveMessageWaitSummary {
  readonly stepIds: StepAttemptSummaryStringArray;
  readonly attemptKeys: StepAttemptSummaryStringArray;
  readonly messages: StepAttemptSummaryStringArray;
  readonly oldestStartedAt?: Temporal.Instant;
  readonly next?: NextAttempt;
}

export interface ActiveChildWorkflowSummary {
  readonly stepIds: StepAttemptSummaryStringArray;
  readonly attemptKeys: StepAttemptSummaryStringArray;
  readonly childRunIds: StepAttemptSummaryStringArray;
  readonly retryChildRunIds?: StepAttemptSummaryStringArray;
  readonly failedChildRunIds?: StepAttemptSummaryStringArray;
  readonly canceledChildRunIds?: StepAttemptSummaryStringArray;
  readonly workflows: StepAttemptSummaryStringArray;
  readonly childStatus: RunStatusCounts;
  readonly childRetry?: RunRetrySummary;
  readonly childFailure?: RunFailureSummary;
  readonly oldestStartedAt?: Temporal.Instant;
  readonly next?: NextAttempt;
}
