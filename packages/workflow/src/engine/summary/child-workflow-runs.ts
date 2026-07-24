import type {
  RunId,
  WorkflowRunRecord,
  WorkflowRunRetryReason,
  WorkflowRunStatus,
} from "../../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";
import type { WorkflowRunReaderRepository } from "../../types/store.ts";
import type {
  WorkflowRunFailureErrorSummary,
  WorkflowRunFailureSummary,
  WorkflowRunRetrySummary,
} from "../../types/summary.ts";

import {
  optionalProperty,
  optionalSortedStringSetProperty,
  sortedStringSet,
} from "../../collection.ts";
import { latestOptionalTimestamp } from "../../temporal.ts";
import {
  greatestOptionalNumber,
  isScheduledWorkflowRunStatus,
  isWorkflowRunStatus,
} from "../../utility.ts";
import {
  createWorkflowRunRetryReasonCounts,
  createWorkflowRunStatusCounts,
} from "./run-metrics.ts";

export interface WorkflowChildWorkflowRunSummaryFields {
  readonly childStatus: Record<WorkflowRunStatus, number>;
  readonly retryChildRunIds?: readonly string[];
  readonly failedChildRunIds?: readonly string[];
  readonly canceledChildRunIds?: readonly string[];
  readonly childRetry?: WorkflowRunRetrySummary;
  readonly childFailure?: WorkflowRunFailureSummary;
}

interface WorkflowChildWorkflowRunRetrySummaryFields {
  readonly childRetry?: WorkflowRunRetrySummary;
}

interface WorkflowChildWorkflowRunFailureSummaryFields {
  readonly childFailure?: WorkflowRunFailureSummary;
}

interface WorkflowChildWorkflowRunRetryAccumulator {
  highestAttempt?: number;
  nextRetryAt?: Temporal.Instant;
  nextRetryRunId?: RunId;
  total: number;
  readonly reason: Record<WorkflowRunRetryReason, number>;
  readonly retryRunIds: Set<string>;
  readonly retryStepIds: Set<string>;
  readonly retryStepNames: Set<string>;
}

interface WorkflowChildWorkflowRunFailureAccumulator {
  latestFailedAt?: Temporal.Instant;
  total: number;
  readonly errors: Map<string, WorkflowChildWorkflowRunFailureErrorAccumulator>;
  readonly failedRunIds: Set<string>;
}

interface WorkflowChildWorkflowRunFailureErrorAccumulator {
  count: number;
  latestFailedAt?: Temporal.Instant;
  readonly failedRunIds: Set<string>;
}

export interface WorkflowChildWorkflowRunSummaryReducer {
  addRun(run: WorkflowRunRecord): void;
  finish(): WorkflowChildWorkflowRunSummaryFields;
}

export async function getChildRunsForAttempts(
  store: WorkflowRunReaderRepository,
  parentRunId: RunId,
  attempts: readonly WorkflowStepAttemptRecord[],
): Promise<readonly WorkflowRunRecord[]> {
  const childRunIds = [
    ...new Set(
      attempts.flatMap((attempt) => (attempt.childRunId === undefined ? [] : [attempt.childRunId])),
    ),
  ];
  const childRuns = await Promise.all(childRunIds.map(async (runId) => await store.getRun(runId)));
  return childRuns.filter(
    (run): run is WorkflowRunRecord =>
      run !== undefined &&
      attempts.some((attempt) => isChildRunForWorkflowStepAttempt(run, parentRunId, attempt)),
  );
}

/** Creates a reducer for child workflow run state embedded in active child workflow waits. */
export function createWorkflowChildWorkflowRunSummaryReducer(): WorkflowChildWorkflowRunSummaryReducer {
  const childStatus = createWorkflowRunStatusCounts();
  const retry = createWorkflowChildWorkflowRunRetryAccumulator();
  const failure = createWorkflowChildWorkflowRunFailureAccumulator();
  const failedChildRunIds = new Set<string>();
  const canceledChildRunIds = new Set<string>();

  return {
    addRun(run) {
      if (!isWorkflowRunStatus(run.status)) {
        return;
      }
      const runStatus = run.status;
      childStatus[runStatus]++;
      addWorkflowChildWorkflowRunRetry(retry, run, runStatus);
      if (runStatus === "failed") {
        addWorkflowChildWorkflowRunFailure(failure, run);
        failedChildRunIds.add(run.id);
      }
      if (runStatus === "canceled") {
        canceledChildRunIds.add(run.id);
      }
    },
    finish() {
      return {
        childStatus,
        ...optionalSortedStringSetProperty("retryChildRunIds", retry.retryRunIds),
        ...optionalSortedStringSetProperty("failedChildRunIds", failedChildRunIds),
        ...optionalSortedStringSetProperty("canceledChildRunIds", canceledChildRunIds),
        ...finishWorkflowChildWorkflowRunRetrySummary(retry),
        ...finishWorkflowChildWorkflowRunFailureSummary(failure),
      };
    },
  };
}

export function summarizeChildWorkflowRuns(
  runs: readonly WorkflowRunRecord[],
): WorkflowChildWorkflowRunSummaryFields {
  const reducer = createWorkflowChildWorkflowRunSummaryReducer();
  for (const run of runs) {
    reducer.addRun(run);
  }
  return reducer.finish();
}

function isChildRunForWorkflowStepAttempt(
  run: WorkflowRunRecord,
  parentRunId: RunId,
  attempt: WorkflowStepAttemptRecord,
): boolean {
  return (
    run.parentRunId === parentRunId &&
    run.parentStepId === attempt.stepId &&
    run.parentStepName === attempt.stepName &&
    run.parentStepAttempt === attempt.attempt &&
    attempt.childRunId === run.id &&
    attempt.workflowName === run.workflowName &&
    attempt.workflowVersion === run.workflowVersion
  );
}

