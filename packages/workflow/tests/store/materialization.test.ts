import { createStorage } from "@temelj/storage";
import { describe, expect, test } from "vitest";

import type { WorkflowStepAttemptRecord } from "../../src/types/step-attempts.ts";

import { WorkflowMessageIdempotencyConflictError } from "../../src/errors/mod.ts";
import { makeStepAttemptKey } from "../../src/store-keys.ts";
import { isSameWorkflowEventIdentity } from "../../src/store/event-history.ts";
import {
  createWorkflowStepAttemptMaterializationStoragePlan,
  isSameStepAttemptIdentity,
} from "../../src/store/materialization.ts";
import { duplicateMessageAppendOutcome } from "../../src/store/message-index.ts";
import { toStorageValue } from "../../src/store/storage-value.ts";

describe("workflow event identity", () => {
  test("compares descriptor identity fields", () => {
    expect(
      isSameWorkflowEventIdentity(
        {
          kind: "step_started",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          stepId: "step-1",
          stepName: "load",
          count: 1,
          attempt: 1,
        },
        {
          kind: "step_started",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          stepId: "step-1",
          stepName: "load",
          count: 1,
          attempt: 2,
        },
      ),
    ).toBe(false);
  });

  test("compares persisted value identity fields canonically", () => {
    expect(
      isSameWorkflowEventIdentity(
        {
          kind: "metadata_set",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          stepId: "metadata-1",
          stepName: "set-status",
          count: 1,
          metadata: ["ready", 1],
        },
        {
          kind: "metadata_set",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          stepId: "metadata-1",
          stepName: "set-status",
          count: 1,
          metadata: ["ready", 1],
        },
      ),
    ).toBe(true);
  });

  test("compares string-list identity fields by order", () => {
    expect(
      isSameWorkflowEventIdentity(
        {
          kind: "message_sent",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          messageId: "ready",
          waiterStepIds: ["a", "b"],
        },
        {
          kind: "message_sent",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          messageId: "ready",
          waiterStepIds: ["b", "a"],
        },
      ),
    ).toBe(false);
  });

  test("throws a typed error for messageId idempotency conflicts", () => {
    expect(() =>
      duplicateMessageAppendOutcome(
        "run-1",
        [
          {
            kind: "message_sent",
            timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
            messageId: "ready",
            payload: "one",
            idempotencyKey: "messageId-key",
          },
        ],
        {
          kind: "message_sent",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
          messageId: "ready",
          payload: "two",
          idempotencyKey: "messageId-key",
        },
      ),
    ).toThrow(WorkflowMessageIdempotencyConflictError);
  });
});

describe("workflow step attempt identity", () => {
  test("compares shared materialized step attempt identity fields", () => {
    expect(
      isSameStepAttemptIdentity(
        workflowStepAttempt({ count: 1, status: "running" }),
        workflowStepAttempt({ count: 2, status: "running" }),
      ),
    ).toBe(false);
  });

  test("compares kind-specific materialized step attempt identity fields", () => {
    expect(
      isSameStepAttemptIdentity(
        workflowStepAttempt({
          kind: "message-send",
          targetRunId: "target-1",
          messageId: "ready",
        }),
        workflowStepAttempt({
          kind: "message-send",
          targetRunId: "target-2",
          messageId: "ready",
        }),
      ),
    ).toBe(false);
  });
});

describe("workflow step attempt materialization plan", () => {
  test("skips events that do not materialize step attempts", async () => {
    await expect(
      createWorkflowStepAttemptMaterializationStoragePlan(createStorage(), "test", "run-1", {
        kind: "workflow_started",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
      }),
    ).resolves.toEqual({ materializes: false });
  });

  test("creates a compare-and-set item for a new step attempt", async () => {
    const storage = createStorage();
    const startedAt = Temporal.Instant.from("2025-01-01T00:00:00Z");
    const plan = await createWorkflowStepAttemptMaterializationStoragePlan(
      storage,
      "test",
      "run-1",
      {
        kind: "step_started",
        timestamp: startedAt,
        stepId: "step-1",
        stepName: "load",
        count: 1,
        attempt: 1,
      },
    );

    expect(plan).toMatchObject({
      materializes: true,
      storageKey: makeStepAttemptKey("test", "run-1", "run:step-1:1"),
      item: {
        key: makeStepAttemptKey("test", "run-1", "run:step-1:1"),
        expected: undefined,
        value: {
          runId: "run-1",
          stepId: "step-1",
          stepName: "load",
          kind: "run",
          status: "running",
          attempt: 1,
          count: 1,
          createdAt: startedAt,
          startedAt,
        },
      },
    });
  });

  test("does not plan a write for an older terminal event", async () => {
    const storage = createStorage();
    const storageKey = makeStepAttemptKey("test", "run-1", "run:step-1:1");
    const current = workflowStepAttempt({
      stepId: "step-1",
      stepName: "load",
      status: "completed",
      finishedAt: Temporal.Instant.from("2025-01-01T00:00:10Z"),
    });
    await storage.set(storageKey, toStorageValue(current));

    const plan = await createWorkflowStepAttemptMaterializationStoragePlan(
      storage,
      "test",
      "run-1",
      {
        kind: "step_failed",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:05Z"),
        stepId: "step-1",
        stepName: "load",
        attempt: 1,
        error: { name: "Error", message: "late failure" },
      },
    );

    expect(plan).toEqual({
      materializes: true,
      storageKey,
      current,
    });
  });
});

function workflowStepAttempt(
  options: Partial<WorkflowStepAttemptRecord> = {},
): WorkflowStepAttemptRecord {
  return {
    runId: "run-1",
    stepId: "step-1",
    stepName: "step",
    kind: "run",
    status: "completed",
    attempt: 1,
    count: 1,
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    startedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    finishedAt: Temporal.Instant.from("2025-01-01T00:00:01Z"),
    ...options,
  };
}
