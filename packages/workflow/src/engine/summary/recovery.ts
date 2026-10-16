import { isString } from "@temelj/value";

import type { EventRecord } from "../../types/events.ts";
import type { RunId } from "../../types/ids.ts";
import type { LockRecord } from "../../types/lock.ts";
import type { RunRecord } from "../../types/run.ts";
import type { ScheduleId, ScheduleRecord } from "../../types/schedule.ts";
import type { StepAttemptRecord } from "../../types/step-attempts.ts";
import type {
  RecoveryChildWorkflowWaitSummary,
  RecoveryLockSummary,
  RecoveryMessageWaitSummary,
  RecoveryRetrySummary,
  RecoveryScheduleSummary,
  RecoverySleepWaitSummary,
  RecoverySummary,
} from "../../types/summary.ts";

import { WorkflowErrorCode } from "../../errors/codes.ts";
import { matchesWorkflowError } from "../../errors/mod.ts";
import { History } from "../../history/replay.ts";
import { isScheduledRunStatus } from "../../run-status.ts";
import { earliestOptionalTimestamp, latestOptionalTimestamp } from "../../temporal.ts";
import { Earliest, sorted } from "./tally.ts";

export interface RecoverySummaryInputs {
  readonly sleepAttempts?: readonly StepAttemptRecord[];
  readonly messageWaitAttempts?: readonly StepAttemptRecord[];
  readonly childWorkflowAttempts?: readonly StepAttemptRecord[];
  readonly childRuns?: readonly RunRecord[];
  readonly eventsByRunId?: ReadonlyMap<string, readonly EventRecord[]>;
  readonly lockWaitAttempts?: readonly StepAttemptRecord[];
  readonly locks?: readonly LockRecord[];
  readonly schedules?: readonly ScheduleRecord[];
}

interface RecoverySummaryOptions {
  readonly runs: readonly RunRecord[];
  readonly now: Temporal.Instant;
  readonly inputs?: RecoverySummaryInputs;
}

/**
 * Every run that can make progress now, and when the next sleep, retry, lease, schedule,
 * lock wait, or external wait should be checked again.
 */
export function summarizeRecovery(options: RecoverySummaryOptions): RecoverySummary {
  const { runs, now, inputs = {} } = options;
  const due = new RunSet();
  const pending = new Set<string>();
  const waiting = new Set<string>();
  const lease = new LeaseTally(now);
  const retry = new RunSet();
  const missingImplementation = new RunSet();
  const failed = new Set<string>();
  let latestFailedAt: Temporal.Instant | undefined;

  for (const run of runs) {
    if (isScheduledRunStatus(run.status)) {
      if (isDueAt(run.availableAt, now)) {
        due.add(run.id, true);
        (run.status === "pending" ? pending : waiting).add(run.id);
      } else {
        due.next.offer(run.availableAt, { runId: run.id });
      }

      if (run.retryReason !== undefined) {
        const retryDue = isDueAt(run.retryAt, now);
        retry.add(run.id, retryDue, run.retryAt);

        if (run.retryReason === "missing_implementation") {
          missingImplementation.add(run.id, retryDue, run.retryAt);
        }
      }
    }

    lease.add(run);

    if (run.status === "failed") {
      failed.add(run.id);
      latestFailedAt = latestOptionalTimestamp(latestFailedAt, run.finishedAt);
    }
  }

  const sleep = summarizeSleepWaits(inputs.sleepAttempts ?? [], now);

  const message = summarizeMessageWaits(
    inputs.messageWaitAttempts ?? [],
    inputs.eventsByRunId ?? new Map(),
    now,
  );

  const childWorkflow = summarizeChildWorkflowWaits(
    inputs.childWorkflowAttempts ?? [],
    inputs.childRuns ?? [],
    now,
  );

  const lock = summarizeLocks(inputs.locks ?? [], inputs.lockWaitAttempts ?? [], runs, now);
  const schedule = summarizeSchedules(inputs.schedules ?? [], now);

  const next = new Earliest<object>();

  for (const candidate of [
    due.next.next,
    lease.next.next,
    retry.next.next,
    schedule.next,
    lock.nextExpiry,
    lock.nextWaitDeadline,
    sleep.next,
    message.next,
    childWorkflow.next,
  ]) {
    next.offer(candidate?.at, {});
  }

  return {
    total: runs.length,
    recoverableRunIds: sorted(
      new Set([
        ...due.dueIds,
        ...lease.staleRunIds,
        ...retry.dueIds,
        ...failed,
        ...sleep.dueRunIds,
        ...message.readyRunIds,
        ...message.timedOutRunIds,
        ...childWorkflow.terminalRunIds,
        ...childWorkflow.missingRunIds,
        ...childWorkflow.timedOutRunIds,
      ]),
    ),
    due: {
      runIds: sorted(due.dueIds),
      pendingRunIds: sorted(pending),
      waitingRunIds: sorted(waiting),
      next: due.next.next,
    },
    lease: lease.finish(),
    retry: retry.finish(),
    missingImplementation: missingImplementation.finish(),
    failed: { runIds: sorted(failed), latestFailedAt },
    schedule,
    lock,
    wait: { sleep, message, childWorkflow },
    nextRecoveryAt: next.at,
  };
}

