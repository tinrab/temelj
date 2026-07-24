import type { LockRecord } from "../../types/lock.ts";
import type { WorkflowRunRecord } from "../../types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../types/step-attempts.ts";
import type { WorkflowRecoveryLockSummary } from "../../types/summary.ts";

import { WorkflowRetryableError } from "../../errors/mod.ts";
import {
  earliestWorkflowRecoveryInstant,
  earliestWorkflowRecoveryTimestamp,
  type WorkflowRecoveryTimestamp,
} from "./recovery-run-timestamps.ts";

interface WorkflowRecoveryLockExpiration {
  readonly key: string;
  readonly timestamp: Temporal.Instant;
}

export interface WorkflowRecoveryLockWaitDetails {
  readonly key: string;
  readonly waitDeadlineAt?: Temporal.Instant;
}

interface WorkflowRecoveryLockAccumulator {
  readonly dueWaitingRunIds: Set<string>;
  readonly holderIds: Set<string>;
  readonly keys: Set<string>;
  readonly staleKeys: Set<string>;
  readonly waitingKeys: Set<string>;
  readonly waitingRunIds: Set<string>;
  readonly waitingStepIds: Set<string>;
  nextExpires?: WorkflowRecoveryLockExpiration;
  nextWaitDeadline?: WorkflowRecoveryTimestamp;
  oldestStaleAt?: Temporal.Instant;
}

export interface WorkflowRecoveryLockSummaryReducer {
  addLock(lock: LockRecord): void;
  addLockWaitAttempt(attempt: WorkflowStepAttemptRecord): void;
  finish(): WorkflowRecoveryLockSummary;
}

export function createWorkflowRecoveryLockSummaryReducer(
  runs: readonly WorkflowRunRecord[],
  now: Temporal.Instant,
): WorkflowRecoveryLockSummaryReducer {
  const locks = createWorkflowRecoveryLockAccumulator();
  const runById = new Map(runs.map((run) => [run.id, run]));

  return {
    addLock(lock) {
      addWorkflowRecoveryLock(locks, lock, now);
    },
    addLockWaitAttempt(attempt) {
      addWorkflowRecoveryLockWaitAttempt(locks, attempt, runById, now);
    },
    finish() {
      return finishWorkflowRecoveryLockSummary(locks);
    },
  };
}

function createWorkflowRecoveryLockAccumulator(): WorkflowRecoveryLockAccumulator {
  return {
    dueWaitingRunIds: new Set<string>(),
    holderIds: new Set<string>(),
    keys: new Set<string>(),
    staleKeys: new Set<string>(),
    waitingKeys: new Set<string>(),
    waitingRunIds: new Set<string>(),
    waitingStepIds: new Set<string>(),
  };
}

function addWorkflowRecoveryLock(
  locks: WorkflowRecoveryLockAccumulator,
  lock: LockRecord,
  now: Temporal.Instant,
): void {
  if (lock.releasedAt !== undefined) {
    return;
  }
  locks.keys.add(lock.key);
  if (lock.holderId !== undefined) {
    locks.holderIds.add(lock.holderId);
  }
  if (Temporal.Instant.compare(lock.leaseExpiresAt, now) <= 0) {
    locks.staleKeys.add(lock.key);
    locks.oldestStaleAt = earliestWorkflowRecoveryInstant(locks.oldestStaleAt, lock.leaseExpiresAt);
    return;
  }
  locks.nextExpires = earliestWorkflowRecoveryLockExpiration(
    locks.nextExpires,
    lock.key,
    lock.leaseExpiresAt,
  );
}

function addWorkflowRecoveryLockWaitAttempt(
  locks: WorkflowRecoveryLockAccumulator,
  attempt: WorkflowStepAttemptRecord,
  runById: ReadonlyMap<string, WorkflowRunRecord>,
  now: Temporal.Instant,
): void {
  const details = workflowRecoveryLockWaitDetails(attempt);
  if (details === undefined) {
    return;
  }
  const run = runById.get(attempt.runId);
  if (run === undefined || run.status !== "waiting" || run.retryReason !== "step") {
    return;
  }
  locks.waitingRunIds.add(attempt.runId);
  locks.waitingStepIds.add(attempt.stepId);
  locks.waitingKeys.add(details.key);
  if (run.retryAt === undefined || Temporal.Instant.compare(run.retryAt, now) <= 0) {
    locks.dueWaitingRunIds.add(attempt.runId);
  }
  if (
    details.waitDeadlineAt !== undefined &&
    Temporal.Instant.compare(details.waitDeadlineAt, now) > 0
  ) {
    locks.nextWaitDeadline = earliestWorkflowRecoveryTimestamp(
      locks.nextWaitDeadline,
      attempt.runId,
      details.waitDeadlineAt,
    );
  }
}

function finishWorkflowRecoveryLockSummary(
  locks: WorkflowRecoveryLockAccumulator,
): WorkflowRecoveryLockSummary {
  return {
    total: locks.keys.size,
    stale: locks.staleKeys.size,
    keys: [...locks.keys].sort(),
    staleKeys: [...locks.staleKeys].sort(),
    holderIds: [...locks.holderIds].sort(),
    waitingRunIds: [...locks.waitingRunIds].sort(),
    dueWaitingRunIds: [...locks.dueWaitingRunIds].sort(),
    waitingStepIds: [...locks.waitingStepIds].sort(),
    waitingKeys: [...locks.waitingKeys].sort(),
    ...(locks.nextExpires === undefined
      ? {}
      : { nextExpiresAt: locks.nextExpires.timestamp, nextExpiringKey: locks.nextExpires.key }),
    ...(locks.oldestStaleAt === undefined ? {} : { oldestStaleAt: locks.oldestStaleAt }),
    ...(locks.nextWaitDeadline === undefined
      ? {}
      : {
          nextWaitDeadlineAt: locks.nextWaitDeadline.timestamp,
          nextWaitDeadlineRunId: locks.nextWaitDeadline.runId,
        }),
  };
}

export function workflowRecoveryLockWaitDetails(
  attempt: WorkflowStepAttemptRecord,
): WorkflowRecoveryLockWaitDetails | undefined {
  const error = attempt.error;
  if (
    !(
      attempt.status === "failed" &&
      attempt.kind === "run" &&
      error !== undefined &&
      WorkflowRetryableError.isLockAlreadyHeld(error) &&
      typeof error.details?.key === "string" &&
      error.details.key.trim() !== ""
    )
  ) {
    return undefined;
  }
  const waitDeadlineAt = workflowLockWaitDeadline(attempt);
  return {
    key: error.details.key,
    ...(waitDeadlineAt === undefined ? {} : { waitDeadlineAt }),
  };
}

function workflowLockWaitDeadline(
  attempt: WorkflowStepAttemptRecord,
): Temporal.Instant | undefined {
  const deadline = attempt.error?.details?.waitDeadlineAt;
  if (!(typeof deadline === "string" && deadline.trim() !== "")) {
    return undefined;
  }
  try {
    return Temporal.Instant.from(deadline);
  } catch {
    return undefined;
  }
}

function earliestWorkflowRecoveryLockExpiration(
  current: WorkflowRecoveryLockExpiration | undefined,
  key: string,
  timestamp: Temporal.Instant,
): WorkflowRecoveryLockExpiration {
  return current === undefined || Temporal.Instant.compare(timestamp, current.timestamp) < 0
    ? { key, timestamp }
    : current;
}
