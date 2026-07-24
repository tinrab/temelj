import type { WorkflowRunRecord } from "../../types/run.ts";
import type {
  WorkflowRecoveryDueSummary,
  WorkflowRecoveryFailedSummary,
  WorkflowRecoveryLeaseSummary,
  WorkflowRecoveryMissingImplementationSummary,
  WorkflowRecoveryRetrySummary,
} from "../../types/summary.ts";

import {
  createWorkflowRecoveryDueRunSummaryReducer,
  type WorkflowRecoveryDueRunSummaryParts,
} from "./recovery-due-runs.ts";
import {
  createWorkflowRecoveryFailedRunSummaryReducer,
  type WorkflowRecoveryFailedRunSummaryParts,
} from "./recovery-failed-runs.ts";
import {
  createWorkflowRecoveryLeaseRunSummaryReducer,
  type WorkflowRecoveryLeaseRunSummaryParts,
} from "./recovery-lease-runs.ts";
import {
  createWorkflowRecoveryRetryRunSummaryReducer,
  type WorkflowRecoveryRetryRunSummaryParts,
} from "./recovery-retry-runs.ts";
import { type WorkflowRecoveryTimestamp } from "./recovery-run-timestamps.ts";

export interface WorkflowRecoveryRunSummaryParts {
  readonly total: number;
  readonly recoverableRunIds: readonly string[];
  readonly due: WorkflowRecoveryDueSummary;
  readonly lease: WorkflowRecoveryLeaseSummary;
  readonly retry: WorkflowRecoveryRetrySummary;
  readonly missingImplementation: WorkflowRecoveryMissingImplementationSummary;
  readonly failed: WorkflowRecoveryFailedSummary;
  readonly nextAvailable?: WorkflowRecoveryTimestamp;
  readonly nextLeaseExpires?: WorkflowRecoveryTimestamp;
  readonly nextRetry?: WorkflowRecoveryTimestamp;
}

export interface WorkflowRecoveryRunSummaryReducer {
  addRun(run: WorkflowRunRecord): void;
  finish(): WorkflowRecoveryRunSummaryParts;
}

interface WorkflowRecoveryNextSummaryParts {
  readonly nextAvailable?: WorkflowRecoveryTimestamp;
  readonly nextLeaseExpires?: WorkflowRecoveryTimestamp;
  readonly nextRetry?: WorkflowRecoveryTimestamp;
}

export function createWorkflowRecoveryRunSummaryReducer(
  now: Temporal.Instant,
): WorkflowRecoveryRunSummaryReducer {
  const due = createWorkflowRecoveryDueRunSummaryReducer(now);
  const lease = createWorkflowRecoveryLeaseRunSummaryReducer(now);
  const retry = createWorkflowRecoveryRetryRunSummaryReducer(now);
  const failed = createWorkflowRecoveryFailedRunSummaryReducer();
  let total = 0;

  return {
    addRun(run) {
      total++;
      due.addRun(run);
      lease.addRun(run);
      retry.addRun(run);
      failed.addRun(run);
    },
    finish() {
      const dueParts = due.finish();
      const leaseParts = lease.finish();
      const retryParts = retry.finish();
      const failedParts = failed.finish();
      return {
        total,
        recoverableRunIds: finishWorkflowRecoveryRecoverableRunIds(
          dueParts,
          leaseParts,
          retryParts,
          failedParts,
        ),
        due: dueParts.due,
        lease: leaseParts.lease,
        retry: retryParts.retry,
        missingImplementation: retryParts.missingImplementation,
        failed: failedParts.failed,
        ...finishWorkflowRecoveryNextSummary(dueParts, leaseParts, retryParts),
      };
    },
  };
}

function finishWorkflowRecoveryRecoverableRunIds(
  due: WorkflowRecoveryDueRunSummaryParts,
  lease: WorkflowRecoveryLeaseRunSummaryParts,
  retry: WorkflowRecoveryRetryRunSummaryParts,
  failed: WorkflowRecoveryFailedRunSummaryParts,
): readonly string[] {
  return [
    ...new Set([
      ...due.dueRunIds,
      ...lease.staleRunIds,
      ...retry.dueRetryRunIds,
      ...failed.failedRunIds,
    ]),
  ].sort();
}

function finishWorkflowRecoveryNextSummary(
  due: WorkflowRecoveryDueRunSummaryParts,
  lease: WorkflowRecoveryLeaseRunSummaryParts,
  retry: WorkflowRecoveryRetryRunSummaryParts,
): WorkflowRecoveryNextSummaryParts {
  return {
    ...(due.nextAvailable === undefined ? {} : { nextAvailable: due.nextAvailable }),
    ...(lease.nextLeaseExpires === undefined ? {} : { nextLeaseExpires: lease.nextLeaseExpires }),
    ...(retry.nextRetry === undefined ? {} : { nextRetry: retry.nextRetry }),
  };
}
