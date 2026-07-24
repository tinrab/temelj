import type { EventRecord } from "../../types/events.ts";
import type { WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";
import type { WorkflowRecoveryWaitSummary } from "../../types/summary.ts";

import { createWorkflowRecoveryChildWorkflowWaitSummaryReducer } from "./recovery-child-workflow-waits.ts";
import { createWorkflowRecoveryMessageWaitSummaryReducer } from "./recovery-message-waits.ts";
import { createWorkflowRecoverySleepWaitSummaryReducer } from "./recovery-sleep-waits.ts";

export interface WorkflowRecoveryWaitInputs {
  readonly sleepAttempts?: readonly WorkflowStepAttemptRecord[];
  readonly messageWaitAttempts?: readonly WorkflowStepAttemptRecord[];
  readonly childWorkflowAttempts?: readonly WorkflowStepAttemptRecord[];
  readonly childRuns?: readonly WorkflowRunRecord[];
  readonly eventsByRunId?: ReadonlyMap<string, readonly EventRecord[]>;
}

export interface WorkflowRecoveryWaitSummaryReducer {
  addSleepAttempts(attempts: readonly WorkflowStepAttemptRecord[]): void;
  addMessageWaitAttempts(attempts: readonly WorkflowStepAttemptRecord[]): void;
  addChildWorkflowAttempts(attempts: readonly WorkflowStepAttemptRecord[]): void;
  finish(): WorkflowRecoveryWaitSummary;
}

export function createWorkflowRecoveryWaitSummaryReducer(
  inputs: WorkflowRecoveryWaitInputs,
  now: Temporal.Instant,
): WorkflowRecoveryWaitSummaryReducer {
  const sleep = createWorkflowRecoverySleepWaitSummaryReducer(now);
  const message = createWorkflowRecoveryMessageWaitSummaryReducer(
    inputs.eventsByRunId ?? new Map(),
    now,
  );
  const childWorkflow = createWorkflowRecoveryChildWorkflowWaitSummaryReducer(
    inputs.childRuns ?? [],
    now,
  );

  return {
    addSleepAttempts(attempts) {
      sleep.addAttempts(attempts);
    },
    addMessageWaitAttempts(attempts) {
      message.addAttempts(attempts);
    },
    addChildWorkflowAttempts(attempts) {
      childWorkflow.addAttempts(attempts);
    },
    finish() {
      return {
        sleep: sleep.finish(),
        message: message.finish(),
        childWorkflow: childWorkflow.finish(),
      };
    },
  };
}
