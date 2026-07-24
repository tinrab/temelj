import { describe, expect, test, vi } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowResultTimeoutError } from "../../src/errors/mod.ts";
import { Registry } from "../../src/registry.ts";
import { WorkflowWorker } from "../../src/worker.ts";
import { sequentialRunIds } from "../utility.ts";

describe("workflow worker polling", () => {
  test("worker polling wakes at the next scheduled run before the poll interval", async () => {
    vi.useFakeTimers();
    try {
      let now = Temporal.Instant.from("2026-06-07T10:00:00Z");
      const engine = createWorkflowEngine({
        now: () => now,
        createRunId: () => "run_scheduled_wakeup",
      });
      const registry = new Registry();
      const client = createWorkflowClient({ engine, registry });
      const worker = new WorkflowWorker({
        engine,
        registry,
        now: () => now,
        pollInterval: Temporal.Duration.from({ milliseconds: 60_000 }),
      });
      const def = defineWorkflow<undefined, string>({ name: "scheduled-wakeup" });
      client.implementWorkflow(def, () => "done");

      const handle = await client.runs.start(def, undefined, {
        availableAt: Temporal.Instant.from("2026-06-07T10:00:01Z"),
      });
      const loop = worker.run({ maxRuns: 1 });

      await vi.advanceTimersByTimeAsync(999);
      expect(await engine.getRun(handle.runId)).toMatchObject({ status: "pending" });

      now = Temporal.Instant.from("2026-06-07T10:00:01Z");
      await vi.advanceTimersByTimeAsync(1);

      await expect(loop).resolves.toEqual({ processedRuns: 1 });
      await expect(
        handle.result({
          timeout: Temporal.Duration.from({ milliseconds: 0 }),
          pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
        }),
      ).resolves.toBe("done");
    } finally {
      vi.useRealTimers();
    }
  });

  test("worker run can tick due recurring schedules before polling runs", async () => {
    vi.useFakeTimers();
    try {
      let now = Temporal.Instant.from("2026-06-07T10:00:00Z");
      const engine = createWorkflowEngine({
        now: () => now,
        createRunId: () => "run_worker_schedule_tick",
      });
      const registry = new Registry();
      const client = createWorkflowClient({ engine, registry });
      const worker = new WorkflowWorker({
        engine,
        registry,
        now: () => now,
        pollInterval: Temporal.Duration.from({ milliseconds: 60_000 }),
      });
      const def = defineWorkflow<undefined, string>({ name: "worker-schedule-tick" });
      client.implementWorkflow(def, () => "scheduled");

      await client.schedules.create(def, {
        id: "worker-schedule",
        every: Temporal.Duration.from({ milliseconds: 1_000 }),
        input: undefined,
        from: Temporal.Instant.from("2026-06-07T10:00:00Z"),
      });

      const loop = worker.run({ maxRuns: 1, tickSchedules: true });

      await vi.advanceTimersByTimeAsync(999);
      await expect(engine.getRun("run_worker_schedule_tick")).resolves.toBeUndefined();

      now = Temporal.Instant.from("2026-06-07T10:00:01Z");
      await vi.advanceTimersByTimeAsync(1);

      await expect(loop).resolves.toEqual({ processedRuns: 1 });
      await expect(engine.getRun("run_worker_schedule_tick")).resolves.toMatchObject({
        workflowName: "worker-schedule-tick",
        status: "completed",
        output: "scheduled",
      });
      await expect(client.schedules.get("worker-schedule")).resolves.toMatchObject({
        lastRunId: "run_worker_schedule_tick",
        nextFireAt: Temporal.Instant.from("2026-06-07T10:00:02Z"),
        tickCount: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("worker polling wakeups honor parent step attempt filters", async () => {
    vi.useFakeTimers();
    try {
      let now = Temporal.Instant.from("2026-06-07T10:00:00Z");
      const engine = createWorkflowEngine({
        now: () => now,
        createRunId: sequentialRunIds(
          "run_wakeup_wrong_parent_attempt",
          "run_wakeup_parent_attempt",
        ),
      });
      const registry = new Registry();
      const client = createWorkflowClient({ engine, registry });
      const worker = new WorkflowWorker({
        engine,
        registry,
        now: () => now,
        pollInterval: Temporal.Duration.from({ milliseconds: 60_000 }),
      });
      const def = defineWorkflow<string, string>({ name: "parent-attempt-wakeup" });
      client.implementWorkflow(def, ({ input }) => input);

      const wrongAttempt = await client.runs.start(def, "wrong", {
        availableAt: Temporal.Instant.from("2026-06-07T10:00:01Z"),
        parent: {
          runId: "parent_run",
          stepName: "child",
          stepAttempt: 1,
        },
      });
      const matchingAttempt = await client.runs.start(def, "right", {
        availableAt: Temporal.Instant.from("2026-06-07T10:00:05Z"),
        parent: {
          runId: "parent_run",
          stepName: "child",
          stepAttempt: 2,
        },
      });
      const loop = worker.run({
        maxRuns: 1,
        parentRunId: "parent_run",
        parentStepAttempt: 2,
      });

      now = Temporal.Instant.from("2026-06-07T10:00:01Z");
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(engine.getRun(wrongAttempt.runId)).resolves.toMatchObject({
        status: "pending",
        parentStepAttempt: 1,
      });
      await expect(engine.getRun(matchingAttempt.runId)).resolves.toMatchObject({
        status: "pending",
        parentStepAttempt: 2,
      });

      now = Temporal.Instant.from("2026-06-07T10:00:05Z");
      await vi.advanceTimersByTimeAsync(4_000);

      await expect(loop).resolves.toEqual({ processedRuns: 1 });
      await expect(
        matchingAttempt.result({
          timeout: Temporal.Duration.from({ milliseconds: 0 }),
          pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
        }),
      ).resolves.toBe("right");
      await expect(engine.getRun(wrongAttempt.runId)).resolves.toMatchObject({
        status: "pending",
        parentStepAttempt: 1,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  test("worker polling honors workflow filters without claiming nonmatching runs", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_worker_filter_left", "run_worker_filter_right"),
    });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });
    const worker = new WorkflowWorker({
      engine,
      registry,
      workerId: "worker_filter",
    });
    const leftDef = defineWorkflow<undefined, string>({ name: "worker-filter-left" });
    const rightDef = defineWorkflow<undefined, string>({ name: "worker-filter-right" });

    client.implementWorkflow(leftDef, () => "left");
    client.implementWorkflow(rightDef, () => "right");

    const left = await client.runs.start(leftDef, undefined);
    const right = await client.runs.start(rightDef, undefined);

    await expect(
      worker.run({
        maxRuns: 1,
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
        workflowName: "worker-filter-right",
      }),
    ).resolves.toEqual({ processedRuns: 1 });

    await expect(
      right.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("right");
    await expect(
      left.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toBeInstanceOf(WorkflowResultTimeoutError);
    await expect(engine.getRun(left.runId)).resolves.toMatchObject({
      status: "pending",
    });
    await expect(engine.getRun(left.runId)).resolves.not.toHaveProperty("workerId");

    await expect(worker.processNextRun()).resolves.toMatchObject({
      kind: "completed",
      output: "left",
      run: {
        id: "run_worker_filter_left",
      },
    });
    await expect(
      left.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("left");
  });

  test("client wakeDueRuns processes currently due runs without polling", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_wake_due_ready", "run_wake_due_future"),
      now: () => now,
    });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry, now: () => now });
    const def = defineWorkflow<string, string>({ name: "wake-due" });

    client.implementWorkflow(def, ({ input }) => input);

    const ready = await client.runs.start(def, "ready");
    const future = await client.runs.start(def, "future", {
      availableAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
    });

    await expect(client.workers.wakeDueRuns({ workflowName: "wake-due" })).resolves.toEqual({
      processedRuns: 1,
    });
    await expect(
      ready.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("ready");
    await expect(
      future.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toBeInstanceOf(WorkflowResultTimeoutError);
    await expect(engine.getRun(future.runId)).resolves.toMatchObject({
      status: "pending",
      availableAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
    });

    now = Temporal.Instant.from("2026-06-11T11:00:00Z");
    await expect(client.workers.wakeDueRuns({ workflowName: "wake-due" })).resolves.toEqual({
      processedRuns: 1,
    });
    await expect(
      future.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("future");
  });

  test("client wakeDueRuns resumes due parked step attempts", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_wake_due_sleep",
      now: () => now,
    });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry, now: () => now });
    const def = defineWorkflow<undefined, string>({ name: "wake-due-sleep" });

    client.implementWorkflow(def, async ({ step }) => {
      await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
      return "done";
    });

    const handle = await client.runs.start(def, undefined);

    await expect(client.workers.wakeDueRuns({ workflowName: "wake-due-sleep" })).resolves.toEqual({
      processedRuns: 1,
    });
    await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
      status: "waiting",
      availableAt: Temporal.Instant.from("2026-06-11T10:00:01Z"),
    });
    await expect(client.workers.wakeDueRuns({ workflowName: "wake-due-sleep" })).resolves.toEqual({
      processedRuns: 0,
    });

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    await expect(client.workers.wakeDueRuns({ workflowName: "wake-due-sleep" })).resolves.toEqual({
      processedRuns: 1,
    });
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("done");
  });
});
