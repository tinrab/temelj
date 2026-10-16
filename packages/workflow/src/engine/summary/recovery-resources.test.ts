import { describe, expect, test } from "vitest";

import type { LockRecord } from "../../types/lock.ts";
import type { RunRecord } from "../../types/run.ts";
import type { ScheduleRecord } from "../../types/schedule.ts";
import type { StepAttemptRecord } from "../../types/step-attempts.ts";

import { WorkflowErrorCode } from "../../errors/mod.ts";
import { lockWaitDetails, summarizeRecovery } from "./recovery.ts";

describe("workflow recovery resource summary", () => {
  test("summarizes due schedules and next schedule fire", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");

    const schedules = [
      scheduleRecord("schedule_due", "active", {
        nextFireAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
      }),
      scheduleRecord("schedule_future", "active", {
        nextFireAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
      scheduleRecord("schedule_paused", "paused", {
        nextFireAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      }),
    ];

    expect(summarizeRecovery({ runs: [], now, inputs: { schedules } }).schedule).toMatchObject({
      scheduleIds: ["schedule_due", "schedule_future"],
      dueScheduleIds: ["schedule_due"],
      next: { at: Temporal.Instant.from("2026-06-12T09:59:00Z"), scheduleId: "schedule_due" },
    });
  });

  test("extracts lock wait details from retryable lock failures", () => {
    expect(
      lockWaitDetails(
        lockWaitAttempt("run_lock", "lock:held", {
          waitDeadlineAt: "2026-06-12T10:30:00Z",
        }),
      ),
    ).toEqual({
      key: "lock:held",
      waitDeadlineAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
    });
    expect(
      lockWaitDetails(
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
      lockWaitDetails(
        lockWaitAttempt("run_lock", "lock:held", {
          waitDeadlineAt: "not-an-instant",
        }),
      ),
    ).toEqual({ key: "lock:held" });
  });

  test("summarizes stale locks and waiting lock attempts", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");

    const runs = [
      runRecord("run_lock_due", "waiting", {
        retryAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
        retryReason: "step",
      }),
      runRecord("run_lock_future", "waiting", {
        retryAt: Temporal.Instant.from("2026-06-12T10:10:00Z"),
        retryReason: "step",
      }),
    ];

    const locks = [
      lockRecord("lock:stale", {
        holderId: "holder_stale",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      }),
      lockRecord("lock:future", {
        holderId: "holder_future",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
      }),
      lockRecord("lock:released", {
        holderId: "holder_released",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
        releasedAt: Temporal.Instant.from("2026-06-12T09:51:00Z"),
      }),
    ];

    const lockWaitAttempts = [
      lockWaitAttempt("run_lock_due", "lock:future", {
        waitDeadlineAt: "2026-06-12T10:30:00Z",
      }),
      lockWaitAttempt("run_lock_future", "lock:future", {
        waitDeadlineAt: "2026-06-12T10:15:00Z",
      }),
    ];

    expect(
      summarizeRecovery({ runs, now, inputs: { locks, lockWaitAttempts } }).lock,
    ).toMatchObject({
      keys: ["lock:future", "lock:stale"],
      staleKeys: ["lock:stale"],
      holderIds: ["holder_future", "holder_stale"],
      waitingRunIds: ["run_lock_due", "run_lock_future"],
      dueWaitingRunIds: ["run_lock_due"],
      waitingStepIds: ["lock:run_lock_due", "lock:run_lock_future"],
      waitingKeys: ["lock:future"],
      oldestStaleAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      nextExpiry: { at: Temporal.Instant.from("2026-06-12T10:20:00Z"), key: "lock:future" },
      nextWaitDeadline: {
        at: Temporal.Instant.from("2026-06-12T10:15:00Z"),
        runId: "run_lock_future",
      },
    });
  });
});

function runRecord(
  id: string,
  status: RunRecord["status"],
  patch: Partial<RunRecord> = {},
): RunRecord {
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
): StepAttemptRecord {
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
  kind: StepAttemptRecord["kind"],
  patch: Partial<StepAttemptRecord> = {},
): StepAttemptRecord {
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
