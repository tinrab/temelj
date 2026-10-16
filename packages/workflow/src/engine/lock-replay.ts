import type { WorkflowErrorRecord } from "../types/error.ts";
import type { DeterministicValueRecordedEvent } from "../types/events.ts";
import type { RunId } from "../types/ids.ts";
import type { LockRecord } from "../types/lock.ts";

import { WorkflowErrorCode } from "../errors/codes.ts";
import { WorkflowReplayDivergenceError, matchesWorkflowError } from "../errors/mod.ts";

export function parseLockWaitDeadlineReplay(
  recorded: DeterministicValueRecordedEvent,
  timeout: number,
): Temporal.Instant {
  if (!(recorded.value instanceof Temporal.Instant)) {
    WorkflowReplayDivergenceError.atStep(
      recorded.stepId,
      `recorded lock wait deadline ${recorded.stepId} is invalid`,
    );
  }

  const deadlineOffset = recorded.value.since(recorded.timestamp).total({ unit: "millisecond" });

  if (deadlineOffset === timeout) {
    return recorded.value;
  }

  WorkflowReplayDivergenceError.atStep(
    recorded.stepId,
    `recorded lock wait deadline ${recorded.stepId} does not match replayed waitTimeout`,
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

  WorkflowReplayDivergenceError.atStep(
    recorded.holderStepId,
    `recorded lock step ${recorded.holderStepId ?? recorded.key} does not match replayed lock acquisition`,
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

  WorkflowReplayDivergenceError.atStep(
    recorded.holderStepId,
    `recorded lock step ${recorded.holderStepId ?? recorded.key} does not match replayed lock release`,
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
    matchesWorkflowError(failed.error, WorkflowErrorCode.LOCK_ALREADY_HELD, { key: expected.key }),
  );

  if (!waited || expected.wait) {
    return;
  }

  WorkflowReplayDivergenceError.atStep(
    `run:${expected.key}`,
    `recorded lock ${expected.key} waited but replayed lock acquisition does not allow waiting`,
  );
}
