import type { RunId, WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowRunStatusCounts, WorkflowRunStatusRunIds } from "./run-metrics.ts";

import {
  createWorkflowRunStatusCounts,
  createWorkflowRunStatusRunIds,
  sortedWorkflowRunStatusRunIds,
} from "./run-metrics.ts";

export { isWorkflowRunStatus } from "../../utility.ts";

export interface WorkflowRunStatusSummaryFields {
  readonly total: number;
  readonly status: WorkflowRunStatusCounts;
  readonly statusRunIds: Record<keyof WorkflowRunStatusCounts, readonly RunId[]>;
}

interface WorkflowRunStatusAccumulator {
  total: number;
  readonly status: WorkflowRunStatusCounts;
  readonly statusRunIds: WorkflowRunStatusRunIds;
}

export function createWorkflowRunStatusSummaryReducer(): {
  readonly addRun: (run: WorkflowRunRecord) => void;
  readonly finish: () => WorkflowRunStatusSummaryFields;
} {
  const status = createWorkflowRunStatusAccumulator();

  return {
    addRun(run) {
      addWorkflowRunStatus(status, run);
    },
    finish() {
      return finishWorkflowRunStatusSummary(status);
    },
  };
}

function createWorkflowRunStatusAccumulator(): WorkflowRunStatusAccumulator {
  return {
    total: 0,
    status: createWorkflowRunStatusCounts(),
    statusRunIds: createWorkflowRunStatusRunIds(),
  };
}

function addWorkflowRunStatus(status: WorkflowRunStatusAccumulator, run: WorkflowRunRecord): void {
  status.total++;
  status.status[run.status]++;
  status.statusRunIds[run.status].push(run.id);
}

function finishWorkflowRunStatusSummary(
  status: WorkflowRunStatusAccumulator,
): WorkflowRunStatusSummaryFields {
  return {
    total: status.total,
    status: status.status,
    statusRunIds: sortedWorkflowRunStatusRunIds(status.statusRunIds),
  };
}
