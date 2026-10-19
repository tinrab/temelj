import { describe, expect, test } from "vitest";

import type { EventRecord } from "../../types/events.ts";

import { summarizeRuns } from "./runs.ts";

describe("workflow run activity summary", () => {
  test("keeps only streams and hooks that have not ended", () => {
    const summary = summarizeRuns({
      runs: [],
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runningEvents: [
        {
          runId: "run_events",
          events: [
            streamStarted("stream:updates", "updates", "stream_updates", "2026-06-12T09:10:00Z"),
            streamChunk("stream:updates", "updates", "stream_updates", 0),
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
      ],
    });

    expect(summary).toMatchObject({
      stream: { names: ["updates"], chunkCount: 1 },
      hook: { hookNames: ["approval"], messages: ["approval.received"] },
    });
  });

  test("summarizes active streams, hooks, and webhooks from run events", () => {
    const summary = summarizeRuns({
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
        names: ["updates"],
        chunkCount: 2,
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      },
      hook: {
        webhooks: 1,
        hookNames: ["approval"],
        webhookNames: ["webhook"],
        messages: ["approval.received", "webhook.received"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:15:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T10:00:00Z"),
          runId: "run_events_b",
          stepId: "message-wait:webhook",
        },
      },
    });
  });
});

describe("workflow run stream activity summary", () => {
  test("summarizes active streams across runs", () => {
    const summary = summarizeRuns({
      runs: [],
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runningEvents: [
        {
          runId: "run_stream_b",
          events: [
            streamStarted("stream:beta", "beta", "stream_beta", "2026-06-12T09:20:00Z"),
            streamChunk("stream:beta", "beta", "stream_beta", 0),
            streamChunk("stream:beta", "beta", "stream_beta", 1),
            streamChunk("stream:beta", "beta", "stream_beta", 2),
          ],
        },
        {
          runId: "run_stream_a",
          events: [
            streamStarted("stream:alpha", "alpha", "stream_alpha", "2026-06-12T09:10:00Z"),
            streamChunk("stream:alpha", "alpha", "stream_alpha", 0),
          ],
        },
      ],
    });

    expect(summary.stream).toEqual({
      count: 2,
      names: ["alpha", "beta"],
      chunkCount: 4,
      oldestStartedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
    });
  });

  test("omits stream summary when no active streams are present", () => {
    expect(
      summarizeRuns({ runs: [], now: Temporal.Instant.from("2026-06-12T10:00:00Z") }).stream,
    ).toBeUndefined();
  });
});

describe("workflow run hook activity summary", () => {
  test("summarizes active hooks and webhooks across runs", () => {
    const summary = summarizeRuns({
      runs: [],
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runningEvents: [
        {
          runId: "run_hook_b",
          events: [
            hookStarted(
              "message-wait:webhook",
              "webhook",
              "webhook.received",
              "webhook",
              "2026-06-12T09:20:00Z",
              "2026-06-12T10:20:00Z",
            ),
          ],
        },
        {
          runId: "run_hook_a",
          events: [
            hookStarted(
              "message-wait:approval",
              "approval",
              "approval.received",
              "hook",
              "2026-06-12T09:10:00Z",
              "2026-06-12T10:05:00Z",
            ),
          ],
        },
      ],
    });

    expect(summary.hook).toEqual({
      count: 2,
      webhooks: 1,
      hookNames: ["approval"],
      webhookNames: ["webhook"],
      messages: ["approval.received", "webhook.received"],
      oldestStartedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      next: {
        at: Temporal.Instant.from("2026-06-12T10:05:00Z"),
        runId: "run_hook_a",
        stepId: "message-wait:approval",
      },
    });
  });

  test("omits hook summary when no active hooks are present", () => {
    expect(
      summarizeRuns({ runs: [], now: Temporal.Instant.from("2026-06-12T10:00:00Z") }).hook,
    ).toBeUndefined();
  });

  test("does not report a next timeout owner when active hooks have no timeout", () => {
    const summary = summarizeRuns({
      runs: [],
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runningEvents: [
        {
          runId: "run_hook",
          events: [
            hookStarted(
              "message-wait:approval",
              "approval",
              "approval.received",
              "hook",
              "2026-06-12T09:10:00Z",
            ),
          ],
        },
      ],
    });

    expect(summary.hook).toEqual({
      count: 1,
      webhooks: 0,
      hookNames: ["approval"],
      webhookNames: [],
      messages: ["approval.received"],
      oldestStartedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
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
  timeoutAt?: string,
): EventRecord {
  return {
    kind: "message_wait_started",
    timestamp: Temporal.Instant.from(timestamp),
    stepId,
    stepName,
    count: 1,
    messageId,
    source,
    timeoutAt: timeoutAt === undefined ? undefined : Temporal.Instant.from(timeoutAt),
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
