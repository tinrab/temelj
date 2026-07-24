import { describe, expect, test } from "vitest";

import type { LockRecord } from "../../src/types/lock.ts";
import type { WorkflowRunRecord } from "../../src/types/run.ts";
import type { ScheduleRecord } from "../../src/types/schedule.ts";
import type { WorkflowStepAttemptRecord } from "../../src/types/step-attempts.ts";

import {
  createWorkflowRecoveryLockSummaryReducer,
  workflowRecoveryLockWaitDetails,
} from "../../src/engine/summary/recovery-locks.ts";
import { createWorkflowRecoveryScheduleSummaryReducer } from "../../src/engine/summary/recovery-schedules.ts";
import { WorkflowErrorCode } from "../../src/errors/mod.ts";

describe("workflow recovery resource summary reducers", () => {
  test("summarizes due schedules and next schedule fire", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");
    const reducer = createWorkflowRecoveryScheduleSummaryReducer(now);
    reducer.addSchedule(
      scheduleRecord("schedule_due", "active", {
        nextFireAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
      }),
    );
    reducer.addSchedule(
      scheduleRecord("schedule_future", "active", {
        nextFireAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    reducer.addSchedule(
      scheduleRecord("schedule_paused", "paused", {
        nextFireAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      }),
    );

    expect(reducer.finish()).toMatchObject({
      total: 2,
      due: 1,
      scheduleIds: ["schedule_due", "schedule_future"],
      dueScheduleIds: ["schedule_due"],
      invalidNextFireScheduleIds: [],
      nextFireAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
      nextFireScheduleId: "schedule_due",
    });
  });

  test("extracts lock wait details from retryable lock failures", () => {
    expect(
      workflowRecoveryLockWaitDetails(
        lockWaitAttempt("run_lock", "lock:held", {
          waitDeadlineAt: "2026-06-12T10:30:00Z",
        }),
      ),
    ).toEqual({
      key: "lock:held",
      waitDeadlineAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
    });
    expect(
      workflowRecoveryLockWaitDetails(
        stepAttempt("run_lock", "lock:other", "lock", "run", {
          status: "failed",
          error: {
            name: "Error",
            message: "Workflow lock is already held: lock:held",
            details: { key: "lock:held" },
          },
        }),
      ),
    ).toBeUndefined();
    expect(
      workflowRecoveryLockWaitDetails(
        lockWaitAttempt("run_lock", "lock:held", {
          waitDeadlineAt: "not-an-instant",
        }),
      ),
    ).toEqual({ key: "lock:held" });
  });

  test("summarizes stale locks and waiting lock attempts", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");
    const reducer = createWorkflowRecoveryLockSummaryReducer(
      [
        runRecord("run_lock_due", "waiting", {
          retryAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
          retryReason: "step",
        }),
        runRecord("run_lock_future", "waiting", {
          retryAt: Temporal.Instant.from("2026-06-12T10:10:00Z"),
          retryReason: "step",
        }),
      ],
      now,
    );
    reducer.addLock(
      lockRecord("lock:stale", {
        holderId: "holder_stale",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      }),
    );
    reducer.addLock(
      lockRecord("lock:future", {
        holderId: "holder_future",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
      }),
    );
    reducer.addLock(
      lockRecord("lock:released", {
        holderId: "holder_released",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
        releasedAt: Temporal.Instant.from("2026-06-12T09:51:00Z"),
      }),
    );
    reducer.addLockWaitAttempt(
      lockWaitAttempt("run_lock_due", "lock:future", {
        waitDeadlineAt: "2026-06-12T10:30:00Z",
      }),
    );
    reducer.addLockWaitAttempt(
      lockWaitAttempt("run_lock_future", "lock:future", {
        waitDeadlineAt: "2026-06-12T10:15:00Z",
      }),
    );

    expect(reducer.finish()).toMatchObject({
      total: 2,
      stale: 1,
      keys: ["lock:future", "lock:stale"],
      staleKeys: ["lock:stale"],
      holderIds: ["holder_future", "holder_stale"],
      waitingRunIds: ["run_lock_due", "run_lock_future"],
      dueWaitingRunIds: ["run_lock_due"],
      waitingStepIds: ["lock:run_lock_due", "lock:run_lock_future"],
      waitingKeys: ["lock:future"],
      nextExpiresAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
      nextExpiringKey: "lock:future",
      oldestStaleAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      nextWaitDeadlineAt: Temporal.Instant.from("2026-06-12T10:15:00Z"),
      nextWaitDeadlineRunId: "run_lock_future",
    });
  });
});

function runRecord(
  id: string,
  status: WorkflowRunRecord["status"],
  patch: Partial<WorkflowRunRecord> = {},
): WorkflowRunRecord {
  const timestamp = Temporal.Instant.from("2026-06-12T09:00:00Z");
  return {
    id,
    namespace: "default",
    workflowName: "summary",
    status,
    input: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason:
      status === "running" ? "claimed" : status === "failed" ? "failed" : "created",
    ...patch,
  };
}

function scheduleRecord(
  id: string,
  status: ScheduleRecord["status"],
  patch: Partial<ScheduleRecord> = {},
): ScheduleRecord {
  const timestamp = Temporal.Instant.from("2026-06-12T09:00:00Z");
  return {
    id,
    namespace: "default",
    workflowName: "summary-schedule",
    status,
    every: Temporal.Duration.from({ hours: 1 }),
    catchUp: "skip",
    overlap: "skip",
    createdAt: timestamp,
    updatedAt: timestamp,
    nextFireAt: timestamp,
    tickCount: 0,
    ...patch,
  };
}

function lockRecord(key: string, patch: Partial<LockRecord> = {}): LockRecord {
  const timestamp = Temporal.Instant.from("2026-06-12T09:00:00Z");
  return {
    key,
    namespace: "default",
    holderId: `holder:${key}`,
    fencingToken: 1,
    acquiredAt: timestamp,
    leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
    ...patch,
  };
}

function lockWaitAttempt(
  runId: string,
  key: string,
  details: { readonly waitDeadlineAt?: string } = {},
): WorkflowStepAttemptRecord {
  return stepAttempt(runId, `lock:${runId}`, "lock", "run", {
    status: "failed",
    error: {
      code: WorkflowErrorCode.LOCK_ALREADY_HELD,
      name: "WorkflowRetryableError",
      message: `Workflow lock is already held: ${key}`,
      details: {
        key,
        ...details,
      },
    },
  });
}

function stepAttempt(
  runId: string,
  stepId: string,
  stepName: string,
  kind: WorkflowStepAttemptRecord["kind"],
  patch: Partial<WorkflowStepAttemptRecord> = {},
): WorkflowStepAttemptRecord {
  const timestamp = Temporal.Instant.from("2026-06-12T09:00:00Z");
  return {
    runId,
    stepId,
    stepName,
    kind,
    status: "running",
    attempt: 1,
    createdAt: timestamp,
    startedAt: timestamp,
    ...patch,
  };
}
