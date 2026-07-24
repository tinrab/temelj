import { describe, expect, expectTypeOf, test } from "vitest";

import type { WorkflowStepApi } from "../../src/types/step.ts";

import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";

describe("workflow locks", () => {
  test("acquires locks through durable workflow steps", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_lock",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<undefined, number>(
      { name: "step-lock" },
      async ({ step }) => {
        const lock = await step.lock.acquire("customer-lock", "customer:step", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
        });
        return lock.fencingToken;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: 1,
    });
    await expect(engine.getLock("customer:step")).resolves.toMatchObject({
      holderId: "run_step_lock",
      holderRunId: "run_step_lock",
      holderStepId: "run:customer-lock",
      fencingToken: 1,
      releasedAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    await expect(engine.listStepAttempts("run_step_lock")).resolves.toMatchObject([
      {
        stepId: "run:customer-lock",
        stepName: "customer-lock",
        kind: "run",
        status: "completed",
        output: {
          key: "customer:step",
          fencingToken: 1,
        },
      },
    ]);

    await expect(engine.resumeWorkflow(workflow, "run_step_lock")).resolves.toMatchObject({
      kind: "completed",
      output: 1,
    });
    await expect(engine.getLock("customer:step")).resolves.toMatchObject({
      fencingToken: 1,
      releasedAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
  });

  test("releases locks through durable workflow steps before run completion", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_release_lock",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<undefined, number>(
      { name: "step-release-lock" },
      async ({ step }) => {
        await step.lock.acquire("acquire-lock", "lock:step-release", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
        });
        const released = await step.lock.release("release-lock", "lock:step-release");
        const reacquired = await step.lock.acquire("reacquire-lock", "lock:step-release", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
        });
        return released.fencingToken + reacquired.fencingToken;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: 3,
    });
    const attempts = await engine.listStepAttempts("run_step_release_lock");
    expect(attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stepId: "run:acquire-lock", status: "completed" }),
        expect.objectContaining({ stepId: "run:release-lock", status: "completed" }),
        expect.objectContaining({ stepId: "run:reacquire-lock", status: "completed" }),
      ]),
    );
    await expect(engine.getLock("lock:step-release")).resolves.toMatchObject({
      fencingToken: 2,
      releasedAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    await expect(engine.resumeWorkflow(workflow, "run_step_release_lock")).resolves.toMatchObject({
      kind: "completed",
      output: 3,
    });
  });

  test("runs callbacks under a durable lock helper", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_with_lock",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<undefined, number>(
      { name: "step-with-lock" },
      async ({ step }) => {
        return await step.lock.with(
          "customer-lock",
          "lock:with-lock",
          { leaseDuration: Temporal.Duration.from({ minutes: 1 }) },
          (lock) => lock.fencingToken + 10,
        );
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: 11,
    });
    await expect(engine.getLock("lock:with-lock")).resolves.toMatchObject({
      holderRunId: "run_step_with_lock",
      holderStepId: "run:customer-lock:acquire",
      fencingToken: 1,
      releasedAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    await expect(engine.listStepAttempts("run_step_with_lock")).resolves.toMatchObject([
      {
        stepId: "run:customer-lock:acquire",
        status: "completed",
      },
      {
        stepId: "run:customer-lock:release",
        status: "completed",
      },
    ]);
    await expect(engine.resumeWorkflow(workflow, "run_step_with_lock")).resolves.toMatchObject({
      kind: "completed",
      output: 11,
    });
  });

  test("waits durably for contended lock acquisition", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_waiting_lock",
      now: () => now,
    });
    await engine.acquireLock("lock:contended", {
      holderId: "other-run",
      leaseDuration: Temporal.Duration.from({ minutes: 1 }),
    });
    const workflow = implementWorkflow<undefined, number>(
      { name: "step-waiting-lock" },
      async ({ step }) => {
        const lock = await step.lock.acquire("guard", "lock:contended", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
          wait: true,
        });
        return lock.fencingToken;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
      run: {
        id: "run_waiting_lock",
        retryAt: Temporal.Instant.from("2026-06-11T10:01:00Z"),
        retryReason: "step",
        retryStepId: "run:guard",
      },
    });
    await expect(engine.listStepAttempts("run_waiting_lock")).resolves.toMatchObject([
      {
        stepId: "run:guard",
        status: "failed",
        error: {
          name: "WorkflowRetryableError",
          message: "Workflow lock is already held: lock:contended",
        },
      },
    ]);

    now = Temporal.Instant.from("2026-06-11T10:01:00Z");
    await expect(engine.resumeWorkflow(workflow, "run_waiting_lock")).resolves.toMatchObject({
      kind: "completed",
      output: 2,
    });
    await expect(engine.getLock("lock:contended")).resolves.toMatchObject({
      holderId: "run_waiting_lock",
      holderRunId: "run_waiting_lock",
      holderStepId: "run:guard",
      fencingToken: 2,
      releasedAt: Temporal.Instant.from("2026-06-11T10:01:00Z"),
    });
  });

  test("wakes durable lock waiters when locks are released early", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_early_lock_waiter",
      now: () => now,
    });
    await engine.acquireLock("lock:early-release", {
      holderId: "other-run",
      leaseDuration: Temporal.Duration.from({ hours: 1 }),
    });
    const workflow = implementWorkflow<undefined, number>(
      { name: "step-early-lock-waiter" },
      async ({ step }) => {
        const lock = await step.lock.acquire("guard", "lock:early-release", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
          wait: true,
        });
        return lock.fencingToken;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
      run: {
        availableAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
        retryAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      },
    });

    now = Temporal.Instant.from("2026-06-11T10:00:10Z");
    await engine.releaseLock("lock:early-release", { holderId: "other-run" });
    await expect(engine.getRun("run_early_lock_waiter")).resolves.toMatchObject({
      status: "waiting",
      availableAt: Temporal.Instant.from("2026-06-11T10:00:10Z"),
      retryAt: Temporal.Instant.from("2026-06-11T10:00:10Z"),
    });

    await expect(engine.resumeWorkflow(workflow, "run_early_lock_waiter")).resolves.toMatchObject({
      kind: "completed",
      output: 2,
    });
  });

  test("times out durable lock waiters without extending deadlines on retry", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_timeout_lock_waiter",
      now: () => now,
    });
    await engine.acquireLock("lock:timeout", {
      holderId: "other-run",
      leaseDuration: Temporal.Duration.from({ hours: 1 }),
    });
    const workflow = implementWorkflow(
      { name: "step-timeout-lock-waiter" },
      async ({ step }): Promise<void> => {
        await step.lock.acquire("guard", "lock:timeout", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
          wait: true,
          waitTimeout: Temporal.Duration.from({ seconds: 10 }),
        });
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
      run: {
        availableAt: Temporal.Instant.from("2026-06-11T10:00:10Z"),
        retryAt: Temporal.Instant.from("2026-06-11T10:00:10Z"),
      },
    });
    await expect(engine.getEvents("run_timeout_lock_waiter")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:guard:wait-deadline",
          value: Temporal.Instant.from("2026-06-11T10:00:10Z"),
        }),
      ]),
    );
    await expect(engine.getRecoverySummary()).resolves.toMatchObject({
      lock: {
        waitingRunIds: ["run_timeout_lock_waiter"],
        dueWaitingRunIds: [],
        waitingStepIds: ["run:guard"],
        waitingKeys: ["lock:timeout"],
        nextWaitDeadlineAt: Temporal.Instant.from("2026-06-11T10:00:10Z"),
        nextWaitDeadlineRunId: "run_timeout_lock_waiter",
      },
      nextRecoveryAt: Temporal.Instant.from("2026-06-11T10:00:10Z"),
    });

    now = Temporal.Instant.from("2026-06-11T10:00:10Z");
    await expect(engine.getRecoverySummary()).resolves.toMatchObject({
      lock: {
        waitingRunIds: ["run_timeout_lock_waiter"],
        dueWaitingRunIds: ["run_timeout_lock_waiter"],
        waitingKeys: ["lock:timeout"],
      },
    });
    const timedOut = await engine.resumeWorkflow(workflow, "run_timeout_lock_waiter");
    expect(timedOut.kind).toBe("failed");
    if (timedOut.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }
    expect(timedOut.error).toMatchObject({
      name: "WorkflowStepExecutionError",
      message: "Workflow step failed: guard",
    });
    await expect(engine.getRecoverySummary()).resolves.toMatchObject({
      lock: {
        waitingRunIds: [],
        dueWaitingRunIds: [],
        waitingKeys: [],
      },
    });
    await expect(engine.getLock("lock:timeout")).resolves.toMatchObject({
      holderId: "other-run",
      fencingToken: 1,
    });
  });

  test("preserves durable lock helper types", () => {
    async function useStep(step: WorkflowStepApi) {
      const output = await step.lock.with(
        "typed-lock",
        "lock:typed",
        { leaseDuration: Temporal.Duration.from({ minutes: 1 }) },
        async (lock) => {
          expectTypeOf(lock.fencingToken).toEqualTypeOf<number>();
          expectTypeOf(lock.holderRunId).toEqualTypeOf<string | undefined>();
          return { token: lock.fencingToken };
        },
      );
      expectTypeOf(output).toEqualTypeOf<{ token: number }>();
      return output;
    }

    expectTypeOf<ReturnType<typeof useStep>>().toEqualTypeOf<Promise<{ token: number }>>();
  });

  test("releases durable lock helpers when callbacks fail", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_with_lock_failed",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow(
      { name: "step-with-lock-failed" },
      async ({ step }): Promise<void> => {
        await step.lock.with(
          "customer-lock",
          "lock:with-lock-failed",
          { leaseDuration: Temporal.Duration.from({ minutes: 1 }) },
          () => {
            throw new Error("callback failed");
          },
        );
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "failed",
      error: { message: "callback failed" },
    });
    await expect(engine.getLock("lock:with-lock-failed")).resolves.toMatchObject({
      holderRunId: "run_step_with_lock_failed",
      releasedAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
  });

  test("keeps durable lock helpers held while callbacks are suspended", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_with_lock_waiting",
      now: () => now,
    });
    const workflow = implementWorkflow(
      { name: "step-with-lock-waiting" },
      async ({ step }): Promise<void> => {
        await step.lock.with(
          "customer-lock",
          "lock:with-lock-waiting",
          { leaseDuration: Temporal.Duration.from({ hours: 1 }) },
          async () => {
            await step.task.sleep("pause", Temporal.Duration.from({ minutes: 1 }));
          },
        );
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    const waitingLock = await engine.getLock("lock:with-lock-waiting");
    expect(waitingLock).toMatchObject({
      holderRunId: "run_step_with_lock_waiting",
    });
    expect(waitingLock).not.toHaveProperty("releasedAt");

    now = Temporal.Instant.from("2026-06-11T10:01:00Z");
    await expect(
      engine.resumeWorkflow(workflow, "run_step_with_lock_waiting"),
    ).resolves.toMatchObject({
      kind: "completed",
    });
    await expect(engine.getLock("lock:with-lock-waiting")).resolves.toMatchObject({
      releasedAt: Temporal.Instant.from("2026-06-11T10:01:00Z"),
    });
  });

  test("releases run-held locks when workflow runs fail or are canceled", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_failed_lock",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const failingWorkflow = implementWorkflow(
      { name: "failed-lock" },
      async ({ step }): Promise<void> => {
        await step.lock.acquire("failed-lock", "lock:failed", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
        });
        throw new Error("workflow failed");
      },
    );

    await expect(engine.runWorkflowNow(failingWorkflow, undefined)).resolves.toMatchObject({
      kind: "failed",
      error: { message: "workflow failed" },
    });
    await expect(engine.getLock("lock:failed")).resolves.toMatchObject({
      holderRunId: "run_failed_lock",
      releasedAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });

    let now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    const waitingEngine = createWorkflowEngine({
      createRunId: () => "run_canceled_lock",
      now: () => now,
    });
    const waitingWorkflow = implementWorkflow(
      { name: "canceled-lock" },
      async ({ step }): Promise<void> => {
        await step.lock.acquire("canceled-lock", "lock:canceled", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
        });
        await step.task.sleep("pause", Temporal.Duration.from({ hours: 1 }));
      },
    );

    await expect(waitingEngine.runWorkflowNow(waitingWorkflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
      run: { id: "run_canceled_lock" },
    });
    const heldLock = await waitingEngine.getLock("lock:canceled");
    expect(heldLock).toMatchObject({
      holderRunId: "run_canceled_lock",
    });
    expect(heldLock).not.toHaveProperty("releasedAt");

    now = Temporal.Instant.from("2026-06-11T11:00:05Z");
    await expect(waitingEngine.cancelRun("run_canceled_lock")).resolves.toMatchObject({
      status: "canceled",
    });
    await expect(waitingEngine.getLock("lock:canceled")).resolves.toMatchObject({
      holderRunId: "run_canceled_lock",
      releasedAt: Temporal.Instant.from("2026-06-11T11:00:05Z"),
    });
  });

  test("rejects invalid step lock timeout options before recording deadlines", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_invalid_lock_timeout",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow(
      { name: "invalid-lock-timeout" },
      async ({ step }): Promise<void> => {
        await step.lock.acquire("guard", "lock:invalid-timeout", {
          leaseDuration: Temporal.Duration.from({ minutes: 1 }),
          waitTimeout: Temporal.Duration.from({ seconds: 1 }),
        });
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "failed",
    });
    await expect(engine.getEvents("run_invalid_lock_timeout")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          error: expect.objectContaining({
            message: "Workflow lock timeout options require wait: true",
          }),
          kind: "step_failed",
        }),
      ]),
    );
  });
});
