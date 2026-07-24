import type { WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowRecoveryFailedSummary } from "../../types/summary.ts";

import { latestOptionalWorkflowRecoveryInstant } from "./recovery-run-timestamps.ts";

export interface WorkflowRecoveryFailedRunSummaryParts {
  readonly failed: WorkflowRecoveryFailedSummary;
  readonly failedRunIds: readonly string[];
}

export interface WorkflowRecoveryFailedRunSummaryReducer {
  addRun(run: WorkflowRunRecord): void;
  finish(): WorkflowRecoveryFailedRunSummaryParts;
}

interface WorkflowRecoveryFailedRunAccumulator {
  readonly runIds: Set<string>;
  latestFailedAt?: Temporal.Instant;
}

export function createWorkflowRecoveryFailedRunSummaryReducer(): WorkflowRecoveryFailedRunSummaryReducer {
  const failed = createWorkflowRecoveryFailedRunAccumulator();
  return {
    addRun(run) {
      addWorkflowRecoveryFailedRun(failed, run);
    },
    finish() {
      return {
        failed: finishWorkflowRecoveryFailedSummary(failed),
        failedRunIds: [...failed.runIds].sort(),
      };
    },
  };
}

function createWorkflowRecoveryFailedRunAccumulator(): WorkflowRecoveryFailedRunAccumulator {
  return { runIds: new Set<string>() };
}

function addWorkflowRecoveryFailedRun(
  failed: WorkflowRecoveryFailedRunAccumulator,
  run: WorkflowRunRecord,
): void {
  if (run.status !== "failed") {
    return;
  }
  failed.runIds.add(run.id);
  failed.latestFailedAt = latestOptionalWorkflowRecoveryInstant(
    failed.latestFailedAt,
    run.finishedAt,
  );
}

function finishWorkflowRecoveryFailedSummary(
  failed: WorkflowRecoveryFailedRunAccumulator,
): WorkflowRecoveryFailedSummary {
  return {
    total: failed.runIds.size,
    runIds: [...failed.runIds].sort(),
    ...(failed.latestFailedAt === undefined ? {} : { latestFailedAt: failed.latestFailedAt }),
  };
}
