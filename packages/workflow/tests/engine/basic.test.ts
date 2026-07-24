import { describe, expect, expectTypeOf, test } from "vitest";

import type {
  WorkflowClient,
  WorkflowClientAdminApi,
  WorkflowClientRunsApi,
} from "../../src/types/client.ts";
import type { WorkflowStepApi } from "../../src/types/step.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { defineWorkflow, implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { StreamId } from "../../src/types/stream-id.ts";
import { withoutWorkflowWorkerStore } from "../support/client-engine.ts";

describe("createWorkflowEngine", () => {
  test("runs a workflow with one durable step", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_basic",
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "basic" },
      async ({ step }) => await step.task.run({ name: "work" }, () => "done"),
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await expect(engine.getEvents("run_basic")).resolves.toMatchObject([
      { kind: "workflow_started" },
      { kind: "step_started", stepId: "run:work" },
      { kind: "step_completed", stepId: "run:work", result: "done" },
      { kind: "workflow_completed" },
    ]);
  });

  test("runs workflow commands through grouped step facets", async () => {
    const engine = createWorkflowEngine({
      createRecordedId: ({ commandName, runId }) => `${runId}:${commandName}`,
      createRunId: () => "run_grouped_step_facets",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<
      undefined,
      {
        readonly id: string;
        readonly streamId: StreamId;
        readonly task: string;
      }
    >({ name: "grouped-step-facets" }, async ({ step }) => {
      const task = await step.task.run({ name: "task" }, () => "task");
      const lock = await step.lock.acquire("guard", "lock:grouped-step-facets", {
        leaseDuration: Temporal.Duration.from({ minutes: 1 }),
      });
      await step.lock.release("release-guard", lock.key);
      await step.runData.setMetadata("metadata", { task });
      await step.runData.setAttributes("attributes", { phase: "grouped" });
      const id = await step.deterministic.id("token");
      const stream = step.stream.create<string>("log");
      await stream.write("chunk");
      await stream.close();
      return {
        id,
        streamId: stream.id,
        task,
      };
    });

    const result = await engine.runWorkflowNow(workflow, undefined);
    if (result.kind === "failed") {
      throw result.error;
    }
    expect(result).toMatchObject({
      kind: "completed",
      output: {
        id: "run_grouped_step_facets:token",
        streamId: "log",
        task: "task",
      },
    });
    await expect(engine.getRun("run_grouped_step_facets")).resolves.toMatchObject({
      attributes: { phase: "grouped" },
      metadata: { task: "task" },
    });
    await expect(engine.getEvents("run_grouped_step_facets")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "step_started", stepId: "run:task" }),
        expect.objectContaining({ kind: "step_started", stepId: "run:guard" }),
        expect.objectContaining({ kind: "step_started", stepId: "run:release-guard" }),
        expect.objectContaining({ kind: "metadata_set", stepId: "metadata:metadata" }),
        expect.objectContaining({ kind: "attributes_set", stepId: "attributes:attributes" }),
        expect.objectContaining({
          kind: "deterministic_value_recorded",
          stepId: "deterministic:token",
        }),
        expect.objectContaining({ kind: "stream_started", stepId: "stream:log" }),
        expect.objectContaining({ kind: "stream_chunk", streamId: "log", chunk: "chunk" }),
        expect.objectContaining({ kind: "stream_closed", streamId: "log" }),
      ]),
    );
  });

  test("uses commandId as the durable step identity", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_command_id",
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "command-id" },
      async ({ step }) => {
        await step.message.wait({
          commandId: "approval-command",
          messageId: "approved",
          timeout: Temporal.Duration.from({ minutes: 1 }),
        });
        return await step.task.run({ commandId: "work-command" }, () => "done");
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    await engine.sendMessage("run_command_id", { messageId: "approved" });
    await expect(engine.resumeWorkflow(workflow, "run_command_id")).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await expect(engine.getEvents("run_command_id")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message_wait_started",
          stepId: "message-wait:approval-command",
          stepName: "approval-command",
          messageId: "approved",
        }),
        expect.objectContaining({
          kind: "step_started",
          stepId: "run:work-command",
          stepName: "work-command",
        }),
      ]),
    );
  });

  test("exposes only grouped step facet types", () => {
    expectTypeOf<WorkflowStepApi>().toHaveProperty("task");
    expectTypeOf<WorkflowStepApi>().toHaveProperty("workflow");
    expectTypeOf<WorkflowStepApi>().toHaveProperty("message");
    expectTypeOf<WorkflowStepApi>().toHaveProperty("lock");
    expectTypeOf<WorkflowStepApi>().toHaveProperty("runData");
    expectTypeOf<WorkflowStepApi>().toHaveProperty("deterministic");
    expectTypeOf<WorkflowStepApi>().toHaveProperty("stream");
    expectTypeOf<WorkflowStepApi>().toHaveProperty("hook");
    expectTypeOf<WorkflowStepApi>().not.toHaveProperty("run");
    expectTypeOf<WorkflowStepApi>().not.toHaveProperty("runWorkflow");
    expectTypeOf<WorkflowStepApi>().not.toHaveProperty("waitForMessage");
  });

  test("exposes grouped client facets", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_grouped_client_facets",
    });
    const client = createWorkflowClient({ engine });
    const workflow = client.workflow<undefined, string>(
      defineWorkflow({ name: "grouped-client-facets" }),
      async ({ step }) => await step.task.run({ name: "work" }, () => "done"),
    );

    const handle = await workflow.run(undefined);
    await client.workers.processRun(handle.runId);

    await expect(client.runs.get(handle.runId)).resolves.toMatchObject({
      status: "completed",
    });
    await expect(client.runs.count({ workflowName: "grouped-client-facets" })).resolves.toBe(1);
    await expect(client.runs.events(handle.runId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workflow_started" }),
        expect.objectContaining({ kind: "step_completed", stepId: "run:work", result: "done" }),
        expect.objectContaining({ kind: "workflow_completed" }),
      ]),
    );
    await expect(client.runs.listStepAttempts(handle.runId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ runId: handle.runId, stepId: "run:work" }),
      ]),
    );
    await expect(
      client.admin.updateMetadata(handle.runId, { source: "client-facet" }),
    ).resolves.toMatchObject({
      metadata: { source: "client-facet" },
    });
  });

  test("exposes grouped client facet types", () => {
    expectTypeOf<WorkflowClient>().toHaveProperty("runs");
    expectTypeOf<WorkflowClient>().toHaveProperty("admin");
    expectTypeOf<WorkflowClient>().toHaveProperty("schedules");
    expectTypeOf<WorkflowClient>().toHaveProperty("locks");
    expectTypeOf<WorkflowClient>().toHaveProperty("hooks");
    expectTypeOf<WorkflowClient>().toHaveProperty("streams");
    expectTypeOf<WorkflowClient>().toHaveProperty("messages");
    expectTypeOf<WorkflowClient>().toHaveProperty("workers");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("engine");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("worker");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("processRun");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("wakeDueRuns");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("getRun");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("getEvents");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("cancelRun");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("readStream");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("sendMessage");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("createSchedule");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("acquireLock");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("resumeHook");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("resumeWebhook");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("disposeHook");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("disposeWebhook");
    expectTypeOf<WorkflowClient>().not.toHaveProperty("getHookByToken");
    expectTypeOf<WorkflowClientRunsApi>().not.toHaveProperty("repairStepAttempts");
    expectTypeOf<WorkflowClientRunsApi>().not.toHaveProperty("repairMessageIdempotencyIndexes");
    expectTypeOf<WorkflowClientAdminApi>().not.toHaveProperty("repairStepAttempts");
    expectTypeOf<WorkflowClientAdminApi>().not.toHaveProperty("repairMessageIdempotencyIndexes");
  });

  test("reports worker facet use on a client-only engine", async () => {
    const engine = createWorkflowEngine();
    const clientOnlyEngine = withoutWorkflowWorkerStore(engine);
    const client = createWorkflowClient({ engine: clientOnlyEngine });

    await expect(client.workers.processRun("run_client_only_engine")).rejects.toMatchObject({
      name: "WorkflowCapabilityError",
      capability: "workflow worker engine",
    });
  });
});
