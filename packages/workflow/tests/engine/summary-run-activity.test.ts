import { describe, expect, test } from "vitest";

import type { EventRecord } from "../../src/types/events.ts";

import { summarizeWorkflowRuns } from "../../src/engine/summary.ts";
import { createActiveWorkflowEventSummaryReducer } from "../../src/engine/summary/active-events.ts";
import { createWorkflowRunHookActivitySummaryReducer } from "../../src/engine/summary/run-hooks.ts";
import { createWorkflowRunStreamActivitySummaryReducer } from "../../src/engine/summary/run-streams.ts";

describe("workflow run event activity summary reducer", () => {
  test("summarizes active events within one run before cross-run aggregation", () => {
    const reducer = createActiveWorkflowEventSummaryReducer();
    reducer.addEvent(
      streamStarted("stream:updates", "updates", "stream_updates", "2026-06-12T09:10:00Z"),
    );
    reducer.addEvent(streamChunk("stream:updates", "updates", "stream_updates", 0));
    reducer.addEvent(
      streamStarted("stream:closed", "closed", "stream_closed", "2026-06-12T09:05:00Z"),
    );
    reducer.addEvent(streamClosed("stream:closed", "closed", "stream_closed"));
    reducer.addEvent(
      hookStarted(
        "message-wait:approval",
        "approval",
        "approval.received",
        "hook",
        "2026-06-12T09:20:00Z",
        "2026-06-12T10:20:00Z",
      ),
    );
    reducer.addEvent(
      hookStarted(
        "message-wait:completed",
        "completed",
        "completed.received",
        "hook",
        "2026-06-12T09:12:00Z",
        "2026-06-12T10:05:00Z",
      ),
    );
    reducer.addEvent(hookCompleted("message-wait:completed", "completed"));

    expect(reducer.finish()).toMatchObject({
      streams: [
        {
          stepId: "stream:updates",
          stepName: "updates",
          streamId: "stream_updates",
          chunkCount: 1,
        },
      ],
      hooks: [
        {
          stepId: "message-wait:approval",
          name: "approval",
          messageId: "approval.received",
          source: "hook",
        },
      ],
    });
  });

  test("summarizes active streams, hooks, and webhooks from run events", () => {
    const summary = summarizeWorkflowRuns({
      runs: [],
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runningEvents: [
        {
          runId: "run_events_a",
          events: [
            streamStarted("stream:updates", "updates", "stream_updates", "2026-06-12T09:10:00Z"),
            streamChunk("stream:updates", "updates", "stream_updates", 0),
            streamChunk("stream:updates", "updates", "stream_updates", 1),
            streamStarted("stream:closed", "closed", "stream_closed", "2026-06-12T09:05:00Z"),
            streamClosed("stream:closed", "closed", "stream_closed"),
            hookStarted(
              "message-wait:approval",
              "approval",
              "approval.received",
              "hook",
              "2026-06-12T09:20:00Z",
              "2026-06-12T10:20:00Z",
            ),
            hookStarted(
              "message-wait:completed",
              "completed",
              "completed.received",
              "hook",
              "2026-06-12T09:12:00Z",
              "2026-06-12T10:05:00Z",
            ),
            hookCompleted("message-wait:completed", "completed"),
          ],
        },
        {
          runId: "run_events_b",
          events: [
            hookStarted(
              "message-wait:webhook",
              "webhook",
              "webhook.received",
              "webhook",
              "2026-06-12T09:15:00Z",
              "2026-06-12T10:00:00Z",
            ),
            hookStarted(
              "message-wait:failed-webhook",
              "failed-webhook",
              "failed-webhook.received",
              "webhook",
              "2026-06-12T09:01:00Z",
              "2026-06-12T09:50:00Z",
            ),
            hookFailed("message-wait:failed-webhook", "failed-webhook"),
          ],
        },
      ],
    });

    expect(summary).toMatchObject({
      stream: {
        activeStreams: 1,
        activeStreamRuns: 1,
        streamRunIds: ["run_events_a"],
        streamStepIds: ["stream:updates"],
        streamIds: ["stream_updates"],
        streamNames: ["updates"],
        chunkCount: 2,
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      },
      hook: {
        activeHooks: 1,
        activeWebhooks: 1,
        activeHookRuns: 2,
        hookRunIds: ["run_events_a", "run_events_b"],
        hookStepIds: ["message-wait:approval", "message-wait:webhook"],
        hookNames: ["approval"],
        webhookNames: ["webhook"],
        messages: ["approval.received", "webhook.received"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:15:00Z"),
        nextTimeoutAt: Temporal.Instant.from("2026-06-12T10:00:00Z"),
        nextTimeoutRunId: "run_events_b",
        nextTimeoutStepId: "message-wait:webhook",
      },
    });
  });
});

describe("workflow run stream activity summary reducer", () => {
  test("summarizes active streams across runs", () => {
    const reducer = createWorkflowRunStreamActivitySummaryReducer();

    reducer.addStream("run_stream_b", {
      stepId: "stream:beta",
      stepName: "beta",
      streamId: "stream_beta",
      startedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      chunkCount: 3,
    });
    reducer.addStream("run_stream_a", {
      stepId: "stream:alpha",
      stepName: "alpha",
      streamId: "stream_alpha",
      startedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      chunkCount: 1,
    });

    expect(reducer.finish()).toEqual({
      stream: {
        activeStreams: 2,
        activeStreamRuns: 2,
        streamRunIds: ["run_stream_a", "run_stream_b"],
        streamStepIds: ["stream:alpha", "stream:beta"],
        streamIds: ["stream_alpha", "stream_beta"],
        streamNames: ["alpha", "beta"],
        chunkCount: 4,
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      },
    });
  });

  test("omits stream summary when no active streams are present", () => {
    const reducer = createWorkflowRunStreamActivitySummaryReducer();

    expect(reducer.finish()).toEqual({});
  });
});

describe("workflow run hook activity summary reducer", () => {
  test("summarizes active hooks and webhooks across runs", () => {
    const reducer = createWorkflowRunHookActivitySummaryReducer();

    reducer.addHook("run_hook_b", {
      stepId: "message-wait:webhook",
      name: "webhook",
      messageId: "webhook.received",
      source: "webhook",
      startedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      timeoutAt: Temporal.Instant.from("2026-06-12T10:20:00Z"),
    });
    reducer.addHook("run_hook_a", {
      stepId: "message-wait:approval",
      name: "approval",
      messageId: "approval.received",
      source: "hook",
      startedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      timeoutAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
    });

    expect(reducer.finish()).toEqual({
      hook: {
        activeHooks: 1,
        activeWebhooks: 1,
        activeHookRuns: 2,
        hookRunIds: ["run_hook_a", "run_hook_b"],
        hookStepIds: ["message-wait:approval", "message-wait:webhook"],
        hookNames: ["approval"],
        webhookNames: ["webhook"],
        messages: ["approval.received", "webhook.received"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        nextTimeoutAt: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        nextTimeoutRunId: "run_hook_a",
        nextTimeoutStepId: "message-wait:approval",
      },
    });
  });

  test("omits hook summary when no active hooks are present", () => {
    const reducer = createWorkflowRunHookActivitySummaryReducer();

    expect(reducer.finish()).toEqual({});
  });

  test("does not report a next timeout owner when active hooks have no timeout", () => {
    const reducer = createWorkflowRunHookActivitySummaryReducer();

    reducer.addHook("run_hook", {
      stepId: "message-wait:approval",
      name: "approval",
      messageId: "approval.received",
      source: "hook",
      startedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
    });

    expect(reducer.finish()).toEqual({
      hook: {
        activeHooks: 1,
        activeWebhooks: 0,
        activeHookRuns: 1,
        hookRunIds: ["run_hook"],
        hookStepIds: ["message-wait:approval"],
        hookNames: ["approval"],
        webhookNames: [],
        messages: ["approval.received"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      },
    });
  });
});

function streamStarted(
  stepId: string,
  stepName: string,
  streamId: string,
  timestamp: string,
): EventRecord {
  return {
    kind: "stream_started",
    timestamp: Temporal.Instant.from(timestamp),
    stepId,
    stepName,
    count: 1,
    streamId,
  };
}

function streamChunk(
  stepId: string,
  stepName: string,
  streamId: string,
  index: number,
): EventRecord {
  return {
    kind: "stream_chunk",
    timestamp: Temporal.Instant.from("2026-06-12T09:30:00Z"),
    stepId,
    stepName,
    streamId,
    index,
  };
}

function streamClosed(stepId: string, stepName: string, streamId: string): EventRecord {
  return {
    kind: "stream_closed",
    timestamp: Temporal.Instant.from("2026-06-12T09:35:00Z"),
    stepId,
    stepName,
    streamId,
  };
}

function hookStarted(
  stepId: string,
  stepName: string,
  messageId: string,
  source: "hook" | "webhook",
  timestamp: string,
  timeoutAt: string,
): EventRecord {
  return {
    kind: "message_wait_started",
    timestamp: Temporal.Instant.from(timestamp),
    stepId,
    stepName,
    count: 1,
    messageId,
    source,
    timeoutAt: Temporal.Instant.from(timeoutAt),
  };
}

function hookCompleted(stepId: string, stepName: string): EventRecord {
  return {
    kind: "message_wait_completed",
    timestamp: Temporal.Instant.from("2026-06-12T09:40:00Z"),
    stepId,
    stepName,
    messageId: `${stepName}.received`,
    messageTimestamp: Temporal.Instant.from("2026-06-12T09:39:00Z"),
    payload: { ok: true },
  };
}

function hookFailed(stepId: string, stepName: string): EventRecord {
  return {
    kind: "message_wait_failed",
    timestamp: Temporal.Instant.from("2026-06-12T09:41:00Z"),
    stepId,
    stepName,
    messageId: `${stepName}.received`,
    error: { name: "HookFailure", message: "hook failed" },
  };
}