function createWorkflowChildWorkflowRunRetryAccumulator(): WorkflowChildWorkflowRunRetryAccumulator {
  return {
    total: 0,
    reason: createWorkflowRunRetryReasonCounts(),
    retryRunIds: new Set<string>(),
    retryStepIds: new Set<string>(),
    retryStepNames: new Set<string>(),
  };
}

function createWorkflowChildWorkflowRunFailureAccumulator(): WorkflowChildWorkflowRunFailureAccumulator {
  return {
    total: 0,
    errors: new Map<string, WorkflowChildWorkflowRunFailureErrorAccumulator>(),
    failedRunIds: new Set<string>(),
  };
}

function addWorkflowChildWorkflowRunRetry(
  retry: WorkflowChildWorkflowRunRetryAccumulator,
  run: WorkflowRunRecord,
  runStatus: WorkflowRunStatus,
): void {
  const retryReason = workflowChildWorkflowRunRetryReason(run);
  if (!isScheduledWorkflowRunStatus(runStatus) || retryReason === undefined) {
    return;
  }
  retry.total++;
  retry.retryRunIds.add(run.id);
  addWorkflowChildWorkflowRunRetryMetadata(retry, run);
  retry.reason[retryReason]++;
  setWorkflowChildWorkflowRunHighestAttempt(retry, run);
  setWorkflowChildWorkflowRunNextRetry(retry, run);
}

function setWorkflowChildWorkflowRunHighestAttempt(
  retry: WorkflowChildWorkflowRunRetryAccumulator,
  run: WorkflowRunRecord,
): void {
  retry.highestAttempt = greatestOptionalNumber(retry.highestAttempt, run.retryAttempt);
}

function addWorkflowChildWorkflowRunRetryMetadata(
  retry: WorkflowChildWorkflowRunRetryAccumulator,
  run: WorkflowRunRecord,
): void {
  if (run.retryStepId !== undefined) {
    retry.retryStepIds.add(run.retryStepId);
  }
  if (run.retryStepName !== undefined) {
    retry.retryStepNames.add(run.retryStepName);
  }
}

function setWorkflowChildWorkflowRunNextRetry(
  retry: WorkflowChildWorkflowRunRetryAccumulator,
  run: WorkflowRunRecord,
): void {
  if (
    run.retryAt === undefined ||
    (retry.nextRetryAt !== undefined &&
      Temporal.Instant.compare(run.retryAt, retry.nextRetryAt) >= 0)
  ) {
    return;
  }
  retry.nextRetryAt = run.retryAt;
  retry.nextRetryRunId = run.id;
}

function workflowChildWorkflowRunRetryReason(
  run: WorkflowRunRecord,
): WorkflowRunRetryReason | undefined {
  return run.retryReason === "workflow" ||
    run.retryReason === "step" ||
    run.retryReason === "missing_implementation"
    ? run.retryReason
    : undefined;
}

function addWorkflowChildWorkflowRunFailure(
  failure: WorkflowChildWorkflowRunFailureAccumulator,
  run: WorkflowRunRecord,
): void {
  failure.total++;
  failure.failedRunIds.add(run.id);
  failure.latestFailedAt = latestOptionalTimestamp(failure.latestFailedAt, run.finishedAt);
  addWorkflowChildWorkflowRunFailureError(failure, run);
}

function addWorkflowChildWorkflowRunFailureError(
  failure: WorkflowChildWorkflowRunFailureAccumulator,
  run: WorkflowRunRecord,
): void {
  const errorName = run.error?.name ?? "Error";
  const current = failure.errors.get(errorName) ?? {
    count: 0,
    failedRunIds: new Set<string>(),
  };
  current.count++;
  current.failedRunIds.add(run.id);
  current.latestFailedAt = latestOptionalTimestamp(current.latestFailedAt, run.finishedAt);
  failure.errors.set(errorName, current);
}

function finishWorkflowChildWorkflowRunRetrySummary(
  retry: WorkflowChildWorkflowRunRetryAccumulator,
): WorkflowChildWorkflowRunRetrySummaryFields {
  return retry.total === 0
    ? {}
    : {
        childRetry: {
          total: retry.total,
          retryRunIds: sortedStringSet(retry.retryRunIds),
          retryStepIds: sortedStringSet(retry.retryStepIds),
          retryStepNames: sortedStringSet(retry.retryStepNames),
          reason: retry.reason,
          ...(retry.nextRetryAt === undefined
            ? {}
            : {
                nextRetryAt: retry.nextRetryAt,
                ...optionalProperty("nextRetryRunId", retry.nextRetryRunId),
              }),
          ...optionalProperty("highestAttempt", retry.highestAttempt),
        },
      };
}

function finishWorkflowChildWorkflowRunFailureSummary(
  failure: WorkflowChildWorkflowRunFailureAccumulator,
): WorkflowChildWorkflowRunFailureSummaryFields {
  return failure.total === 0
    ? {}
    : {
        childFailure: {
          total: failure.total,
          failedRunIds: sortedStringSet(failure.failedRunIds),
          errors: finishWorkflowChildWorkflowRunFailureErrors(failure.errors),
          ...optionalProperty("latestFailedAt", failure.latestFailedAt),
        },
      };
}

function finishWorkflowChildWorkflowRunFailureErrors(
  errors: ReadonlyMap<string, WorkflowChildWorkflowRunFailureErrorAccumulator>,
): WorkflowRunFailureErrorSummary[] {
  return [...errors.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, summary]) => ({
      name,
      count: summary.count,
      failedRunIds: sortedStringSet(summary.failedRunIds),
      ...optionalProperty("latestFailedAt", summary.latestFailedAt),
    }));
}
