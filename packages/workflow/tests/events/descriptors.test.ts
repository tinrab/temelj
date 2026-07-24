import { describe, expect, test } from "vitest";

import {
  isWorkflowRecordedStepEventKind,
  isWorkflowTerminalStepAttemptEvent,
  getWorkflowEventStepAttempt,
  getWorkflowEventStepAttemptKey,
} from "../../src/events/descriptors.ts";
import { workflowStartedEventMatchesTerminalEvent } from "../../src/history/validator.ts";
import { isSameWorkflowEventIdentity } from "../../src/store/event-history.ts";

describe("workflow event descriptors", () => {
  test("uses message ids as part of sent event identity", () => {
    const timestamp = Temporal.Instant.from("2025-01-01T00:00:00Z");

    expect(
      isSameWorkflowEventIdentity(
        { kind: "message_sent", timestamp, messageId: "first" },
        { kind: "message_sent", timestamp, messageId: "second" },
      ),
    ).toBe(false);
  });

  test("matches message send terminal events by message id", () => {
    const timestamp = Temporal.Instant.from("2025-01-01T00:00:00Z");

    expect(
      workflowStartedEventMatchesTerminalEvent(
        {
          kind: "message_send_started",
          timestamp,
          stepId: "message-send:ready",
          stepName: "ready",
          count: 1,
          targetRunId: "target-1",
          messageId: "first",
        },
        {
          kind: "message_send_completed",
          timestamp,
          stepId: "message-send:ready",
          stepName: "ready",
          targetRunId: "target-1",
          messageId: "second",
        },
      ),
    ).toBe(false);
  });

  test("matches message wait terminal events by message id", () => {
    const timestamp = Temporal.Instant.from("2025-01-01T00:00:00Z");

    expect(
      workflowStartedEventMatchesTerminalEvent(
        {
          kind: "message_wait_started",
          timestamp,
          stepId: "message-wait:ready",
          stepName: "ready",
          count: 1,
          messageId: "first",
        },
        {
          kind: "message_wait_completed",
          timestamp,
          stepId: "message-wait:ready",
          stepName: "ready",
          messageId: "second",
          messageTimestamp: timestamp,
        },
      ),
    ).toBe(false);
  });

  test("classifies recorded step event kinds from descriptor step type metadata", () => {
    expect(isWorkflowRecordedStepEventKind("step_started")).toBe(true);
    expect(isWorkflowRecordedStepEventKind("metadata_set")).toBe(true);
    expect(isWorkflowRecordedStepEventKind("attributes_set")).toBe(true);
    expect(isWorkflowRecordedStepEventKind("stream_chunk")).toBe(false);
    expect(isWorkflowRecordedStepEventKind("message_sent")).toBe(false);
    expect(isWorkflowRecordedStepEventKind("workflow_started")).toBe(false);
  });

  test("classifies terminal step attempt events from descriptor metadata", () => {
    expect(
      isWorkflowTerminalStepAttemptEvent({
        kind: "step_completed",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        stepId: "step-1",
        stepName: "load",
        attempt: 1,
      }),
    ).toBe(true);
    expect(
      isWorkflowTerminalStepAttemptEvent({
        kind: "step_started",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        stepId: "step-1",
        stepName: "load",
        count: 1,
        attempt: 1,
      }),
    ).toBe(false);
  });

  test("derives event-backed step attempt numbers from descriptors", () => {
    expect(
      getWorkflowEventStepAttempt({
        kind: "step_started",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        stepId: "step-1",
        stepName: "load",
        count: 1,
        attempt: 3,
      }),
    ).toBe(3);
  });

  test("derives single step attempt numbers from descriptors", () => {
    expect(
      getWorkflowEventStepAttempt({
        kind: "message_wait_started",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        stepId: "messageId:ready",
        stepName: "ready",
        count: 1,
        messageId: "ready",
      }),
    ).toBe(1);
  });

  test("does not derive attempt keys for non-attempt events", () => {
    expect(
      getWorkflowEventStepAttemptKey({
        kind: "message_sent",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        messageId: "ready",
      }),
    ).toBeUndefined();
  });

  test("derives step attempt keys from descriptor attempt policy", () => {
    expect(
      getWorkflowEventStepAttemptKey({
        kind: "child_workflow_started",
        timestamp: Temporal.Instant.from("2025-01-01T00:00:00Z"),
        stepId: "workflow:child",
        stepName: "child",
        count: 1,
        attempt: 2,
        childRunId: "child-1",
        workflowName: "child",
      }),
    ).toBe("run:workflow:child:2");
  });
});
