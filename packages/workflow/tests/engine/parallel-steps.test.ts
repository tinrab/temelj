import { describe, expect, test } from "vitest";

import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowRetryableError } from "../../src/errors/mod.ts";

describe("parallel workflow steps", () => {
  test("runs durable steps in parallel with Promise.all", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_parallel_steps",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<undefined, readonly string[]>(
      { name: "parallel-steps" },
      async ({ step }) => {
        return await Promise.all([
          step.task.run({ name: "fetch-user" }, () => "user"),
          step.task.run({ name: "fetch-settings" }, () => "settings"),
        ]);
      },
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result).toMatchObject({
      kind: "completed",
      output: ["user", "settings"],
    });
    await expect(engine.getEvents("run_parallel_steps")).resolves.toMatchObject([
      { kind: "workflow_started" },
      { kind: "step_started", stepId: "run:fetch-user", stepName: "fetch-user" },
      { kind: "step_started", stepId: "run:fetch-settings", stepName: "fetch-settings" },
      { kind: "step_completed", stepId: "run:fetch-user", result: "user" },
      { kind: "step_completed", stepId: "run:fetch-settings", result: "settings" },
      { kind: "workflow_completed" },
    ]);
    const attempts = await engine.listStepAttempts("run_parallel_steps");
    expect(attempts).toHaveLength(2);
    expect(attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: "run:fetch-user",
          status: "completed",
          output: "user",
        }),
        expect.objectContaining({
          stepId: "run:fetch-settings",
          status: "completed",
          output: "settings",
        }),
      ]),
    );
  });

  test("replays completed parallel steps without repeating them after a retry", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_parallel_retry",
      now: () => now,
    });
    let stableRuns = 0;
    let flakyRuns = 0;
    const workflow = implementWorkflow<undefined, readonly string[]>(
      { name: "parallel-retry" },
      async ({ step }) => {
        return await Promise.all([
          step.task.run({ name: "stable" }, () => {
            stableRuns++;
            return "stable";
          }),
          step.task.run(
            {
              name: "flaky",
              retry: {
                maximumAttempts: 2,
                initialInterval: Temporal.Duration.from({ seconds: 1 }),
              },
            },
            () => {
              flakyRuns++;
              if (flakyRuns === 1) {
                WorkflowRetryableError.failed("retry parallel branch", {
                  retryDelay: Temporal.Duration.from({ seconds: 1 }),
                });
              }
              return "flaky";
            },
          ),
        ]);
      },
    );

    const waiting = await engine.runWorkflowNow(workflow, undefined);

    expect(waiting.kind).toBe("waiting");
    if (waiting.kind !== "waiting") {
      throw new Error("Expected parallel retry workflow to wait");
    }
    expect(stableRuns).toBe(1);
    expect(flakyRuns).toBe(1);
    expect(waiting.run.retryStepName).toBe("flaky");
    expect(waiting.availableAt.toString()).toBe("2026-06-11T10:00:01Z");

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const completed = await engine.resumeWorkflow(workflow, "run_parallel_retry");

    expect(completed).toMatchObject({
      kind: "completed",
      output: ["stable", "flaky"],
    });
    expect(stableRuns).toBe(1);
    expect(flakyRuns).toBe(2);
    const attempts = await engine.listStepAttempts("run_parallel_retry");
    expect(attempts).toHaveLength(3);
    expect(attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: "run:stable",
          attempt: 1,
          status: "completed",
          output: "stable",
        }),
        expect.objectContaining({
          stepId: "run:flaky",
          attempt: 1,
          status: "failed",
        }),
        expect.objectContaining({
          stepId: "run:flaky",
          attempt: 2,
          status: "completed",
          output: "flaky",
        }),
      ]),
    );
  });

  test("replays nested dynamic steps by stable names when collections reorder", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_dynamic_steps",
      now: () => now,
    });
    let processed: string[] = [];
    let orders: Array<{
      readonly id: string;
      readonly lines: readonly { readonly id: string }[];
    }> = [
      { id: "order-b", lines: [{ id: "line-2" }, { id: "line-1" }] },
      { id: "order-a", lines: [{ id: "line-1" }] },
    ];
    const workflow = implementWorkflow<undefined, readonly string[]>(
      { name: "dynamic-steps" },
      async ({ step }) => {
        const outputs: string[] = [];
        for (const order of orders.toSorted((left, right) => left.id.localeCompare(right.id))) {
          for (const line of order.lines.toSorted((left, right) =>
            left.id.localeCompare(right.id),
          )) {
            outputs.push(
              await step.task.run({ name: `process:${order.id}:${line.id}` }, () => {
                const processedId = `${order.id}:${line.id}`;
                processed.push(processedId);
                return processedId;
              }),
            );
          }
        }
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        return outputs;
      },
    );

    const waiting = await engine.runWorkflowNow(workflow, undefined);

    expect(waiting.kind).toBe("waiting");
    expect(processed).toEqual(["order-a:line-1", "order-b:line-1", "order-b:line-2"]);
    if (waiting.kind !== "waiting") {
      throw new Error("Expected dynamic workflow to wait");
    }
    expect(waiting.availableAt.toString()).toBe("2026-06-11T10:00:01Z");

    processed = [];
    orders = [
      { id: "order-a", lines: [{ id: "line-1" }] },
      { id: "order-b", lines: [{ id: "line-1" }, { id: "line-2" }] },
    ];
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const completed = await engine.resumeWorkflow(workflow, "run_dynamic_steps");

    expect(completed).toMatchObject({
      kind: "completed",
      output: ["order-a:line-1", "order-b:line-1", "order-b:line-2"],
    });
    expect(processed).toEqual([]);
    await expect(engine.getEvents("run_dynamic_steps")).resolves.toMatchObject([
      { kind: "workflow_started" },
      { kind: "step_started", stepId: "run:process:order-a:line-1" },
      { kind: "step_completed", stepId: "run:process:order-a:line-1" },
      { kind: "step_started", stepId: "run:process:order-b:line-1" },
      { kind: "step_completed", stepId: "run:process:order-b:line-1" },
      { kind: "step_started", stepId: "run:process:order-b:line-2" },
      { kind: "step_completed", stepId: "run:process:order-b:line-2" },
      { kind: "sleep_started", stepId: "sleep:pause" },
      { kind: "workflow_started" },
      { kind: "sleep_completed", stepId: "sleep:pause" },
      { kind: "workflow_completed" },
    ]);
  });
});
