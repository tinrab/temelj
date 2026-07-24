import { describe, expect, test } from "vitest";

import type { WorkflowLifecycleEvent } from "../../src/types/run.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow, defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { Registry } from "../../src/registry.ts";
import { sequentialRunIds } from "../utility.ts";

describe("workflow lifecycle operations", () => {
  test("starts with a resolved workflow version and persists the exact identity", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_resolved_version" });
    const def = defineWorkflow<undefined, string>({ name: "resolved-version" });

    const handle = await engine.startWorkflow(def, undefined, {
      workflowVersionResolver: () => "2",
    });

    expect(handle).toMatchObject({
      runId: "run_resolved_version",
      workflowName: "resolved-version",
      workflowVersion: "2",
    });
    await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
      workflowName: "resolved-version",
      workflowVersion: "2",
    });
  });

  test("uses registry latest-version lookup for client starts", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_registry_latest" });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });
    const def = defineWorkflow<undefined, string>({ name: "registry-latest" });

    client.implementWorkflow(
      defineWorkflow<undefined, string>({ name: "registry-latest", version: "1" }),
      () => "old",
    );
    client.implementWorkflow(
      defineWorkflow<undefined, string>({ name: "registry-latest", version: "2" }),
      () => "new",
    );

    expect(registry.latest("registry-latest")?.version).toBe("2");
    const handle = await client.runs.start(def, undefined, {
      workflowVersionResolver: (workflowName) => registry.latest(workflowName)?.version,
    });
    await client.workers.processRun(handle.runId);

    await expect(handle.result()).resolves.toBe("new");
    await expect(engine.getRun(handle.runId)).resolves.toMatchObject({
      workflowName: "registry-latest",
      workflowVersion: "2",
      status: "completed",
      output: "new",
    });
  });

  test("fails predictably when registry latest version is missing", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_missing_latest" });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });
    const def = defineWorkflow<undefined, string>({ name: "missing-latest" });

    expect(registry.latest("missing-latest")?.version).toBe(undefined);
    const handle = await client.runs
      .start(def, undefined, {
        workflowVersionResolver: (workflowName) => {
          const version = registry.latest(workflowName)?.version;
          if (version === undefined) {
            throw new Error(`No workflow versions registered for ${workflowName}`);
          }
          return version;
        },
      })
      .catch((error: unknown) => error);

    expect(handle).toBeInstanceOf(Error);
    expect((handle as Error).message).toBe("No workflow versions registered for missing-latest");
  });

  test("reruns a workflow from stored input and context", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_original", "run_rerun"),
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const client = createWorkflowClient({ engine });
    const workflow = implementWorkflow<{ readonly userId: string }, string>(
      { name: "rerun-workflow", version: "1" },
      ({ input }) => input.userId,
    );

    const original = await client.runs.start(
      workflow,
      { userId: "user_1" },
      {
        context: { source: "original" },
        idempotencyKey: "original",
      },
    );
    await engine.resumeWorkflow(workflow, original.runId);

    const rerun = await client.admin.rerun(original.runId, {
      start: {
        idempotencyKey: "rerun",
        availableAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      },
    });

    expect(rerun.runId).toBe("run_rerun");
    await expect(engine.getRun(rerun.runId)).resolves.toMatchObject({
      workflowName: "rerun-workflow",
      workflowVersion: "1",
      input: { userId: "user_1" },
      context: { source: "original" },
      idempotencyKey: "rerun",
      availableAt: Temporal.Instant.from("2026-06-11T11:00:00Z"),
      status: "pending",
    });
  });

  test("reruns onto an explicitly selected workflow identity", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_old_version", "run_latest_version"),
    });
    const oldSpec = defineWorkflow<{ readonly orderId: string }, string>({
      name: "rerun-versioned",
      version: "1",
    });

    const original = await engine.startWorkflow(oldSpec, { orderId: "order_1" });
    const rerun = await engine.rerunWorkflow(original.runId, {
      workflowName: "rerun-versioned",
      workflowVersion: "2",
      start: { idempotencyKey: "order_1:v2" },
    });

    expect(rerun).toMatchObject({
      runId: "run_latest_version",
      workflowName: "rerun-versioned",
      workflowVersion: "2",
    });
    await expect(engine.getRun(rerun.runId)).resolves.toMatchObject({
      workflowName: "rerun-versioned",
      workflowVersion: "2",
      input: { orderId: "order_1" },
      idempotencyKey: "order_1:v2",
    });
  });

  test("reruns can explicitly clear a stored workflow version", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_versioned_source", "run_unversioned_rerun"),
    });
    const source = defineWorkflow<{ readonly orderId: string }, string>({
      name: "rerun-clear-version",
      version: "1",
    });

    const original = await engine.startWorkflow(source, { orderId: "order_1" });
    const rerun = await engine.rerunWorkflow(original.runId, {
      workflowVersion: undefined,
      start: { idempotencyKey: "order_1:unversioned" },
    });

    expect(rerun).toMatchObject({
      runId: "run_unversioned_rerun",
      workflowName: "rerun-clear-version",
    });
    expect(rerun.workflowVersion).toBeUndefined();
    const rerunRecord = await engine.getRun(rerun.runId);
    expect(rerunRecord).toMatchObject({
      workflowName: "rerun-clear-version",
      input: { orderId: "order_1" },
      idempotencyKey: "order_1:unversioned",
    });
    expect(rerunRecord?.workflowVersion).toBeUndefined();
  });

  test("reruns onto a workflow version resolved at rerun time", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_rerun_source", "run_rerun_resolved"),
    });
    const registry = new Registry();
    const client = createWorkflowClient({ engine, registry });
    const source = defineWorkflow<{ readonly orderId: string }, string>({
      name: "rerun-resolved",
      version: "1",
    });

    client.implementWorkflow(source, ({ input }) => `old:${input.orderId}`);
    client.implementWorkflow(
      defineWorkflow<{ readonly orderId: string }, string>({
        name: "rerun-resolved",
        version: "2",
      }),
      ({ input }) => `new:${input.orderId}`,
    );

    const original = await client.runs.start(source, { orderId: "order_1" });
    await client.workers.processRun(original.runId);
    const rerun = await client.admin.rerun(original.runId, {
      workflowVersionResolver: (workflowName) => registry.latest(workflowName)?.version,
    });
    await client.workers.processRun(rerun.runId);

    expect(rerun).toMatchObject({
      runId: "run_rerun_resolved",
      workflowName: "rerun-resolved",
      workflowVersion: "2",
    });
    await expect(rerun.result()).resolves.toBe("new:order_1");
  });

  test("reruns workflow runs through the client", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_rerun_validation", "run_rerun_validation_next"),
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "rerun-validation" });
    const handle = await engine.startWorkflow(def, undefined);

    await expect(client.admin.rerun(handle.runId)).resolves.toMatchObject({
      runId: "run_rerun_validation_next",
      workflowName: "rerun-validation",
    });
  });

  test("emits lifecycle callbacks for completed, waiting, and retry transitions", async () => {
    const lifecycleEvents: WorkflowLifecycleEvent[] = [];
    const completedEvents: WorkflowLifecycleEvent[] = [];
    const waitingEvents: WorkflowLifecycleEvent[] = [];
    const retryEvents: WorkflowLifecycleEvent[] = [];
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_waiting", "run_retry", "run_completed"),
      now: () => now,
      onLifecycleEvent: (event) => {
        lifecycleEvents.push(event);
      },
      onRunCompleted: (event) => {
        completedEvents.push(event);
      },
      onRunWaiting: (event) => {
        waitingEvents.push(event);
      },
      onRunRetry: (event) => {
        retryEvents.push(event);
      },
    });

    const waitingWorkflow = implementWorkflow<undefined, string>(
      { name: "lifecycle-waiting" },
      async ({ step }) => {
        await step.task.sleep("pause", Temporal.Duration.from({ seconds: 1 }));
        return "waited";
      },
    );
    const retryWorkflow = implementWorkflow<undefined, string>(
      {
        name: "lifecycle-retry",
        retry: { maximumAttempts: 2, initialInterval: Temporal.Duration.from({ seconds: 1 }) },
      },
      () => {
        throw new Error("try again");
      },
    );
    const completedWorkflow = implementWorkflow<undefined, string>(
      { name: "lifecycle-completed" },
      () => "done",
    );

    await engine.runWorkflowNow(waitingWorkflow, undefined);
    await engine.runWorkflowNow(retryWorkflow, undefined);
    await engine.runWorkflowNow(completedWorkflow, undefined);

    expect(
      lifecycleEvents.map((event) => [event.workflowName, event.status, event.reason]),
    ).toEqual([
      ["lifecycle-waiting", "waiting", "waiting"],
      ["lifecycle-retry", "waiting", "retry"],
      ["lifecycle-completed", "completed", "completed"],
    ]);
    expect(waitingEvents.map((event) => event.run.id)).toEqual(["run_waiting"]);
    expect(retryEvents.map((event) => event.run.id)).toEqual(["run_retry"]);
    expect(completedEvents.map((event) => event.run.id)).toEqual(["run_completed"]);
    expect(lifecycleEvents[0]?.previousRun?.status).toBe("running");

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    await engine.resumeWorkflow(waitingWorkflow, "run_waiting");
    expect(completedEvents.map((event) => event.run.id)).toEqual(["run_completed", "run_waiting"]);
  });

  test("emits lifecycle callbacks for failed and canceled transitions", async () => {
    const failedEvents: WorkflowLifecycleEvent[] = [];
    const canceledEvents: WorkflowLifecycleEvent[] = [];
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_failed", "run_canceled"),
      onRunFailed: (event) => {
        failedEvents.push(event);
      },
      onRunCanceled: (event) => {
        canceledEvents.push(event);
      },
    });

    const failedWorkflow = implementWorkflow<undefined, string>(
      { name: "lifecycle-failed" },
      () => {
        throw new Error("boom");
      },
    );
    const pendingDef = defineWorkflow<undefined, string>({ name: "lifecycle-canceled" });

    await engine.runWorkflowNow(failedWorkflow, undefined);
    const pending = await engine.startWorkflow(pendingDef, undefined);
    await engine.cancelRun(pending.runId);

    expect(failedEvents.map((event) => [event.run.id, event.status, event.reason])).toEqual([
      ["run_failed", "failed", "failed"],
    ]);
    expect(canceledEvents.map((event) => [event.run.id, event.status, event.reason])).toEqual([
      ["run_canceled", "canceled", "canceled"],
    ]);
  });

  test("isolates observation handler failures from durable workflow outcomes", async () => {
    const engine = createWorkflowEngine({ createRunId: () => "run_observer_failure" });
    const workflow = implementWorkflow<undefined, string>(
      { name: "observer-failure" },
      async ({ step }) => {
        const stream = step.stream.create<string>("log");
        await stream.write("one");
        await stream.close();
        return "done";
      },
    );
    const thrown = new Error("observer failed");
    let successfulObserverCalls = 0;
    engine.on("workflow:run-created", () => {
      throw thrown;
    });
    engine.on("workflow:durable-event-appended", () => {
      throw thrown;
    });
    engine.on("workflow:stream-updated", () => {
      throw thrown;
    });
    engine.on("*", () => {
      successfulObserverCalls += 1;
    });

    await expect(engine.startWorkflow(workflow, undefined)).resolves.toMatchObject({
      runId: "run_observer_failure",
    });
    await expect(engine.resumeWorkflow(workflow, "run_observer_failure")).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });

    await expect(engine.getRun("run_observer_failure")).resolves.toMatchObject({
      status: "completed",
      output: "done",
    });
    await expect(engine.getEvents("run_observer_failure")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "workflow_started" }),
        expect.objectContaining({ kind: "stream_started" }),
        expect.objectContaining({ kind: "stream_chunk", chunk: "one" }),
        expect.objectContaining({ kind: "stream_closed" }),
        expect.objectContaining({ kind: "workflow_completed" }),
      ]),
    );
    expect(successfulObserverCalls).toBeGreaterThan(0);
  });
});
