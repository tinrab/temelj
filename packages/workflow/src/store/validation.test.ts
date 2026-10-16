import { describe, expect, test } from "vitest";

import { parse } from "../schema/common.ts";
import { eventRecordSchema } from "../schema/events.ts";

describe("workflow store validation", () => {
  test("rejects unsupported workflow event types", () => {
    expect(() =>
      parse(eventRecordSchema, {
        kind: "unknown_event",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
      }),
    ).toThrow("Unsupported workflow event kind");
  });

  test("rejects workflow event timestamps that are not Temporal.Instant", () => {
    expect(() =>
      parse(eventRecordSchema, {
        kind: "workflow_started",
        timestamp: "2025-01-01T00:00:00Z",
      }),
    ).toThrow("Expected a Temporal.Instant");
  });
});
