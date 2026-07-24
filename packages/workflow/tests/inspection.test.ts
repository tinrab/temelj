import { describe, expect, test } from "vitest";

import {
  workflowCleanupMarkerRecordSchema,
  workflowStepAttemptRecordSchema,
} from "../src/inspection/mod.ts";

describe("workflow inspection entry point", () => {
  test("exports runtime validation schemas for inspection records", () => {
    expect(
      workflowCleanupMarkerRecordSchema.safeParse({
        mode: "best_effort",
        runId: "run_cleanup",
        workflowName: "cleanup-workflow",
        status: "completed",
        createdAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        finishedAt: Temporal.Instant.from("2026-06-12T09:05:00Z"),
        cleanupStartedAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
        events: 2,
        stepAttempts: 1,
        idempotencyKeys: 1,
        messageIdempotencyKeys: 0,
      }).success,
    ).toBe(true);
    expect(
      workflowStepAttemptRecordSchema.safeParse({
        runId: "run_step",
        stepId: "run:charge",
        stepName: "charge",
        kind: "run",
        status: "completed",
        attempt: 1,
        createdAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        startedAt: Temporal.Instant.from("2026-06-12T09:00:01Z"),
        finishedAt: Temporal.Instant.from("2026-06-12T09:00:02Z"),
        output: "charged",
      }).success,
    ).toBe(true);
  });
});
