import type { WorkflowListRunsOptions } from "./run-list.ts";
import type {
  RunId,
  WorkflowRunRetryReason,
  WorkflowRunStatus,
  WorkflowRunTransitionReason,
  WorkflowTerminalRunStatus,
} from "./run.ts";
import type { ScheduleId } from "./schedule.ts";
import type { StepId } from "./step-id.ts";

type WorkflowSummaryIdArray = readonly string[];

/** Options for workflow run summary. */
export type WorkflowRunSummaryOptions = WorkflowListRunsOptions;

/** Options for workflow recovery summary. */
export type WorkflowRecoverySummaryOptions = WorkflowListRunsOptions;

/** Counts grouped by run status. */
export type WorkflowRunStatusCounts = Readonly<Record<WorkflowRunStatus, number>>;

/** Run IDs grouped by run status. */
export type WorkflowRunStatusRunIds = Readonly<Record<WorkflowRunStatus, WorkflowSummaryIdArray>>;

/** Counts grouped by run transition reason. */
export type WorkflowRunTransitionReasonCounts = Readonly<
  Record<WorkflowRunTransitionReason, number>
>;

/** Run IDs grouped by run transition reason. */
export type WorkflowRunTransitionReasonRunIds = Readonly<
  Record<WorkflowRunTransitionReason, WorkflowSummaryIdArray>
>;

/** Counts grouped by run retry reason. */
export type WorkflowRunRetryReasonCounts = Readonly<Record<WorkflowRunRetryReason, number>>;

/** Counts grouped by terminal run status. */
export type WorkflowTerminalRunStatusCounts = Readonly<Record<WorkflowTerminalRunStatus, number>>;

/** Run IDs grouped by terminal run status. */
export type WorkflowTerminalRunStatusRunIds = Readonly<
  Record<WorkflowTerminalRunStatus, WorkflowSummaryIdArray>
>;

/** Summary data for workflow recovery due. */
export interface WorkflowRecoveryDueSummary {
  readonly total: number;
  readonly runIds: WorkflowSummaryIdArray;
  readonly pendingRunIds: WorkflowSummaryIdArray;
  readonly waitingRunIds: WorkflowSummaryIdArray;
  readonly invalidScheduleRunIds: WorkflowSummaryIdArray;
  readonly nextAvailableAt?: Temporal.Instant;
  readonly nextAvailableRunId?: RunId;
}

/** Summary data for workflow recovery lease. */
export interface WorkflowRecoveryLeaseSummary {
  readonly total: number;
  readonly stale: number;
  readonly runIds: WorkflowSummaryIdArray;
  readonly staleRunIds: WorkflowSummaryIdArray;
  readonly ownerlessRunIds: WorkflowSummaryIdArray;
  readonly missingExpiresAtRunIds: WorkflowSummaryIdArray;
  readonly invalidExpiresAtRunIds: WorkflowSummaryIdArray;
  readonly expiredRunIds: WorkflowSummaryIdArray;
  readonly workerIds: WorkflowSummaryIdArray;
  readonly nextExpiresAt?: Temporal.Instant;
  readonly nextExpiringRunId?: RunId;
  readonly oldestStaleAt?: Temporal.Instant;
}

/** Summary data for workflow recovery retry. */
export interface WorkflowRecoveryRetrySummary {
  readonly total: number;
  readonly due: number;
  readonly runIds: WorkflowSummaryIdArray;
  readonly dueRunIds: WorkflowSummaryIdArray;
  readonly nextRetryAt?: Temporal.Instant;
  readonly nextRetryRunId?: RunId;
}

/** Summary data for workflow recovery missing implementation. */
export type WorkflowRecoveryMissingImplementationSummary = WorkflowRecoveryRetrySummary;

/** Summary data for workflow recovery failed. */
export interface WorkflowRecoveryFailedSummary {
  readonly total: number;
  readonly runIds: WorkflowSummaryIdArray;
  readonly latestFailedAt?: Temporal.Instant;
}

