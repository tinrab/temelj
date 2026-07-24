import { describe, expect, expectTypeOf, test } from "vitest";

import type { WorkflowMaterializedStepType, WorkflowRunRecord } from "../../src/types/run.ts";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow, defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowRetryableError, WorkflowSerializationError } from "../../src/errors/mod.ts";
import { WorkflowStore } from "../../src/store/create.ts";

type WorkflowTestUpdateRunIfCurrent = (
  current: WorkflowRunRecord,
  next: WorkflowRunRecord,
) => Promise<WorkflowRunRecord | undefined>;

describe("workflow run metadata", () => {
  test("updates run metadata through engine and client", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_metadata",
      now: () => now,
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<undefined, string>({ name: "metadata" });
    const handle = await engine.startWorkflow(def, undefined);

    now = Temporal.Instant.from("2026-06-11T10:05:00Z");
    await expect(
      engine.updateRunMetadata(handle.runId, {
        status: "importing",
        progress: 50,
      }),
    ).resolves.toMatchObject({
      id: "run_metadata",
      metadata: {
        status: "importing",
        progress: 50,
      },
      updatedAt: Temporal.Instant.from("2026-06-11T10:05:00Z"),
    });

    now = Temporal.Instant.from("2026-06-11T10:06:00Z");
    const updated = await client.admin.updateMetadata(handle.runId, {
      status: "done",
      progress: 100,
    });

    expect(updated).toMatchObject({
      metadata: {
        status: "done",
        progress: 100,
      },
      updatedAt: Temporal.Instant.from("2026-06-11T10:06:00Z"),
    });
    await expect(client.runs.get(handle.runId)).resolves.toMatchObject({
      metadata: {
        status: "done",
        progress: 100,
      },
    });
  });

  test("validates metadata before durable writes", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_metadata_validation",
      maximumPersistedValueBytes: 16,
    });
    const def = defineWorkflow<undefined, string>({ name: "metadata-validation" });
    const handle = await engine.startWorkflow(def, undefined);

    await expect(
      engine.updateRunMetadata(handle.runId, { callback: () => "not persisted" }),
    ).rejects.toThrow(WorkflowSerializationError);
    await expect(
      engine.updateRunMetadata(handle.runId, { value: "12345678901234567890" }),
    ).rejects.toThrow(WorkflowSerializationError);
    await expect(engine.getRun(handle.runId)).resolves.not.toHaveProperty("metadata");
  });

  test("preserves concurrent run state when updating metadata", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    let firstMetadataAttempt = true;
    class ConcurrentMetadataStore extends WorkflowStore {
      constructor() {
        super();
        const updateRunIfCurrent: WorkflowTestUpdateRunIfCurrent =
          this.updateRunIfCurrent.bind(this);
        this.updateRunIfCurrent = async (current, next) => {
          if (firstMetadataAttempt && next.metadata !== undefined) {
            firstMetadataAttempt = false;
            await updateRunIfCurrent(current, {
              ...current,
              updatedAt: Temporal.Instant.from("2026-06-11T10:01:00Z"),
              leaseExpiresAt: Temporal.Instant.from("2026-06-11T10:02:00Z"),
            });
            return undefined;
          }
          return await updateRunIfCurrent(current, next);
        };
      }
    }
    const store = new ConcurrentMetadataStore();
    const engine = createWorkflowEngine({
      createRunId: () => "run_metadata_race",
      now: () => now,
      store,
    });
    const def = defineWorkflow<undefined, string>({ name: "metadata-race" });
    const handle = await engine.startWorkflow(def, undefined);
    const run = await engine.getRun(handle.runId);
    if (run === undefined) {
      throw new Error("Expected metadata race run");
    }
    await store.updateRunIfCurrent(run, {
      ...run,
      status: "running",
      attempts: 1,
      workerId: "worker_metadata_race",
      leaseExpiresAt: Temporal.Instant.from("2026-06-11T10:01:00Z"),
      updatedAt: Temporal.Instant.from("2026-06-11T10:00:30Z"),
      lastTransitionAt: Temporal.Instant.from("2026-06-11T10:00:30Z"),
      lastTransitionReason: "claimed",
    });

    now = Temporal.Instant.from("2026-06-11T10:03:00Z");
    await expect(engine.updateRunMetadata(handle.runId, { progress: 1 })).resolves.toMatchObject({
      metadata: { progress: 1 },
      workerId: "worker_metadata_race",
      leaseExpiresAt: Temporal.Instant.from("2026-06-11T10:02:00Z"),
    });
  });

  test("records in-workflow metadata as a durable timeline event", async () => {
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_metadata",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "step-metadata" },
      async ({ step }) => {
        await step.runData.setMetadata("progress", {
          status: "importing",
          progress: 50,
        });
        return "done";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
      run: {
        metadata: {
          status: "importing",
          progress: 50,
        },
      },
    });
    await expect(engine.getEvents("run_step_metadata")).resolves.toMatchObject([
      { kind: "workflow_started" },
      {
        kind: "metadata_set",
        stepId: "metadata:progress",
        stepName: "progress",
        count: 1,
        metadata: {
          status: "importing",
          progress: 50,
        },
      },
      { kind: "workflow_completed" },
    ]);
    await expect(engine.getTimeline("run_step_metadata")).resolves.toMatchObject({
      entries: [
        { kind: "workflow", status: "started" },
        {
          kind: "metadata",
          status: "set",
          stepId: "metadata:progress",
          metadata: {
            status: "importing",
            progress: 50,
          },
        },
        { kind: "workflow", status: "completed" },
      ],
    });
  });

  test("does not materialize metadata events as step attempts", async () => {
    expectTypeOf<"metadata">().not.toMatchTypeOf<WorkflowMaterializedStepType>();

    const engine = createWorkflowEngine({
      createRunId: () => "run_step_metadata_attempts",
      now: () => Temporal.Instant.from("2026-06-11T10:00:00Z"),
    });
    const workflow = implementWorkflow<undefined, string>(
      { name: "step-metadata-attempts" },
      async ({ step }) => {
        await step.runData.setMetadata("progress", { status: "importing" });
        return "done";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });
    await expect(engine.listStepAttempts("run_step_metadata_attempts")).resolves.toEqual([]);
    await expect(engine.getStepAttemptSummary("run_step_metadata_attempts")).resolves.toMatchObject(
      {
        total: 0,
        kind: {
          run: 0,
          sleep: 0,
          workflow: 0,
          "message-send": 0,
          "message-wait": 0,
        },
        kindStepIds: {
          run: [],
          sleep: [],
          workflow: [],
          "message-send": [],
          "message-wait": [],
        },
        kindAttemptKeys: {
          run: [],
          sleep: [],
          workflow: [],
          "message-send": [],
          "message-wait": [],
        },
      },
    );
  });

  test("replays in-workflow metadata without appending duplicate events", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_metadata_replay",
      now: () => now,
    });
    let attempts = 0;
    const workflow = implementWorkflow<undefined, string>(
      {
        name: "step-metadata-replay",
        retry: { maximumAttempts: 2, initialInterval: Temporal.Duration.from({ seconds: 1 }) },
      },
      async ({ step }) => {
        attempts++;
        await step.runData.setMetadata("progress", { status: "retrying" });
        if (attempts === 1) {
          WorkflowRetryableError.failed("retry", {
            retryDelay: Temporal.Duration.from({ seconds: 1 }),
          });
        }
        return "done";
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    await expect(
      engine.resumeWorkflow(workflow, "run_step_metadata_replay"),
    ).resolves.toMatchObject({
      kind: "completed",
      output: "done",
    });

    const metadataEvents = (await engine.getEvents("run_step_metadata_replay")).filter(
      (event) => event.kind === "metadata_set",
    );
    expect(metadataEvents).toHaveLength(1);
    await expect(engine.getRun("run_step_metadata_replay")).resolves.toMatchObject({
      metadata: { status: "retrying" },
    });
  });

  test("rejects replayed in-workflow metadata divergence", async () => {
    let now = Temporal.Instant.from("2026-06-11T10:00:00Z");
    const engine = createWorkflowEngine({
      createRunId: () => "run_step_metadata_divergence",
      now: () => now,
    });
    let metadata = { status: "first" };
    const workflow = implementWorkflow<undefined, string>(
      {
        name: "step-metadata-divergence",
        retry: { maximumAttempts: 2, initialInterval: Temporal.Duration.from({ seconds: 1 }) },
      },
      async ({ step }) => {
        await step.runData.setMetadata("progress", metadata);
        WorkflowRetryableError.failed("retry", {
          retryDelay: Temporal.Duration.from({ seconds: 1 }),
        });
      },
    );

    await expect(engine.runWorkflowNow(workflow, undefined)).resolves.toMatchObject({
      kind: "waiting",
    });

    metadata = { status: "second" };
    now = Temporal.Instant.from("2026-06-11T10:00:01Z");
    const result = await engine.resumeWorkflow(workflow, "run_step_metadata_divergence");

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") {
      throw new Error("Expected metadata replay divergence to fail the workflow");
    }
    expect(result.error.name).toBe("WorkflowReplayDivergenceError");
    await expect(engine.getRun("run_step_metadata_divergence")).resolves.toMatchObject({
      status: "failed",
      error: { name: "WorkflowReplayDivergenceError" },
    });
  });
});
