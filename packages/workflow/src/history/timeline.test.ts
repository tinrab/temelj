import { describe, expect, test } from "vitest";

import { createTimeline } from "./timeline.ts";

describe("workflow timeline validation", () => {
  test("rejects malformed event history with schema errors", () => {
    expect(() =>
      createTimeline(
        {
          id: "run-1",
          namespace: "default",
          workflowName: "example",
          status: "completed",
          input: undefined,
          attempts: 1,
          createdAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          updatedAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          lastTransitionAt: Temporal.Instant.from("2025-01-01T00:00:00Z"),
          lastTransitionReason: "completed",
        },
        // @ts-expect-error Exercise malformed history supplied by a JavaScript adapter.
        [{ type: "unknown", timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z") }],
      ),
    ).toThrow("Unsupported workflow event kind");
  });
});
