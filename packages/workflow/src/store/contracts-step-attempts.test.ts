import { describe, expect, test } from "vitest";

import type { EventRecord } from "../types/events.ts";
import type { WorkflowStore } from "../types/store.ts";

import { makeStepAttemptKey, stepAttemptKey } from "../store-keys.ts";
import { pendingRun, storeFactories } from "../testing/store-contract.ts";
import { toStorageValue } from "./storage-value.ts";

interface StoreContractOptions {
  readonly name: string;
  readonly createStore: () => WorkflowStore | Promise<WorkflowStore>;
}

function describeStoreStepAttemptContract(options: StoreContractOptions): void {
  describe(`${options.name}`, () => {
    test("appends events conditionally and materializes step attempts", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-events"));

      const running = await store.updateRun({
        ...run,
        status: "running",
        attempts: 1,
        updatedAt: Temporal.Instant.from("2025-01-01T00:00:00.100Z"),
        lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:00.100Z"),
        lastTransitionReason: "started",
        startedAt: Temporal.Instant.from("2025-01-01T00:00:00.100Z"),
      });

      const started = await store.appendEventIfRunCurrent(running, stepStarted());
      expect(started?.map((event) => event.kind)).toEqual(["step_started"]);
      expect(await store.listStepAttempts(run.id)).toMatchObject([
        {
          runId: run.id,
          stepId: "step-1",
          stepName: "fetch",
          kind: "run",
          status: "running",
          attempt: 1,
        },
      ]);

      const completed = await store.appendEventIfRunCurrent(running, stepCompleted());
      expect(completed?.map((event) => event.kind)).toEqual(["step_started", "step_completed"]);
      expect(await store.listStepAttempts(run.id)).toMatchObject([
        {
          status: "completed",
          output: "ok",
          finishedAt: Temporal.Instant.from("2025-01-01T00:00:01Z"),
        },
      ]);
    });

    test("preserves stream durable events and materializes stream attempts", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-stream-events"));

      await expect(store.appendEvent(run.id, streamStarted())).resolves.toMatchObject([
        { kind: "stream_started", streamId: "stream-1" },
      ]);
      await expect(store.appendEvent(run.id, streamChunk(0, "one"))).resolves.toMatchObject([
        { kind: "stream_started" },
        { kind: "stream_chunk", index: 0, chunk: "one" },
      ]);
      await expect(store.appendEvent(run.id, streamClosed())).resolves.toMatchObject([
        { kind: "stream_started" },
        { kind: "stream_chunk" },
        { kind: "stream_closed" },
      ]);

      await expect(store.getEvents(run.id)).resolves.toMatchObject([
        { kind: "stream_started", streamId: "stream-1", stepName: "updates" },
        { kind: "stream_chunk", streamId: "stream-1", index: 0, chunk: "one" },
        { kind: "stream_closed", streamId: "stream-1" },
      ]);
      await expect(store.listStepAttempts(run.id, { kind: "stream" })).resolves.toMatchObject([
        {
          runId: run.id,
          stepId: "stream:updates",
          stepName: "updates",
          kind: "stream",
          status: "completed",
        },
      ]);
      await expect(store.countStepAttempts(run.id, { kind: "stream" })).resolves.toBe(1);

      const firstPage = await store.listStepAttemptsPage(run.id, {
        kind: "stream",
        limit: 1,
      });

      expect(firstPage).toMatchObject({
        items: [
          {
            runId: run.id,
            stepId: "stream:updates",
            kind: "stream",
            status: "completed",
          },
        ],
        hasMore: false,
      });
    });

    test("repairs step attempts from durable event history", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-repair"));
      await store.appendEvent(run.id, stepStarted());
      await store.appendEvent(run.id, stepCompleted());
      await store.storage.delete(
        makeStepAttemptKey(store.namespace, run.id, stepAttemptKey("step-1", 1)),
      );

      expect(await store.listStepAttempts(run.id)).toMatchObject([{ status: "completed" }]);
      await store.storage.delete(
        makeStepAttemptKey(store.namespace, run.id, stepAttemptKey("step-1", 1)),
      );
      await expect(store.repairStepAttempts(run.id)).resolves.toMatchObject([
        { status: "completed", output: "ok" },
      ]);
    });

    test("repairs corrupted step attempt status from durable event history", async () => {
      const store = await options.createStore();
      const run = await store.createRun(pendingRun(store, "run-repair-status"));
      await store.appendEvent(run.id, stepStarted());
      await store.appendEvent(run.id, stepCompleted());

      const attemptKey = makeStepAttemptKey(store.namespace, run.id, stepAttemptKey("step-1", 1));

      await store.storage.set(
        attemptKey,
        toStorageValue({
          runId: run.id,
          stepId: "step-1",
          stepName: "fetch",
          kind: "run",
          status: "running",
          attempt: 1,
          count: 1,
          createdAt: Temporal.Instant.from("2025-01-01T00:00:00.500Z"),
          startedAt: Temporal.Instant.from("2025-01-01T00:00:05Z"),
        }),
      );

      await expect(store.repairStepAttempts(run.id)).resolves.toMatchObject([
        {
          status: "completed",
          output: "ok",
          finishedAt: Temporal.Instant.from("2025-01-01T00:00:01Z"),
        },
      ]);
      await expect(store.storage.get(attemptKey)).resolves.toMatchObject({
        status: "completed",
        output: "ok",
        finishedAt: Temporal.Instant.from("2025-01-01T00:00:01Z"),
      });
    });
  });
}

for (const factory of storeFactories) {
  describeStoreStepAttemptContract({
    name: `workflow store step-attempt contract: ${factory.name}`,
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

function streamStarted(): EventRecord {
  return {
    kind: "stream_started",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:00.500Z"),
    stepId: "stream:updates",
    stepName: "updates",
    count: 1,
    streamId: "stream-1",
    contentType: "text/plain",
    metadata: { channel: "contract" },
  };
}

function streamChunk(index: number, chunk: string): EventRecord {
  return {
    kind: "stream_chunk",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
    stepId: "stream:updates",
    stepName: "updates",
    streamId: "stream-1",
    index,
    chunk,
  };
}

function streamClosed(): EventRecord {
  return {
    kind: "stream_closed",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:02Z"),
    stepId: "stream:updates",
    stepName: "updates",
    streamId: "stream-1",
  };
}
