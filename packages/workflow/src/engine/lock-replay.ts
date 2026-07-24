import type { WorkflowErrorRecord } from "../types/error.ts";
import type { LockRecord } from "../types/lock.ts";

import { WorkflowReplayDivergenceError, WorkflowRetryableError } from "../errors/mod.ts";
import { RunId } from "../types/run.ts";
import { StepId } from "../types/step.ts";

export function requireLockWaitDeadlineReplayMatches(
  recorded: {
    readonly stepId: StepId;
    readonly timestamp: Temporal.Instant;
    readonly value: unknown;
  },
  timeout: number,
): void {
  if (!(recorded.value instanceof Temporal.Instant)) {
    WorkflowReplayDivergenceError.diverged(
      `recorded lock wait deadline ${recorded.stepId} is invalid`,
      {
        expectedStepId: recorded.stepId,
        actualStepId: recorded.stepId,
      },
    );
  }
  const deadlineOffset = recorded.value.since(recorded.timestamp).total({ unit: "millisecond" });
  if (deadlineOffset === timeout) {
    return;
  }
  WorkflowReplayDivergenceError.diverged(
    `recorded lock wait deadline ${recorded.stepId} does not match replayed waitTimeout`,
    {
      expectedStepId: recorded.stepId,
      actualStepId: recorded.stepId,
    },
  );
}

export function requireLockReplayMatches(
  recorded: LockRecord,
  expected: {
    readonly key: string;
    readonly holderId: string;
    readonly holderRunId: RunId;
    readonly leaseDuration: number;
  },
): void {
  const recordedLeaseDuration = recorded.leaseExpiresAt
    .since(recorded.acquiredAt)
    .total({ unit: "millisecond" });
  if (
    recorded.key === expected.key &&
    recorded.holderId === expected.holderId &&
    recorded.holderRunId === expected.holderRunId &&
    recordedLeaseDuration === expected.leaseDuration
  ) {
    return;
  }
  WorkflowReplayDivergenceError.diverged(
    `recorded lock step ${recorded.holderStepId ?? recorded.key} does not match replayed lock acquisition`,
    {
      expectedStepId: recorded.holderStepId,
      actualStepId: recorded.holderStepId,
    },
  );
}

export function requireLockReleaseReplayMatches(
  recorded: LockRecord,
  expected: {
    readonly key: string;
    readonly holderId: string;
  },
): void {
  if (
    recorded.key === expected.key &&
    recorded.holderId === expected.holderId &&
    recorded.releasedAt !== undefined
  ) {
    return;
  }
  WorkflowReplayDivergenceError.diverged(
    `recorded lock step ${recorded.holderStepId ?? recorded.key} does not match replayed lock release`,
    {
      expectedStepId: recorded.holderStepId,
      actualStepId: recorded.holderStepId,
    },
  );
}

export function requireLockWaitReplayMatches(
  failedSteps: readonly {
    readonly error: WorkflowErrorRecord;
  }[],
  expected: {
    readonly key: string;
    readonly wait: boolean;
  },
): void {
  const waited = failedSteps.some((failed) =>
    WorkflowRetryableError.isLockAlreadyHeld(failed.error, expected.key),
  );
  if (!waited || expected.wait) {
    return;
  }
  WorkflowReplayDivergenceError.diverged(
    `recorded lock ${expected.key} waited but replayed lock acquisition does not allow waiting`,
    {
      expectedStepId: `run:${expected.key}`,
      actualStepId: `run:${expected.key}`,
    },
  );
}
