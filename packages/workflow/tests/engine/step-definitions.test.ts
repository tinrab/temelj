import { describe, expect, test } from "vitest";

import type { WorkflowStepContext } from "../../src/types/step.ts";

import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { defineWorkflowStep } from "../../src/step-definition.ts";

describe("workflow step definitions", () => {
  test("calls reusable step definitions through durable step history", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_defined_step",
    });
    const greet = defineWorkflowStep(
      { name: "greet" },
      (name: string, context: WorkflowStepContext) => `${context.step.id}:${name}`,
    );
    const workflow = implementWorkflow<undefined, string>(
      { name: "defined-step" },
      async ({ step }) => await step.task.call(greet, "Ada"),
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "run:greet:Ada",
    });
    await expect(engine.getEvents("run_defined_step")).resolves.toMatchObject([
      { kind: "workflow_started" },
      { kind: "step_started", stepId: "run:greet", stepName: "greet" },
      { kind: "step_completed", stepId: "run:greet", stepName: "greet", result: "run:greet:Ada" },
      { kind: "workflow_completed" },
    ]);
  });

  test("replays completed step definitions without rerunning handlers", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_defined_step_replay",
      now: () => now,
    });
    let calls = 0;
    const load = defineWorkflowStep({ name: "load" }, () => {
      calls++;
      return "cached";
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "defined-step-replay" },
      async ({ step }) => {
        const value = await step.task.call(load);
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        return value;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    expect(calls).toBe(1);

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    await expect(engine.resumeWorkflow(workflow, "run_defined_step_replay")).resolves.toMatchObject(
      {
        kind: "completed",
        output: "cached",
      },
    );
    expect(calls).toBe(1);
  });

  test("applies retry config from step definitions", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_defined_step_retry",
    });
    let attempts = 0;
    const flaky = defineWorkflowStep(
      { name: "flaky", retry: { maximumAttempts: 2 } },
      (_context) => {
        attempts++;
        if (attempts === 1) {
          throw new Error("try again");
        }
        return "ok";
      },
    );
    const workflow = implementWorkflow<undefined, string>(
      { name: "defined-step-retry" },
      async ({ step }) => await step.task.call(flaky),
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "ok",
    });
    expect(attempts).toBe(2);
    await expect(engine.listStepAttempts("run_defined_step_retry")).resolves.toMatchObject([
      { stepId: "run:flaky", attempt: 1, status: "failed" },
      { stepId: "run:flaky", attempt: 2, status: "completed" },
    ]);
  });

  test("runs step definitions in parallel with stable per-call identities", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_defined_step_parallel",
    });
    const double = defineWorkflowStep(
      { name: "double" },
      (value: number, _context: WorkflowStepContext) => value * 2,
    );
    const workflow = implementWorkflow<undefined, readonly number[]>(
      { name: "defined-step-parallel" },
      async ({ step }) => await Promise.all([step.task.call(double, 2), step.task.call(double, 3)]),
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: [4, 6],
    });
    await expect(engine.getEvents("run_defined_step_parallel")).resolves.toMatchObject([
      { kind: "workflow_started" },
      { kind: "step_started", stepId: "run:double", count: 1 },
      { kind: "step_started", stepId: "run:double:1", count: 2 },
      { kind: "step_completed", stepId: "run:double", result: 4 },
      { kind: "step_completed", stepId: "run:double:1", result: 6 },
      { kind: "workflow_completed" },
    ]);
  });

  test("applies timeout config from step definitions", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_defined_step_timeout",
    });
    const slow = defineWorkflowStep(
      {
        name: "slow",
        timeout: Temporal.Duration.from({ milliseconds: 1 }),
        retry: { maximumAttempts: 1 },
      },
      async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });
        return "late";
      },
    );
    const workflow = implementWorkflow<undefined, string>(
      { name: "defined-step-timeout" },
      async ({ step }) => await step.task.call(slow),
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }
    await expect(engine.listStepAttempts("run_defined_step_timeout")).resolves.toMatchObject([
      { stepId: "run:slow", stepName: "slow", status: "failed" },
    ]);
    const events = await engine.getEvents("run_defined_step_timeout");
    expect(events).toMatchObject([
      { kind: "workflow_started" },
      { kind: "step_started", stepId: "run:slow", stepName: "slow" },
      { kind: "step_failed", stepId: "run:slow", stepName: "slow" },
      { kind: "workflow_failed" },
    ]);
    const failed = events.find((event) => event.kind === "step_failed");
    expect(failed).toMatchObject({
      error: { name: "WorkflowStepTimeoutError" },
    });
  });

  test("rejects renamed step definition replay divergence", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_defined_step_rename_divergence",
      now: () => now,
    });
    let work = defineWorkflowStep({ name: "work" }, () => "done");
    const workflow = implementWorkflow<undefined, string>(
      { name: "defined-step-rename-divergence" },
      async ({ step }) => {
        const value = await step.task.call(work);
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        return value;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    work = defineWorkflowStep({ name: "renamed-work" }, () => "done");
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");

    const result = await engine.resumeWorkflow(workflow, "run_defined_step_rename_divergence");

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") {
      throw new Error("Expected renamed step definition replay divergence");
    }
    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
    await expect(engine.getRun("run_defined_step_rename_divergence")).resolves.toMatchObject({
      status: "failed",
      error: { name: "WorkflowReplayDivergenceError" },
    });
  });

  test("rejects reordered step definition replay divergence", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_defined_step_reorder_divergence",
      now: () => now,
    });
    const first = defineWorkflowStep({ name: "first" }, () => "one");
    const second = defineWorkflowStep({ name: "second" }, () => "two");
    let order: "first" | "second" = "first";
    const workflow = implementWorkflow<undefined, string>(
      { name: "defined-step-reorder-divergence" },
      async ({ step }) => {
        const value =
          order === "first" ? await step.task.call(first) : await step.task.call(second);
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        return value;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    order = "second";
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");

    const result = await engine.resumeWorkflow(workflow, "run_defined_step_reorder_divergence");

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") {
      throw new Error("Expected reordered step definition replay divergence");
    }
    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
    await expect(engine.getRun("run_defined_step_reorder_divergence")).resolves.toMatchObject({
      status: "failed",
      error: { name: "WorkflowReplayDivergenceError" },
    });
  });
});
