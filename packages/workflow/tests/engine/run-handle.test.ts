import { describe, expect, expectTypeOf, test } from "vitest";

import type { WorkflowRunHandle } from "../../src/types/client.ts";
import type { WorkflowClientEngine } from "../../src/types/engine.ts";
import type { WorkflowHandle } from "../../src/types/result.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow, defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowResultTimeoutError, WorkflowRunNotFoundError } from "../../src/errors/mod.ts";

describe("workflow run handle", () => {
  test("exposes run status, events, timeline, metadata, result, and cancellation", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_handle_facade" });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "run-handle-facade" });
    client.implementWorkflow(def, ({ step }) => step.task.run({ name: "work" }, () => "done"));

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
        expect.objectContaining({ kind: "step", status: "completed", stepName: "work" }),
      ]),
    });
    await expect(handle.getRun()).resolves.toMatchObject({
      metadata: { progress: "queued" },
    });
  });

  test("cancels pending runs through the run facade", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_handle_cancel" });
    const client = createWorkflowClient({ engine });
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
    const client = createWorkflowClient({ engine });
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
    const client = createWorkflowClient({ engine });
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
    const missingRunEngine = workflowClientEngineWithOverrides(engine, {
      async getRun() {
        return undefined;
      },
    });
    const client = createWorkflowClient({
      engine: missingRunEngine,
    });
    const def = defineWorkflow<undefined, string>({ name: "run-handle-missing-result" });

    const handle = await client.runs.start(def, undefined);

    await expect(handle.getRun()).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
    await expect(
      handle.result({
        timeout: Temporal.Duration.from({ milliseconds: 0 }),
        pollInterval: Temporal.Duration.from({ milliseconds: 0 }),
      }),
    ).rejects.toBeInstanceOf(WorkflowRunNotFoundError);
  });

  test("exposes direct engine run handles with current result semantics", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_engine_handle_facade" });
    const workflow = implementWorkflow<undefined, string>(
      { name: "engine-handle-facade" },
      ({ step }) => step.task.run({ name: "work" }, () => "done"),
    );

    const handle = await engine.runWorkflow(workflow, undefined);

    await expect(handle.status()).resolves.toBe("pending");
    await expect(handle.result()).resolves.toMatchObject({ kind: "waiting" });

    const updated = await handle.setMetadata({ progress: "queued" });
    expect(updated).toMatchObject({
      id: "run_engine_handle_facade",
      metadata: { progress: "queued" },
    });

    await expect(engine.resumeWorkflow(workflow, handle.runId)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await expect(handle.result()).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await expect(handle.events()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workflow_started" }),
        expect.objectContaining({ kind: "workflow_completed" }),
      ]),
    );
    await expect(handle.timeline()).resolves.toMatchObject({
      run: { id: "run_engine_handle_facade", status: "completed" },
      entries: expect.arrayContaining([
        expect.objectContaining({ kind: "step", stepName: "work", status: "completed" }),
      ]),
    });
    await expect(handle.getRun()).resolves.toMatchObject({
      metadata: { progress: "queued" },
    });
  });

  test("cancels direct engine runs through the run facade", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_engine_handle_cancel" });
    const workflow = implementWorkflow<undefined, string>(
      { name: "engine-handle-cancel" },
      () => "done",
    );

    const handle = await engine.runWorkflow(workflow, undefined);

    await expect(handle.cancel()).resolves.toMatchObject({
      id: "run_engine_handle_cancel",
      status: "canceled",
    });
    await expect(handle.status()).resolves.toBe("canceled");
    await expect(handle.result()).resolves.toMatchObject({ kind: "failed" });
  });

  test("preserves workflow output type on the run facade", () => {
    const client = createWorkflowClient();
    const def = defineWorkflow<{ readonly id: string }, { readonly ok: boolean }>({
      name: "typed-run-handle",
    });
    const runnable = client.workflow(def, ({ input }) => ({ ok: input.id.length > 0 }));

    expectTypeOf(runnable.run({ id: "user_1" })).toEqualTypeOf<
      Promise<WorkflowRunHandle<{ readonly ok: boolean }>>
    >();

    const workflow = implementWorkflow<{ readonly id: string }, { readonly ok: boolean }>(
      { name: "typed-engine-run-handle" },
      ({ input }) => ({ ok: input.id.length > 0 }),
    );
    const engine = createWorkflowEngine();

    expectTypeOf(engine.runWorkflow(workflow, { id: "user_1" })).toEqualTypeOf<
      Promise<WorkflowHandle<{ readonly ok: boolean }>>
    >();
  });
});

function workflowClientEngineWithOverrides(
  engine: WorkflowClientEngine,
  overrides: Partial<WorkflowClientEngine>,
): WorkflowClientEngine {
  return new Proxy(engine, {
    get(target, property, receiver) {
      if (property in overrides) {
        return Reflect.get(overrides, property, receiver);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
