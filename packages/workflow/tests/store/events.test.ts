import { createStorage } from "@temelj/storage";
import { describe, expect, test } from "vitest";

import type { EventRecord } from "../../src/types/events.ts";
import type { WorkflowRunRecord } from "../../src/types/run.ts";

import { workflowStepAttemptKey } from "../../src/history/mod.ts";
import { makeEventsKey, makeRunKey, makeStepAttemptKey } from "../../src/store-keys.ts";
import {
  appendEventWithProjectionPipelineIfRunCurrent,
  appendEventWithProjections,
} from "../../src/store/event-append-project.ts";
import { toStorageValue } from "../../src/store/storage-value.ts";
import {
  createConcurrentEventAppendOnStepAttemptFailureStorage,
  createFailingStepAttemptStorage,
} from "../utility.ts";

describe("workflow event append outcomes", () => {
  test("returns duplicate without appending a duplicate message idempotency event", async () => {
    const storage = createStorage();
    const event = messageSent();

    await expect(
      appendEventWithProjections(storage, "test", "run-1", event),
    ).resolves.toMatchObject({
      status: "appended",
      events: [event],
    });
    await expect(
      appendEventWithProjections(storage, "test", "run-1", { ...event }),
    ).resolves.toMatchObject({
      status: "duplicate",
      events: [event],
    });
    await expect(storage.get(makeEventsKey("test", "run-1"))).resolves.toEqual([event]);
  });

  test("returns duplicate through the run-current append path", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "running" });
    const event = messageSent();
    await storage.set(makeRunKey("test", run.id), toStorageValue(run));

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, event),
    ).resolves.toMatchObject({
      outcome: {
        status: "appended",
        events: [event],
      },
    });
    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, { ...event }),
    ).resolves.toMatchObject({
      outcome: {
        status: "duplicate",
        events: [event],
      },
    });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toEqual([event]);
  });

  test("returns staleRun without appending to a terminal run", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "completed" });

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, stepStarted()),
    ).resolves.toEqual({ outcome: { status: "staleRun" } });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toBeUndefined();
  });

  test("returns staleRun without appending when the stored run revision changed", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "running" });
    const newerRun = workflowRun({
      status: "running",
      updatedAt: Temporal.Instant.from("2025-01-01T00:00:02Z"),
    });
    await storage.set(makeRunKey("test", run.id), toStorageValue(newerRun));

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, workflowStarted()),
    ).resolves.toMatchObject({ outcome: { status: "staleRun" } });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toBeUndefined();
  });

  test("appends non-materialized events when the run revision is current", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "running" });
    const event = workflowStarted();
    await storage.set(makeRunKey("test", run.id), toStorageValue(run));

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, event),
    ).resolves.toMatchObject({
      outcome: {
        status: "appended",
        events: [event],
      },
    });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toEqual([event]);
  });

  test("appends materialized events and stores the step-attempt read model atomically", async () => {
    const storage = createStorage();
    const run = workflowRun({ status: "running" });
    const event = stepStarted();
    await storage.set(makeRunKey("test", run.id), toStorageValue(run));

    await expect(
      appendEventWithProjectionPipelineIfRunCurrent(storage, "test", run, event),
    ).resolves.toMatchObject({
      outcome: {
        status: "appended",
        events: [event],
      },
    });
    await expect(storage.get(makeEventsKey("test", run.id))).resolves.toEqual([event]);
    await expect(
      storage.get(makeStepAttemptKey("test", run.id, workflowStepAttemptKey("step-1", 1))),
    ).resolves.toMatchObject({
      runId: run.id,
      stepId: "step-1",
      stepName: "load",
      kind: "run",
      status: "running",
      attempt: 1,
      count: 1,
      createdAt: event.timestamp,
      startedAt: event.timestamp,
    });
  });

  test("rolls back an appended event when fallback materialization fails", async () => {
    const storage = createFailingStepAttemptStorage();
    const event = stepStarted();

    await expect(appendEventWithProjections(storage, "default", "run-1", event)).rejects.toThrow(
      "failed during set",
    );
    await expect(storage.get(makeEventsKey("default", "run-1"))).resolves.toEqual([]);
  });

  test("does not roll back fallback materialization failure after concurrent history append", async () => {
    const storage = createConcurrentEventAppendOnStepAttemptFailureStorage("run-1");
    const event = stepStarted();

    await expect(appendEventWithProjections(storage, "default", "run-1", event)).rejects.toThrow(
      "step attempt write failed after concurrent event append",
    );
    await expect(storage.get(makeEventsKey("default", "run-1"))).resolves.toMatchObject([
      { kind: "step_started" },
      { kind: "workflow_started" },
    ]);
  });
});

function workflowStarted(): EventRecord {
  return {
    kind: "workflow_started",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
  };
}

function stepStarted(): EventRecord {
  return {
    kind: "step_started",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
    stepId: "step-1",
    stepName: "load",
    count: 1,
    attempt: 1,
  };
}

function messageSent(): EventRecord {
  return {
    kind: "message_sent",
    timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    messageId: "ready",
    payload: "ok",
    idempotencyKey: "ready-key",
  };
}

function workflowRun(options: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id: "run-1",
    namespace: "test",
    workflowName: "append-outcomes",
    status: "pending",
    attempts: 0,
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionReason: "created",
    ...options,
  };
}
