import { ss } from "@temelj/standard-schema";
import { describe, expect, expectTypeOf, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowMessageIdempotencyConflictError } from "../../src/errors/mod.ts";
import { MessageId } from "../../src/types/message-id.ts";
import { RunId } from "../../src/types/run.ts";
import { parseWebhookToken, resumeWebhook } from "../../src/webhook.ts";

describe("workflow webhooks", () => {
  test("creates deterministic webhooks and resumes them through the client", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_webhook",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    let webhookToken = "";
    const workflow = implementWorkflow<undefined, string>(
      { name: "webhook-resume" },
      async ({ step }) => {
        const webhook = step.hook.createWebhook<{ readonly approved: boolean }>({
          name: "approval",
          messageId: "webhook.approval",
          timeout: Temporal.Duration.from({ hours: 1 }),
          metadata: { route: "/webhooks/approval" },
        });
        webhookToken = webhook.token;
        const payload = await webhook.wait();
        return payload.approved ? "approved" : "rejected";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    expect(parseWebhookToken(webhookToken)).toEqual({
      runId: "run_webhook",
      name: "approval",
      messageId: "webhook.approval",
    });

    await client.hooks.resumeWebhook(webhookToken, {
      payload: { approved: true },
      idempotencyKey: "approval_1",
    });
    await expect(engine.resumeWorkflow(workflow, "run_webhook")).resolves.toMatchObject({
      kind: "completed",
      output: "approved",
    });
  });

  test("resumes webhooks through the adapter helper", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_webhook_helper" });
    const client = createWorkflowClient({ engine });
    let webhookToken = "";
    const workflow = implementWorkflow<undefined, string>(
      { name: "webhook-helper" },
      async ({ step }) => {
        const webhook = step.hook.createWebhook<{ readonly status: string }>({ name: "callback" });
        webhookToken = webhook.token;
        const payload = await webhook;
        return payload.status;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    await resumeWebhook(client, webhookToken, { payload: { status: "ok" } });

    await expect(engine.resumeWorkflow(workflow, "run_webhook_helper")).resolves.toMatchObject({
      kind: "completed",
      output: "ok",
    });
  });

  test("deduplicates webhook callbacks with the same idempotency key", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_webhook_idempotency" });
    const client = createWorkflowClient({ engine });
    let webhookToken = "";
    const workflow = implementWorkflow<undefined, boolean>(
      { name: "webhook-idempotency" },
      async ({ step }) => {
        const webhook = step.hook.createWebhook<{ readonly approved: boolean }>({
          name: "approval",
        });
        webhookToken = webhook.token;
        const payload = await webhook;
        return payload.approved;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    await client.hooks.resumeWebhook(webhookToken, {
      payload: { approved: true },
      idempotencyKey: "approval_1",
    });
    await client.hooks.resumeWebhook(webhookToken, {
      payload: { approved: true },
      idempotencyKey: "approval_1",
    });

    const messageEvents = (await engine.getEvents("run_webhook_idempotency")).filter(
      (event) => event.kind === "message_sent",
    );
    expect(messageEvents).toHaveLength(1);
    await expect(engine.resumeWorkflow(workflow, "run_webhook_idempotency")).resolves.toMatchObject(
      {
        kind: "completed",
        output: true,
      },
    );
  });

  test("disposes waiting webhooks through the client", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_dispose_webhook" });
    const client = createWorkflowClient({ engine });
    let webhookToken = "";
    const workflow = implementWorkflow<undefined, boolean>(
      { name: "dispose-webhook" },
      async ({ step }) => {
        const webhook = step.hook.createWebhook<{ readonly approved: boolean }>({
          name: "approval",
        });
        webhookToken = webhook.token;
        const payload = await webhook;
        return payload.approved;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    await expect(client.hooks.disposeWebhook(webhookToken)).resolves.toMatchObject({
      kind: "webhook",
      status: "disposed",
      error: { name: "WorkflowHookDisposedError" },
    });
    const failed = await engine.resumeWorkflow(workflow, "run_dispose_webhook");

    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") {
      throw new Error("Expected disposed webhook to fail the run");
    }
    expect(failed.error.name).toBe("WorkflowHookDisposedError");
  });

  test("rejects conflicting webhook callbacks with the same idempotency key", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_webhook_conflict" });
    const client = createWorkflowClient({ engine });
    let webhookToken = "";
    const workflow = implementWorkflow<undefined, boolean>(
      { name: "webhook-conflict" },
      async ({ step }) => {
        const webhook = step.hook.createWebhook<{ readonly approved: boolean }>({
          name: "approval",
        });
        webhookToken = webhook.token;
        const payload = await webhook;
        return payload.approved;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    await client.hooks.resumeWebhook(webhookToken, {
      payload: { approved: true },
      idempotencyKey: "approval_1",
    });

    await expect(
      client.hooks.resumeWebhook(webhookToken, {
        payload: { approved: false },
        idempotencyKey: "approval_1",
      }),
    ).rejects.toThrow(WorkflowMessageIdempotencyConflictError);
  });

  test("validates webhook payloads with standard schemas", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_webhook_schema" });
    const client = createWorkflowClient({ engine });
    const schema = ss.object({ approved: ss.boolean() });
    let webhookToken = "";
    const workflow = implementWorkflow<undefined, boolean>(
      { name: "webhook-schema" },
      async ({ step }) => {
        const webhook = step.hook.createWebhook({
          name: "approval",
          schema,
        });
        webhookToken = webhook.token;
        const payload = await webhook.wait();
        expectTypeOf(payload).toEqualTypeOf<{ readonly approved: boolean }>();
        return payload.approved;
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    await client.hooks.resumeWebhook(webhookToken, { payload: { approved: "yes" } });
    const failed = await engine.resumeWorkflow(workflow, "run_webhook_schema");

    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") {
      throw new Error("Expected webhook schema validation to fail");
    }
    expect(failed.error.message).toContain("Workflow message validation failed");
  });

  test("exposes webhook types through the step API", () => {
    implementWorkflow<undefined, void>({ name: "webhook-types" }, ({ step }) => {
      const webhook = step.hook.createWebhook({
        name: "typed",
        schema: ss.object({ approved: ss.boolean() }),
      });
      expectTypeOf(webhook.token).toEqualTypeOf<string>();
      expectTypeOf(webhook.metadata).toEqualTypeOf<unknown>();
      expectTypeOf(webhook.wait()).toEqualTypeOf<Promise<{ readonly approved: boolean }>>();
    });
    expectTypeOf<ReturnType<typeof parseWebhookToken>>().toEqualTypeOf<{
      readonly runId: RunId;
      readonly name: string;
      readonly messageId: MessageId;
    }>();
  });
});
