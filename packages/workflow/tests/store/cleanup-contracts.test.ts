import { createStorage, createSuperJsonStorageCodec } from "@temelj/storage";
import { FileSystemStorageEngine } from "@temelj/storage/filesystem";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import type { EventRecord } from "../../src/types/events.ts";
import type { WorkflowRunRecord } from "../../src/types/run.ts";
import type { WorkflowStore } from "../../src/types/store.ts";

import { workflowStepAttemptKey } from "../../src/history/mod.ts";
import {
  makeCleanupMarkerKey,
  makeEventsKey,
  makeMessageIdempotencyKey,
  makeStepAttemptKey,
  makeWorkflowIdempotencyKey,
} from "../../src/store-keys.ts";
import { createWorkflowStore } from "../../src/store/create.ts";
import { toStorageValue } from "../../src/store/storage-value.ts";

const temporaryDirectories: string[] = [];

interface WorkflowStoreCleanupContractOptions {
  readonly name: string;
  readonly createStore: () => WorkflowStore | Promise<WorkflowStore>;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => await rm(directory, { force: true, recursive: true })),
  );
});

function describeWorkflowStoreCleanupContract(options: WorkflowStoreCleanupContractOptions): void {
  describe(`${options.name}`, () => {
    test("cleanup removes runs, events, attempts, and idempotency indexes", async () => {
      const store = await options.createStore();
      const run = await store.createRun(
        pendingRun(store, "run-cleanup", {
          idempotencyKey: "cleanup-key",
        }),
      );
      await store.appendEvent(run.id, stepStarted());
      await store.appendEvent(run.id, stepCompleted());
      await store.appendEvent(run.id, {
        kind: "message_sent",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:02Z"),
        messageId: "cleanup",
        payload: "payload",
        idempotencyKey: "cleanup-messageId-key",
      });
      await store.updateRun({
        ...run,
        status: "failed",
        error: { name: "Error", message: "failed" },
        updatedAt: Temporal.Instant.from("2025-01-01T00:00:03Z"),
        lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:03Z"),
        lastTransitionReason: "failed",
        finishedAt: Temporal.Instant.from("2025-01-01T00:00:03Z"),
      });

      const result = await store.cleanupRuns({
        finishedAtBefore: Temporal.Instant.from("2025-01-01T00:00:04Z"),
        status: "failed",
      });

      expect(result).toMatchObject({
        mode: "best_effort",
        runIds: [run.id],
        runs: [
          expect.objectContaining({
            cleanupMarkerCreated: true,
            cleanupMarkerDeleted: true,
            runDeleted: true,
            deletedEvents: 1,
            deletedStepAttempts: 1,
            deletedIdempotencyKeys: 1,
            deletedMessageIdempotencyKeys: 1,
          }),
        ],
        deletedRuns: 1,
        createdCleanupMarkers: 1,
        deletedCleanupMarkers: 1,
        deletedEvents: 1,
        deletedStepAttempts: 1,
        deletedIdempotencyKeys: 1,
        deletedMessageIdempotencyKeys: 1,
      });
      await expect(store.getRun(run.id)).resolves.toBeUndefined();
      await expect(
        store.storage.get(makeCleanupMarkerKey(store.namespace, run.id)),
      ).resolves.toBeUndefined();
      await expect(
        store.storage.get(makeEventsKey(store.namespace, run.id)),
      ).resolves.toBeUndefined();
      await expect(
        store.storage.get(
          makeStepAttemptKey(store.namespace, run.id, workflowStepAttemptKey("step-1", 1)),
        ),
      ).resolves.toBeUndefined();
      await expect(
        store.storage.get(
          makeWorkflowIdempotencyKey(store.namespace, {
            workflowName: run.workflowName,
            workflowVersion: run.workflowVersion,
            idempotencyKey: "cleanup-key",
          }),
        ),
      ).resolves.toBeUndefined();
      await expect(
        store.storage.get(
          makeMessageIdempotencyKey(store.namespace, run.id, "cleanup-messageId-key"),
        ),
      ).resolves.toBeUndefined();
    });

    test("lists retained cleanup markers for repair inspection", async () => {
      const store = await options.createStore();
      await store.storage.set(
        makeCleanupMarkerKey(store.namespace, "run-cleanup-marker"),
        toStorageValue({
          mode: "best_effort",
          runId: "run-cleanup-marker",
          workflowName: "cleanup",
          workflowVersion: "v1",
          status: "failed",
          createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          finishedAt: Temporal.Instant.from("2025-01-01T00:00:03Z"),
          cleanupStartedAt: Temporal.Instant.from("2025-01-01T00:00:04Z"),
          events: 1,
          stepAttempts: 2,
          idempotencyKeys: 1,
          messageIdempotencyKeys: 1,
        }),
      );
      await store.storage.set(makeCleanupMarkerKey(store.namespace, "run-invalid-marker"), {
        mode: "best_effort",
        runId: "",
      });

      await expect(store.listCleanupMarkers()).resolves.toEqual([
        {
          mode: "best_effort",
          runId: "run-cleanup-marker",
          workflowName: "cleanup",
          workflowVersion: "v1",
          status: "failed",
          createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          finishedAt: Temporal.Instant.from("2025-01-01T00:00:03Z"),
          cleanupStartedAt: Temporal.Instant.from("2025-01-01T00:00:04Z"),
          events: 1,
          stepAttempts: 2,
          idempotencyKeys: 1,
          messageIdempotencyKeys: 1,
        },
      ]);
    });
  });
}

describeWorkflowStoreCleanupContract({
  name: "workflow store cleanup contract: default in-memory storage",
  createStore: () =>
    createWorkflowStore({
      namespace: `cleanup-${Temporal.Now.instant().epochMilliseconds.toString(36)}-${Math.random()}`,
    }),
});

describeWorkflowStoreCleanupContract({
  name: "workflow store cleanup contract: filesystem storage adapter",
  createStore: async () => {
    const directory = await temporaryDirectory();
    return createWorkflowStore({
      namespace: `cleanup-${Temporal.Now.instant().epochMilliseconds.toString(36)}-${Math.random()}`,
      storage: createStorage({
        codec: createSuperJsonStorageCodec({ format: "bytes" }),
        engine: new FileSystemStorageEngine({
          directory,
          prefix: "workflow",
        }),
      }),
    });
  },
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "temelj-workflow-store-cleanup-"));
  temporaryDirectories.push(directory);
  return directory;
}

function pendingRun(
  store: WorkflowStore,
  id: string,
  options: Partial<WorkflowRunRecord> = {},
): WorkflowRunRecord {
  const { id: _id, namespace: _namespace, ...patch } = options;
  return {
    id,
    namespace: store.namespace,
    workflowName: "cleanup-workflow",
    workflowVersion: "v1",
    status: "pending",
    input: undefined,
    attempts: 0,
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionReason: "created",
    ...patch,
  };
}

function stepStarted(): EventRecord {
  return {
    kind: "step_started",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:00.500Z"),
    stepId: "step-1",
    stepName: "fetch",
    count: 1,
    attempt: 1,
  };
}

function stepCompleted(): EventRecord {
  return {
    kind: "step_completed",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
    stepId: "step-1",
    stepName: "fetch",
    attempt: 1,
    result: "ok",
  };
}