/** Summary data for workflow recovery schedule. */
export interface WorkflowRecoveryScheduleSummary {
  readonly total: number;
  readonly due: number;
  readonly scheduleIds: WorkflowSummaryIdArray;
  readonly dueScheduleIds: WorkflowSummaryIdArray;
  readonly invalidNextFireScheduleIds: WorkflowSummaryIdArray;
  readonly nextFireAt?: Temporal.Instant;
  readonly nextFireScheduleId?: ScheduleId;
}

/** Summary data for workflow recovery lock. */
export interface WorkflowRecoveryLockSummary {
  readonly total: number;
  readonly stale: number;
  readonly keys: WorkflowSummaryIdArray;
  readonly staleKeys: WorkflowSummaryIdArray;
  readonly holderIds: WorkflowSummaryIdArray;
  readonly waitingRunIds: WorkflowSummaryIdArray;
  readonly dueWaitingRunIds: WorkflowSummaryIdArray;
  readonly waitingStepIds: WorkflowSummaryIdArray;
  readonly waitingKeys: WorkflowSummaryIdArray;
  readonly nextExpiresAt?: Temporal.Instant;
  readonly nextExpiringKey?: string;
  readonly oldestStaleAt?: Temporal.Instant;
  readonly nextWaitDeadlineAt?: Temporal.Instant;
  readonly nextWaitDeadlineRunId?: RunId;
}

/** Summary data for workflow recovery sleep wait. */
export interface WorkflowRecoverySleepWaitSummary {
  readonly active: number;
  readonly due: number;
  readonly runIds: WorkflowSummaryIdArray;
  readonly dueRunIds: WorkflowSummaryIdArray;
  readonly dueStepIds: WorkflowSummaryIdArray;
  readonly invalidUntilRunIds: WorkflowSummaryIdArray;
  readonly nextWakeAt?: Temporal.Instant;
  readonly nextWakeRunId?: RunId;
}

/** Summary data for workflow recovery message wait. */
export interface WorkflowRecoveryMessageWaitSummary {
  readonly active: number;
  readonly ready: number;
  readonly timedOut: number;
  readonly runIds: WorkflowSummaryIdArray;
  readonly readyRunIds: WorkflowSummaryIdArray;
  readonly timedOutRunIds: WorkflowSummaryIdArray;
  readonly readyStepIds: WorkflowSummaryIdArray;
  readonly timedOutStepIds: WorkflowSummaryIdArray;
  readonly messages: WorkflowSummaryIdArray;
  readonly nextTimeoutAt?: Temporal.Instant;
  readonly nextTimeoutRunId?: RunId;
}

/** Summary data for workflow recovery child workflow wait. */
export interface WorkflowRecoveryChildWorkflowWaitSummary {
  readonly active: number;
  readonly terminal: number;
  readonly missing: number;
  readonly timedOut: number;
  readonly runIds: WorkflowSummaryIdArray;
  readonly terminalRunIds: WorkflowSummaryIdArray;
  readonly missingRunIds: WorkflowSummaryIdArray;
  readonly timedOutRunIds: WorkflowSummaryIdArray;
  readonly terminalStepIds: WorkflowSummaryIdArray;
  readonly missingStepIds: WorkflowSummaryIdArray;
  readonly timedOutStepIds: WorkflowSummaryIdArray;
  readonly childRunIds: WorkflowSummaryIdArray;
  readonly completedChildRunIds: WorkflowSummaryIdArray;
  readonly failedChildRunIds: WorkflowSummaryIdArray;
  readonly canceledChildRunIds: WorkflowSummaryIdArray;
  readonly nextTimeoutAt?: Temporal.Instant;
  readonly nextTimeoutRunId?: RunId;
}

/** Summary data for workflow recovery wait. */
export interface WorkflowRecoveryWaitSummary {
  readonly sleep: WorkflowRecoverySleepWaitSummary;
  readonly message: WorkflowRecoveryMessageWaitSummary;
  readonly childWorkflow: WorkflowRecoveryChildWorkflowWaitSummary;
}

