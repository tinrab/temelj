import { describe, expect, expectTypeOf, test } from "vitest";

import type { WorkflowRunHandle } from "../../src/types/client.ts";
import type { WorkflowRunRecord } from "../../src/types/run.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { createWorkflowRunHandle } from "../../src/client/run-handle.ts";
import { defineWorkflow, implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";

describe("workflow recovery actions", () => {
  test("reschedules pending or waiting runs as an audited recovery transition", async () => {
    const lifecycle: Array<readonly [string, string, Temporal.Instant | undefined]> = [];
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
      onLifecycleEvent(event) {
        lifecycle.push([event.run.id, event.reason, event.run.availableAt]);
      },
    });
    const client = createWorkflowClient({ engine });
    await engine.store.createRun(
      runRecord("run_reschedule_retry", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
        retryAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
        retryReason: "step",
        retryAttempt: 3,
        retryStepId: "run:flaky",
        retryStepName: "flaky",
      }),
    );

    await expect(
      client.admin.reschedule("run_reschedule_retry", {
        availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      }),
    ).resolves.toMatchObject({
      status: "waiting",
      availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      retryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      retryReason: "step",
      retryAttempt: 3,
      retryStepId: "run:flaky",
      retryStepName: "flaky",
      lastTransitionReason: "rescheduled",
      lastTransitionAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    await expect(
      client.admin.reschedule("run_reschedule_retry", {
        availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      }),
    ).resolves.toMatchObject({
      availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      lastTransitionReason: "rescheduled",
    });
    await expect(
      client.runs.summary({ lastTransitionReason: "rescheduled" }),
    ).resolves.toMatchObject({
      transition: {
        reason: { rescheduled: 1 },
        runIds: { rescheduled: ["run_reschedule_retry"] },
      },
    });
    expect(lifecycle).toEqual([
      ["run_reschedule_retry", "rescheduled", Temporal.Instant.from("2026-06-12T10:05:00Z")],
    ]);
  });

  test("emits typed observation events for recovery transitions", async () => {
    const observed: Array<readonly [string, string, string]> = [];
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    engine.on("workflow:run-rescheduled", (event) => {
      observed.push([event.run.id, event.reason, "rescheduled"]);
    });
    engine.on("workflow:run-lease-released", (event) => {
      observed.push([event.run.id, event.reason, "lease"]);
    });
    engine.on("workflow:run-manual-retry", (event) => {
      observed.push([event.run.id, event.reason, "retry"]);
    });
    engine.on("workflow:run-permanently-failed", (event) => {
      observed.push([event.run.id, event.reason, "permanent"]);
    });
    await engine.store.createRun(
      runRecord("run_observed_reschedule", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("run_observed_lease", "running", {
        workerId: "worker_stale",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("run_observed_retry", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
        error: { name: "Error", message: "retry" },
        retryReason: "workflow",
        retryAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        retryAttempt: 1,
      }),
    );
    await engine.store.createRun(
      runRecord("run_observed_permanent", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
      }),
    );

    await engine.rescheduleRun("run_observed_reschedule");
    await engine.releaseStaleRunLease("run_observed_lease");
    await engine.retryFailedRun("run_observed_retry");
    await engine.markRunPermanentlyFailed("run_observed_permanent", {
      reason: "operator stopped retries",
    });

    expect(observed).toEqual([
      ["run_observed_reschedule", "rescheduled", "rescheduled"],
      ["run_observed_lease", "lease_released", "lease"],
      ["run_observed_retry", "manual_retry", "retry"],
      ["run_observed_permanent", "permanent_failure", "permanent"],
    ]);
  });

  test("reschedules to now by default and rejects terminal runs", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_reschedule_now", "pending", {
        availableAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("run_reschedule_terminal", "completed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        output: "done",
      }),
    );

    await expect(engine.rescheduleRun("run_reschedule_now")).resolves.toMatchObject({
      status: "pending",
      availableAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      lastTransitionReason: "rescheduled",
    });
    await expect(engine.rescheduleRun("run_reschedule_terminal")).rejects.toThrow(
      "Workflow run cannot be rescheduled unless pending or waiting: run_reschedule_terminal",
    );
  });

  test("releases stale run leases as an audited recovery transition", async () => {
    const lifecycle: Array<readonly [string, string, Temporal.Instant | undefined]> = [];
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
      onLifecycleEvent(event) {
        lifecycle.push([event.run.id, event.reason, event.run.availableAt]);
      },
    });
    const client = createWorkflowClient({ engine });
    await engine.store.createRun(
      runRecord("run_release_stale_lease", "running", {
        workerId: "worker_stale",
        attempts: 2,
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
        startedAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
      }),
    );

    await expect(
      client.admin.releaseStaleLease("run_release_stale_lease", {
        availableAt: Temporal.Instant.from("2026-06-12T10:02:00Z"),
      }),
    ).resolves.toMatchObject({
      status: "waiting",
      availableAt: Temporal.Instant.from("2026-06-12T10:02:00Z"),
      lastTransitionReason: "lease_released",
      lastTransitionAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    const released = await engine.getRun("run_release_stale_lease");
    expect(released).not.toHaveProperty("workerId");
    expect(released).not.toHaveProperty("leaseExpiresAt");
    await expect(
      client.runs.summary({ lastTransitionReason: "lease_released" }),
    ).resolves.toMatchObject({
      transition: {
        reason: { lease_released: 1 },
        runIds: { lease_released: ["run_release_stale_lease"] },
      },
    });
    expect(lifecycle).toEqual([
      ["run_release_stale_lease", "lease_released", Temporal.Instant.from("2026-06-12T10:02:00Z")],
    ]);
  });

  test("releases ownerless and missing-expiry leases, and is idempotent after release", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_ownerless_release", "running", {
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );
    await engine.store.createRun(
      runRecord("run_missing_expiry_release", "running", {
        workerId: "worker_missing_expiry",
      }),
    );

    await expect(engine.releaseStaleRunLease("run_ownerless_release")).resolves.toMatchObject({
      status: "waiting",
      lastTransitionReason: "lease_released",
    });
    await expect(engine.releaseStaleRunLease("run_missing_expiry_release")).resolves.toMatchObject({
      status: "waiting",
      lastTransitionReason: "lease_released",
    });
    await expect(engine.releaseStaleRunLease("run_missing_expiry_release")).resolves.toMatchObject({
      status: "waiting",
      lastTransitionReason: "lease_released",
    });
  });

  test("rejects active lease release and invalid release options", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    await engine.store.createRun(
      runRecord("run_active_release", "running", {
        workerId: "worker_active",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
    );

    await expect(client.admin.releaseStaleLease("run_active_release")).rejects.toThrow(
      "Workflow run lease is still active: run_active_release",
    );
  });

  test("retries failed runs with retry metadata as an audited recovery transition", async () => {
    const lifecycle: Array<readonly [string, string, Temporal.Instant | undefined]> = [];
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
      onLifecycleEvent(event) {
        lifecycle.push([event.run.id, event.reason, event.run.availableAt]);
      },
    });
    const client = createWorkflowClient({ engine });
    await engine.store.createRun(
      runRecord("run_retry_failed", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
        error: { name: "Error", message: "temporary" },
        retryAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        retryReason: "workflow",
        retryAttempt: 2,
      }),
    );

    await expect(
      client.admin.retryFailed("run_retry_failed", {
        availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      }),
    ).resolves.toMatchObject({
      status: "pending",
      availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      retryAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      retryReason: "workflow",
      retryAttempt: 3,
      lastTransitionReason: "manual_retry",
      lastTransitionAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    const retried = await engine.getRun("run_retry_failed");
    expect(retried).not.toHaveProperty("error");
    expect(retried).not.toHaveProperty("finishedAt");
    await expect(
      client.runs.summary({ lastTransitionReason: "manual_retry" }),
    ).resolves.toMatchObject({
      transition: {
        reason: { manual_retry: 1 },
        runIds: { manual_retry: ["run_retry_failed"] },
      },
    });
    expect(lifecycle).toEqual([
      ["run_retry_failed", "manual_retry", Temporal.Instant.from("2026-06-12T10:05:00Z")],
    ]);
  });

  test("requires force to retry failed runs without retry metadata", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    await engine.store.createRun(
      runRecord("run_retry_failed_force", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
        error: { name: "Error", message: "fatal" },
      }),
    );

    await expect(engine.retryFailedRun("run_retry_failed_force")).rejects.toThrow(
      "Workflow failed run retry requires force when no retry metadata exists: run_retry_failed_force",
    );
    await expect(
      engine.retryFailedRun("run_retry_failed_force", { force: true }),
    ).resolves.toMatchObject({
      status: "pending",
      retryReason: "workflow",
      retryAttempt: 1,
      lastTransitionReason: "manual_retry",
    });
  });

  test("marks runs permanently failed and blocks retry unless forced", async () => {
    const engine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    await engine.store.createRun(
      runRecord("run_permanent_failure", "waiting", {
        availableAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
        retryAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
        retryReason: "step",
        retryAttempt: 2,
      }),
    );

    await expect(
      client.admin.markPermanentlyFailed("run_permanent_failure", {
        reason: "operator stopped retries",
      }),
    ).resolves.toMatchObject({
      status: "failed",
      lastTransitionReason: "permanent_failure",
      finishedAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      error: {
        name: "WorkflowPermanentFailureError",
        details: {
          runId: "run_permanent_failure",
          reason: "operator stopped retries",
        },
      },
    });
    await expect(client.admin.retryFailed("run_permanent_failure")).rejects.toThrow(
      "Workflow run cannot be retried after permanent failure without force: run_permanent_failure",
    );
    await expect(
      client.admin.retryFailed("run_permanent_failure", { force: true }),
    ).resolves.toMatchObject({
      status: "pending",
      lastTransitionReason: "manual_retry",
    });
  });

  test("exposes recovery actions on run handles", async () => {
    const clientEngine = createWorkflowEngine({
      createRunId: () => "run_handle_recovery",
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine: clientEngine });
    const waitingWorkflow = implementWorkflow({ name: "handle-recovery" }, async ({ step }) => {
      await step.task.sleep("pause", Temporal.Duration.from({ hours: 1 }));
      return "ok";
    });
    const handle = await client.runs.start(waitingWorkflow, undefined);

    await expect(
      handle.reschedule({ availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z") }),
    ).resolves.toMatchObject({
      id: "run_handle_recovery",
      status: "pending",
      availableAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
      lastTransitionReason: "rescheduled",
    });
    await expect(
      handle.markPermanentlyFailed({ reason: "operator stopped retries" }),
    ).resolves.toMatchObject({
      id: "run_handle_recovery",
      status: "failed",
      lastTransitionReason: "permanent_failure",
    });

    const runtimeEngine = createWorkflowEngine({
      now: () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    });
    const recoveryDefinition = defineWorkflow<undefined, unknown>({ name: "summary" });
    await runtimeEngine.store.createRun(
      runRecord("run_handle_release", "running", {
        workerId: "worker_stale",
        leaseExpiresAt: Temporal.Instant.from("2026-06-12T09:59:00Z"),
      }),
    );
    const releaseHandle = createWorkflowRunHandle(
      runtimeEngine,
      recoveryDefinition,
      "run_handle_release",
      () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    );
    await expect(releaseHandle.releaseStaleLease()).resolves.toMatchObject({
      id: "run_handle_release",
      status: "waiting",
      lastTransitionReason: "lease_released",
    });

    await runtimeEngine.store.createRun(
      runRecord("run_handle_retry", "failed", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:55:00Z"),
        error: { name: "Error", message: "retry" },
        retryAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        retryReason: "workflow",
        retryAttempt: 1,
      }),
    );
    const retryHandle = createWorkflowRunHandle(
      runtimeEngine,
      recoveryDefinition,
      "run_handle_retry",
      () => Temporal.Instant.from("2026-06-12T10:00:00Z"),
    );
    await expect(retryHandle.retryFailed()).resolves.toMatchObject({
      id: "run_handle_retry",
      status: "pending",
      lastTransitionReason: "manual_retry",
    });

    expectTypeOf<ReturnType<WorkflowRunHandle["reschedule"]>>().toEqualTypeOf<
      Promise<WorkflowRunRecord>
    >();
    expectTypeOf<ReturnType<WorkflowRunHandle["releaseStaleLease"]>>().toEqualTypeOf<
      Promise<WorkflowRunRecord>
    >();
    expectTypeOf<ReturnType<WorkflowRunHandle["retryFailed"]>>().toEqualTypeOf<
      Promise<WorkflowRunRecord>
    >();
    expectTypeOf<ReturnType<WorkflowRunHandle["markPermanentlyFailed"]>>().toEqualTypeOf<
      Promise<WorkflowRunRecord>
    >();
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
