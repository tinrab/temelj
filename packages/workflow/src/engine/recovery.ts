import type { LockRecord } from "../types/lock.ts";
import type { WorkflowRunRecord } from "../types/run.ts";
import type { ScheduleRecord } from "../types/schedule.ts";
import type { WorkflowStepAttemptRecord } from "../types/step-attempts.ts";
import type { WorkflowRecoverySummary } from "../types/summary.ts";

import { createWorkflowRecoveryLockSummaryReducer } from "./summary/recovery-locks.ts";
import { createWorkflowRecoveryRunSummaryReducer } from "./summary/recovery-runs.ts";
import { createWorkflowRecoveryScheduleSummaryReducer } from "./summary/recovery-schedules.ts";
import {
  createWorkflowRecoveryWaitSummaryReducer,
  type WorkflowRecoveryWaitInputs,
} from "./summary/recovery-waits.ts";

export interface WorkflowRecoverySummaryInputs extends WorkflowRecoveryWaitInputs {
  readonly lockWaitAttempts?: readonly WorkflowStepAttemptRecord[];
  readonly locks?: readonly LockRecord[];
  readonly schedules?: readonly ScheduleRecord[];
}

export interface WorkflowRecoverySummaryOptions {
  readonly runs: readonly WorkflowRunRecord[];
  readonly now: Temporal.Instant;
  readonly inputs?: WorkflowRecoverySummaryInputs;
}

interface WorkflowRecoveryResourceInputs {
  readonly lockWaitAttempts?: readonly WorkflowStepAttemptRecord[];
  readonly locks?: readonly LockRecord[];
  readonly schedules?: readonly ScheduleRecord[];
}

function recoveryWaitInputs(inputs: WorkflowRecoverySummaryInputs): WorkflowRecoveryWaitInputs {
  return {
    sleepAttempts: inputs.sleepAttempts,
    messageWaitAttempts: inputs.messageWaitAttempts,
    childWorkflowAttempts: inputs.childWorkflowAttempts,
    childRuns: inputs.childRuns,
    eventsByRunId: inputs.eventsByRunId,
  };
}

function recoveryResourceInputs(
  inputs: WorkflowRecoverySummaryInputs,
): WorkflowRecoveryResourceInputs {
  return {
    lockWaitAttempts: inputs.lockWaitAttempts,
    locks: inputs.locks,
    schedules: inputs.schedules,
  };
}

export interface WorkflowRecoveryDeadline {
  readonly timestamp: Temporal.Instant;
}

export function summarizeWorkflowRecovery(
  options: WorkflowRecoverySummaryOptions,
): WorkflowRecoverySummary {
  const { runs, now, inputs = {} } = options;
  const waitInputs = recoveryWaitInputs(inputs);
  const resources = recoveryResourceInputs(inputs);

  const runReducer = createWorkflowRecoveryRunSummaryReducer(now);
  for (const run of runs) {
    runReducer.addRun(run);
  }
  const runSummary = runReducer.finish();

  const waitReducer = createWorkflowRecoveryWaitSummaryReducer(waitInputs, now);
  waitReducer.addSleepAttempts(waitInputs.sleepAttempts ?? []);
  waitReducer.addMessageWaitAttempts(waitInputs.messageWaitAttempts ?? []);
  waitReducer.addChildWorkflowAttempts(waitInputs.childWorkflowAttempts ?? []);
  const wait = waitReducer.finish();

  const lockReducer = createWorkflowRecoveryLockSummaryReducer(runs, now);
  for (const lockRecord of resources.locks ?? []) {
    lockReducer.addLock(lockRecord);
  }
  for (const attempt of resources.lockWaitAttempts ?? []) {
    lockReducer.addLockWaitAttempt(attempt);
  }
  const lock = lockReducer.finish();

  const scheduleReducer = createWorkflowRecoveryScheduleSummaryReducer(now);
  for (const scheduleRecord of resources.schedules ?? []) {
    scheduleReducer.addSchedule(scheduleRecord);
  }
  const schedule = scheduleReducer.finish();

  const recoverableRunIds = mergeWorkflowRecoveryRunIds([
    runSummary.recoverableRunIds,
    wait.sleep.dueRunIds,
    wait.message.readyRunIds,
    wait.message.timedOutRunIds,
    wait.childWorkflow.terminalRunIds,
    wait.childWorkflow.missingRunIds,
    wait.childWorkflow.timedOutRunIds,
  ]);
  // Recovery reports every run that can make progress now, while nextRecoveryAt below answers when a sleeping retry, lease, schedule, lock wait, or external wait should be checked again.
  const summary = {
    total: runSummary.total,
    recoverableRunIds,
    due: runSummary.due,
    lease: runSummary.lease,
    retry: runSummary.retry,
    missingImplementation: runSummary.missingImplementation,
    failed: runSummary.failed,
    schedule,
    lock,
    wait,
  };
  const nextRecovery = earliestWorkflowRecoveryDeadline([
    runSummary.nextAvailable,
    runSummary.nextLeaseExpires,
    runSummary.nextRetry,
    workflowRecoveryDeadline(schedule.nextFireScheduleId, schedule.nextFireAt),
    workflowRecoveryDeadline(lock.nextExpiringKey, lock.nextExpiresAt),
    workflowRecoveryDeadline(lock.nextWaitDeadlineRunId, lock.nextWaitDeadlineAt),
    workflowRecoveryDeadline(wait.sleep.nextWakeRunId, wait.sleep.nextWakeAt),
    workflowRecoveryDeadline(wait.message.nextTimeoutRunId, wait.message.nextTimeoutAt),
    workflowRecoveryDeadline(wait.childWorkflow.nextTimeoutRunId, wait.childWorkflow.nextTimeoutAt),
  ]);
  return {
    ...summary,
    ...(nextRecovery === undefined ? {} : { nextRecoveryAt: nextRecovery.timestamp }),
  };
}

export function mergeWorkflowRecoveryRunIds(
  runIdGroups: readonly (readonly string[])[],
): readonly string[] {
  return [...new Set(runIdGroups.flat())].sort();
}

export function workflowRecoveryDeadline(
  ownerId: string | undefined,
  timestamp: Temporal.Instant | undefined,
): WorkflowRecoveryDeadline | undefined {
  return ownerId === undefined || timestamp === undefined ? undefined : { timestamp };
}

export function earliestWorkflowRecoveryDeadline(
  candidates: readonly (WorkflowRecoveryDeadline | undefined)[],
): WorkflowRecoveryDeadline | undefined {
  return candidates.reduce<WorkflowRecoveryDeadline | undefined>((current, candidate) => {
    if (candidate === undefined) {
      return current;
    }
    if (current === undefined) {
      return candidate;
    }
    return Temporal.Instant.compare(candidate.timestamp, current.timestamp) < 0
      ? candidate
      : current;
  }, undefined);
}