/** Summary data for workflow recovery. */
export interface WorkflowRecoverySummary {
  readonly total: number;
  readonly recoverableRunIds: WorkflowSummaryIdArray;
  readonly due: WorkflowRecoveryDueSummary;
  readonly lease: WorkflowRecoveryLeaseSummary;
  readonly retry: WorkflowRecoveryRetrySummary;
  readonly missingImplementation: WorkflowRecoveryMissingImplementationSummary;
  readonly failed: WorkflowRecoveryFailedSummary;
  readonly schedule: WorkflowRecoveryScheduleSummary;
  readonly lock: WorkflowRecoveryLockSummary;
  readonly wait: WorkflowRecoveryWaitSummary;
  readonly nextRecoveryAt?: Temporal.Instant;
}

/** Describes the workflow run workflow count contract. */
export interface WorkflowRunWorkflowCount {
  readonly name: string;
  readonly version?: string;
  readonly count: number;
  readonly runIds: WorkflowSummaryIdArray;
}

/** Summary data for workflow run workflow. */
export interface WorkflowRunWorkflowSummary {
  readonly total: number;
  readonly workflows: readonly WorkflowRunWorkflowCount[];
}

/** Summary data for workflow run transition. */
export interface WorkflowRunTransitionSummary {
  readonly latestTransitionAt?: Temporal.Instant;
  readonly reason: WorkflowRunTransitionReasonCounts;
  readonly runIds: WorkflowRunTransitionReasonRunIds;
}

/** Summary data for workflow run retry. */
export interface WorkflowRunRetrySummary {
  readonly total: number;
  readonly retryRunIds: WorkflowSummaryIdArray;
  readonly retryStepIds: WorkflowSummaryIdArray;
  readonly retryStepNames: WorkflowSummaryIdArray;
  readonly nextRetryAt?: Temporal.Instant;
  readonly nextRetryRunId?: RunId;
  readonly highestAttempt?: number;
  readonly reason: WorkflowRunRetryReasonCounts;
}

/** Summary data for workflow run failure error. */
export interface WorkflowRunFailureErrorSummary {
  readonly name: string;
  readonly count: number;
  readonly failedRunIds: WorkflowSummaryIdArray;
  readonly latestFailedAt?: Temporal.Instant;
}

/** Summary data for workflow run failure. */
export interface WorkflowRunFailureSummary {
  readonly total: number;
  readonly failedRunIds: WorkflowSummaryIdArray;
  readonly errors: readonly WorkflowRunFailureErrorSummary[];
  readonly latestFailedAt?: Temporal.Instant;
}

/** Summary data for workflow run lease. */
export interface WorkflowRunLeaseSummary {
  readonly total: number;
  readonly expired: number;
  readonly runIds: WorkflowSummaryIdArray;
  readonly expiredRunIds: WorkflowSummaryIdArray;
  readonly workerIds: WorkflowSummaryIdArray;
  readonly nextExpiresAt?: Temporal.Instant;
  readonly nextExpiringRunId?: RunId;
  readonly oldestExpiredAt?: Temporal.Instant;
}

/** Summary data for workflow run cleanup. */
export interface WorkflowRunCleanupSummary {
  readonly eligibleRuns: number;
  readonly status: WorkflowTerminalRunStatusCounts;
  readonly statusRunIds: WorkflowTerminalRunStatusRunIds;
  readonly oldestFinishedAt?: Temporal.Instant;
  readonly newestFinishedAt?: Temporal.Instant;
}

/** Summary data for workflow run stream. */
export interface WorkflowRunStreamSummary {
  readonly activeStreams: number;
  readonly activeStreamRuns: number;
  readonly streamRunIds: WorkflowSummaryIdArray;
  readonly streamStepIds: WorkflowSummaryIdArray;
  readonly streamIds: WorkflowSummaryIdArray;
  readonly streamNames: WorkflowSummaryIdArray;
  readonly chunkCount: number;
  readonly oldestStartedAt?: Temporal.Instant;
}

/** Summary data for workflow run hook. */
export interface WorkflowRunHookSummary {
  readonly activeHooks: number;
  readonly activeWebhooks: number;
  readonly activeHookRuns: number;
  readonly hookRunIds: WorkflowSummaryIdArray;
  readonly hookStepIds: WorkflowSummaryIdArray;
  readonly hookNames: WorkflowSummaryIdArray;
  readonly webhookNames: WorkflowSummaryIdArray;
  readonly messages: WorkflowSummaryIdArray;
  readonly oldestStartedAt?: Temporal.Instant;
  readonly nextTimeoutAt?: Temporal.Instant;
  readonly nextTimeoutRunId?: RunId;
  readonly nextTimeoutStepId?: StepId;
}

