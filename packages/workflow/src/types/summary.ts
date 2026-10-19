import type { RunId, StepId } from "./ids.ts";
import type { RunRetryReason, RunStatus, RunTransitionReason, TerminalRunStatus } from "./run.ts";
import type { ScheduleId } from "./schedule.ts";

type SummaryIdArray = readonly string[];

export type RunStatusCounts = Readonly<Record<RunStatus, number>>;

export type RunTransitionReasonCounts = Readonly<Record<RunTransitionReason, number>>;

export type RunRetryReasonCounts = Readonly<Record<RunRetryReason, number>>;

export type TerminalRunStatusCounts = Readonly<Record<TerminalRunStatus, number>>;

/** The run whose deadline, wake-up, or expiry comes first. */
export interface NextRun {
  readonly at: Temporal.Instant;
  readonly runId: RunId;
}

/** The step attempt whose wake-up or timeout comes first. */
export interface NextStep extends NextRun {
  readonly stepId: StepId;
  readonly attemptKey?: string;
}

export interface NextSleep extends NextStep {
  readonly duration?: Temporal.Duration;
}

export interface NextSchedule {
  readonly at: Temporal.Instant;
  readonly scheduleId: ScheduleId;
}

export interface NextLock {
  readonly at: Temporal.Instant;
  readonly key: string;
}

export interface RecoveryDueSummary {
  readonly runIds: SummaryIdArray;
  readonly pendingRunIds: SummaryIdArray;
  readonly waitingRunIds: SummaryIdArray;
  readonly next?: NextRun;
}

export interface RecoveryLeaseSummary {
  readonly runIds: SummaryIdArray;
  readonly staleRunIds: SummaryIdArray;
  readonly ownerlessRunIds: SummaryIdArray;
  readonly missingExpiresAtRunIds: SummaryIdArray;
  readonly expiredRunIds: SummaryIdArray;
  readonly workerIds: SummaryIdArray;
  readonly next?: NextRun;
  readonly oldestStaleAt?: Temporal.Instant;
}

export interface RecoveryRetrySummary {
  readonly runIds: SummaryIdArray;
  readonly dueRunIds: SummaryIdArray;
  readonly next?: NextRun;
}

export interface RecoveryFailedSummary {
  readonly runIds: SummaryIdArray;
  readonly latestFailedAt?: Temporal.Instant;
}

export interface RecoveryScheduleSummary {
  readonly scheduleIds: SummaryIdArray;
  readonly dueScheduleIds: SummaryIdArray;
  readonly next?: NextSchedule;
}

export interface RecoveryLockSummary {
  readonly keys: SummaryIdArray;
  readonly staleKeys: SummaryIdArray;
  readonly holderIds: SummaryIdArray;
  readonly waitingRunIds: SummaryIdArray;
  readonly dueWaitingRunIds: SummaryIdArray;
  readonly waitingStepIds: SummaryIdArray;
  readonly waitingKeys: SummaryIdArray;
  readonly oldestStaleAt?: Temporal.Instant;
  readonly nextExpiry?: NextLock;
  readonly nextWaitDeadline?: NextRun;
}

export interface RecoverySleepWaitSummary {
  readonly runIds: SummaryIdArray;
  readonly dueRunIds: SummaryIdArray;
  readonly dueStepIds: SummaryIdArray;
  readonly invalidUntilRunIds: SummaryIdArray;
  readonly next?: NextRun;
}

export interface RecoveryMessageWaitSummary {
  readonly runIds: SummaryIdArray;
  readonly readyRunIds: SummaryIdArray;
  readonly timedOutRunIds: SummaryIdArray;
  readonly readyStepIds: SummaryIdArray;
  readonly timedOutStepIds: SummaryIdArray;
  readonly messages: SummaryIdArray;
  readonly next?: NextRun;
}

export interface RecoveryChildWorkflowWaitSummary {
  readonly runIds: SummaryIdArray;
  readonly terminalRunIds: SummaryIdArray;
  readonly missingRunIds: SummaryIdArray;
  readonly timedOutRunIds: SummaryIdArray;
  readonly terminalStepIds: SummaryIdArray;
  readonly missingStepIds: SummaryIdArray;
  readonly timedOutStepIds: SummaryIdArray;
  readonly childRunIds: SummaryIdArray;
  readonly completedChildRunIds: SummaryIdArray;
  readonly failedChildRunIds: SummaryIdArray;
  readonly canceledChildRunIds: SummaryIdArray;
  readonly next?: NextRun;
}

