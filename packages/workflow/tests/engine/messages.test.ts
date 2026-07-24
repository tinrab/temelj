import { ss, StandardSchemaValidationError } from "@temelj/standard-schema";
import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow, defineMessageChannel, defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import {
  WorkflowSerializationError,
  WorkflowMessageWaitTimeoutError,
} from "../../src/errors/mod.ts";
import { workflowErrorFromRecord } from "../../src/errors/records.ts";
import { sequentialRunIds } from "../utility.ts";

describe("workflow message fan-out", () => {
  test("typed message channels interoperate with persisted string messageIds", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_channel_first", "run_channel_second"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    const approval = defineMessageChannel<
      { readonly approved: boolean },
      { readonly requestId: string }
    >({
      name: "approval",
      resolveMessageId: (key) => `approval.${key.requestId}`,
    });
    const schema = ss.object({ approved: ss.boolean() });
    const refresh = defineMessageChannel({
      name: "refresh",
      schema,
    });
    const workflow = implementWorkflow<undefined, boolean>(
      { name: "channel-messageIds" },
      async ({ run, step }) => {
        await step.message.send(run.id, refresh, {
          payload: { approved: true },
          idempotencyKey: "refresh:1",
        });
        const payload = await step.message.wait(approval, {
          key: { requestId: "123" },
          timeout: Temporal.Duration.from({ minutes: 1 }),
        });
        return payload.approved;
      },
    );

    const waiting = await engine.runWorkflowNow(workflow, undefined);

    expect(waiting.kind).toBe("waiting");
    await expect(engine.getEvents("run_channel_first")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workflow_started" }),
        expect.objectContaining({
          kind: "message_sent",
          messageId: "refresh",
          payload: { approved: true },
          idempotencyKey: "refresh:1",
        }),
        expect.objectContaining({
          kind: "message_wait_started",
          messageId: "approval.123",
        }),
      ]),
    );

    await expect(
      client.messages.send("run_channel_first", approval, {
        key: { requestId: "123" },
        payload: { approved: true },
      }),
    ).resolves.toBeUndefined();
    await expect(engine.resumeWorkflow(workflow, "run_channel_first")).resolves.toMatchObject({
      kind: "completed",
      output: true,
    });

    const second = await engine.startWorkflow(
      defineWorkflow({ name: "channel-messageIds" }),
      undefined,
    );
    await expect(
      client.messages.broadcast({
        channel: refresh,
        payload: { approved: false },
        target: { workflowName: "channel-messageIds" },
      }),
    ).resolves.toEqual({
      messageId: "refresh",
      runIds: ["run_channel_second"],
      deliveredMessages: 1,
    });
    await expect(engine.getEvents(second.runId)).resolves.toMatchObject([
      {
        kind: "message_sent",
        messageId: "refresh",
        payload: { approved: false },
      },
    ]);
    await expect(
      client.messages.send("run_channel_second", refresh, {
        payload: { approved: "yes" as unknown as boolean },
      }),
    ).rejects.toBeInstanceOf(StandardSchemaValidationError);
  });

  test("broadcasts messages to a query-targeted active run snapshot", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds(
        "run_broadcast_first",
        "run_broadcast_second",
        "run_broadcast_other",
        "run_broadcast_completed",
      ),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    const targetDef = defineWorkflow<undefined, string>({ name: "broadcast-target" });
    const otherDef = defineWorkflow<undefined, string>({ name: "broadcast-other" });
    const completedWorkflow = implementWorkflow<undefined, string>(
      { name: "broadcast-target" },
      () => "done",
    );

    const first = await engine.startWorkflow(targetDef, undefined);
    const second = await engine.startWorkflow(targetDef, undefined);
    const other = await engine.startWorkflow(otherDef, undefined);
    const completed = await engine.runWorkflowNow(completedWorkflow, undefined);
    expect(completed.kind).toBe("completed");

    const result = await client.messages.broadcast({
      messageId: "refresh",
      payload: { force: true },
      idempotencyKey: "refresh:2026-06-11",
      target: { workflowName: "broadcast-target" },
    });

    expect(result).toEqual({
      messageId: "refresh",
      runIds: ["run_broadcast_first", "run_broadcast_second"],
      deliveredMessages: 2,
    });
    await expect(engine.getEvents(first.runId)).resolves.toMatchObject([
      {
        kind: "message_sent",
        messageId: "refresh",
        payload: { force: true },
        idempotencyKey: "refresh:2026-06-11",
      },
    ]);
    await expect(engine.getEvents(second.runId)).resolves.toMatchObject([
      {
        kind: "message_sent",
        messageId: "refresh",
        payload: { force: true },
        idempotencyKey: "refresh:2026-06-11",
      },
    ]);
    await expect(engine.getEvents(other.runId)).resolves.toEqual([]);
    await expect(engine.getEvents("run_broadcast_completed")).resolves.toEqual([
      { kind: "workflow_started", timestamp: Temporal.Instant.from("2026-06-11T10:00:00Z") },
      { kind: "workflow_completed", timestamp: Temporal.Instant.from("2026-06-11T10:00:00Z") },
    ]);

    await expect(
      engine.broadcastMessage({
        messageId: "refresh",
        payload: { force: true },
        idempotencyKey: "refresh:2026-06-11",
        target: { workflowName: "broadcast-target" },
      }),
    ).resolves.toMatchObject({
      runIds: ["run_broadcast_first", "run_broadcast_second"],
      deliveredMessages: 2,
    });
    await expect(engine.getEvents(first.runId)).resolves.toHaveLength(1);
  });

  test("validates broadcast payloads even when no runs match", async () => {
    const engine = createWorkflowEngine({ maximumPersistedValueBytes: 10 });
    await expect(
      engine.broadcastMessage({
        messageId: "large",
        payload: "12345678901",
        target: { workflowName: "missing" },
      }),
    ).rejects.toThrow(WorkflowSerializationError);
  });

  test("message wait timeouts fail with a typed timeout error", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_message_wait_timeout",
      now: () => now,
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "message-wait-timeout" },
      async ({ step }) => {
        await step.message.wait({
          name: "approval",
          messageId: "approval.received",
          timeout: Temporal.Duration.from({ seconds: 1 }),
        });
        return "approved";
      },
    );

    const waiting = await engine.runWorkflowNow(workflow, undefined);

    expect(waiting.kind).toBe("waiting");
    if (waiting.kind !== "waiting") {
      throw new Error("Expected message wait workflow to wait");
    }
    expect(waiting.availableAt.toString()).toBe("2026-06-11T10:00:01Z");

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const failed = await engine.resumeWorkflow(workflow, "run_message_wait_timeout");

    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") {
      throw new Error("Expected message wait timeout to fail");
    }
    expect(workflowErrorFromRecord(failed.error)).toBeInstanceOf(WorkflowMessageWaitTimeoutError);
    await expect(engine.getEvents("run_message_wait_timeout")).resolves.toMatchObject([
      { kind: "workflow_started" },
      {
        kind: "message_wait_started",
        stepId: "message-wait:approval",
        messageId: "approval.received",
        timeoutAt: Temporal.Instant.from("2026-06-11T10:00:01Z"),
      },
      { kind: "workflow_started" },
      {
        kind: "message_wait_failed",
        stepId: "message-wait:approval",
        messageId: "approval.received",
      },
      { kind: "workflow_failed" },
    ]);
    await expect(engine.listStepAttempts("run_message_wait_timeout")).resolves.toMatchObject([
      {
        stepId: "message-wait:approval",
        status: "failed",
        messageId: "approval.received",
        timeoutAt: Temporal.Instant.from("2026-06-11T10:00:01Z"),
      },
    ]);
  });

  test("message wait timeout is the supported message-versus-sleep race equivalent", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_message_timeout_race",
      now: () => now,
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "messageId-timeout-race" },
      async ({ step }) => {
        const payload = await step.message.wait<{ readonly approved: boolean }>({
          name: "approval",
          messageId: "approval.received",
          timeout: Temporal.Duration.from({ minutes: 1 }),
        });
        return payload.approved ? "approved" : "rejected";
      },
    );

    const waiting = await engine.runWorkflowNow(workflow, undefined);

    expect(waiting.kind).toBe("waiting");
    if (waiting.kind !== "waiting") {
      throw new Error("Expected message timeout race workflow to wait");
    }
    expect(waiting.availableAt.toString()).toBe("2026-06-11T10:01:00Z");

    now = Temporal.Instant.from("2026-06-11T10:00:30Z");
    await engine.sendMessage("run_message_timeout_race", {
      messageId: "approval.received",
      payload: { approved: true },
    });
    const completed = await engine.resumeWorkflow(workflow, "run_message_timeout_race");

    expect(completed).toMatchObject({
      kind: "completed",
      output: "approved",
    });
    await expect(engine.getEvents("run_message_timeout_race")).resolves.toMatchObject([
      { kind: "workflow_started" },
      {
        kind: "message_wait_started",
        stepId: "message-wait:approval",
        messageId: "approval.received",
        timeoutAt: Temporal.Instant.from("2026-06-11T10:01:00Z"),
      },
      {
        kind: "message_sent",
        messageId: "approval.received",
        waiterStepIds: ["message-wait:approval"],
      },
      { kind: "workflow_started" },
      {
        kind: "message_wait_completed",
        stepId: "message-wait:approval",
        messageId: "approval.received",
        messageTimestamp: Temporal.Instant.from("2026-06-11T10:00:30Z"),
      },
      { kind: "workflow_completed" },
    ]);
  });
});
