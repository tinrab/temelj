import { describe, expect, test } from "vitest";

import type {
  EventRecord,
  MessageWaitCompletedEvent,
  SleepCompletedEvent,
} from "../../src/types/events.ts";
import type { WorkflowStepAttemptRecord } from "../../src/types/step-attempts.ts";

import { WorkflowHistory } from "../../src/history/mod.ts";

describe("workflow replay projection", () => {
  test("indexes whether terminal events have a matching started event before them", () => {
    const completedAfterStart = stepCompleted("run:load", 1);
    const completedBeforeStart = stepCompleted("run:late", 1);
    const staleMessageWaitCompleted = messageWaitCompleted("message-wait:approval");
    const events: EventRecord[] = [
      stepStarted("run:load", 1),
      completedAfterStart,
      completedBeforeStart,
      staleMessageWaitCompleted,
      messageWaitStarted("message-wait:approval"),
      stepStarted("run:late", 1),
    ];

    const history = new WorkflowHistory(events);

    expect(history.hasStartedEventBeforeTerminalEvent(completedAfterStart)).toBe(true);
    expect(history.hasStartedEventBeforeTerminalEvent(completedBeforeStart)).toBe(false);
    expect(history.hasStartedEventBeforeTerminalEvent(staleMessageWaitCompleted)).toBe(false);
  });

  test("rejects duplicate started events for the same step attempt", () => {
    const history = new WorkflowHistory([
      stepStarted("run:duplicate-start", 1),
      stepStarted("run:duplicate-start", 1),
    ]);

    expect(() => history.requireStartedEventsAreUnique()).toThrow(
      "recorded run step run:duplicate-start has multiple started events for attempt 1",
    );
  });

  test("rejects duplicate terminal events for the same step attempt", () => {
    const history = new WorkflowHistory([
      stepStarted("run:duplicate-terminal", 1),
      stepCompleted("run:duplicate-terminal", 1),
      stepCompleted("run:duplicate-terminal", 1),
    ]);

    expect(() => history.requireTerminalEventsAreUnique()).toThrow(
      "recorded run step run:duplicate-terminal has multiple terminal events for attempt 1",
    );
  });

  test("rejects terminal events without a matching earlier started event", () => {
    const history = new WorkflowHistory([stepCompleted("run:missing-start", 1)]);

    expect(() => history.requireTerminalEventsHaveStartedEvents()).toThrow(
      "recorded run step run:missing-start has a terminal event without a started event",
    );
  });

  test("indexes failed step events that do not have an earlier start", () => {
    const history = new WorkflowHistory([
      stepStarted("run:started", 1),
      stepFailed("run:started", 1),
      stepFailed("run:late-start", 1),
      stepStarted("run:late-start", 1),
    ]);

    expect(history.unstartedFailedStep("run:started")).toBeUndefined();
    expect(history.unstartedFailedStep("run:late-start")).toMatchObject({
      kind: "step_failed",
      stepId: "run:late-start",
    });
  });

  test("allows stale message wait terminal events before a later matching start", () => {
    const history = new WorkflowHistory([
      messageWaitCompleted("message-wait:approval"),
      messageWaitStarted("message-wait:approval"),
    ]);

    expect(() => history.requireTerminalEventsHaveStartedEvents()).not.toThrow();
  });

  test("rejects command sequence divergence when replay encounters a different next step", () => {
    const history = new WorkflowHistory([stepStarted("run:first", 1)]);

    expect(() => history.nextStep("run", "second")).toThrow(
      "expected recorded run step run:first, but encountered run step run:second",
    );
  });

  test("reports unconsumed replayed commands after handler execution", () => {
    const history = new WorkflowHistory([
      stepStarted("run:first", 1, "first"),
      stepStarted("run:second", 1, "second"),
    ]);

    expect(history.isReplayConsumed()).toBe(false);
    expect(history.nextStep("run", "first")).toMatchObject({
      id: "run:first",
      name: "first",
      count: 1,
      kind: "run",
    });
    expect(history.isReplayConsumed()).toBe(false);
    expect(() => history.requireReplayConsumed()).toThrow(
      "recorded step run:second was not encountered by the workflow handler",
    );
  });

  test("indexes next run step attempt by highest recorded started attempt", () => {
    const history = new WorkflowHistory([
      stepStarted("run:retry", 1),
      stepStarted("run:retry", 3),
      stepStarted("run:other", 2),
    ]);

    expect(history.nextStepAttempt("run:retry")).toBe(4);
    expect(history.nextStepAttempt("run:other")).toBe(3);
    expect(history.nextStepAttempt("run:new")).toBe(1);
  });

  test("preserves invalid started attempt errors through the replay projection", () => {
    const history = new WorkflowHistory([stepStarted("run:invalid", 0)]);

    expect(() => history.nextStepAttempt("run:invalid")).toThrow(
      "recorded run step run:invalid has an invalid attempt number",
    );
  });

  test("finds messages for waits from the replay projection", () => {
    const history = new WorkflowHistory([
      messageSent("approval.received", "too-early"),
      messageWaitStarted("message-wait:approval"),
      messageSent("approval.received", "wrong-waiter", ["message-wait:other"]),
      messageSent("approval.received", "ready", ["message-wait:approval"]),
    ]);

    expect(
      history.messageForWait("approval.received", "message-wait:approval", undefined),
    ).toMatchObject({
      payload: "ready",
    });
  });

  test("indexes active message wait step ids by message id", () => {
    const history = new WorkflowHistory([
      messageWaitStarted("message-wait:approval"),
      messageWaitStarted("message-wait:review"),
      messageWaitStarted("message-wait:other", "other.received"),
      messageWaitCompleted("message-wait:review"),
    ]);

    expect(history.activeMessageWaitStepIds("approval.received")).toEqual([
      "message-wait:approval",
    ]);
    expect(history.activeMessageWaitStepIds("other.received")).toEqual(["message-wait:other"]);
  });

  test("keeps an active message wait when a stale terminal has the wrong step name", () => {
    const history = new WorkflowHistory([
      messageWaitStarted("message-wait:approval", "approval.received", "approval"),
      messageWaitCompleted("message-wait:approval", "approval.received", "old-approval"),
    ]);

    expect(history.activeMessageWaitStepIds("approval.received")).toEqual([
      "message-wait:approval",
    ]);
  });

  test("indexes sent messages by idempotency key and latest message id", () => {
    const history = new WorkflowHistory([
      messageSent("approval.received", "first", undefined, "send-once"),
      messageSent("approval.received", "latest", undefined, "send-again"),
      messageSent("approval.received", "latest-once", undefined, "send-once"),
    ]);

    expect(history.messageForSend("approval.received", undefined)).toMatchObject({
      payload: "latest-once",
    });
    expect(history.messageForSend("approval.received", "send-once")).toMatchObject({
      payload: "first",
    });
    expect(history.latestMessagesByIdempotencyKey()).toMatchObject([
      { idempotencyKey: "send-once", payload: "latest-once" },
      { idempotencyKey: "send-again", payload: "latest" },
    ]);
  });

  test("indexes stream chunks by step id and chunk index", () => {
    const history = new WorkflowHistory([
      streamStarted("stream:progress"),
      streamChunk("stream:progress", 0, "first"),
      streamChunk("stream:progress", 0, "duplicate"),
      streamChunk("stream:progress", 1, "second"),
    ]);

    expect(history.streamChunk("stream:progress", 0)).toMatchObject({ chunk: "first" });
    expect(history.streamChunk("stream:progress", 1)).toMatchObject({ chunk: "second" });
    expect(history.streamChunk("stream:progress", 2)).toBeUndefined();
  });

  test("projects stream events by stream id or name", () => {
    const history = new WorkflowHistory([
      streamStarted("stream:progress", "progress", "log"),
      streamChunk("stream:progress", 0, "first", "progress"),
      streamChunk("stream:progress", 1, "second", "progress"),
      streamClosed("stream:progress", "progress"),
    ]);

    expect(history.streamProjection("log")).toMatchObject({
      started: {
        kind: "stream_started",
        stepName: "log",
      },
      chunks: [{ event: { index: 0, chunk: "first" } }, { event: { index: 1, chunk: "second" } }],
      closed: { event: { kind: "stream_closed" } },
    });
    expect(history.streamProjection("progress")?.started.stepName).toBe("log");
  });

  test("finds started events for completed sleep and message waits", () => {
    const completedSleep = sleepCompleted("sleep:pause");
    const completedWait = messageWaitCompleted("message-wait:approval");
    const history = new WorkflowHistory([
      sleepStarted("sleep:pause"),
      completedSleep,
      messageWaitStarted("message-wait:approval"),
      completedWait,
    ]);

    expect(history.startedSleepForCompleted(completedSleep)).toMatchObject({
      kind: "sleep_started",
      stepId: "sleep:pause",
    });
    expect(history.startedMessageWaitForCompleted(completedWait)).toMatchObject({
      kind: "message_wait_started",
      stepId: "message-wait:approval",
    });
  });

  test("finds sent messages by message timestamp", () => {
    const timestamp = Temporal.Instant.from("2026-06-12T09:03:00Z");
    const history = new WorkflowHistory([
      messageSent("approval.received", "first", undefined, undefined, timestamp),
      messageSent(
        "approval.received",
        "second",
        undefined,
        undefined,
        timestamp.add({ seconds: 1 }),
      ),
    ]);

    expect(history.messageSentByTimestamp("approval.received", timestamp)).toMatchObject({
      payload: "first",
    });
  });

  test("finds child workflow lifecycle for a materialized attempt", () => {
    const attempt = childWorkflowAttempt("child-workflow:invoice", "run_child_invoice");
    const history = new WorkflowHistory([childWorkflowStarted("child-workflow:invoice")]);

    expect(history.childWorkflowLifecycleForAttempt(attempt)).toMatchObject({
      started: {
        kind: "child_workflow_started",
        childRunId: "run_child_invoice",
      },
      hasTerminalAfterStarted: false,
    });
  });

  test("marks child workflow lifecycle terminal after the matching start", () => {
    const attempt = childWorkflowAttempt("child-workflow:invoice", "run_child_invoice");
    const history = new WorkflowHistory([
      childWorkflowStarted("child-workflow:invoice"),
      childWorkflowCompleted("child-workflow:other", "run_child_invoice"),
      childWorkflowCompleted("child-workflow:invoice", "run_child_invoice"),
    ]);

    expect(history.childWorkflowLifecycleForAttempt(attempt)).toMatchObject({
      hasTerminalAfterStarted: true,
    });
  });

  test("ignores messages recorded after a wait timeout", () => {
    const history = new WorkflowHistory([
      messageWaitStarted("message-wait:approval"),
      messageSent("approval.received", "late"),
    ]);

    expect(
      history.messageForWait(
        "approval.received",
        "message-wait:approval",
        Temporal.Instant.from("2026-06-12T09:02:30Z"),
      ),
    ).toBeUndefined();
  });
});