/** Summary data for workflow run sleep. */
export interface WorkflowRunSleepSummary {
  readonly activeSleeps: number;
  readonly activeSleepRuns: number;
  readonly sleepRunIds: WorkflowSummaryIdArray;
  readonly sleepStepIds: WorkflowSummaryIdArray;
  readonly sleepAttemptKeys: WorkflowSummaryIdArray;
  readonly oldestStartedAt?: Temporal.Instant;
  readonly nextWakeAt?: Temporal.Instant;
  readonly nextWakingRunId?: RunId;
  readonly nextWakingStepId?: StepId;
  readonly nextWakingAttemptKey?: string;
  readonly nextWakingDuration?: Temporal.Duration;
}

/** Summary data for workflow run messageId. */
export interface WorkflowRunMessageSummary {
  readonly activeWaits: number;
  readonly activeWaitRuns: number;
  readonly waitRunIds: WorkflowSummaryIdArray;
  readonly waitStepIds: WorkflowSummaryIdArray;
  readonly waitAttemptKeys: WorkflowSummaryIdArray;
  readonly messages: WorkflowSummaryIdArray;
  readonly oldestWaitStartedAt?: Temporal.Instant;
  readonly nextWaitTimeoutAt?: Temporal.Instant;
  readonly nextWaitTimeoutRunId?: RunId;
  readonly nextWaitTimeoutStepId?: StepId;
  readonly nextWaitTimeoutAttemptKey?: string;
}

/** Summary data for workflow run child workflow. */
export interface WorkflowRunChildWorkflowSummary {
  readonly activeWaits: number;
  readonly activeWaitRuns: number;
  readonly waitRunIds: WorkflowSummaryIdArray;
  readonly waitStepIds: WorkflowSummaryIdArray;
  readonly waitAttemptKeys: WorkflowSummaryIdArray;
  readonly childRunIds: WorkflowSummaryIdArray;
  readonly retryChildRunIds?: WorkflowSummaryIdArray;
  readonly failedChildRunIds?: WorkflowSummaryIdArray;
  readonly canceledChildRunIds?: WorkflowSummaryIdArray;
  readonly workflows: WorkflowSummaryIdArray;
  readonly childStatus: WorkflowRunStatusCounts;
  readonly childRetry?: WorkflowRunRetrySummary;
  readonly childFailure?: WorkflowRunFailureSummary;
  readonly oldestWaitStartedAt?: Temporal.Instant;
  readonly nextWaitTimeoutAt?: Temporal.Instant;
  readonly nextWaitTimeoutRunId?: RunId;
  readonly nextWaitTimeoutStepId?: StepId;
  readonly nextWaitTimeoutAttemptKey?: string;
}

/** Summary data for workflow run. */
export interface WorkflowRunSummary {
  readonly total: number;
  readonly status: WorkflowRunStatusCounts;
  readonly statusRunIds: WorkflowRunStatusRunIds;
  readonly workflow: WorkflowRunWorkflowSummary;
  readonly transition: WorkflowRunTransitionSummary;
  readonly retry: WorkflowRunRetrySummary;
  readonly failure?: WorkflowRunFailureSummary;
  readonly lease: WorkflowRunLeaseSummary;
  readonly cleanup?: WorkflowRunCleanupSummary;
  readonly stream?: WorkflowRunStreamSummary;
  readonly hook?: WorkflowRunHookSummary;
  readonly sleep?: WorkflowRunSleepSummary;
  readonly childWorkflow?: WorkflowRunChildWorkflowSummary;
  readonly messageId?: WorkflowRunMessageSummary;
  readonly nextAvailableAt?: Temporal.Instant;
  readonly oldestPendingAt?: Temporal.Instant;
  readonly oldestRunningAt?: Temporal.Instant;
}
