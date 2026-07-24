import type { WorkflowRunRecord } from "../../types/run.ts";
import type {
  WorkflowRecoveryMissingImplementationSummary,
  WorkflowRecoveryRetrySummary,
} from "../../types/summary.ts";

import { isScheduledWorkflowRunStatus } from "../../utility.ts";
import {
  earliestWorkflowRecoveryTimestamp,
  isWorkflowRecoveryRunDueAt,
  type WorkflowRecoveryTimestamp,
} from "./recovery-run-timestamps.ts";

export interface WorkflowRecoveryRetryRunSummaryParts {
  readonly retry: WorkflowRecoveryRetrySummary;
  readonly missingImplementation: WorkflowRecoveryMissingImplementationSummary;
  readonly dueRetryRunIds: readonly string[];
  readonly nextRetry?: WorkflowRecoveryTimestamp;
}

export interface WorkflowRecoveryRetryRunSummaryReducer {
  addRun(run: WorkflowRunRecord): void;
  finish(): WorkflowRecoveryRetryRunSummaryParts;
}

interface WorkflowRecoveryRetryRunAccumulator {
  readonly runIds: Set<string>;
  readonly dueRunIds: Set<string>;
  readonly missingImplementationRunIds: Set<string>;
  readonly dueMissingImplementationRunIds: Set<string>;
  next?: WorkflowRecoveryTimestamp;
  nextMissingImplementation?: WorkflowRecoveryTimestamp;
}

export function createWorkflowRecoveryRetryRunSummaryReducer(
  now: Temporal.Instant,
): WorkflowRecoveryRetryRunSummaryReducer {
  const retry = createWorkflowRecoveryRetryRunAccumulator();
  return {
    addRun(run) {
      addWorkflowRecoveryRetryRun(retry, run, now);
    },
    finish() {
      return {
        retry: finishWorkflowRecoveryRetrySummary(retry),
        missingImplementation: finishWorkflowRecoveryMissingImplementationSummary(retry),
        dueRetryRunIds: [...retry.dueRunIds].sort(),
        ...(retry.next === undefined ? {} : { nextRetry: retry.next }),
      };
    },
  };
}

function createWorkflowRecoveryRetryRunAccumulator(): WorkflowRecoveryRetryRunAccumulator {
  return {
    runIds: new Set<string>(),
    dueRunIds: new Set<string>(),
    missingImplementationRunIds: new Set<string>(),
    dueMissingImplementationRunIds: new Set<string>(),
  };
}

function addWorkflowRecoveryRetryRun(
  retry: WorkflowRecoveryRetryRunAccumulator,
  run: WorkflowRunRecord,
  now: Temporal.Instant,
): void {
  if (!isScheduledWorkflowRunStatus(run.status) || run.retryReason === undefined) {
    return;
  }
  retry.runIds.add(run.id);
  const retryAt = run.retryAt;
  const due = isWorkflowRecoveryRunDueAt(retryAt, now);
  if (due) {
    retry.dueRunIds.add(run.id);
  } else if (retryAt !== undefined) {
    retry.next = earliestWorkflowRecoveryTimestamp(retry.next, run.id, retryAt);
  }
  if (run.retryReason !== "missing_implementation") {
    return;
  }
  retry.missingImplementationRunIds.add(run.id);
  if (due) {
    retry.dueMissingImplementationRunIds.add(run.id);
  } else if (retryAt !== undefined) {
    retry.nextMissingImplementation = earliestWorkflowRecoveryTimestamp(
      retry.nextMissingImplementation,
      run.id,
      retryAt,
    );
  }
}

function finishWorkflowRecoveryRetrySummary(
  retry: WorkflowRecoveryRetryRunAccumulator,
): WorkflowRecoveryRetrySummary {
  return {
    total: retry.runIds.size,
    due: retry.dueRunIds.size,
    runIds: [...retry.runIds].sort(),
    dueRunIds: [...retry.dueRunIds].sort(),
    ...(retry.next === undefined
      ? {}
      : { nextRetryAt: retry.next.timestamp, nextRetryRunId: retry.next.runId }),
  };
}

function finishWorkflowRecoveryMissingImplementationSummary(
  retry: WorkflowRecoveryRetryRunAccumulator,
): WorkflowRecoveryMissingImplementationSummary {
  return {
    total: retry.missingImplementationRunIds.size,
    due: retry.dueMissingImplementationRunIds.size,
    runIds: [...retry.missingImplementationRunIds].sort(),
    dueRunIds: [...retry.dueMissingImplementationRunIds].sort(),
    ...(retry.nextMissingImplementation === undefined
      ? {}
      : {
          nextRetryAt: retry.nextMissingImplementation.timestamp,
          nextRetryRunId: retry.nextMissingImplementation.runId,
        }),
  };
}
