import { describe, expect, test } from "vitest";

import { WorkflowStateError } from "../../src/errors/mod.ts";
import { applyWorkflowStepAttemptEvent } from "../../src/history/projection.ts";

describe("workflow step attempt projection", () => {
  test("validates terminal events against descriptor match fields", () => {
    expect(() =>
      applyWorkflowStepAttemptEvent(
        "run-1",
        {
          kind: "message_send_failed",
          timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
          stepId: "messageId:ready",
          stepName: "ready",
          targetRunId: "target-2",
          messageId: "ready",
          error: {
            name: "Error",
            message: "failed",
          },
        },
        {
          runId: "run-1",
          stepId: "messageId:ready",
          stepName: "ready",
          kind: "message-send",
          status: "running",
          attempt: 1,
          count: 1,
          targetRunId: "target-1",
          messageId: "ready",
          createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          startedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        },
      ),
    ).toThrow(WorkflowStateError);
  });
});
