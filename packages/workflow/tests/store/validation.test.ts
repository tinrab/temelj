import { describe, expect, test } from "vitest";

import type { EventRecord } from "../../src/types/events.ts";

import { workflowEventRecordSchema } from "../../src/types/events.ts";

describe("workflow store validation", () => {
  test("rejects unsupported workflow event types", () => {
    expect(() =>
      workflowEventRecordSchema.parse({
        kind: "unknown_event",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
      } as never as EventRecord),
    ).toThrow("Invalid discriminator value");
  });

  test("rejects workflow event timestamps that are not Temporal.Instant", () => {
    expect(() =>
      workflowEventRecordSchema.parse({
        kind: "workflow_started",
        timestamp: "2025-01-01T00:00:00Z",
      } as never as EventRecord),
    ).toThrow("Expected a Temporal.Instant");
  });
});
