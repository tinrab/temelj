import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import {
  WorkflowErrorCode,
  WorkflowHookDisposedError,
  WorkflowHookError,
} from "../../src/errors/mod.ts";

describe("workflow hooks", () => {
  test("creates deterministic hooks and resumes them through the client", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_hook",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    let hookToken = "";
    const workflow = implementWorkflow<undefined, string>(
      { name: "hook-resume" },
      async ({ step }) => {
        const hook = step.hook.create<{ readonly approved: boolean }>({
          name: "approval",
          messageId: "approval.received",
          timeout: Temporal.Duration.from({ hours: 1 }),
        });
        hookToken = hook.token;
        const payload = await hook.wait();
        return payload.approved ? "approved" : "rejected";
      },
    );

    const waiting = await engine.runWorkflowNow(workflow, undefined);

    expect(waiting.kind).toBe("waiting");
    expect(hookToken).toBe(
      "temelj-hook:v1:eyJ2IjoxLCJydW5JZCI6InJ1bl9ob29rIiwibmFtZSI6ImFwcHJvdmFsIiwibWVzc2FnZUlkIjoiYXBwcm92YWwucmVjZWl2ZWQifQ",
    );

    await client.hooks.resume(hookToken, {
      payload: { approved: true },
      idempotencyKey: "approval_1",
    });
    const completed = await engine.resumeWorkflow(workflow, "run_hook");

    expect(completed).toMatchObject({
      kind: "completed",
      output: "approved",
    });
    await expect(engine.getEvents("run_hook")).resolves.toMatchObject([
      { kind: "workflow_started" },
      {
        kind: "message_wait_started",
        stepId: "message-wait:approval",
        messageId: "approval.received",
        timeoutAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      },
      {
        kind: "message_sent",
        messageId: "approval.received",
        idempotencyKey: "approval_1",
        waiterStepIds: ["message-wait:approval"],
      },
      { kind: "workflow_started" },
      {
        kind: "message_wait_completed",
        stepId: "message-wait:approval",
        messageId: "approval.received",
      },
      { kind: "workflow_completed" },
    ]);
  });

  test("validates hook tokens", async () => {
    const engine = createWorkflowEngine();
    const client = createWorkflowClient({ engine });

    await expect(client.hooks.resume("bad-token")).rejects.toMatchObject({
      name: "WorkflowHookError",
      code: WorkflowErrorCode.HOOK_TOKEN_INVALID,
    });
    await expect(client.hooks.resume("bad-token")).rejects.toBeInstanceOf(WorkflowHookError);
    await expect(client.hooks.dispose("bad-token")).rejects.toMatchObject({
      name: "WorkflowHookError",
      code: WorkflowErrorCode.HOOK_TOKEN_INVALID,
    });
  });

  test("disposes waiting hooks durably and wakes the run", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_dispose_hook",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    let hookToken = "";
    const workflow = implementWorkflow<undefined, string>(
      { name: "dispose-hook" },
      async ({ step }) => {
        const hook = step.hook.create<{ readonly approved: boolean }>({
          name: "approval",
          messageId: "approval.received",
          timeout: Temporal.Duration.from({ hours: 1 }),
        });
        hookToken = hook.token;
        const payload = await hook.wait();
        return payload.approved ? "approved" : "rejected";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    await expect(client.hooks.dispose(hookToken)).resolves.toMatchObject({
      status: "disposed",
      stepId: "message-wait:approval",
      error: { name: "WorkflowHookDisposedError" },
    });
    await expect(client.hooks.getByToken(hookToken)).resolves.toMatchObject({
      status: "disposed",
      error: { name: "WorkflowHookDisposedError" },
    });
    const failed = await engine.resumeWorkflow(workflow, "run_dispose_hook");

    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") {
      throw new Error("Expected disposed hook to fail the run");
    }
    expect(failed.error.name).toBe("WorkflowHookDisposedError");
    expect(failed.error.message).toContain("Workflow hook disposed");
    expect(await engine.getRun("run_dispose_hook")).toMatchObject({
      status: "failed",
      error: { name: "WorkflowHookDisposedError" },
    });
    await expect(engine.getEvents("run_dispose_hook")).resolves.toMatchObject([
      { kind: "workflow_started" },
      {
        kind: "message_wait_started",
        stepId: "message-wait:approval",
        messageId: "approval.received",
      },
      {
        kind: "message_wait_failed",
        stepId: "message-wait:approval",
        messageId: "approval.received",
        error: { name: "WorkflowHookDisposedError" },
      },
      { kind: "workflow_started" },
      { kind: "workflow_failed" },
    ]);
  });

  test("disposes hooks idempotently after terminal disposal", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_dispose_hook_idempotent" });
    const client = createWorkflowClient({ engine });
    let hookToken = "";
    const workflow = implementWorkflow<undefined, void>(
      { name: "dispose-hook-idempotent" },
      async ({ step }) => {
        hookToken = step.hook.create({ name: "approval" }).token;
        await step.message.wait({ name: "approval", messageId: "approval" });
      },
    );

    await engine.runWorkflowNow(workflow, undefined);
    await client.hooks.dispose(hookToken);
    await client.hooks.dispose(hookToken);

    const failedWaits = (await engine.getEvents("run_dispose_hook_idempotent")).filter(
      (event) => event.kind === "message_wait_failed",
    );
    expect(failedWaits).toHaveLength(1);
    expect(failedWaits[0]).toMatchObject({
      error: { name: "WorkflowHookDisposedError" },
    });
  });

  test("reports missing hooks as not found during disposal", async () => {
    const engine = createWorkflowEngine();
    const client = createWorkflowClient({ engine });
    const token =
      "temelj-hook:v1:eyJ2IjoxLCJydW5JZCI6InJ1bl9taXNzaW5nX2hvb2siLCJuYW1lIjoiYXBwcm92YWwiLCJtZXNzYWdlSWQiOiJhcHByb3ZhbCJ9";

    await expect(client.hooks.dispose(token)).resolves.toMatchObject({
      runId: "run_missing_hook",
      status: "not-found",
    });
  });

  test("recreates disposed hook errors from persisted records", () => {
    const error = WorkflowHookDisposedError.create({
      runId: "run_disposed",
      stepId: "message-wait:approval",
      stepName: "approval",
      messageId: "approval",
    });

    expect(error.name).toBe("WorkflowHookDisposedError");
  });

  test("resumes encoded hook tokens", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_encoded_hook",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, string>(
      { name: "encoded-hook-resume" },
      async ({ step }) => {
        const hook = step.hook.create<{ readonly approved: boolean }>({
          name: "approval",
          messageId: "approval.received",
        });
        const payload = await hook.wait();
        return payload.approved ? "approved" : "rejected";
      },
    );

    await engine.runWorkflowNow(workflow, undefined);
    await client.hooks.resume(
      "temelj-hook:v1:eyJ2IjoxLCJydW5JZCI6InJ1bl9lbmNvZGVkX2hvb2siLCJuYW1lIjoiYXBwcm92YWwiLCJtZXNzYWdlSWQiOiJhcHByb3ZhbC5yZWNlaXZlZCJ9",
      { payload: { approved: true } },
    );

    await expect(engine.resumeWorkflow(workflow, "run_encoded_hook")).resolves.toMatchObject({
      kind: "completed",
      output: "approved",
    });
  });

  test("awaits workflow hooks directly", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_awaitable_hook",
    });
    const client = createWorkflowClient({ engine });
    let hookToken = "";
    const workflow = implementWorkflow<undefined, string>(
      { name: "awaitable-hook" },
      async ({ step }) => {
        const hook = step.hook.create<{ readonly approved: boolean }>({
          name: "approval",
        });
        hookToken = hook.token;
        const payload = await hook;
        return payload.approved ? "approved" : "rejected";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    await client.hooks.resume(hookToken, { payload: { approved: true } });

    await expect(engine.resumeWorkflow(workflow, "run_awaitable_hook")).resolves.toMatchObject({
      kind: "completed",
      output: "approved",
    });
  });

  test("summarizes active hook waits from durable message wait events", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_hook_summary",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<undefined, void>(
      { name: "hook-summary" },
      async ({ step }) => {
        const hook = step.hook.create<{ readonly approved: boolean }>({
          name: "approval",
          messageId: "approval.received",
          timeout: Temporal.Duration.from({ hours: 1 }),
        });
        const webhook = step.hook.createWebhook<{ readonly ok: boolean }>({
          name: "callback",
          messageId: "callback.received",
        });
        await Promise.all([hook.wait(), webhook.wait()]);
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    await expect(engine.getRunSummary()).resolves.toMatchObject({
      hook: {
        activeHooks: 1,
        activeWebhooks: 1,
        activeHookRuns: 1,
        hookRunIds: ["run_hook_summary"],
        hookStepIds: ["message-wait:approval", "message-wait:callback"],
        hookNames: ["approval"],
        webhookNames: ["callback"],
        messages: ["approval.received", "callback.received"],
        oldestStartedAt: Temporal.Instant.from("2026-06-11T10:00:00Z"),
        nextTimeoutAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
        nextTimeoutRunId: "run_hook_summary",
        nextTimeoutStepId: "message-wait:approval",
      },
    });
  });

  test("rejects duplicate hook tokens within one run", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_duplicate_hook_token",
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "duplicate-hook-token" },
      async ({ step }) => {
        step.hook.create({ name: "approval", messageId: "approval.received" });
        step.hook.create({ name: "approval", messageId: "approval.received" });
        return "unreachable";
      },
    );

    const failed = await engine.runWorkflowNow(workflow, undefined);

    expect(failed.kind).toBe("failed");
    if (failed.kind !== "failed") {
      throw new Error("Expected duplicate hook token to fail");
    }
    expect(failed.error.message).toBe("Workflow hook token must be unique within a run: approval");
  });

  test("resumes hooks idempotently with deterministic tokens", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_hook_idempotency",
    });
    const client = createWorkflowClient({ engine });
    let hookToken = "";
    const workflow = implementWorkflow<undefined, string>(
      { name: "hook-idempotency" },
      async ({ step }) => {
        const hook = step.hook.create<{ readonly approved: boolean }>({
          name: "approval",
          messageId: "approval.received",
        });
        hookToken = hook.token;
        const payload = await hook;
        return payload.approved ? "approved" : "rejected";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });
    await client.hooks.resume(hookToken, {
      payload: { approved: true },
      idempotencyKey: "approval_1",
    });
    await client.hooks.resume(hookToken, {
      payload: { approved: true },
      idempotencyKey: "approval_1",
    });

    await expect(engine.resumeWorkflow(workflow, "run_hook_idempotency")).resolves.toMatchObject({
      kind: "completed",
      output: "approved",
    });
    const messageEvents = (await engine.getEvents("run_hook_idempotency")).filter(
      (event) => event.kind === "message_sent",
    );
    expect(messageEvents).toHaveLength(1);
  });

  test("rejects hook name replay divergence", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_hook_name_divergence",
    });
    const client = createWorkflowClient({ engine });
    let hookName = "approval";
    let hookToken = "";
    const workflow = implementWorkflow<undefined, string>(
      { name: "hook-name-divergence" },
      async ({ step }) => {
        const hook = step.hook.create<{ readonly approved: boolean }>({
          name: hookName,
          messageId: "approval.received",
        });
        hookToken = hook.token;
        const payload = await hook.wait();
        return payload.approved ? "approved" : "rejected";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    hookName = "renamed-approval";
    await client.hooks.resume(hookToken, { payload: { approved: true } });
    const result = await engine.resumeWorkflow(workflow, "run_hook_name_divergence");

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") {
      throw new Error("Expected hook name replay divergence");
    }
    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
  });

  test("rejects hook message replay divergence", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_hook_message_divergence",
    });
    const client = createWorkflowClient({ engine });
    let messageId = "approval.received";
    let hookToken = "";
    const workflow = implementWorkflow<undefined, string>(
      { name: "hook-message-divergence" },
      async ({ step }) => {
        const hook = step.hook.create<{ readonly approved: boolean }>({
          name: "approval",
          messageId: messageId,
        });
        hookToken = hook.token;
        const payload = await hook.wait();
        return payload.approved ? "approved" : "rejected";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    messageId = "approval.changed";
    await client.hooks.resume(hookToken, { payload: { approved: true } });
    const result = await engine.resumeWorkflow(workflow, "run_hook_message_divergence");

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") {
      throw new Error("Expected hook message replay divergence");
    }
    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
  });
});
