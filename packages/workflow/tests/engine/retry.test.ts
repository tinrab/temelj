import { describe, expect, test } from "vitest";

import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowNonRetryableError, WorkflowRetryableError } from "../../src/errors/failures.ts";
import { workflowErrorFromRecord } from "../../src/errors/records.ts";
import { sequentialRunIds } from "../utility.ts";

describe("workflow retry behavior", () => {
  test("non-retryable workflow and step errors bypass remaining retries", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_non_retryable_workflow", "run_non_retryable_step"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    let workflowAttempts = 0;
    const workflow = implementWorkflow<undefined, string>(
      {
        name: "non-retryable-workflow",
        retry: { maximumAttempts: 3, initialInterval: Temporal.Duration.from({ seconds: 1 }) },
      },
      async () => {
        workflowAttempts++;
        WorkflowNonRetryableError.failed("fatal workflow");
      },
    );

    const workflowResult = await engine.runWorkflowNow(workflow, undefined);

    expect(workflowAttempts).toBe(1);
    expect(workflowResult.kind).toBe("failed");
    if (workflowResult.kind !== "failed") {
      throw new Error("Expected workflow to fail");
    }
    expect(workflowResult.run.retryAt).toBeUndefined();
    expect(workflowErrorFromRecord(workflowResult.error)).toBeInstanceOf(WorkflowNonRetryableError);

    let stepAttempts = 0;
    const stepWorkflow = implementWorkflow<undefined, string>(
      { name: "non-retryable-step" },
      async ({ step }) => {
        await step.task.run(
          {
            name: "fatal-step",
            retry: { maximumAttempts: 3, initialInterval: Temporal.Duration.from({ seconds: 1 }) },
          },
          () => {
            stepAttempts++;
            WorkflowNonRetryableError.failed("fatal step");
          },
        );
        return "unreachable";
      },
    );

    const stepResult = await engine.runWorkflowNow(stepWorkflow, undefined);

    expect(stepAttempts).toBe(1);
    expect(stepResult.kind).toBe("failed");
    const stepAttemptsRecords = await engine.listStepAttempts("run_non_retryable_step");
    expect(stepAttemptsRecords).toHaveLength(1);
    expect(stepAttemptsRecords[0]?.status).toBe("failed");
  });

  test("retryable errors can request workflow and step retry timestamps", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_retryable_workflow", "run_retryable_step"),
      now: () => now,
    });
    let workflowAttempts = 0;
    const workflow = implementWorkflow<undefined, string>(
      {
        name: "retryable-workflow",
        retry: { maximumAttempts: 3, initialInterval: Temporal.Duration.from({ minutes: 1 }) },
      },
      async () => {
        workflowAttempts++;
        if (workflowAttempts === 1) {
          WorkflowRetryableError.failed("retry workflow later", {
            retryAt: Temporal.Instant.from("2026-06-11T10:00:05Z"),
          });
        }
        return "done";
      },
    );

    const waitingWorkflow = await engine.runWorkflowNow(workflow, undefined);

    expect(waitingWorkflow.kind).toBe("waiting");
    if (waitingWorkflow.kind !== "waiting") {
      throw new Error("Expected workflow to wait for retry");
    }
    expect(waitingWorkflow.run.retryAt).toEqual(Temporal.Instant.from("2026-06-11T10:00:05Z"));
    expect(waitingWorkflow.run.retryAttempt).toBe(2);
    expect(waitingWorkflow.availableAt.toString()).toBe("2026-06-11T10:00:05Z");

    now = Temporal.Instant.from("2026-06-11T10:00:05Z");
    await expect(engine.resumeWorkflow(workflow, "run_retryable_workflow")).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });

    let stepAttempts = 0;
    const stepWorkflow = implementWorkflow<undefined, string>(
      { name: "retryable-step" },
      async ({ step }) => {
        await step.task.run(
          {
            name: "retry-step",
            retry: { maximumAttempts: 3, initialInterval: Temporal.Duration.from({ minutes: 1 }) },
          },
          () => {
            stepAttempts++;
            if (stepAttempts === 1) {
              WorkflowRetryableError.failed("retry step soon", {
                retryDelay: Temporal.Duration.from({ seconds: 5 }),
              });
            }
            return "ok";
          },
        );
        return "done";
      },
    );

    const waitingStep = await engine.runWorkflowNow(stepWorkflow, undefined);

    expect(waitingStep.kind).toBe("waiting");
    if (waitingStep.kind !== "waiting") {
      throw new Error("Expected step workflow to wait for retry");
    }
    expect(waitingStep.run.retryAt).toEqual(Temporal.Instant.from("2026-06-11T10:00:10Z"));
    expect(waitingStep.run.retryStepName).toBe("retry-step");
    expect(waitingStep.run.retryAttempt).toBe(2);
  });
});