function stepStarted(stepId: string, attempt: number, stepName = stepId): EventRecord {
  return {
    kind: "step_started",
    timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
    stepId,
    stepName,
    count: 1,
    attempt,
  };
}

function stepCompleted(stepId: string, attempt: number): EventRecord {
  return {
    kind: "step_completed",
    timestamp: Temporal.Instant.from("2026-06-12T09:01:00Z"),
    stepId,
    stepName: stepId,
    attempt,
  };
}

function stepFailed(stepId: string, attempt: number): EventRecord {
  return {
    kind: "step_failed",
    timestamp: Temporal.Instant.from("2026-06-12T09:01:00Z"),
    stepId,
    stepName: stepId,
    attempt,
    error: {
      name: "Error",
      message: "failed",
    },
  };
}

function messageWaitStarted(
  stepId: string,
  messageId = "approval.received",
  stepName = stepId,
): EventRecord {
  return {
    kind: "message_wait_started",
    timestamp: Temporal.Instant.from("2026-06-12T09:02:00Z"),
    stepId,
    stepName,
    count: 1,
    messageId,
  };
}

function messageWaitCompleted(
  stepId: string,
  messageId = "approval.received",
  stepName = stepId,
): MessageWaitCompletedEvent {
  return {
    kind: "message_wait_completed",
    timestamp: Temporal.Instant.from("2026-06-12T09:01:30Z"),
    stepId,
    stepName,
    messageId,
    messageTimestamp: Temporal.Instant.from("2026-06-12T09:01:20Z"),
  };
}

