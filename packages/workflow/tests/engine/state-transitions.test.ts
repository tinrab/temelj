import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";

import {
  patchRun,
  transitionRunToCanceled,
  transitionRunToCompleted,
  transitionRunToFailed,
  transitionRunToPermanentFailure,
  transitionRunToRunning,
  transitionRunToWaiting,
} from "../../src/engine/state.ts";

const timestamp = Temporal.Instant.from("2026-07-17T08:00:00Z");
const error = { name: "Error", message: "failed" } as const;

describe("workflow run transitions", () => {
  test("applies partial updates without inventing a start timestamp", async () => {
    const run = runRecord({ startedAt: undefined });

    const updated = await patchRun({ updateRun: async (next) => next }, run, {
      metadata: { status: "ready" },
      updatedAt: timestamp,
    });

    expect(updated.startedAt).toBeUndefined();
    expect(updated.metadata).toEqual({ status: "ready" });
  });

  test.each([
    ["completed", (run: WorkflowRunRecord) => transitionRunToCompleted(run, "done", timestamp)],
    ["failed", (run: WorkflowRunRecord) => transitionRunToFailed(run, error, timestamp, "failed")],
    ["canceled", (run: WorkflowRunRecord) => transitionRunToCanceled(run, error, timestamp)],
    [
      "permanent failure",
      (run: WorkflowRunRecord) => transitionRunToPermanentFailure(run, error, timestamp),
    ],
  ])("clears scheduling and lease state for %s transitions", (_label, transition) => {
    const transitioned = transition(runRecord());

    expect(transitioned).toMatchObject({ finishedAt: timestamp });
    expect(transitioned.availableAt).toBeUndefined();
    expect(transitioned.workerId).toBeUndefined();
    expect(transitioned.leaseExpiresAt).toBeUndefined();
    expect(transitioned.retryAt).toBeUndefined();
    expect(transitioned.retryReason).toBeUndefined();
    expect(transitioned.retryAttempt).toBeUndefined();
    expect(transitioned.retryStepId).toBeUndefined();
    expect(transitioned.retryStepName).toBeUndefined();
  });

  test("retains the claimed worker lease when execution starts", () => {
    const transitioned = transitionRunToRunning(runRecord(), timestamp, 3);

    expect(transitioned).toMatchObject({
      status: "running",
      workerId: "worker-1",
      leaseExpiresAt: Temporal.Instant.from("2026-07-17T09:00:00Z"),
      attempts: 3,
      startedAt: timestamp,
    });
  });

  test("clears the worker lease when a run starts waiting", () => {
    const transitioned = transitionRunToWaiting(runRecord(), timestamp, timestamp);

    expect(transitioned.status).toBe("waiting");
    expect(transitioned.workerId).toBeUndefined();
    expect(transitioned.leaseExpiresAt).toBeUndefined();
  });
});

function runRecord(patch: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  const createdAt = Temporal.Instant.from("2026-07-17T07:00:00Z");
  return {
    id: "run-1",
    namespace: "default",
    workflowName: "test",
    status: "running",
    attempts: 2,
    workerId: "worker-1",
    createdAt,
    updatedAt: createdAt,
    lastTransitionAt: createdAt,
    lastTransitionReason: "claimed",
    availableAt: createdAt,
    leaseExpiresAt: Temporal.Instant.from("2026-07-17T09:00:00Z"),
    retryAt: createdAt,
    retryReason: "step",
    retryAttempt: 2,
    retryStepId: "step-1",
    retryStepName: "step",
    error,
    output: "old",
    finishedAt: createdAt,
    ...patch,
  };
}
