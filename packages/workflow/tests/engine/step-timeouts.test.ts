import { describe, expect, test, vi } from "vitest";

import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import {
  WorkflowRunDeadlineExceededError,
  WorkflowStepTimeoutError,
} from "../../src/errors/mod.ts";
import { workflowErrorFromRecord } from "../../src/errors/records.ts";

describe("workflow step timeouts", () => {
  test("run cancellation aborts active step contexts", async () => {
    vi.useFakeTimers();
    try {
      const engine = createWorkflowEngine({
        createRunId: () => "run_step_cancel_signal",
        now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
      });
      let stepStarted!: () => void;
      const stepStartedPromise = new Promise<void>((resolve) => {
        stepStarted = resolve;
      });
      let observedAbort = false;
      const workflow = implementWorkflow<undefined, string>(
        { name: "step-cancel-signal" },
        async ({ step }) => {
          await step.task.run(
            { name: "cancelable", retry: { maximumAttempts: 1 } },
            async (context) => {
              stepStarted();
              await new Promise<void>((resolve) => {
                context.signal.addEventListener(
                  "abort",
                  () => {
                    observedAbort = true;
                    resolve();
                  },
                  { once: true },
                );
              });
              throw context.signal.reason;
            },
          );
          return "unreachable";
        },
      );

      const execution = engine.runWorkflowNow(workflow, undefined);
      await vi.advanceTimersByTimeAsync(0);
      await stepStartedPromise;
      await engine.cancelRun("run_step_cancel_signal");
      await vi.advanceTimersByTimeAsync(25);

      await expect(execution).resolves.toMatchObject({
        kind: "failed",
        run: {
          id: "run_step_cancel_signal",
          status: "canceled",
        },
      });
      expect(observedAbort).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("step.task.run timeout aborts cooperative callbacks and stores typed timeout errors", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_timeout_cooperative",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    let observedAbort = false;
    const workflow = implementWorkflow<undefined, string>(
      { name: "step-timeout-cooperative" },
      async ({ step }) => {
        await step.task.run(
          {
            name: "cooperative",
            timeout: Temporal.Duration.from({ milliseconds: 1 }),
            retry: { maximumAttempts: 1 },
          },
          async (context) => {
            await new Promise<void>((resolve) => {
              context.signal.addEventListener(
                "abort",
                () => {
                  observedAbort = true;
                  resolve();
                },
                { once: true },
              );
            });
            throw context.signal.reason;
          },
        );
        return "unreachable";
      },
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(observedAbort).toBe(true);
    expect(result.kind).toBe("failed");
    const attempts = await engine.listStepAttempts("run_step_timeout_cooperative");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.timeoutAt).toEqual(Temporal.Instant.from("2026-06-11T10:00:00.001Z"));
    expect(attempts[0]?.error).toBeDefined();
    const attemptError = attempts[0]?.error;
    if (attemptError === undefined) {
      throw new Error("Expected step timeout attempt error");
    }
    expect(workflowErrorFromRecord(attemptError)).toBeInstanceOf(WorkflowStepTimeoutError);
  });

  test("step.task.run timeout fails non-cooperative callbacks without waiting for completion", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_timeout_noncooperative",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    let callbackStarted = false;
    const workflow = implementWorkflow<undefined, string>(
      { name: "step-timeout-noncooperative" },
      async ({ step }) => {
        await step.task.run(
          {
            name: "noncooperative",
            timeout: Temporal.Duration.from({ milliseconds: 1 }),
            retry: { maximumAttempts: 1 },
          },
          () => {
            callbackStarted = true;
            return new Promise<string>(() => {});
          },
        );
        return "unreachable";
      },
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(callbackStarted).toBe(true);
    expect(result.kind).toBe("failed");
    const events = await engine.getEvents("run_step_timeout_noncooperative");
    expect(events.map((event) => event.kind)).toContain("step_failed");
    const attempts = await engine.listStepAttempts("run_step_timeout_noncooperative");
    const attemptError = attempts[0]?.error;
    if (attemptError === undefined) {
      throw new Error("Expected non-cooperative step timeout attempt error");
    }
    expect(workflowErrorFromRecord(attemptError)).toBeInstanceOf(WorkflowStepTimeoutError);
  });

  test("step.task.run timeout retries respect workflow deadlines", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_timeout_deadline",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "step-timeout-deadline" },
      async ({ step }) => {
        await step.task.run(
          {
            name: "deadline-step",
            timeout: Temporal.Duration.from({ milliseconds: 1 }),
            retry: { maximumAttempts: 2, initialInterval: Temporal.Duration.from({ seconds: 10 }) },
          },
          () => new Promise<string>(() => {}),
        );
        return "unreachable";
      },
    );

    const result = await engine.runWorkflowNow(workflow, undefined, {
      start: { deadlineAt: Temporal.Instant.from("2026-06-11T10:00:05Z") },
    });

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") {
      throw new Error("Expected workflow to fail at the run deadline");
    }
    expect(workflowErrorFromRecord(result.error)).toBeInstanceOf(WorkflowRunDeadlineExceededError);
    expect(result.run.retryAt).toBeUndefined();
  });
});
