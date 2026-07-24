import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";

describe("workflow recovery summaries", () => {
  test("summarizes due runs, stale leases, retries, missing implementations, and failures", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    await engine.store.createRun(
      runRecord("run_due_pending", "pending", {
        availableAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("run_future_waiting", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:10:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("run_retry_due", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        retryAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        retryReason: "step",
        retryAttempt: 2,
      }),
    );
    await engine.store.createRun(
      runRecord("run_missing_impl_future", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        retryAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        retryReason: "missing_implementation",
        retryAttempt: 1,
      }),
    );
    await engine.store.createRun(
      runRecord("run_stale_lease", "running", {
        workerId: "worker_a",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("run_active_lease", "running", {
        workerId: "worker_b",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("run_failed", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
        error: { name: "Error", message: "boom" },
      }),
    );

    const summary = await client.runs.recovery();

    expect(summary).toMatchObject({
      total: 7,
      recoverableRunIds: ["run_due_pending", "run_failed", "run_retry_due", "run_stale_lease"],
      due: {
        total: 2,
        runIds: ["run_due_pending", "run_retry_due"],
        pendingRunIds: ["run_due_pending"],
        waitingRunIds: ["run_retry_due"],
        nextAvailableAt: Temporal.Instant.from("2026-06-12T10:10:00Z"),
        nextAvailableRunId: "run_future_waiting",
      },
      lease: {
        total: 2,
        stale: 1,
        runIds: ["run_active_lease", "run_stale_lease"],
        staleRunIds: ["run_stale_lease"],
        expiredRunIds: ["run_stale_lease"],
        workerIds: ["worker_a", "worker_b"],
        nextExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        nextExpiringRunId: "run_active_lease",
        oldestStaleAt: Temporal.Instant.from("2026-06-12T09:58:00Z"),
      },
      retry: {
        total: 2,
        due: 1,
        runIds: ["run_missing_impl_future", "run_retry_due"],
        dueRunIds: ["run_retry_due"],
        nextRetryAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        nextRetryRunId: "run_missing_impl_future",
      },
      missingImplementation: {
        total: 1,
        due: 0,
        runIds: ["run_missing_impl_future"],
        dueRunIds: [],
        nextRetryAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
        nextRetryRunId: "run_missing_impl_future",
      },
      failed: {
        total: 1,
        runIds: ["run_failed"],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
      },
      nextRecoveryAt: Temporal.Instant.from("2026-06-12T10:10:00Z"),
    });
  });

  test("summarizes recurring schedules as recovery work", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "recovery-schedule" });

    await client.schedules.create(def, {
      id: "due-schedule",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-12T08:30:00Z"),
    });
    await client.schedules.create(def, {
      id: "future-schedule",
      every: Temporal.Duration.from({ hours: 1 }),
      input: undefined,
      from: Temporal.Instant.from("2026-06-12T09:30:00Z"),
    });
    await client.schedules.pause("future-schedule");

    await expect(engine.getRecoverySummary()).resolves.toMatchObject({
      schedule: {
        total: 1,
        due: 1,
        scheduleIds: ["due-schedule"],
        dueScheduleIds: ["due-schedule"],
        invalidNextFireScheduleIds: [],
        nextFireAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        nextFireScheduleId: "due-schedule",
      },
      nextRecoveryAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
    });
  });

  test("summarizes ownerless and missing lease state as recoverable", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_ownerless_lease", "running", {
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("run_missing_lease", "running", {
        workerId: "worker_missing_lease",
      }),
    );
    await expect(engine.getRecoverySummary()).resolves.toMatchObject({
      recoverableRunIds: ["run_missing_lease", "run_ownerless_lease"],
      lease: {
        staleRunIds: ["run_missing_lease", "run_ownerless_lease"],
        ownerlessRunIds: ["run_ownerless_lease"],
        missingExpiresAtRunIds: ["run_missing_lease"],
        invalidExpiresAtRunIds: [],
      },
    });
  });

  test("summarizes waiting runs whose sleep, message, or child condition is recoverable", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_sleep_due", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.appendEvent("run_sleep_due", {
      kind: "sleep_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "sleep:pause",
      stepName: "pause",
      count: 1,
      until: Temporal.Instant.from("2026-06-12T09:30:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_sleep_future", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.appendEvent("run_sleep_future", {
      kind: "sleep_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "sleep:later",
      stepName: "later",
      count: 1,
      until: Temporal.Instant.from("2026-06-12T10:15:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_message_ready", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.appendEvent("run_message_ready", {
      kind: "message_wait_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "message-wait:approval",
      stepName: "approval",
      count: 1,
      messageId: "approved",
      timeoutAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
    });
    await engine.store.appendEvent("run_message_ready", {
      kind: "message_sent",
      timestamp: Temporal.Instant.from("2026-06-12T09:05:00Z"),
      messageId: "approved",
      payload: { accepted: true },
      waiterStepIds: ["message-wait:approval"],
    });
    await engine.store.createRun(
      runRecord("run_message_timed_out", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.appendEvent("run_message_timed_out", {
      kind: "message_wait_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "message-wait:timeout",
      stepName: "timeout",
      count: 1,
      messageId: "expired",
      timeoutAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_message_future", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.appendEvent("run_message_future", {
      kind: "message_wait_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "message-wait:future",
      stepName: "future",
      count: 1,
      messageId: "future",
      timeoutAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_child_completed", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("child_completed", "completed", {
        workflowName: "child",
        parentRunId: "run_child_completed",
        parentStepId: "workflow:child",
        parentStepName: "child",
        parentStepAttempt: 1,
        finishedAt: Temporal.Instant.from("2026-06-12T09:50:00Z"),
        output: "ok",
      }),
    );
    await engine.store.appendEvent("run_child_completed", {
      kind: "child_workflow_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "workflow:child",
      stepName: "child",
      count: 1,
      attempt: 1,
      childRunId: "child_completed",
      workflowName: "child",
    });
    await engine.store.createRun(
      runRecord("run_child_missing", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.appendEvent("run_child_missing", {
      kind: "child_workflow_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "workflow:missing",
      stepName: "missing",
      count: 1,
      attempt: 1,
      childRunId: "child_missing",
      workflowName: "child",
    });
    await engine.store.createRun(
      runRecord("run_child_timed_out", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("child_running", "running", {
        workflowName: "child",
        parentRunId: "run_child_timed_out",
        parentStepId: "workflow:timeout",
        parentStepName: "timeout",
        parentStepAttempt: 1,
        workerId: "worker_child",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.appendEvent("run_child_timed_out", {
      kind: "child_workflow_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "workflow:timeout",
      stepName: "timeout",
      count: 1,
      attempt: 1,
      childRunId: "child_running",
      workflowName: "child",
      timeoutAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
    });

    await expect(engine.getRecoverySummary()).resolves.toMatchObject({
      recoverableRunIds: [
        "run_child_completed",
        "run_child_missing",
        "run_child_timed_out",
        "run_message_ready",
        "run_message_timed_out",
        "run_sleep_due",
      ],
      wait: {
        sleep: {
          active: 2,
          due: 1,
          runIds: ["run_sleep_due", "run_sleep_future"],
          dueRunIds: ["run_sleep_due"],
          dueStepIds: ["sleep:pause"],
          nextWakeAt: Temporal.Instant.from("2026-06-12T10:15:00Z"),
          nextWakeRunId: "run_sleep_future",
        },
        message: {
          active: 3,
          ready: 1,
          timedOut: 1,
          runIds: ["run_message_future", "run_message_ready", "run_message_timed_out"],
          readyRunIds: ["run_message_ready"],
          timedOutRunIds: ["run_message_timed_out"],
          readyStepIds: ["message-wait:approval"],
          timedOutStepIds: ["message-wait:timeout"],
          messages: ["approved", "expired", "future"],
          nextTimeoutAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
          nextTimeoutRunId: "run_message_future",
        },
        childWorkflow: {
          active: 3,
          terminal: 1,
          missing: 1,
          timedOut: 1,
          runIds: ["run_child_completed", "run_child_missing", "run_child_timed_out"],
          terminalRunIds: ["run_child_completed"],
          missingRunIds: ["run_child_missing"],
          timedOutRunIds: ["run_child_timed_out"],
          terminalStepIds: ["workflow:child"],
          missingStepIds: ["workflow:missing"],
          timedOutStepIds: ["workflow:timeout"],
          childRunIds: ["child_completed", "child_missing", "child_running"],
          completedChildRunIds: ["child_completed"],
        },
      },
      nextRecoveryAt: Temporal.Instant.from("2026-06-12T10:15:00Z"),
    });
  });

  test("uses future wait timers for top-level next recovery scheduling", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_future_sleep_only", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.appendEvent("run_future_sleep_only", {
      kind: "sleep_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "sleep:future",
      stepName: "future",
      count: 1,
      until: Temporal.Instant.from("2026-06-12T10:15:00Z"),
    });

    await expect(engine.getRecoverySummary()).resolves.toMatchObject({
      recoverableRunIds: [],
      wait: {
        sleep: {
          active: 1,
          due: 0,
          nextWakeAt: Temporal.Instant.from("2026-06-12T10:15:00Z"),
          nextWakeRunId: "run_future_sleep_only",
        },
      },
      nextRecoveryAt: Temporal.Instant.from("2026-06-12T10:15:00Z"),
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
    workflowName: "recovery",
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
