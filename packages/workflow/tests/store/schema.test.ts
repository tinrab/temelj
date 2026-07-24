import { describe, expect, test } from "vitest";

import {
  workflowCleanupIndexKeySchema,
  workflowMessageIdempotencyIndexSchema,
} from "../../src/store/mod.ts";

describe("workflow store schemas", () => {
  test("exports validation schemas from the public store barrel", () => {
    expect(
      workflowCleanupIndexKeySchema.safeParse({
        key: "cleanup-index",
        value: { status: "completed" },
      }).success,
    ).toBe(true);
    expect(
      workflowMessageIdempotencyIndexSchema.safeParse({
        runId: "run_schema",
        messageId: "message.schema",
        timestamp: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      }).success,
    ).toBe(true);
  });
});
