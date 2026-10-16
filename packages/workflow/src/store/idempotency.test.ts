import { describe, expect, test } from "vitest";

import type { RunId } from "../types/ids.ts";
import type { RunRecord } from "../types/run.ts";
import type { WorkflowStorage } from "../types/store.ts";

import { makeEventsKey, makeRunKey, makeWorkflowIdempotencyKey } from "../store-keys.ts";
import { fakeStorage } from "../testing/fake-storage.ts";
import { createWorkflowStore } from "./create.ts";

describe("workflow run creation idempotency", () => {
  test("rolls back a non-atomic run record when event history creation fails", async () => {
    const storage = failingFirstEventsWriteStorage("run-create-fallback-failure");
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

function pendingRun(id: string, options: Partial<RunRecord> = {}): RunRecord {
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

/** Storage without atomic writes whose first event history write for `runId` fails. */
function failingFirstEventsWriteStorage(runId: RunId): WorkflowStorage {
  let failed = false;

  return fakeStorage({
    conditionalWrites: "none",
    engineSet: async (key, value, options, next) => {
      if (!failed && key === makeEventsKey("default", runId)) {
        failed = true;
        throw new Error("workflow event history write failed");
      }

      await next(key, value, options);
    },
  });
}
