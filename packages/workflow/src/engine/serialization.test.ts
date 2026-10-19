import { describe, expect, test } from "vitest";

import { clientForEngine } from "../client/create.ts";
import { implementWorkflow, defineWorkflow } from "../definition.ts";
import { WorkflowSerializationError } from "../errors/mod.ts";
import { workflowErrorFromRecord } from "../errors/records.ts";
import { sequentialRunIds } from "../testing/helpers.ts";
import { createWorkflowEngine } from "./create.ts";

describe("workflow serialization", () => {
  test("rejects unserializable workflow input and context before durable writes", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_bad_input", "run_bad_context"),
    });

    const workflow = implementWorkflow<unknown, string>(
      { name: "serialization-start" },
      () => "done",
    );

    await expect(engine.runWorkflowNow(workflow, { bad: () => "nope" })).rejects.toThrow(
      WorkflowSerializationError,
    );
    await expect(
      engine.runWorkflowNow(workflow, undefined, {
        start: { context: { bad: Symbol("nope") } },
      }),
    ).rejects.toThrow(WorkflowSerializationError);
    await expect(engine.store.listRuns()).resolves.toEqual([]);
  });

  test("stores typed serialization errors for workflow outputs and step results", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_bad_output", "run_bad_step_result"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });

    const outputWorkflow = implementWorkflow<undefined, unknown>(
      { name: "serialization-output" },
      () => ({ bad: () => "nope" }),
    );

    const outputResult = await engine.runWorkflowNow(outputWorkflow, undefined);

    expect(outputResult.kind).toBe("failed");

    if (outputResult.kind !== "failed") {
      throw new Error("Expected workflow output serialization to fail");
    }

    expect(workflowErrorFromRecord(outputResult.error)).toBeInstanceOf(WorkflowSerializationError);

    const stepWorkflow = implementWorkflow<undefined, string>(
      { name: "serialization-step-result" },
      async ({ step }) => {
        await step.run({ name: "bad-result", retry: { maximumAttempts: 1 } }, () => ({
          bad: () => "nope",
        }));

        return "unreachable";
      },
    );

    const stepResult = await engine.runWorkflowNow(stepWorkflow, undefined);

    expect(stepResult.kind).toBe("failed");
    const attempts = await engine.store.listStepAttempts("run_bad_step_result");
    const attemptError = attempts[0]?.error;

    if (attemptError === undefined) {
      throw new Error("Expected step serialization attempt error");
    }

    expect(workflowErrorFromRecord(attemptError)).toBeInstanceOf(WorkflowSerializationError);
  });

  test("rejects unserializable child workflow input before starting child runs", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_bad_child_parent", "run_bad_child"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });

    const child = defineWorkflow<unknown, string>({ name: "serialization-child" });

    const parent = implementWorkflow<undefined, string>(
      { name: "serialization-child-parent" },
      async ({ step }) => {
        await step.workflow.run(child, { bad: () => "nope" }, { name: "child" });

        return "unreachable";
      },
    );

    const result = await engine.runWorkflowNow(parent, undefined);

    expect(result.kind).toBe("failed");
    expect(await engine.store.getRun("run_bad_child")).toBeUndefined();
    expect(await engine.store.listStepAttempts("run_bad_child_parent")).toEqual([]);
  });

  test("rejects unserializable message payloads before durable messageId writes", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_message_target", "run_message_sender"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });

    const client = clientForEngine(engine);

    const target = implementWorkflow<undefined, string>(
      { name: "serialization-message-target" },
      () => "target",
    );

    const targetHandle = await engine.runWorkflow(target, undefined);

    await expect(
      client.messages.send(targetHandle.runId, {
        messageId: "bad",
        payload: { bad: () => "nope" },
      }),
    ).rejects.toThrow(WorkflowSerializationError);
    expect(await engine.store.getEvents(targetHandle.runId)).toEqual([]);

    const sender = implementWorkflow<undefined, string>(
      { name: "serialization-message-sender" },
      async ({ step }) => {
        await step.message.send(targetHandle.runId, {
          messageId: "bad",
          payload: { bad: () => "nope" },
        });

        return "unreachable";
      },
    );

    const result = await engine.runWorkflowNow(sender, undefined);

    expect(result.kind).toBe("failed");

    if (result.kind !== "failed") {
      throw new Error("Expected message sender serialization to fail");
    }

    expect(workflowErrorFromRecord(result.error)).toBeInstanceOf(WorkflowSerializationError);
    const attempts = await engine.store.listStepAttempts("run_message_sender");
    expect(attempts).toEqual([]);

    const messageEvents = (await engine.store.getEvents(targetHandle.runId)).filter(
      (event) => event.kind === "message_sent",
    );

    expect(messageEvents).toEqual([]);
  });
});
