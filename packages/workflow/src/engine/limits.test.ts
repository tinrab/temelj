import { describe, expect, test } from "vitest";

import { clientForEngine } from "../client/create.ts";
import { implementWorkflow, defineWorkflow } from "../definition.ts";
import { WorkflowSerializationError } from "../errors/mod.ts";
import { workflowErrorFromRecord } from "../errors/records.ts";
import { sequentialRunIds } from "../testing/helpers.ts";
import { createWorkflowEngine } from "./create.ts";

describe("workflow engine limits", () => {
  test("enforces configured persisted value byte limits", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_limit_input", "run_limit_step"),
      maximumPersistedValueBytes: 10,
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });

    const workflow = implementWorkflow<string, string>({ name: "value-limit-input" }, () => "ok");

    await expect(engine.runWorkflowNow(workflow, "12345678901")).rejects.toThrow(
      WorkflowSerializationError,
    );
    await expect(engine.store.listRuns()).resolves.toEqual([]);

    const stepWorkflow = implementWorkflow<undefined, string>(
      { name: "value-limit-step" },
      async ({ step }) => {
        await step.run({ name: "too-large", retry: { maximumAttempts: 1 } }, () => "12345678901");

        return "unreachable";
      },
    );

    const result = await engine.runWorkflowNow(stepWorkflow, undefined);

    expect(result.kind).toBe("failed");
    const attempts = await engine.store.listStepAttempts("run_limit_step");
    const attemptError = attempts[0]?.error;

    if (attemptError === undefined) {
      throw new Error("Expected limited step result error");
    }

    expect(workflowErrorFromRecord(attemptError)).toBeInstanceOf(WorkflowSerializationError);
  });

  test("enforces configured event history limits before appending events", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_event_history_limit",
      maximumEventHistoryEvents: 1,
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });

    const client = clientForEngine(engine);

    const def = defineWorkflow<undefined, string>({ name: "event-history-limit" });
    const handle = await engine.startWorkflow(def, undefined);

    await client.messages.send(handle.runId, { messageId: "first", payload: "ok" });
    await expect(
      client.messages.send(handle.runId, { messageId: "second", payload: "ok" }),
    ).rejects.toThrow(WorkflowSerializationError);

    expect(await engine.store.getEvents(handle.runId)).toHaveLength(1);
  });

  test("marks runs failed when completion would exceed the event history limit", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_completion_history_limit",
      maximumEventHistoryEvents: 1,
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });

    const workflow = implementWorkflow<undefined, string>(
      { name: "completion-history-limit", retry: { maximumAttempts: 1 } },
      () => "done",
    );

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected completion history limit to fail the workflow");
    }

    expect(workflowErrorFromRecord(result.error)).toBeInstanceOf(WorkflowSerializationError);
    await expect(engine.store.getRun("run_completion_history_limit")).resolves.toMatchObject({
      status: "failed",
      error: { name: "WorkflowSerializationError" },
    });
    await expect(engine.store.getEvents("run_completion_history_limit")).resolves.toMatchObject([
      { kind: "workflow_started" },
      { kind: "workflow_failed" },
    ]);
  });
});
