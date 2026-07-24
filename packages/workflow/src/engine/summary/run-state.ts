import type { RunId, WorkflowRunRecord } from "../../types/run.ts";
import type {
  WorkflowRunCleanupSummary,
  WorkflowRunFailureSummary,
  WorkflowRunLeaseSummary,
  WorkflowRunRetrySummary,
  WorkflowRunTransitionSummary,
  WorkflowRunWorkflowSummary,
} from "../../types/summary.ts";
import type { WorkflowRunStatusCounts } from "./run-metrics.ts";

import { createWorkflowRunAvailabilitySummaryReducer } from "./run-availability.ts";
import { createWorkflowRunCleanupSummaryReducer } from "./run-cleanup.ts";
import { createWorkflowRunFailureSummaryReducer } from "./run-failure.ts";
import { createWorkflowRunLeaseSummaryReducer } from "./run-lease.ts";
import { createWorkflowRunRetrySummaryReducer } from "./run-retry.ts";
import { createWorkflowRunStatusSummaryReducer, isWorkflowRunStatus } from "./run-status.ts";
import { createWorkflowRunTransitionSummaryReducer } from "./run-transition.ts";
import { createWorkflowRunWorkflowSummaryReducer } from "./run-workflow.ts";

interface WorkflowRunStateSummary {
  readonly total: number;
  readonly status: WorkflowRunStatusCounts;
  readonly statusRunIds: Record<keyof WorkflowRunStatusCounts, readonly RunId[]>;
  readonly workflow: WorkflowRunWorkflowSummary;
  readonly transition: WorkflowRunTransitionSummary;
  readonly retry: WorkflowRunRetrySummary;
  readonly failure?: WorkflowRunFailureSummary;
  readonly lease: WorkflowRunLeaseSummary;
  readonly cleanup?: WorkflowRunCleanupSummary;
  readonly nextAvailableAt?: Temporal.Instant;
  readonly oldestPendingAt?: Temporal.Instant;
  readonly oldestRunningAt?: Temporal.Instant;
}

/** Creates an accumulator for run-record summary fields. */
export function createWorkflowRunStateSummaryReducer(
  now: Temporal.Instant,
  cleanupCutoff: Temporal.Instant | undefined,
): {
  readonly addRun: (run: WorkflowRunRecord) => void;
  readonly finish: () => WorkflowRunStateSummary;
} {
  const status = createWorkflowRunStatusSummaryReducer();
  const workflow = createWorkflowRunWorkflowSummaryReducer();
  const transition = createWorkflowRunTransitionSummaryReducer();
  const retry = createWorkflowRunRetrySummaryReducer();
  const failure = createWorkflowRunFailureSummaryReducer();
  const lease = createWorkflowRunLeaseSummaryReducer(now);
  const cleanup = createWorkflowRunCleanupSummaryReducer(cleanupCutoff);
  const availability = createWorkflowRunAvailabilitySummaryReducer();

  return {
    addRun(run) {
      if (!isWorkflowRunStatus(run.status)) {
        return;
      }
      status.addRun(run);
      workflow.addRun(run);
      transition.addRun(run);
      retry.addRun(run);
      failure.addRun(run);
      lease.addRun(run);
      cleanup.addRun(run);
      availability.addRun(run);
    },
    finish() {
      return {
        ...status.finish(),
        workflow: workflow.finish(),
        transition: transition.finish(),
        retry: retry.finish(),
        ...failure.finish(),
        lease: lease.finish(),
        ...cleanup.finish(),
        ...availability.finish(),
      };
    },
  };
}