interface LockWaitDetails {
  readonly key: string;
  readonly waitDeadlineAt?: Temporal.Instant;
}

/** The lock a failed step attempt was waiting for, when it failed because the lock was held. */
export function lockWaitDetails(attempt: StepAttemptRecord): LockWaitDetails | undefined {
  const error = attempt.error;

  if (
    attempt.status !== "failed" ||
    attempt.kind !== "run" ||
    error === undefined ||
    !matchesWorkflowError(error, WorkflowErrorCode.LOCK_ALREADY_HELD) ||
    !isString(error.details?.key) ||
    error.details.key.trim() === ""
  ) {
    return undefined;
  }

  const deadline = error.details.waitDeadlineAt;

  return {
    key: error.details.key,
    waitDeadlineAt:
      isString(deadline) && deadline.trim() !== "" ? parseInstant(deadline) : undefined,
  };
}

function parseInstant(value: string): Temporal.Instant | undefined {
  try {
    return Temporal.Instant.from(value);
  } catch {
    return undefined;
  }
}

function isDueAt(at: Temporal.Instant | undefined, now: Temporal.Instant): boolean {
  return at === undefined || Temporal.Instant.compare(at, now) <= 0;
}

/** Runs of one kind, those that are due, and the earliest that is not yet due. */
class RunSet {
  readonly ids = new Set<string>();
  readonly dueIds = new Set<string>();
  readonly next = new Earliest<{ readonly runId: RunId }>();

  add(id: RunId, due: boolean, at?: Temporal.Instant): void {
    this.ids.add(id);

    if (due) {
      this.dueIds.add(id);
    } else {
      this.next.offer(at, { runId: id });
    }
  }

  finish(): RecoveryRetrySummary {
    return { runIds: sorted(this.ids), dueRunIds: sorted(this.dueIds), next: this.next.next };
  }
}

class LeaseTally {
  readonly #now: Temporal.Instant;
  readonly runIds = new Set<string>();
  readonly staleRunIds = new Set<string>();
  readonly #ownerless = new Set<string>();
  readonly #missingExpiresAt = new Set<string>();
  readonly #expired = new Set<string>();
  readonly #workerIds = new Set<string>();
  readonly next = new Earliest<{ readonly runId: RunId }>();
  #oldestStaleAt: Temporal.Instant | undefined;

  constructor(now: Temporal.Instant) {
    this.#now = now;
  }

