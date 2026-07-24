import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { makeGeneratedName } from "../../src/vite.ts";
import { compileWorkflowDirectiveFixtures } from "../directive-fixtures.ts";
import {
  requireNoDuplicateWorkflowEventsAfterReplay,
  readStream,
  resumeWebhook,
  resumeHook,
  wakeWorkflowRun,
  waitForHook,
  waitForWorkflowSleep,
} from "../utility.ts";

describe("workflow test utilities", () => {
  test("waits for an active workflow sleep using public handle inspection", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_test_utils_sleep",
      now: () => now,
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "test-utils-sleep" },
      async ({ step }) => {
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        return "done";
      },
    );

    const handle = await engine.runWorkflow(workflow, undefined);
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "waiting",
    });

    await expect(waitForWorkflowSleep(handle, { name: "pause" })).resolves.toMatchObject({
      kind: "sleep",
      status: "started",
      stepId: "sleep:pause",
      stepName: "pause",
      until: Temporal.Instant.from("2026-06-11T10:00:01Z"),
    });

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
  });

  test("wakes one due workflow run through the client helper", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_test_utils_wake" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, string>(
      { name: "test-utils-wake" },
      () => "done",
    );
    client.register(workflow);

    const handle = await client.runs.start(workflow, undefined);

    await expect(wakeWorkflowRun(client, handle)).resolves.toEqual({ processedRuns: 1 });
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("done");
  });

  test("wakes the supplied run handle when multiple matching runs are due", async () => {
    const runIds = ["run_test_utils_wake_first", "run_test_utils_wake_second"];
    const engine = createWorkflowEngine({
      createRunId: () => {
        const runId = runIds.shift();
        if (runId === undefined) {
          throw new Error("Unexpected run id allocation");
        }
        return runId;
      },
    });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, string>(
      { name: "test-utils-wake-specific" },
      () => "done",
    );
    client.register(workflow);

    const first = await client.runs.start(workflow, undefined);
    const second = await client.runs.start(workflow, undefined);

    await expect(wakeWorkflowRun(client, second)).resolves.toEqual({ processedRuns: 1 });
    await expect(
      second.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("done");
    await expect(engine.getRun(first.runId)).resolves.toMatchObject({ status: "pending" });
  });

  test("waits for and resumes an active workflow hook", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_test_utils_hook" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, string>(
      { name: "test-utils-hook" },
      async ({ step }) => {
        const hook = step.hook.create<{ readonly approved: boolean }>({
          name: "approval",
          messageId: "approval.received",
        });
        const payload = await hook;
        return payload.approved ? "approved" : "rejected";
      },
    );

    const handle = await engine.runWorkflow(workflow, undefined);
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "waiting",
    });
    const hook = await waitForHook(handle, { name: "approval" });

    expect(hook).toMatchObject({
      kind: "message",
      status: "waiting",
      stepId: "message-wait:approval",
      stepName: "approval",
      messageId: "approval.received",
    });

    await resumeHook(client, hook, handle.runId, {
      payload: { approved: true },
      idempotencyKey: "approval_1",
    });
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "approved",
    });
  });

  test("resumes webhooks and reads streams through public test helpers", async () => {
    let webhookToken: string | undefined;
    const engine = createWorkflowEngine({ createRunId: () => "run_test_utils_web_stream" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, string>(
      { name: "test-utils-web-stream" },
      async ({ step }) => {
        const stream = step.stream.create<{ readonly message: string }>("updates");
        await stream.write({ message: "waiting" });
        const webhook = step.hook.createWebhook<{ readonly approved: boolean }>({
          name: "approval",
          messageId: "approval.webhook",
        });
        webhookToken = webhook.token;
        const payload = await webhook;
        await stream.write({ message: payload.approved ? "approved" : "rejected" });
        await stream.close();
        return payload.approved ? "approved" : "rejected";
      },
    );

    const handle = await engine.runWorkflow(workflow, undefined);
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "waiting",
    });
    if (webhookToken === undefined) {
      throw new Error("Expected webhook token");
    }
    await expect(
      readStream<{ readonly message: string }>(client, handle.runId, "updates"),
    ).resolves.toMatchObject({
      status: "open",
      chunks: [{ index: 0, value: { message: "waiting" } }],
    });

    await resumeWebhook(client, webhookToken, {
      payload: { approved: true },
      idempotencyKey: "approval_1",
    });
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "approved",
    });
    await expect(
      readStream<{ readonly message: string }>(client, handle.runId, "updates", {
        fromIndex: 1,
      }),
    ).resolves.toMatchObject({
      status: "closed",
      chunks: [{ index: 1, value: { message: "approved" } }],
    });
  });

  test("asserts replay does not append duplicate durable events", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_test_utils_replay" });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<undefined, string>(
      { name: "test-utils-replay" },
      async ({ step }) => {
        await step.task.run({ name: "once" }, () => "done");
        return "done";
      },
    );

    const handle = await engine.runWorkflow(workflow, undefined);
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });

    await expect(
      requireNoDuplicateWorkflowEventsAfterReplay(
        client,
        handle,
        async () => await engine.resumeWorkflow(workflow, handle.runId),
      ),
    ).resolves.toBeUndefined();
  });

  test("compiles directive fixtures with manifests from previous fixtures", () => {
    const [steps, workflow] = compileWorkflowDirectiveFixtures(
      [
        {
          id: "/repo/steps.ts",
          code: `
export async function double(input: number) {
  "use step";
  return input * 2;
}
`,
        },
        {
          id: "/repo/workflows.ts",
          code: `
import { double } from "./steps.ts";

export async function calculate(input: number) {
  "use workflow";
  return await double(input);
}
`,
        },
      ],
      { root: "/repo" },
    );

    expect(steps?.result?.manifest.functions).toMatchObject([
      { kind: "step", exportName: "double" },
    ]);
    expect(workflow?.result?.manifest.imports).toMatchObject([
      { source: "steps.ts", importName: "double", localName: "double", kind: "step" },
    ]);
    expect(workflow?.result?.code).toContain(makeGeneratedName("callWorkflowStepFunction"));
  });

  test("reports observed timeline state when a wait times out", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_test_utils_timeout" });
    const workflow = implementWorkflow<undefined, string>(
      { name: "test-utils-timeout" },
      async ({ step }) => {
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        return "done";
      },
    );

    const handle = await engine.runWorkflow(workflow, undefined);
    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "waiting",
    });

    await expect(
      waitForHook(handle, {
        name: "missing",
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toThrow(
      "Timed out waiting for workflow hook in run run_test_utils_timeout; expected name missing",
    );
    await expect(
      waitForHook(handle, {
        name: "missing",
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toThrow(
      "Timed out waiting for workflow hook in run run_test_utils_timeout; expected name missing",
    );
  });
});
