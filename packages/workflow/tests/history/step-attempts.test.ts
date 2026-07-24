import { describe, expect, test } from "vitest";

import { createWorkflowStepAttempts } from "../../src/history/step-attempts.ts";

describe("workflow step attempt reconciliation", () => {
  test("derives attempt keys from descriptor event attempt policy", () => {
    const attempts = createWorkflowStepAttempts("run-1", [
      {
        kind: "workflow_started",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
      },
      {
        kind: "step_started",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
        stepId: "run:load",
        stepName: "load",
        count: 1,
        attempt: 2,
      },
      {
        kind: "step_completed",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:02Z"),
        stepId: "run:load",
        stepName: "load",
        attempt: 2,
        result: "loaded",
      },
    ]);

    expect(attempts).toEqual([
      expect.objectContaining({
        stepId: "run:load",
        kind: "run",
        status: "completed",
        attempt: 2,
        output: "loaded",
      }),
    ]);
  });

  test("reconciles single-attempt descriptor events", () => {
    const attempts = createWorkflowStepAttempts("run-1", [
      {
        kind: "message_send_started",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        stepId: "messageId:ready",
        stepName: "ready",
        count: 1,
        targetRunId: "target-1",
        messageId: "ready",
        payload: { ok: true },
      },
      {
        kind: "message_send_completed",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:01Z"),
        stepId: "messageId:ready",
        stepName: "ready",
        targetRunId: "target-1",
        messageId: "ready",
      },
    ]);

    expect(attempts).toEqual([
      expect.objectContaining({
        stepId: "messageId:ready",
        kind: "message-send",
        status: "completed",
        attempt: 1,
        payload: { ok: true },
      }),
    ]);
  });
});