function messageSent(
  messageId: string,
  payload: string,
  waiterStepIds?: readonly string[],
  idempotencyKey?: string,
  timestamp = Temporal.Instant.from("2026-06-12T09:03:00Z"),
): EventRecord {
  return {
    kind: "message_sent",
    timestamp,
    messageId,
    payload,
    ...(waiterStepIds === undefined ? {} : { waiterStepIds }),
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
  };
}

function sleepStarted(stepId: string): EventRecord {
  return {
    kind: "sleep_started",
    timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
    stepId,
    stepName: stepId,
    count: 1,
    until: Temporal.Instant.from("2026-06-12T09:01:00Z"),
  };
}

function sleepCompleted(stepId: string): SleepCompletedEvent {
  return {
    kind: "sleep_completed",
    timestamp: Temporal.Instant.from("2026-06-12T09:01:00Z"),
    stepId,
    stepName: stepId,
  };
}

function streamStarted(stepId: string, streamId = "progress", stepName = stepId): EventRecord {
  return {
    kind: "stream_started",
    timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
    stepId,
    stepName,
    count: 1,
    streamId,
  };
}

function streamChunk(
  stepId: string,
  index: number,
  chunk: string,
  streamId = "progress",
): EventRecord {
  return {
    kind: "stream_chunk",
    timestamp: Temporal.Instant.from("2026-06-12T09:01:00Z"),
    stepId,
    stepName: stepId,
    streamId,
    index,
    chunk,
  };
}

function streamClosed(stepId: string, streamId = "progress"): EventRecord {
  return {
    kind: "stream_closed",
    timestamp: Temporal.Instant.from("2026-06-12T09:02:00Z"),
    stepId,
    stepName: stepId,
    streamId,
  };
}

function childWorkflowAttempt(stepId: string, childRunId: string): WorkflowStepAttemptRecord {
  return {
    runId: "run_parent",
    stepId,
    stepName: stepId,
    kind: "workflow",
    status: "running",
    attempt: 1,
    count: 1,
    childRunId,
    workflowName: "invoice-child",
    cancellation: "cascade",
    createdAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
    startedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
  };
}

function childWorkflowStarted(stepId: string, childRunId = "run_child_invoice"): EventRecord {
  return {
    kind: "child_workflow_started",
    timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
    stepId,
    stepName: stepId,
    count: 1,
    attempt: 1,
    childRunId,
    workflowName: "invoice-child",
    cancellation: "cascade",
  };
}

function childWorkflowCompleted(stepId: string, childRunId: string): EventRecord {
  return {
    kind: "child_workflow_completed",
    timestamp: Temporal.Instant.from("2026-06-12T09:01:00Z"),
    stepId,
    stepName: stepId,
    attempt: 1,
    childRunId,
  };
}
