import type { WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowRecoveryDueSummary } from "../../types/summary.ts";

import { isScheduledWorkflowRunStatus } from "../../utility.ts";
import {
  earliestWorkflowRecoveryTimestamp,
  isWorkflowRecoveryRunDueAt,
  type WorkflowRecoveryTimestamp,
} from "./recovery-run-timestamps.ts";

export interface WorkflowRecoveryDueRunSummaryParts {
  readonly due: WorkflowRecoveryDueSummary;
  readonly dueRunIds: readonly string[];
  readonly nextAvailable?: WorkflowRecoveryTimestamp;
}

export interface WorkflowRecoveryDueRunSummaryReducer {
  addRun(run: WorkflowRunRecord): void;
  finish(): WorkflowRecoveryDueRunSummaryParts;
}

interface WorkflowRecoveryDueRunAccumulator {
  readonly runIds: Set<string>;
  readonly pendingRunIds: Set<string>;
  readonly waitingRunIds: Set<string>;
  readonly invalidScheduleRunIds: Set<string>;
  nextAvailable?: WorkflowRecoveryTimestamp;
}

export function createWorkflowRecoveryDueRunSummaryReducer(
  now: Temporal.Instant,
): WorkflowRecoveryDueRunSummaryReducer {
  const due = createWorkflowRecoveryDueRunAccumulator();
  return {
    addRun(run) {
      addWorkflowRecoveryDueRun(due, run, now);
    },
    finish() {
      return {
        due: finishWorkflowRecoveryDueSummary(due),
        dueRunIds: [...due.runIds].sort(),
        ...(due.nextAvailable === undefined ? {} : { nextAvailable: due.nextAvailable }),
      };
    },
  };
}

function createWorkflowRecoveryDueRunAccumulator(): WorkflowRecoveryDueRunAccumulator {
  return {
    runIds: new Set<string>(),
    pendingRunIds: new Set<string>(),
    waitingRunIds: new Set<string>(),
    invalidScheduleRunIds: new Set<string>(),
  };
}

function addWorkflowRecoveryDueRun(
  due: WorkflowRecoveryDueRunAccumulator,
  run: WorkflowRunRecord,
  now: Temporal.Instant,
): void {
  if (!isScheduledWorkflowRunStatus(run.status)) {
    return;
  }
  const availableAt = run.availableAt;
  if (isWorkflowRecoveryRunDueAt(availableAt, now)) {
    due.runIds.add(run.id);
    if (run.status === "pending") {
      due.pendingRunIds.add(run.id);
    } else {
      due.waitingRunIds.add(run.id);
    }
    return;
  }
  if (availableAt !== undefined) {
    due.nextAvailable = earliestWorkflowRecoveryTimestamp(due.nextAvailable, run.id, availableAt);
  }
}

function finishWorkflowRecoveryDueSummary(
  due: WorkflowRecoveryDueRunAccumulator,
): WorkflowRecoveryDueSummary {
  return {
    total: due.runIds.size,
    runIds: [...due.runIds].sort(),
    pendingRunIds: [...due.pendingRunIds].sort(),
    waitingRunIds: [...due.waitingRunIds].sort(),
    invalidScheduleRunIds: [...due.invalidScheduleRunIds].sort(),
    ...(due.nextAvailable === undefined
      ? {}
      : {
          nextAvailableAt: due.nextAvailable.timestamp,
          nextAvailableRunId: due.nextAvailable.runId,
        }),
  };
}
