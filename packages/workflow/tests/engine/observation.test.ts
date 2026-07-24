import { describe, expect, it, vi } from "vitest";

import type { ObservationEventHandler } from "../../src/types/observation.ts";

import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { MessageId } from "../../src/types/message-id.ts";
import { RunId } from "../../src/types/run.ts";

describe("workflow observation", () => {
  it("emits committed run transition events in order", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-observed" });
    const workflow = implementWorkflow({ name: "observed" }, () => "done");
    const events: string[] = [];

    engine.on("workflow:*", (event, name) => {
      if ("run" in event && "reason" in event) {
        events.push(`${name}:${event.run.id}:${event.reason}`);
      }
    });

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result.kind).toBe("completed");
    expect(events).toEqual([
      "workflow:run-created:run-observed:created",
      "workflow:run-started:run-observed:started",
      "workflow:run-completed:run-observed:completed",
    ]);
  });

  it("supports once, off, listeners, and listener counts", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-listeners" });
    const workflow = implementWorkflow({ name: "listeners" }, () => "done");
    const created = vi.fn<ObservationEventHandler<"workflow:run-created">>();
    const removed = vi.fn<ObservationEventHandler<"workflow:run-created">>();
    const completed = vi.fn<ObservationEventHandler<"workflow:run-completed">>();

    engine.on("workflow:run-created", created);
    engine.on("workflow:run-created", removed);
    engine.off("workflow:run-created", removed);
    engine.once("workflow:run-completed", completed);

    expect(engine.listenerCount("workflow:run-created")).toBe(1);
    expect(engine.listeners("workflow:run-completed")).toHaveLength(1);

    await engine.runWorkflowNow(workflow, undefined);
    await engine.runWorkflowNow(workflow, undefined, { start: { id: "run-listeners-2" } });

    expect(created).toHaveBeenCalledTimes(2);
    expect(removed).not.toHaveBeenCalled();
    expect(completed).toHaveBeenCalledTimes(1);

    engine.clearListeners("workflow:run-created");
    expect(engine.listenerCount("workflow:run-created")).toBe(0);
  });

  it("does not let observation listener failures change workflow results", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-failure-isolated" });
    const workflow = implementWorkflow({ name: "failure-isolated" }, () => "done");

    engine.on("workflow:run-created", () => {
      throw new Error("observer failed");
    });
    engine.on("workflow:run-completed", () => {
      throw new Error("observer failed");
    });

    const result = await engine.runWorkflowNow(workflow, undefined);

    if (result.kind !== "completed") {
      throw new Error("Expected workflow result to be completed");
    }
    expect(result.output).toBe("done");
  });

  it("emits metadata and cleanup events after operations commit", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-side-effects" });
    const workflow = implementWorkflow({ name: "side-effects" }, () => "done");
    const observed: string[] = [];

    engine.on("workflow:run-metadata-updated", (event, name) => {
      observed.push(`${name}:${event.run.id}:${String(event.run.metadata)}`);
    });
    engine.on("workflow:cleanup-completed", (event, name) => {
      observed.push(`${name}:${event.result.deletedRuns}`);
    });

    const handle = await engine.runWorkflow(workflow, undefined);
    await engine.updateRunMetadata(handle.runId, "ready");
    await engine.runWorkflowNow(workflow, undefined, { start: { id: "run-side-effects-2" } });
    await engine.cleanupRuns({
      finishedAtBefore: Temporal.Now.instant().add(Temporal.Duration.from({ milliseconds: 1 })),
      status: "completed",
    });

    expect(observed).toEqual([
      "workflow:run-metadata-updated:run-side-effects:ready",
      "workflow:cleanup-completed:1",
    ]);
  });

  it("emits durable append and stream update events", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run-durable" });
    const workflow = implementWorkflow({ name: "durable" }, async ({ step }) => {
      const stream = step.stream.create("progress");
      await stream.write("one");
      await stream.close();
      return "done";
    });
    const durableEvents: string[] = [];
    const attempts: string[] = [];
    const streamEvents: string[] = [];

    engine.on("workflow:durable-event-appended", (event) => {
      durableEvents.push(event.event.kind);
    });
    engine.on("workflow:step-attempt-updated", (event) => {
      attempts.push(`${event.attempt.stepName}:${event.attempt.status}`);
    });
    engine.on("workflow:stream-updated", (event) => {
      streamEvents.push(event.streamId);
    });

    const result = await engine.runWorkflowNow(workflow, undefined);

    expect(result.kind).toBe("completed");
    expect(durableEvents).toEqual([
      "workflow_started",
      "stream_started",
      "stream_chunk",
      "stream_closed",
      "workflow_completed",
    ]);
    expect(attempts).toEqual(["progress:running", "progress:completed"]);
    expect(streamEvents).toEqual(["progress", "progress", "progress"]);
  });

  it("emits message, hook resume, and webhook resume events", async () => {
    let runIndex = 0;
    const engine = createWorkflowEngine({
      createRunId: () => {
        runIndex++;
        return `run-message-${runIndex}`;
      },
    });
    const workflow = implementWorkflow({ name: "message-target" }, () => "ready");
    const messageEvents: string[] = [];
    const resumeEvents: string[] = [];

    engine.on("workflow:message-sent", (event) => {
      messageEvents.push(`${event.runId}:${event.messageId}:${String(event.payload)}`);
    });
    engine.on("workflow:hook-resumed", (event) => {
      resumeEvents.push(`hook:${event.runId}:${event.messageId}:${String(event.payload)}`);
    });
    engine.on("workflow:webhook-resumed", (event) => {
      resumeEvents.push(`webhook:${event.runId}:${event.messageId}:${String(event.payload)}`);
    });

    const direct = await engine.runWorkflow(workflow, undefined);
    await engine.sendMessage(direct.runId, { messageId: "direct", payload: "ok" });

    const hook = await engine.runWorkflow(workflow, undefined);
    await engine.resumeHook(hookToken(hook.runId, "approval", "approved"), {
      payload: "yes",
    });

    const webhook = await engine.runWorkflow(workflow, undefined);
    await engine.resumeWebhook(hookToken(webhook.runId, "incoming", "posted"), {
      payload: "body",
    });

    expect(messageEvents).toEqual([
      "run-message-1:direct:ok",
      "run-message-2:approved:yes",
      "run-message-3:posted:body",
    ]);
    expect(resumeEvents).toEqual([
      "hook:run-message-2:approved:yes",
      "webhook:run-message-3:posted:body",
    ]);
  });
});

function hookToken(runId: RunId, name: string, messageId: MessageId): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, runId, name, messageId })).toString(
    "base64url",
  );
  return `temelj-hook:v1:${payload}`;
}
