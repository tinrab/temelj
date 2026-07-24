import { describe, expect, it } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowOptionsError } from "../../src/errors/mod.ts";

describe("workflow hook inspection", () => {
  it("inspects waiting and completed hooks by token", async () => {
    let token = "";
    const engine = createWorkflowEngine({ createRunId: () => "run-hook-inspection" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow({ name: "hook-inspection" }, async ({ step }) => {
      const hook = step.hook.create<string>({ name: "approval", messageId: "approved" });
      token = hook.token;
      return await hook;
    });

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    await expect(client.hooks.getByToken(token)).resolves.toMatchObject({
      token,
      runId: "run-hook-inspection",
      name: "approval",
      messageId: "approved",
      kind: "hook",
      status: "waiting",
      stepId: "message-wait:approval",
    });

    await engine.resumeHook(token, { payload: "yes" });
    await expect(engine.resumeWorkflow(workflow, "run-hook-inspection")).resolves.toMatchObject({
      kind: "completed",
    });

    await expect(engine.getHookByToken(token)).resolves.toMatchObject({
      status: "completed",
      payload: "yes",
    });
  });

  it("inspects webhook token metadata", async () => {
    let token = "";
    const engine = createWorkflowEngine({ createRunId: () => "run-webhook-inspection" });
    const workflow = implementWorkflow({ name: "webhook-inspection" }, async ({ step }) => {
      const webhook = step.hook.createWebhook<{ ok: true }>({
        name: "incoming",
        messageId: "posted",
        metadata: { route: "/hooks/incoming" },
      });
      token = webhook.token;
      return await webhook;
    });

    await engine.runWorkflowNow(workflow, undefined);

    await expect(engine.getHookByToken(token)).resolves.toMatchObject({
      kind: "webhook",
      status: "waiting",
      metadata: { route: "/hooks/incoming" },
    });

    await engine.resumeWebhook(token, { payload: { ok: true } });
    await engine.resumeWorkflow(workflow, "run-webhook-inspection");

    await expect(engine.getHookByToken(token)).resolves.toMatchObject({
      kind: "webhook",
      status: "completed",
      payload: { ok: true },
      metadata: { route: "/hooks/incoming" },
    });
  });

  it("reports missing and expired hooks", async () => {
    let now = Temporal.Instant.from("2025-01-01T00:00:00Z");
    let token = "";
    const engine = createWorkflowEngine({
      createRunId: () => "run-expired-hook",
      now: () => now,
    });
    const workflow = implementWorkflow({ name: "expired-hook" }, async ({ step }) => {
      const hook = step.hook.create({
        name: "approval",
        timeout: Temporal.Duration.from({ milliseconds: 10 }),
      });
      token = hook.token;
      return await hook;
    });

    await engine.runWorkflowNow(workflow, undefined);
    now = Temporal.Instant.from("2025-01-01T00:00:00.011Z");

    await expect(engine.getHookByToken(token)).resolves.toMatchObject({
      status: "expired",
      timeoutAt: Temporal.Instant.from("2025-01-01T00:00:00.010Z"),
    });
    await expect(
      engine.getHookByToken(
        "temelj-hook:v1:eyJ2IjoxLCJydW5JZCI6Im1pc3NpbmciLCJuYW1lIjoiYSIsIm1lc3NhZ2VJZCI6ImEifQ",
      ),
    ).resolves.toMatchObject({
      runId: "missing",
      status: "not-found",
    });
  });

  it("reports failed and run-terminal hooks", async () => {
    let now = Temporal.Instant.from("2025-01-01T00:00:00Z");
    let failedToken = "";
    const failedEngine = createWorkflowEngine({
      createRunId: () => "run-failed-hook",
      now: () => now,
    });
    const failedWorkflow = implementWorkflow({ name: "failed-hook" }, async ({ step }) => {
      const hook = step.hook.create({
        name: "approval",
        timeout: Temporal.Duration.from({ milliseconds: 10 }),
      });
      failedToken = hook.token;
      return await hook;
    });

    await failedEngine.runWorkflowNow(failedWorkflow, undefined);
    now = Temporal.Instant.from("2025-01-01T00:00:00.011Z");
    await failedEngine.resumeWorkflow(failedWorkflow, "run-failed-hook");

    await expect(failedEngine.getHookByToken(failedToken)).resolves.toMatchObject({
      status: "failed",
      error: {
        name: "WorkflowMessageWaitTimeoutError",
      },
    });

    let terminalToken = "";
    const terminalEngine = createWorkflowEngine({ createRunId: () => "run-terminal-hook" });
    const terminalWorkflow = implementWorkflow({ name: "terminal-hook" }, async ({ step }) => {
      const hook = step.hook.create({ name: "approval" });
      terminalToken = hook.token;
      return await hook;
    });

    await terminalEngine.runWorkflowNow(terminalWorkflow, undefined);
    await terminalEngine.cancelRun("run-terminal-hook");

    await expect(terminalEngine.getHookByToken(terminalToken)).resolves.toMatchObject({
      status: "run-terminal",
    });
  });

  it("ignores stale hook terminal events before the latest wait", async () => {
    const token = hookToken("run-hook-stale-terminal", "approval", "approved");
    const engine = createWorkflowEngine({ createRunId: () => "run-hook-stale-terminal" });
    await engine.store.createRun({
      id: "run-hook-stale-terminal",
      namespace: engine.store.namespace,
      workflowName: "hook-stale-terminal",
      status: "waiting",
      createdAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      updatedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      availableAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      lastTransitionAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      lastTransitionReason: "created",
    });
    await engine.store.appendEvent("run-hook-stale-terminal", {
      kind: "message_wait_failed",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "message-wait:approval",
      stepName: "approval",
      messageId: "approved",
      error: { name: "Error", message: "stale failure" },
    });
    await engine.store.appendEvent("run-hook-stale-terminal", {
      kind: "message_wait_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:01:00Z"),
      stepId: "message-wait:approval",
      stepName: "approval",
      count: 1,
      messageId: "approved",
      source: "hook",
    });

    await expect(engine.getHookByToken(token)).resolves.toMatchObject({
      status: "waiting",
      stepId: "message-wait:approval",
    });
  });

  it("rejects invalid hook tokens", async () => {
    const engine = createWorkflowEngine();

    await expect(engine.getHookByToken("not-a-token")).rejects.toBeInstanceOf(WorkflowOptionsError);
  });
});

function hookToken(runId: string, name: string, messageId: string): string {
  const payload = Buffer.from(JSON.stringify({ v: 1, runId, name, messageId })).toString(
    "base64url",
  );
  return `temelj-hook:v1:${payload}`;
}
