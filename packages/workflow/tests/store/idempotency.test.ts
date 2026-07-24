import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";

import { makeEventsKey, makeRunKey, makeWorkflowIdempotencyKey } from "../../src/store-keys.ts";
import { createWorkflowStore } from "../../src/store/create.ts";
import { createFailingFallbackCreateRunStorage } from "../utility.ts";

describe("workflow run creation idempotency", () => {
  test("rolls back a non-atomic run record when event history creation fails", async () => {
    const storage = createFailingFallbackCreateRunStorage("run-create-fallback-failure");
    const store = createWorkflowStore({ storage });
    const run = pendingRun("run-create-fallback-failure", {
      idempotencyKey: "create-fallback-failure",
    });

    await expect(store.createRun(run)).rejects.toThrow("failed during set");
    await expect(storage.get(makeRunKey("default", run.id))).resolves.toBeUndefined();
    await expect(storage.get(makeEventsKey("default", run.id))).resolves.toBeUndefined();
    await expect(
      storage.get(
        makeWorkflowIdempotencyKey("default", {
          workflowName: run.workflowName,
          workflowVersion: run.workflowVersion,
          idempotencyKey: "create-fallback-failure",
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

function pendingRun(id: string, options: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id,
    namespace: "default",
    workflowName: "idempotency-test",
    status: "pending",
    attempts: 0,
    createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    updatedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
    lastTransitionReason: "created",
    ...options,
  };
}
