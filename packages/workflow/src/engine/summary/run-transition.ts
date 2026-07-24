import type { WorkflowRunRecord, WorkflowRunTransitionReason } from "../../types/run.ts";
import type { WorkflowRunTransitionSummary } from "../../types/summary.ts";
import type {
  WorkflowRunTransitionReasonCounts,
  WorkflowRunTransitionReasonRunIds,
} from "./run-metrics.ts";

import { latestOptionalTimestamp } from "../../temporal.ts";
import {
  createWorkflowRunTransitionReasonCounts,
  createWorkflowRunTransitionReasonRunIds,
  sortedWorkflowRunTransitionReasonRunIds,
} from "./run-metrics.ts";

interface WorkflowRunTransitionAccumulator {
  latestTransitionAt?: Temporal.Instant;
  readonly reason: WorkflowRunTransitionReasonCounts;
  readonly runIds: WorkflowRunTransitionReasonRunIds;
}

export function createWorkflowRunTransitionSummaryReducer(): {
  readonly addRun: (run: WorkflowRunRecord) => void;
  readonly finish: () => WorkflowRunTransitionSummary;
} {
  const transition = createWorkflowRunTransitionAccumulator();

  return {
    addRun(run) {
      addWorkflowRunTransition(transition, run);
    },
    finish() {
      return finishWorkflowRunTransitionSummary(transition);
    },
  };
}

function createWorkflowRunTransitionAccumulator(): WorkflowRunTransitionAccumulator {
  return {
    reason: createWorkflowRunTransitionReasonCounts(),
    runIds: createWorkflowRunTransitionReasonRunIds(),
  };
}

function addWorkflowRunTransition(
  transition: WorkflowRunTransitionAccumulator,
  run: WorkflowRunRecord,
): void {
  const reason = workflowRunTransitionReason(run.lastTransitionReason);
  if (reason === undefined) {
    return;
  }
  transition.reason[reason]++;
  transition.runIds[reason].push(run.id);
  transition.latestTransitionAt = latestOptionalTimestamp(
    transition.latestTransitionAt,
    run.lastTransitionAt,
  );
}

function finishWorkflowRunTransitionSummary(
  transition: WorkflowRunTransitionAccumulator,
): WorkflowRunTransitionSummary {
  return {
    reason: transition.reason,
    runIds: sortedWorkflowRunTransitionReasonRunIds(transition.runIds),
    ...(transition.latestTransitionAt === undefined
      ? {}
      : { latestTransitionAt: transition.latestTransitionAt }),
  };
}

function workflowRunTransitionReason(
  reason: WorkflowRunTransitionReason,
): WorkflowRunTransitionReason | undefined {
  return reason === "created" ||
    reason === "claimed" ||
    reason === "reclaimed" ||
    reason === "started" ||
    reason === "waiting" ||
    reason === "rescheduled" ||
    reason === "lease_released" ||
    reason === "manual_retry" ||
    reason === "permanent_failure" ||
    reason === "retry" ||
    reason === "missing_implementation" ||
    reason === "completed" ||
    reason === "failed" ||
    reason === "deadline" ||
    reason === "canceled"
    ? reason
    : undefined;
}