export interface RecoveryWaitSummary {
  readonly sleep: RecoverySleepWaitSummary;
  readonly message: RecoveryMessageWaitSummary;
  readonly childWorkflow: RecoveryChildWorkflowWaitSummary;
}

export interface RecoverySummary {
  readonly total: number;
  readonly recoverableRunIds: SummaryIdArray;
  readonly due: RecoveryDueSummary;
  readonly lease: RecoveryLeaseSummary;
  readonly retry: RecoveryRetrySummary;
  readonly missingImplementation: RecoveryRetrySummary;
  readonly failed: RecoveryFailedSummary;
  readonly schedule: RecoveryScheduleSummary;
  readonly lock: RecoveryLockSummary;
  readonly wait: RecoveryWaitSummary;
  readonly nextRecoveryAt?: Temporal.Instant;
}

/** Run count for one workflow name and version. */
export interface RunWorkflowCount {
  readonly name: string;
  readonly version?: string;
  readonly count: number;
}

export interface RunTransitionSummary {
  readonly reason: RunTransitionReasonCounts;
  readonly latestTransitionAt?: Temporal.Instant;
}

export interface RunRetrySummary {
  readonly count: number;
  readonly stepNames: SummaryIdArray;
  readonly reason: RunRetryReasonCounts;
  readonly highestAttempt?: number;
  readonly next?: NextRun;
}

export interface RunFailureErrorSummary {
  readonly name: string;
  readonly count: number;
  readonly latestFailedAt?: Temporal.Instant;
}

export interface RunFailureSummary {
  readonly count: number;
  readonly errors: readonly RunFailureErrorSummary[];
  readonly latestFailedAt?: Temporal.Instant;
}

export interface RunLeaseSummary {
  readonly count: number;
  readonly expired: number;
  readonly workerIds: SummaryIdArray;
  readonly oldestExpiredAt?: Temporal.Instant;
  readonly next?: NextRun;
}

export interface RunCleanupSummary {
  readonly status: TerminalRunStatusCounts;
  readonly oldestFinishedAt?: Temporal.Instant;
  readonly newestFinishedAt?: Temporal.Instant;
}

/** Active waits of one kind: how many, and since when. */
export interface RunWaitSummary {
  readonly count: number;
  readonly oldestStartedAt?: Temporal.Instant;
}

export interface RunStreamSummary extends RunWaitSummary {
  readonly names: SummaryIdArray;
  readonly chunkCount: number;
}

export interface RunHookSummary extends RunWaitSummary {
  readonly webhooks: number;
  readonly hookNames: SummaryIdArray;
  readonly webhookNames: SummaryIdArray;
  readonly messages: SummaryIdArray;
  readonly next?: NextStep;
}

export interface RunSleepSummary extends RunWaitSummary {
  readonly next?: NextSleep;
}

export interface RunMessageSummary extends RunWaitSummary {
  readonly messages: SummaryIdArray;
  readonly next?: NextStep;
}

export interface RunChildWorkflowSummary extends RunWaitSummary {
  readonly workflows: SummaryIdArray;
  readonly childStatus: RunStatusCounts;
  readonly childRetry?: RunRetrySummary;
  readonly childFailure?: RunFailureSummary;
  readonly next?: NextStep;
}

/**
 * Counts and next due times across runs, sized by the number of distinct names rather than the
 * number of runs. Use `runs.list` for the runs themselves, or `admin.recovery` for the runs that
 * need action.
 */
export interface RunSummary {
  readonly total: number;
  readonly status: RunStatusCounts;
  readonly workflows: readonly RunWorkflowCount[];
  readonly transition: RunTransitionSummary;
  readonly retry: RunRetrySummary;
  readonly failure?: RunFailureSummary;
  readonly lease: RunLeaseSummary;
  readonly cleanup?: RunCleanupSummary;
  readonly stream?: RunStreamSummary;
  readonly hook?: RunHookSummary;
  readonly sleep?: RunSleepSummary;
  readonly childWorkflow?: RunChildWorkflowSummary;
  readonly message?: RunMessageSummary;
  readonly nextAvailableAt?: Temporal.Instant;
  readonly oldestPendingAt?: Temporal.Instant;
  readonly oldestRunningAt?: Temporal.Instant;
}
