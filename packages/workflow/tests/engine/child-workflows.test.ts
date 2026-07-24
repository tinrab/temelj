import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow, defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { Registry } from "../../src/registry.ts";
import { WorkflowWorker } from "../../src/worker.ts";
import { sequentialRunIds, waitFor } from "../utility.ts";

describe("child workflows", () => {
  test("starts fire-and-forget child workflows without waiting for completion", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_background_parent",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const child = implementWorkflow<undefined, string>({ name: "background-child" }, () => "child");
    const parent = implementWorkflow<undefined, string>(
      { name: "background-parent" },
      async ({ step }) => {
        return await step.workflow.start(child, undefined, {
          name: "background",
          id: "run_background_child",
        });
      },
    );

    await expect(engine.runWorkflowNow(parent, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "run_background_child",
    });
    await expect(engine.getRun("run_background_child")).resolves.toMatchObject({
      id: "run_background_child",
      status: "pending",
      parentRunId: "run_background_parent",
      parentStepId: "workflow:background",
      parentStepName: "background",
      parentStepAttempt: 1,
    });
    await expect(engine.getEvents("run_background_parent")).resolves.toMatchObject([
      { kind: "workflow_started" },
      {
        kind: "child_workflow_started",
        stepId: "workflow:background",
        childRunId: "run_background_child",
      },
      { kind: "workflow_completed" },
    ]);
    await expect(engine.resumeWorkflow(parent, "run_background_parent")).resolves.toMatchObject({
      kind: "completed",
      output: "run_background_child",
    });
    await expect(engine.resumeWorkflow(child, "run_background_child")).resolves.toMatchObject({
      kind: "completed",
      output: "child",
    });
  });

  test("cascades parent cancellation to active child workflows by default", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_cancel_parent", "run_cancel_child"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const child = implementWorkflow<undefined, string>({ name: "cascade-child" }, () => "child");
    const parent = implementWorkflow<undefined, string>(
      { name: "cascade-parent" },
      async ({ step }) => {
        await step.workflow.start(child, undefined, { name: "child" });
        await step.task.sleep("pause", Temporal.Duration.from({ hours: 1 }));
        return "parent";
      },
    );

    await expect(engine.runWorkflowNow(parent, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    await engine.cancelRun("run_cancel_parent");

    await expect(engine.getRun("run_cancel_child")).resolves.toMatchObject({
      id: "run_cancel_child",
      status: "canceled",
    });
  });

  test("detaches active child workflows from parent cancellation when requested", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_detach_parent", "run_detach_child"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const child = implementWorkflow<undefined, string>({ name: "detach-child" }, () => "child");
    const parent = implementWorkflow<undefined, string>(
      { name: "detach-parent" },
      async ({ step }) => {
        await step.workflow.start(child, undefined, {
          name: "child",
          cancellation: "detach",
        });
        await step.task.sleep("pause", Temporal.Duration.from({ hours: 1 }));
        return "parent";
      },
    );

    await expect(engine.runWorkflowNow(parent, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    await engine.cancelRun("run_detach_parent");

    await expect(engine.getRun("run_detach_parent")).resolves.toMatchObject({
      id: "run_detach_parent",
      status: "canceled",
    });
    await expect(engine.getRun("run_detach_child")).resolves.toMatchObject({
      id: "run_detach_child",
      status: "pending",
    });
    await expect(engine.getEvents("run_detach_parent")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "child_workflow_started",
          childRunId: "run_detach_child",
          cancellation: "detach",
        }),
      ]),
    );
    await expect(engine.listStepAttempts("run_detach_parent")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "workflow",
          childRunId: "run_detach_child",
          cancellation: "detach",
        }),
      ]),
    );
  });

  test("rejects replay when child workflow cancellation policy changes", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_child_policy_parent", "run_child_policy_child"),
      now: () => now,
    });
    const child = implementWorkflow<undefined, string>({ name: "policy-child" }, () => "child");
    const originalParent = implementWorkflow<undefined, string>(
      { name: "policy-parent" },
      async ({ step }) => {
        await step.workflow.start(child, undefined, {
          name: "child",
          cancellation: "detach",
        });
        await step.task.sleep("pause", Temporal.Duration.from({ hours: 1 }));
        return "parent";
      },
    );
    const changedParent = implementWorkflow<undefined, string>(
      { name: "policy-parent" },
      async ({ step }) => {
        await step.workflow.start(child, undefined, { name: "child" });
        await step.task.sleep("pause", Temporal.Duration.from({ hours: 1 }));
        return "parent";
      },
    );

    await expect(engine.runWorkflowNow(originalParent, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(
      engine.resumeWorkflow(changedParent, "run_child_policy_parent"),
    ).resolves.toMatchObject({
      kind: "failed",
      error: {
        name: "WorkflowReplayDivergenceError",
        message: expect.stringContaining(
          "child cancellation policy detach, but replay used cascade",
        ),
      },
    });
  });

  test("stale worker executions do not append child workflow events after reclaim", async () => {
    let now = Temporal.Instant.from("2026-06-07T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds(
        "run_stale_child_append",
        "run_stale_child_second_worker",
        "run_stale_child_orphan",
      ),
      now: () => now,
    });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });
    const firstWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_stale_child_a",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });
    const secondWorker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_stale_child_b",
      leaseDuration: Temporal.Duration.from({ milliseconds: 1_000 }),
      heartbeatInterval: Temporal.Duration.from({ milliseconds: 0 }),
      now: () => now,
    });
    const childDef = defineWorkflow<undefined, string>({
      name: "stale-child-append-child",
    });
    const parentDef = defineWorkflow<undefined, string>({
      name: "stale-child-append-parent",
    });
    let executions = 0;
    let finishFirstExecution!: () => void;
    const firstExecutionCanContinue = new Promise<void>((resolve) => {
      finishFirstExecution = resolve;
    });

    client.implementWorkflow(parentDef, async ({ step }) => {
      executions++;
      const execution = executions;
      if (execution === 1) {
        await firstExecutionCanContinue;
      }
      if (execution === 1) {
        await step.workflow.run(childDef, undefined, { name: "child" });
        return "stale";
      }
      return "fresh";
    });

    const handle = await client.runs.start(parentDef, undefined);
    const firstExecution = firstWorker.processRun(handle.runId);

    await waitFor(async () => {
      const run = await engine.getRun("run_stale_child_append");
      return run?.workerId === "worker_stale_child_a";
    });

    now = Temporal.Instant.from("2026-06-07T10:00:01Z");
    await expect(secondWorker.processRun(handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_child_append",
        status: "completed",
        attempts: 2,
      },
    });

    finishFirstExecution();
    await expect(firstExecution).resolves.toMatchObject({
      kind: "completed",
      output: "fresh",
      run: {
        id: "run_stale_child_append",
        status: "completed",
        attempts: 2,
      },
    });

    expect(
      (await engine.getEvents("run_stale_child_append")).filter(
        (event) =>
          event.kind === "child_workflow_started" ||
          event.kind === "child_workflow_completed" ||
          event.kind === "child_workflow_failed",
      ),
    ).toEqual([]);
    expect(await engine.getRun("run_stale_child_second_worker")).toBeUndefined();
    expect(await engine.getRun("run_stale_child_orphan")).toBeUndefined();
    expect(await engine.listStepAttempts("run_stale_child_append")).toEqual([]);
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("fresh");
  });
});
