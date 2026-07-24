import type { RunId, WorkflowRunRecord, WorkflowRunRetryReason } from "../../types/run.ts";
import type { WorkflowRunRetrySummary } from "../../types/summary.ts";
import type { WorkflowRunRetryReasonCounts } from "./run-metrics.ts";

import { optionalProperty, sortedStringSet } from "../../collection.ts";
import { greatestOptionalNumber, isScheduledWorkflowRunStatus } from "../../utility.ts";
import { createWorkflowRunRetryReasonCounts } from "./run-metrics.ts";

interface WorkflowRunRetryAccumulator {
  total: number;
  highestAttempt?: number;
  nextRetryAt?: Temporal.Instant;
  nextRetryRunId?: RunId;
  readonly reason: WorkflowRunRetryReasonCounts;
  readonly runIds: Set<string>;
  readonly stepIds: Set<string>;
  readonly stepNames: Set<string>;
}

export function createWorkflowRunRetrySummaryReducer(): {
  readonly addRun: (run: WorkflowRunRecord) => void;
  readonly finish: () => WorkflowRunRetrySummary;
} {
  const retry = createWorkflowRunRetryAccumulator();

  return {
    addRun(run) {
      addWorkflowRunRetry(retry, run);
    },
    finish() {
      return finishWorkflowRunRetrySummary(retry);
    },
  };
}

function createWorkflowRunRetryAccumulator(): WorkflowRunRetryAccumulator {
  return {
    total: 0,
    reason: createWorkflowRunRetryReasonCounts(),
    runIds: new Set<string>(),
    stepIds: new Set<string>(),
    stepNames: new Set<string>(),
  };
}

function addWorkflowRunRetry(retry: WorkflowRunRetryAccumulator, run: WorkflowRunRecord): void {
  if (!isWorkflowRunScheduledForRetry(run)) {
    return;
  }
  const reason = workflowRunRetryReason(run.retryReason);
  if (reason === undefined) {
    return;
  }
  retry.total++;
  retry.runIds.add(run.id);
  retry.reason[reason]++;
  addWorkflowRunRetryMetadata(retry, run);
  setWorkflowRunRetryHighestAttempt(retry, run);
  setWorkflowRunNextRetry(retry, run);
}

function isWorkflowRunScheduledForRetry(run: WorkflowRunRecord): boolean {
  return isScheduledWorkflowRunStatus(run.status) && run.retryReason !== undefined;
}

function addWorkflowRunRetryMetadata(
  retry: WorkflowRunRetryAccumulator,
  run: WorkflowRunRecord,
): void {
  if (run.retryStepId !== undefined) {
    retry.stepIds.add(run.retryStepId);
  }
  if (run.retryStepName !== undefined) {
    retry.stepNames.add(run.retryStepName);
  }
}

function setWorkflowRunRetryHighestAttempt(
  retry: WorkflowRunRetryAccumulator,
  run: WorkflowRunRecord,
): void {
  retry.highestAttempt = greatestOptionalNumber(retry.highestAttempt, run.retryAttempt);
}

function setWorkflowRunNextRetry(retry: WorkflowRunRetryAccumulator, run: WorkflowRunRecord): void {
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

function finishWorkflowRunRetrySummary(
  retry: WorkflowRunRetryAccumulator,
): WorkflowRunRetrySummary {
  return {
    total: retry.total,
    retryRunIds: sortedStringSet(retry.runIds),
    retryStepIds: sortedStringSet(retry.stepIds),
    retryStepNames: sortedStringSet(retry.stepNames),
    reason: retry.reason,
    ...(retry.nextRetryAt === undefined
      ? {}
      : {
          nextRetryAt: retry.nextRetryAt,
          ...optionalProperty("nextRetryRunId", retry.nextRetryRunId),
        }),
    ...optionalProperty("highestAttempt", retry.highestAttempt),
  };
}

function workflowRunRetryReason(
  reason: WorkflowRunRetryReason | undefined,
): WorkflowRunRetryReason | undefined {
  return reason === "workflow" || reason === "step" || reason === "missing_implementation"
    ? reason
    : undefined;
}
