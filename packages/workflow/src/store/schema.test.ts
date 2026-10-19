import { ss } from "@temelj/standard-schema";
import { describe, expect, test } from "vitest";

import {
  cleanupIndexKeySchema,
  cleanupMarkerRecordSchema,
  messageIdempotencyIndexSchema,
  stepAttemptRecordSchema,
} from "./mod.ts";

describe("workflow store schemas", () => {
  test("exports validation schemas from the public store barrel", () => {
    expect(
      ss.safeParseSync(cleanupIndexKeySchema, {
        key: "cleanup-index",
        value: { status: "completed" },
      }).success,
    ).toBe(true);
    expect(
      ss.safeParseSync(messageIdempotencyIndexSchema, {
        runId: "run_schema",
        messageId: "message.schema",
        timestamp: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      }).success,
    ).toBe(true);
  });

  test("exports validation schemas for inspection records", () => {
    expect(
      ss.safeParseSync(cleanupMarkerRecordSchema, {
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
      ss.safeParseSync(stepAttemptRecordSchema, {
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