  add(run: RunRecord): void {
    if (run.status !== "running") {
      return;
    }

    this.runIds.add(run.id);

    if (run.workerId === undefined) {
      this.staleRunIds.add(run.id);
      this.#ownerless.add(run.id);
    } else {
      this.#workerIds.add(run.workerId);
    }

    if (run.leaseExpiresAt === undefined) {
      this.staleRunIds.add(run.id);
      this.#missingExpiresAt.add(run.id);
    } else if (Temporal.Instant.compare(run.leaseExpiresAt, this.#now) <= 0) {
      this.staleRunIds.add(run.id);
      this.#expired.add(run.id);
      this.#oldestStaleAt = earliestOptionalTimestamp(this.#oldestStaleAt, run.leaseExpiresAt);
    } else if (run.workerId !== undefined) {
      this.next.offer(run.leaseExpiresAt, { runId: run.id });
    }
  }

  finish(): RecoverySummary["lease"] {
    return {
      runIds: sorted(this.runIds),
      staleRunIds: sorted(this.staleRunIds),
      ownerlessRunIds: sorted(this.#ownerless),
      missingExpiresAtRunIds: sorted(this.#missingExpiresAt),
      expiredRunIds: sorted(this.#expired),
      workerIds: sorted(this.#workerIds),
      next: this.next.next,
      oldestStaleAt: this.#oldestStaleAt,
    };
  }
}

function summarizeSleepWaits(
  attempts: readonly StepAttemptRecord[],
  now: Temporal.Instant,
): RecoverySleepWaitSummary {
  const runIds = new Set<string>();
  const dueRunIds = new Set<string>();
  const dueStepIds = new Set<string>();
  const invalidUntilRunIds = new Set<string>();
  const next = new Earliest<{ readonly runId: RunId }>();

  for (const attempt of attempts) {
    if (attempt.status !== "running" || attempt.kind !== "sleep") {
      continue;
    }

    runIds.add(attempt.runId);

    if (attempt.until === undefined) {
      invalidUntilRunIds.add(attempt.runId);
    }

    if (isDueAt(attempt.until, now)) {
      dueRunIds.add(attempt.runId);
      dueStepIds.add(attempt.stepId);
    } else {
      next.offer(attempt.until, { runId: attempt.runId });
    }
  }

  return {
    runIds: sorted(runIds),
    dueRunIds: sorted(dueRunIds),
    dueStepIds: sorted(dueStepIds),
    invalidUntilRunIds: sorted(invalidUntilRunIds),
    next: next.next,
  };
}

function summarizeMessageWaits(
  attempts: readonly StepAttemptRecord[],
  eventsByRunId: ReadonlyMap<string, readonly EventRecord[]>,
  now: Temporal.Instant,
): RecoveryMessageWaitSummary {
  const histories = new Map<string, History>();
  const runIds = new Set<string>();
  const readyRunIds = new Set<string>();
  const readyStepIds = new Set<string>();
  const timedOutRunIds = new Set<string>();
  const timedOutStepIds = new Set<string>();
  const messages = new Set<string>();
  const next = new Earliest<{ readonly runId: RunId }>();

  for (const attempt of attempts) {
    if (attempt.status !== "running" || attempt.kind !== "message-wait") {
      continue;
    }

    runIds.add(attempt.runId);

    if (attempt.messageId !== undefined) {
      messages.add(attempt.messageId);

      // A wait is ready when a message for it was recorded after the wait started; a targeted
      // message also has to name this waiter.
      const events = eventsByRunId.get(attempt.runId);

      if (events !== undefined) {
        let history = histories.get(attempt.runId);

        if (history === undefined) {
          history = new History(events);
          histories.set(attempt.runId, history);
        }

        if (history.messageForWait(attempt.messageId, attempt.stepId, attempt.timeoutAt)) {
          readyRunIds.add(attempt.runId);
          readyStepIds.add(attempt.stepId);
          continue;
        }
      }
    }

    if (attempt.timeoutAt === undefined) {
      continue;
    }

    if (Temporal.Instant.compare(attempt.timeoutAt, now) <= 0) {
      timedOutRunIds.add(attempt.runId);
      timedOutStepIds.add(attempt.stepId);
    } else {
      next.offer(attempt.timeoutAt, { runId: attempt.runId });
    }
  }

  return {
    runIds: sorted(runIds),
    readyRunIds: sorted(readyRunIds),
    timedOutRunIds: sorted(timedOutRunIds),
    readyStepIds: sorted(readyStepIds),
    timedOutStepIds: sorted(timedOutStepIds),
    messages: sorted(messages),
    next: next.next,
  };
}

function summarizeChildWorkflowWaits(
  attempts: readonly StepAttemptRecord[],
  childRuns: readonly RunRecord[],
  now: Temporal.Instant,
): RecoveryChildWorkflowWaitSummary {
  const childById = new Map(childRuns.map((run) => [run.id, run]));
  const runIds = new Set<string>();
  const terminal = { runIds: new Set<string>(), stepIds: new Set<string>() };
  const missing = { runIds: new Set<string>(), stepIds: new Set<string>() };
  const timedOut = { runIds: new Set<string>(), stepIds: new Set<string>() };
  const childRunIds = new Set<string>();
  const completed = new Set<string>();
  const failed = new Set<string>();
  const canceled = new Set<string>();
  const next = new Earliest<{ readonly runId: RunId }>();

  for (const attempt of attempts) {
    if (attempt.status !== "running" || attempt.kind !== "workflow") {
      continue;
    }

    runIds.add(attempt.runId);

    if (attempt.childRunId !== undefined) {
      childRunIds.add(attempt.childRunId);
    }

    const child = attempt.childRunId === undefined ? undefined : childById.get(attempt.childRunId);

    if (child === undefined) {
      missing.runIds.add(attempt.runId);
      missing.stepIds.add(attempt.stepId);
      continue;
    }

    if (child.status === "completed" || child.status === "failed" || child.status === "canceled") {
      terminal.runIds.add(attempt.runId);
      terminal.stepIds.add(attempt.stepId);

      if (child.status === "completed") {
        completed.add(child.id);
      } else if (child.status === "failed") {
        failed.add(child.id);
      } else {
        canceled.add(child.id);
      }

      continue;
    }

    if (attempt.timeoutAt === undefined) {
      continue;
    }

    if (Temporal.Instant.compare(attempt.timeoutAt, now) <= 0) {
      timedOut.runIds.add(attempt.runId);
      timedOut.stepIds.add(attempt.stepId);
    } else {
      next.offer(attempt.timeoutAt, { runId: attempt.runId });
    }
  }

  return {
    runIds: sorted(runIds),
    terminalRunIds: sorted(terminal.runIds),
    missingRunIds: sorted(missing.runIds),
    timedOutRunIds: sorted(timedOut.runIds),
    terminalStepIds: sorted(terminal.stepIds),
    missingStepIds: sorted(missing.stepIds),
    timedOutStepIds: sorted(timedOut.stepIds),
    childRunIds: sorted(childRunIds),
    completedChildRunIds: sorted(completed),
    failedChildRunIds: sorted(failed),
    canceledChildRunIds: sorted(canceled),
    next: next.next,
  };
}

function summarizeLocks(
  locks: readonly LockRecord[],
  waitAttempts: readonly StepAttemptRecord[],
  runs: readonly RunRecord[],
  now: Temporal.Instant,
): RecoveryLockSummary {
  const keys = new Set<string>();
  const staleKeys = new Set<string>();
  const holderIds = new Set<string>();
  const nextExpiry = new Earliest<{ readonly key: string }>();
  let oldestStaleAt: Temporal.Instant | undefined;

  for (const lock of locks) {
    if (lock.releasedAt !== undefined) {
      continue;
    }

    keys.add(lock.key);

    if (lock.holderId !== undefined) {
      holderIds.add(lock.holderId);
    }

    if (Temporal.Instant.compare(lock.leaseExpiresAt, now) <= 0) {
      staleKeys.add(lock.key);
      oldestStaleAt = earliestOptionalTimestamp(oldestStaleAt, lock.leaseExpiresAt);
    } else {
      nextExpiry.offer(lock.leaseExpiresAt, { key: lock.key });
    }
  }

  const runById = new Map(runs.map((run) => [run.id, run]));
  const waitingRunIds = new Set<string>();
  const dueWaitingRunIds = new Set<string>();
  const waitingStepIds = new Set<string>();
  const waitingKeys = new Set<string>();
  const nextWaitDeadline = new Earliest<{ readonly runId: RunId }>();

  for (const attempt of waitAttempts) {
    const details = lockWaitDetails(attempt);
    const run = runById.get(attempt.runId);

    if (
      details === undefined ||
      run === undefined ||
      run.status !== "waiting" ||
      run.retryReason !== "step"
    ) {
      continue;
    }

    waitingRunIds.add(attempt.runId);
    waitingStepIds.add(attempt.stepId);
    waitingKeys.add(details.key);

    if (isDueAt(run.retryAt, now)) {
      dueWaitingRunIds.add(attempt.runId);
    }

    if (
      details.waitDeadlineAt !== undefined &&
      Temporal.Instant.compare(details.waitDeadlineAt, now) > 0
    ) {
      nextWaitDeadline.offer(details.waitDeadlineAt, { runId: attempt.runId });
    }
  }

  return {
    keys: sorted(keys),
    staleKeys: sorted(staleKeys),
    holderIds: sorted(holderIds),
    waitingRunIds: sorted(waitingRunIds),
    dueWaitingRunIds: sorted(dueWaitingRunIds),
    waitingStepIds: sorted(waitingStepIds),
    waitingKeys: sorted(waitingKeys),
    oldestStaleAt,
    nextExpiry: nextExpiry.next,
    nextWaitDeadline: nextWaitDeadline.next,
  };
}

function summarizeSchedules(
  schedules: readonly ScheduleRecord[],
  now: Temporal.Instant,
): RecoveryScheduleSummary {
  const ids = new Set<string>();
  const dueIds = new Set<string>();
  const next = new Earliest<{ readonly scheduleId: ScheduleId }>();

  for (const schedule of schedules) {
    if (schedule.status !== "active") {
      continue;
    }

    ids.add(schedule.id);

    if (Temporal.Instant.compare(schedule.nextFireAt, now) <= 0) {
      dueIds.add(schedule.id);
    }

    next.offer(schedule.nextFireAt, { scheduleId: schedule.id });
  }

  return {
    scheduleIds: sorted(ids),
    dueScheduleIds: sorted(dueIds),
    next: next.next,
  };
}
