import type { WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowRunCleanupSummary } from "../../types/summary.ts";
import type {
  WorkflowTerminalRunStatusCounts,
  WorkflowTerminalRunStatusRunIds,
} from "./run-metrics.ts";

import { earliestOptionalTimestamp, latestOptionalTimestamp } from "../../temporal.ts";
import {
  createWorkflowTerminalRunStatusCounts,
  createWorkflowTerminalRunStatusRunIds,
  sortedWorkflowTerminalRunStatusRunIds,
} from "./run-metrics.ts";

interface WorkflowRunCleanupSummaryFields {
  readonly cleanup?: WorkflowRunCleanupSummary;
}

interface WorkflowRunCleanupAccumulator {
  eligibleRuns: number;
  oldestFinishedAt?: Temporal.Instant;
  newestFinishedAt?: Temporal.Instant;
  readonly status: WorkflowTerminalRunStatusCounts;
  readonly statusRunIds: WorkflowTerminalRunStatusRunIds;
}

export interface WorkflowRunCleanupSummaryReducer {
  readonly addRun: (run: WorkflowRunRecord) => void;
  readonly finish: () => WorkflowRunCleanupSummaryFields;
}

/** Creates an accumulator for terminal-run cleanup eligibility summary fields. */
export function createWorkflowRunCleanupSummaryReducer(
  cutoff: Temporal.Instant | undefined,
): WorkflowRunCleanupSummaryReducer {
  const cleanup = createWorkflowRunCleanupAccumulator();

  return {
    addRun(run) {
      addWorkflowRunCleanupEligibility(cleanup, run, cutoff);
    },
    finish() {
      return finishWorkflowRunCleanupSummary(cleanup, cutoff);
    },
  };
}

function createWorkflowRunCleanupAccumulator(): WorkflowRunCleanupAccumulator {
  return {
    eligibleRuns: 0,
    status: createWorkflowTerminalRunStatusCounts(),
    statusRunIds: createWorkflowTerminalRunStatusRunIds(),
  };
}

function addWorkflowRunCleanupEligibility(
  cleanup: WorkflowRunCleanupAccumulator,
  run: WorkflowRunRecord,
  cutoff: Temporal.Instant | undefined,
): void {
  if (
    cutoff === undefined ||
    (run.status !== "completed" && run.status !== "failed" && run.status !== "canceled") ||
    run.finishedAt === undefined ||
    Temporal.Instant.compare(run.finishedAt, cutoff) >= 0
  ) {
    return;
  }

  cleanup.eligibleRuns++;
  cleanup.status[run.status]++;
  cleanup.statusRunIds[run.status].push(run.id);
  setWorkflowRunCleanupFinishedRange(cleanup, run);
}

function setWorkflowRunCleanupFinishedRange(
  cleanup: WorkflowRunCleanupAccumulator,
  run: WorkflowRunRecord,
): void {
  cleanup.oldestFinishedAt = earliestOptionalTimestamp(cleanup.oldestFinishedAt, run.finishedAt);
  cleanup.newestFinishedAt = latestOptionalTimestamp(cleanup.newestFinishedAt, run.finishedAt);
}

function finishWorkflowRunCleanupSummary(
  cleanup: WorkflowRunCleanupAccumulator,
  cutoff: Temporal.Instant | undefined,
): WorkflowRunCleanupSummaryFields {
  if (cutoff === undefined) {
    return {};
  }

  const result: NonNullable<WorkflowRunCleanupSummaryFields["cleanup"]> = {
    eligibleRuns: cleanup.eligibleRuns,
    status: cleanup.status,
    statusRunIds: sortedWorkflowTerminalRunStatusRunIds(cleanup.statusRunIds),
  };

  if (cleanup.oldestFinishedAt !== undefined) {
    Object.assign(result, { oldestFinishedAt: cleanup.oldestFinishedAt } satisfies Partial<
      NonNullable<WorkflowRunCleanupSummaryFields["cleanup"]>
    >);
  }

  if (cleanup.newestFinishedAt !== undefined) {
    Object.assign(result, { newestFinishedAt: cleanup.newestFinishedAt } satisfies Partial<
      NonNullable<WorkflowRunCleanupSummaryFields["cleanup"]>
    >);
  }

  return { cleanup: result };
}
