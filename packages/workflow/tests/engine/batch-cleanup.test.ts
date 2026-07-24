import type { StorageValue } from "@temelj/storage";

import { describe, expect, test } from "vitest";

import { createWorkflowClient } from "../../src/client/create.ts";
import { implementWorkflow, defineWorkflow } from "../../src/definition.ts";
import { createWorkflowEngine } from "../../src/engine/create.ts";
import { WorkflowSerializationError } from "../../src/errors/mod.ts";
import { makeCleanupMarkerKey } from "../../src/store-keys.ts";
import { sequentialRunIds } from "../utility.ts";

describe("workflow batches and cleanup", () => {
  test("starts workflows in batches through engine and client", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_batch_first", "run_batch_second"),
    });
    const client = createWorkflowClient({ engine });
    const def = defineWorkflow<string, string>({ name: "batch-start" });
    client.implementWorkflow(def, ({ input }) => input.toUpperCase());

    const engineHandles = await engine.startWorkflows(def, [
      { input: "first", options: { idempotencyKey: "first" } },
      { input: "second", options: { idempotencyKey: "second" } },
    ]);
    expect(engineHandles.map((handle) => handle.runId)).toEqual([
      "run_batch_first",
      "run_batch_second",
    ]);

    const duplicateHandles = await client.runs.startBatch(def, [
      { input: "ignored", options: { idempotencyKey: "first" } },
      { input: "ignored", options: { idempotencyKey: "second" } },
    ]);
    expect(duplicateHandles.map((handle) => handle.runId)).toEqual([
      "run_batch_first",
      "run_batch_second",
    ]);
  });

  test("batch workflow start fails fast without rolling back earlier starts", async () => {
    const engine = createWorkflowEngine({
      createRunId: sequentialRunIds("run_batch_partial_first", "run_batch_partial_second"),
    });
    const def = defineWorkflow<StorageValue, StorageValue>({ name: "batch-partial" });

    await expect(
      engine.startWorkflows(def, [
        { input: "created" },
        { input: { bad: () => "not persisted" } as never },
      ]),
    ).rejects.toThrow(WorkflowSerializationError);

    await expect(engine.getRun("run_batch_partial_first")).resolves.toMatchObject({
      id: "run_batch_partial_first",
      input: "created",
      status: "pending",
    });
    await expect(engine.getRun("run_batch_partial_second")).resolves.toBeUndefined();
  });

  test("retention policy cleanup applies strict age cutoffs and filters", async () => {
    let now = Temporal.Instant.from("2026-06-01T10:00:00Z");
    const engine = createWorkflowEngine({
      now: () => now,
      createRunId: sequentialRunIds("run_retention_old", "run_retention_recent"),
    });
    const client = createWorkflowClient({ engine });
    const def = implementWorkflow<undefined, string>({ name: "retention" }, () => "done");

    now = Temporal.Instant.from("2026-06-01T10:00:00Z");
    await engine.runWorkflowNow(def, undefined, {
      start: { idempotencyKey: "retention_old" },
    });
    now = Temporal.Instant.from("2026-06-10T10:00:00Z");
    await engine.runWorkflowNow(def, undefined, {
      start: { idempotencyKey: "retention_recent" },
    });

    const preview = await client.admin.applyRetentionPolicy({
      olderThan: Temporal.Duration.from({ days: 7 }),
      now: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      workflowName: "retention",
      dryRun: true,
    });

    expect(preview).toMatchObject({
      mode: "best_effort",
      dryRun: true,
      runIds: ["run_retention_old"],
      runs: [
        expect.objectContaining({
          cleanupMarkerCreated: false,
          cleanupMarkerDeleted: false,
          runDeleted: false,
          deletedEvents: 0,
          deletedStepAttempts: 0,
          deletedIdempotencyKeys: 0,
          deletedMessageIdempotencyKeys: 0,
        }),
      ],
      deletedRuns: 0,
      createdCleanupMarkers: 0,
      deletedCleanupMarkers: 0,
      matchedRuns: 1,
    });
    await expect(
      engine.store.storage.get(makeCleanupMarkerKey(engine.store.namespace, "run_retention_old")),
    ).resolves.toBeUndefined();
    await expect(engine.getRun("run_retention_old")).resolves.toMatchObject({
      status: "completed",
    });

    const deleted = await engine.applyRetentionPolicy({
      olderThan: Temporal.Duration.from({ days: 7 }),
      now: Temporal.Instant.from("2026-06-11T10:00:00Z"),
      workflowName: "retention",
      limit: 10,
    });

    expect(deleted).toMatchObject({
      mode: "best_effort",
      runIds: ["run_retention_old"],
      runs: [
        expect.objectContaining({
          cleanupMarkerCreated: true,
          cleanupMarkerDeleted: true,
          runDeleted: true,
        }),
      ],
      deletedRuns: 1,
      createdCleanupMarkers: 1,
      deletedCleanupMarkers: 1,
    });
    await expect(engine.getRun("run_retention_old")).resolves.toBeUndefined();
    await expect(
      engine.store.storage.get(makeCleanupMarkerKey(engine.store.namespace, "run_retention_old")),
    ).resolves.toBeUndefined();
    await expect(engine.getRun("run_retention_recent")).resolves.toMatchObject({
      id: "run_retention_recent",
      status: "completed",
    });
  });
});
