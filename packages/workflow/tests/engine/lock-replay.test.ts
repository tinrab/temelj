import { describe, expect, test } from "vitest";

import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";

describe("workflow lock replay", () => {
  test("rejects replayed lock acquisitions with different durable options", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_lock_replay",
      now: () => now,
    });
    let lockKey = "lock:replay:first";
    let leaseDuration = Temporal.Duration.from({ minutes: 1 });
    const workflow = implementWorkflow({ name: "lock-replay" }, async ({ step }): Promise<void> => {
      await step.lock.acquire("guard", lockKey, {
        leaseDuration,
      });
      await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    lockKey = "lock:replay:second";
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const changedKey = await engine.resumeWorkflow(workflow, "run_lock_replay");
    expect(changedKey.kind).toBe("failed");
    if (changedKey.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }
    expect(changedKey.error.name).toBe("WorkflowReplayDivergenceError");

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    const leaseEngine = createWorkflowEngine({
      createRunId: () => "run_lock_lease_replay",
      now: () => now,
    });
    let leaseReplayDuration = Temporal.Duration.from({ minutes: 1 });
    const leaseWorkflow = implementWorkflow(
      { name: "lock-lease-replay" },
      async ({ step }): Promise<void> => {
        await step.lock.acquire("guard", "lock:lease", {
          leaseDuration: leaseReplayDuration,
        });
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
      },
    );

    await expect(leaseEngine.runWorkflowNow(leaseWorkflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    leaseReplayDuration = Temporal.Duration.from({ minutes: 2 });
    now = Temporal.Instant.from("2026-06-11T11:00:01Z");
    const changedLease = await leaseEngine.resumeWorkflow(leaseWorkflow, "run_lock_lease_replay");
    expect(changedLease.kind).toBe("failed");
    if (changedLease.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }
    expect(changedLease.error.name).toBe("WorkflowReplayDivergenceError");
  });

  test("rejects replayed waited lock acquisitions without wait enabled", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_lock_wait_replay",
      now: () => now,
    });
    await engine.acquireLock("lock:wait-replay", {
      holderId: "other-run",
      leaseDuration: Temporal.Duration.from({ minutes: 1 }),
    });
    let wait = true;
    const workflow = implementWorkflow(
      { name: "lock-wait-replay" },
      async ({ step }): Promise<void> => {
        await step.lock.acquire("guard", "lock:wait-replay", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
          wait,
        });
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    now = Temporal.Instant.from("2026-06-11T10:01:00Z");
    await expect(engine.resumeWorkflow(workflow, "run_lock_wait_replay")).resolves.toMatchObject({
      kind: "waiting",
    });

    wait = false;
    now = Temporal.Instant.from("2026-06-11T10:01:01Z");
    const changedWait = await engine.resumeWorkflow(workflow, "run_lock_wait_replay");
    expect(changedWait.kind).toBe("failed");
    if (changedWait.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }
    expect(changedWait.error.name).toBe("WorkflowReplayDivergenceError");
  });

  test("rejects replayed lock acquisitions with changed wait timeouts", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_lock_wait_timeout_replay",
      now: () => now,
    });
    let waitTimeout = Temporal.Duration.from({ seconds: 10 });
    const workflow = implementWorkflow(
      { name: "lock-wait-timeout-replay" },
      async ({ step }): Promise<void> => {
        await step.lock.acquire("guard", "lock:wait-timeout-replay", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
          wait: true,
          waitTimeout,
        });
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    waitTimeout = Temporal.Duration.from({ seconds: 20 });
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const changedTimeout = await engine.resumeWorkflow(workflow, "run_lock_wait_timeout_replay");
    expect(changedTimeout.kind).toBe("failed");
    if (changedTimeout.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }
    expect(changedTimeout.error.name).toBe("WorkflowReplayDivergenceError");
  });

  test("rejects replayed lock releases with different durable options", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_lock_release_replay",
      now: () => now,
    });
    let releaseKey = "lock:release:first";
    const workflow = implementWorkflow<undefined, void>(
      { name: "lock-release-replay" },
      async ({ step }) => {
        await step.lock.acquire("guard", "lock:release:first", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
        });
        await step.lock.release("release", releaseKey);
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    releaseKey = "lock:release:second";
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const changedKey = await engine.resumeWorkflow(workflow, "run_lock_release_replay");
    expect(changedKey.kind).toBe("failed");
    if (changedKey.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }
    expect(changedKey.error.name).toBe("WorkflowReplayDivergenceError");
  });
});
