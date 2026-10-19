import { describe, expect, test } from "vitest";

import type { EventRecord } from "../types/events.ts";
import type { WorkflowStore } from "../types/store.ts";

import {
  makeCleanupMarkerKey,
  makeEventsKey,
  makeMessageIdempotencyKey,
  makeStepAttemptKey,
  makeWorkflowIdempotencyKey,
  stepAttemptKey,
} from "../store-keys.ts";
import { pendingRun, storeFactories } from "../testing/store-contract.ts";
import { toStorageValue } from "./storage-value.ts";

interface StoreContractOptions {
  readonly name: string;
  readonly createStore: () => WorkflowStore | Promise<WorkflowStore>;
}

function describeStoreCleanupContract(options: StoreContractOptions): void {
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
        store.storage.get(makeStepAttemptKey(store.namespace, run.id, stepAttemptKey("step-1", 1))),
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

for (const factory of storeFactories) {
  describeStoreCleanupContract({
    name: `workflow store cleanup contract: ${factory.name}`,
    createStore: factory.create,
  });
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
