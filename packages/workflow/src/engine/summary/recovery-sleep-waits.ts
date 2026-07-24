import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";
import type { WorkflowRecoverySleepWaitSummary } from "../../types/summary.ts";
import type { WorkflowRecoveryTimestamp } from "./recovery-run-timestamps.ts";

import { earliestWorkflowRecoveryTimestamp } from "./recovery-run-timestamps.ts";

interface WorkflowSleepWaitAccumulator {
  readonly runIds: Set<string>;
  readonly dueRunIds: Set<string>;
  readonly dueStepIds: Set<string>;
  readonly invalidUntilRunIds: Set<string>;
  nextWake?: WorkflowRecoveryTimestamp;
}

export interface WorkflowRecoverySleepWaitSummaryReducer {
  addAttempts(attempts: readonly WorkflowStepAttemptRecord[]): void;
  finish(): WorkflowRecoverySleepWaitSummary;
}

export function createWorkflowRecoverySleepWaitSummaryReducer(
  now: Temporal.Instant,
): WorkflowRecoverySleepWaitSummaryReducer {
  const sleep = createWorkflowSleepWaitAccumulator();

  return {
    addAttempts(attempts) {
      for (const attempt of attempts) {
        addWorkflowSleepWaitAttempt(sleep, attempt, now);
      }
    },
    finish() {
      return finishWorkflowSleepWaitSummary(sleep);
    },
  };
}

function createWorkflowSleepWaitAccumulator(): WorkflowSleepWaitAccumulator {
  return {
    runIds: new Set<string>(),
    dueRunIds: new Set<string>(),
    dueStepIds: new Set<string>(),
    invalidUntilRunIds: new Set<string>(),
  };
}

function addWorkflowSleepWaitAttempt(
  sleep: WorkflowSleepWaitAccumulator,
  attempt: WorkflowStepAttemptRecord,
  now: Temporal.Instant,
): void {
  if (attempt.status !== "running" || attempt.kind !== "sleep") {
    return;
  }
  sleep.runIds.add(attempt.runId);
  if (attempt.until === undefined) {
    sleep.dueRunIds.add(attempt.runId);
    sleep.dueStepIds.add(attempt.stepId);
    sleep.invalidUntilRunIds.add(attempt.runId);
    return;
  }
  if (Temporal.Instant.compare(attempt.until, now) <= 0) {
    sleep.dueRunIds.add(attempt.runId);
    sleep.dueStepIds.add(attempt.stepId);
    return;
  }
  sleep.nextWake = earliestWorkflowRecoveryTimestamp(sleep.nextWake, attempt.runId, attempt.until);
}

function finishWorkflowSleepWaitSummary(
  sleep: WorkflowSleepWaitAccumulator,
): WorkflowRecoverySleepWaitSummary {
  return {
    active: sleep.runIds.size,
    due: sleep.dueRunIds.size,
    runIds: [...sleep.runIds].sort(),
    dueRunIds: [...sleep.dueRunIds].sort(),
    dueStepIds: [...sleep.dueStepIds].sort(),
    invalidUntilRunIds: [...sleep.invalidUntilRunIds].sort(),
    ...(sleep.nextWake === undefined
      ? {}
      : { nextWakeAt: sleep.nextWake.timestamp, nextWakeRunId: sleep.nextWake.runId }),
  };
}
