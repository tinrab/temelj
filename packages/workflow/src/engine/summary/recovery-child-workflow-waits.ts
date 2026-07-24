import type { WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";
import type { WorkflowRecoveryChildWorkflowWaitSummary } from "../../types/summary.ts";
import type { WorkflowRecoveryTimestamp } from "./recovery-run-timestamps.ts";

import { earliestWorkflowRecoveryTimestamp } from "./recovery-run-timestamps.ts";

interface WorkflowChildWorkflowWaitAccumulator {
  readonly runIds: Set<string>;
  readonly terminalRunIds: Set<string>;
  readonly missingRunIds: Set<string>;
  readonly timedOutRunIds: Set<string>;
  readonly terminalStepIds: Set<string>;
  readonly missingStepIds: Set<string>;
  readonly timedOutStepIds: Set<string>;
  readonly childRunIds: Set<string>;
  readonly completedChildRunIds: Set<string>;
  readonly failedChildRunIds: Set<string>;
  readonly canceledChildRunIds: Set<string>;
  nextTimeout?: WorkflowRecoveryTimestamp;
}

export interface WorkflowRecoveryChildWorkflowWaitSummaryReducer {
  addAttempts(attempts: readonly WorkflowStepAttemptRecord[]): void;
  finish(): WorkflowRecoveryChildWorkflowWaitSummary;
}

export function createWorkflowRecoveryChildWorkflowWaitSummaryReducer(
  childRuns: readonly WorkflowRunRecord[],
  now: Temporal.Instant,
): WorkflowRecoveryChildWorkflowWaitSummaryReducer {
  const childWorkflow = createWorkflowChildWorkflowWaitAccumulator();
  const childByRunId = new Map(childRuns.map((run) => [run.id, run]));

  return {
    addAttempts(attempts) {
      for (const attempt of attempts) {
        addWorkflowChildWorkflowWaitAttempt(childWorkflow, attempt, childByRunId, now);
      }
    },
    finish() {
      return finishWorkflowChildWorkflowWaitSummary(childWorkflow);
    },
  };
}

function createWorkflowChildWorkflowWaitAccumulator(): WorkflowChildWorkflowWaitAccumulator {
  return {
    runIds: new Set<string>(),
    terminalRunIds: new Set<string>(),
    missingRunIds: new Set<string>(),
    timedOutRunIds: new Set<string>(),
    terminalStepIds: new Set<string>(),
    missingStepIds: new Set<string>(),
    timedOutStepIds: new Set<string>(),
    childRunIds: new Set<string>(),
    completedChildRunIds: new Set<string>(),
    failedChildRunIds: new Set<string>(),
    canceledChildRunIds: new Set<string>(),
  };
}

function addWorkflowChildWorkflowWaitAttempt(
  childWorkflow: WorkflowChildWorkflowWaitAccumulator,
  attempt: WorkflowStepAttemptRecord,
  childByRunId: ReadonlyMap<string, WorkflowRunRecord>,
  now: Temporal.Instant,
): void {
  if (attempt.status !== "running" || attempt.kind !== "workflow") {
    return;
  }
  childWorkflow.runIds.add(attempt.runId);
  const resolved = addResolvedWorkflowChildWorkflowWaitAttempt(
    childWorkflow,
    attempt,
    childByRunId,
  );
  if (!resolved) {
    addTimedOutWorkflowChildWorkflowWaitAttempt(childWorkflow, attempt, now);
  }
}

function addResolvedWorkflowChildWorkflowWaitAttempt(
  childWorkflow: WorkflowChildWorkflowWaitAccumulator,
  attempt: WorkflowStepAttemptRecord,
  childByRunId: ReadonlyMap<string, WorkflowRunRecord>,
): boolean {
  if (attempt.childRunId === undefined) {
    addMissingWorkflowChildWorkflowWaitAttempt(childWorkflow, attempt);
    return true;
  }
  childWorkflow.childRunIds.add(attempt.childRunId);
  const child = childByRunId.get(attempt.childRunId);
  if (child === undefined) {
    addMissingWorkflowChildWorkflowWaitAttempt(childWorkflow, attempt);
    return true;
  }
  if (child.status !== "completed" && child.status !== "failed" && child.status !== "canceled") {
    return false;
  }
  childWorkflow.terminalRunIds.add(attempt.runId);
  childWorkflow.terminalStepIds.add(attempt.stepId);
  if (child.status === "completed") {
    childWorkflow.completedChildRunIds.add(child.id);
  } else if (child.status === "failed") {
    childWorkflow.failedChildRunIds.add(child.id);
  } else {
    childWorkflow.canceledChildRunIds.add(child.id);
  }
  return true;
}

function addMissingWorkflowChildWorkflowWaitAttempt(
  childWorkflow: WorkflowChildWorkflowWaitAccumulator,
  attempt: WorkflowStepAttemptRecord,
): void {
  childWorkflow.missingRunIds.add(attempt.runId);
  childWorkflow.missingStepIds.add(attempt.stepId);
}

function addTimedOutWorkflowChildWorkflowWaitAttempt(
  childWorkflow: WorkflowChildWorkflowWaitAccumulator,
  attempt: WorkflowStepAttemptRecord,
  now: Temporal.Instant,
): void {
  if (attempt.timeoutAt === undefined) {
    return;
  }
  if (Temporal.Instant.compare(attempt.timeoutAt, now) <= 0) {
    childWorkflow.timedOutRunIds.add(attempt.runId);
    childWorkflow.timedOutStepIds.add(attempt.stepId);
    return;
  }
  childWorkflow.nextTimeout = earliestWorkflowRecoveryTimestamp(
    childWorkflow.nextTimeout,
    attempt.runId,
    attempt.timeoutAt,
  );
}

function finishWorkflowChildWorkflowWaitSummary(
  childWorkflow: WorkflowChildWorkflowWaitAccumulator,
): WorkflowRecoveryChildWorkflowWaitSummary {
  return {
    active: childWorkflow.runIds.size,
    terminal: childWorkflow.terminalRunIds.size,
    missing: childWorkflow.missingRunIds.size,
    timedOut: childWorkflow.timedOutRunIds.size,
    runIds: [...childWorkflow.runIds].sort(),
    terminalRunIds: [...childWorkflow.terminalRunIds].sort(),
    missingRunIds: [...childWorkflow.missingRunIds].sort(),
    timedOutRunIds: [...childWorkflow.timedOutRunIds].sort(),
    terminalStepIds: [...childWorkflow.terminalStepIds].sort(),
    missingStepIds: [...childWorkflow.missingStepIds].sort(),
    timedOutStepIds: [...childWorkflow.timedOutStepIds].sort(),
    childRunIds: [...childWorkflow.childRunIds].sort(),
    completedChildRunIds: [...childWorkflow.completedChildRunIds].sort(),
    failedChildRunIds: [...childWorkflow.failedChildRunIds].sort(),
    canceledChildRunIds: [...childWorkflow.canceledChildRunIds].sort(),
    ...(childWorkflow.nextTimeout === undefined
      ? {}
      : { nextTimeoutAt: childWorkflow.nextTimeout.timestamp }),
    ...(childWorkflow.nextTimeout === undefined
      ? {}
      : { nextTimeoutRunId: childWorkflow.nextTimeout.runId }),
  };
}
