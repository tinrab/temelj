import { describe, expect, expectTypeOf, test } from "vitest";

import type { WorkflowRunHandle } from "../types/client.ts";
import type { RunRef } from "./start.ts";

import { clientForEngine, createWorkflowClient } from "../client/create.ts";
import { implementWorkflow, defineWorkflow } from "../definition.ts";
import { WorkflowResultTimeoutError, WorkflowRunNotFoundError } from "../errors/mod.ts";
import { makeRunKey } from "../store-keys.ts";
import { createWorkflowEngine } from "./create.ts";

describe("workflow run handle", () => {
  test("exposes run status, events, timeline, metadata, result, and cancellation", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_handle_facade" });
    const client = clientForEngine(engine);
    const def = defineWorkflow<undefined, string>({ name: "run-handle-facade" });
    client.implementWorkflow(def, ({ step }) => step.run({ name: "work" }, () => "done"));

    const handle = await client.runs.start(def, undefined);

    await expect(handle.status()).resolves.toBe("pending");
    await expect(handle.getRun()).resolves.toMatchObject({
      id: "run_handle_facade",
      workflowName: "run-handle-facade",
      status: "pending",
    });
    await expect(handle.events()).resolves.toEqual([]);

    const updated = await handle.setMetadata({ progress: "queued" });
    expect(updated).toMatchObject({
      id: "run_handle_facade",
      metadata: { progress: "queued" },
    });

    await client.workers.wakeDueRuns();

    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).resolves.toBe("done");
    await expect(handle.status()).resolves.toBe("completed");
    await expect(handle.events()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workflow_started" }),
        expect.objectContaining({ kind: "step_completed", stepName: "work" }),
        expect.objectContaining({ kind: "workflow_completed" }),
      ]),
    );
    await expect(handle.timeline()).resolves.toMatchObject({
      run: { id: "run_handle_facade", status: "completed" },
      entries: expect.arrayContaining([
        expect.objectContaining({
          kind: "step",
          status: "completed",
          event: expect.objectContaining({ stepName: "work" }),
        }),
      ]),
    });
    await expect(handle.getRun()).resolves.toMatchObject({
      metadata: { progress: "queued" },
    });
  });

  test("cancels pending runs through the run facade", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_handle_cancel" });
    const client = clientForEngine(engine);
    const def = defineWorkflow<undefined, string>({ name: "run-handle-cancel" });
    client.implementWorkflow(def, () => "done");

    const handle = await client.runs.start(def, undefined);

    await expect(handle.cancel()).resolves.toMatchObject({
      id: "run_handle_cancel",
      status: "canceled",
    });
    await expect(handle.status()).resolves.toBe("canceled");
  });

  test("rejects failed client run results through the run facade", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_handle_failed_result" });
    const client = clientForEngine(engine);
    const def = defineWorkflow<undefined, string>({ name: "run-handle-failed-result" });
    client.implementWorkflow(def, () => {
      throw new Error("workflow failed");
    });

    const handle = await client.runs.start(def, undefined);
    await client.workers.wakeDueRuns();

    await expect(handle.status()).resolves.toBe("failed");
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toThrow("workflow failed");
  });

  test("times out pending client run results through the run facade", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_handle_result_timeout" });
    const client = clientForEngine(engine);
    const def = defineWorkflow<undefined, string>({ name: "run-handle-result-timeout" });
    client.implementWorkflow(def, () => "done");

    const handle = await client.runs.start(def, undefined);

    await expect(handle.status()).resolves.toBe("pending");
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toBeInstanceOf(WorkflowResultTimeoutError);
  });

  test("rejects missing client run results through the run facade", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_handle_missing_result" });

    const client = clientForEngine(engine);

    const def = defineWorkflow<undefined, string>({ name: "run-handle-missing-result" });

    const handle = await client.runs.start(def, undefined);

    await engine.storage.delete(makeRunKey(engine.store.namespace, handle.runId));

    await expect(handle.getRun()).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
  });

  test("preserves workflow output type on the run facade", () => {
    const client = createWorkflowClient();

    const def = defineWorkflow<{ readonly id: string }, { readonly ok: boolean }>({
      name: "typed-run-handle",
    });

    const runnable = client.implementWorkflow(def, ({ input }) => ({ ok: input.id.length > 0 }));

    expectTypeOf(client.runs.start(runnable, { id: "user_1" })).toEqualTypeOf<
      Promise<WorkflowRunHandle<{ readonly ok: boolean }>>
    >();

    const workflow = implementWorkflow<{ readonly id: string }, { readonly ok: boolean }>(
      { name: "typed-engine-run-handle" },
      ({ input }) => ({ ok: input.id.length > 0 }),
    );

    const engine = createWorkflowEngine();

    expectTypeOf(engine.runWorkflow(workflow, { id: "user_1" })).toEqualTypeOf<
      Promise<RunRef<{ readonly ok: boolean }>>
    >();
  });
});
