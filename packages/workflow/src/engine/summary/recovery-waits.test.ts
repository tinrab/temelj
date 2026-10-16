import { describe, expect, test } from "vitest";

import type { EventRecord } from "../../types/events.ts";
import type { RunRecord } from "../../types/run.ts";
import type { StepAttemptRecord } from "../../types/step-attempts.ts";

import { summarizeRecovery } from "./recovery.ts";

describe("workflow recovery wait summary", () => {
  test("summarizes recovery sleep waits independently", () => {
    const summary = summarizeRecovery({
      runs: [],
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      inputs: {
        sleepAttempts: [
          stepAttempt("run_sleep_due", "sleep:due", "due", "sleep", {
            until: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          }),
          stepAttempt("run_sleep_future", "sleep:future", "future", "sleep", {
            until: Temporal.Instant.from("2026-06-12T10:15:00Z"),
          }),
          stepAttempt("run_sleep_invalid", "sleep:invalid", "invalid", "sleep"),
        ],
      },
    });

    expect(summary.wait.sleep).toEqual({
      runIds: ["run_sleep_due", "run_sleep_future", "run_sleep_invalid"],
      dueRunIds: ["run_sleep_due", "run_sleep_invalid"],
      dueStepIds: ["sleep:due", "sleep:invalid"],
      invalidUntilRunIds: ["run_sleep_invalid"],
      next: { at: Temporal.Instant.from("2026-06-12T10:15:00Z"), runId: "run_sleep_future" },
    });
  });

  test("summarizes recovery message waits independently", () => {
    const messageWaitStarted = {
      kind: "message_wait_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "message-wait:approval",
      stepName: "approval",
      count: 1,
      messageId: "approved",
      timeoutAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
    } satisfies EventRecord;

    const messageSent = {
      kind: "message_sent",
      timestamp: Temporal.Instant.from("2026-06-12T09:05:00Z"),
      messageId: "approved",
      payload: { accepted: true },
      waiterStepIds: ["message-wait:approval"],
    } satisfies EventRecord;

    const summary = summarizeRecovery({
      runs: [],
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      inputs: {
        eventsByRunId: new Map([["run_message_ready", [messageWaitStarted, messageSent]]]),
        messageWaitAttempts: [
          stepAttempt("run_message_ready", "message-wait:approval", "approval", "message-wait", {
            messageId: "approved",
            timeoutAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
          }),
          stepAttempt("run_message_timeout", "message-wait:timeout", "timeout", "message-wait", {
            messageId: "expired",
            timeoutAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
          }),
        ],
      },
    });

    expect(summary.wait.message).toMatchObject({
      runIds: ["run_message_ready", "run_message_timeout"],
      readyRunIds: ["run_message_ready"],
      timedOutRunIds: ["run_message_timeout"],
      readyStepIds: ["message-wait:approval"],
      timedOutStepIds: ["message-wait:timeout"],
      messages: ["approved", "expired"],
    });
  });

  test("summarizes recovery child workflow waits independently", () => {
    const summary = summarizeRecovery({
      runs: [],
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      inputs: {
        childRuns: [
          runRecord("child_done", "completed"),
          runRecord("child_failed", "failed"),
          runRecord("child_future", "running", {
            leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
          }),
        ],
        childWorkflowAttempts: [
          stepAttempt("run_child_done", "workflow:done", "done", "workflow", {
            childRunId: "child_done",
          }),
          stepAttempt("run_child_failed", "workflow:failed", "failed", "workflow", {
            childRunId: "child_failed",
          }),
          stepAttempt("run_child_future", "workflow:future", "future", "workflow", {
            childRunId: "child_future",
            timeoutAt: Temporal.Instant.from("2026-06-12T10:45:00Z"),
          }),
          stepAttempt("run_child_missing", "workflow:missing", "missing", "workflow"),
        ],
      },
    });

    expect(summary.wait.childWorkflow).toMatchObject({
      runIds: ["run_child_done", "run_child_failed", "run_child_future", "run_child_missing"],
      terminalRunIds: ["run_child_done", "run_child_failed"],
      missingRunIds: ["run_child_missing"],
      terminalStepIds: ["workflow:done", "workflow:failed"],
      missingStepIds: ["workflow:missing"],
      childRunIds: ["child_done", "child_failed", "child_future"],
      completedChildRunIds: ["child_done"],
      failedChildRunIds: ["child_failed"],
      next: { at: Temporal.Instant.from("2026-06-12T10:45:00Z"), runId: "run_child_future" },
    });
  });

  test("summarizes due sleeps, ready messages, and terminal child workflows", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");

    const messageWaitStarted = {
      kind: "message_wait_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "message-wait:approval",
      stepName: "approval",
      count: 1,
      messageId: "approved",
      timeoutAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
    } satisfies EventRecord;

    const messageSent = {
      kind: "message_sent",
      timestamp: Temporal.Instant.from("2026-06-12T09:05:00Z"),
      messageId: "approved",
      payload: { accepted: true },
      waiterStepIds: ["message-wait:approval"],
    } satisfies EventRecord;

    const summary = summarizeRecovery({
      runs: [],
      now: now,
      inputs: {
        childRuns: [
          runRecord("child_done", "completed"),
          runRecord("child_future", "running", {
            leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
          }),
        ],
        eventsByRunId: new Map([["run_message_ready", [messageWaitStarted, messageSent]]]),
        sleepAttempts: [
          stepAttempt("run_sleep_due", "sleep:due", "due", "sleep", {
            until: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          }),
          stepAttempt("run_sleep_future", "sleep:future", "future", "sleep", {
            until: Temporal.Instant.from("2026-06-12T10:15:00Z"),
          }),
        ],
        messageWaitAttempts: [
          stepAttempt("run_message_ready", "message-wait:approval", "approval", "message-wait", {
            messageId: "approved",
            timeoutAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
          }),
          stepAttempt("run_message_timeout", "message-wait:timeout", "timeout", "message-wait", {
            messageId: "expired",
            timeoutAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
          }),
        ],
        childWorkflowAttempts: [
          stepAttempt("run_child_done", "workflow:done", "done", "workflow", {
            childRunId: "child_done",
          }),
          stepAttempt("run_child_future", "workflow:future", "future", "workflow", {
            childRunId: "child_future",
            timeoutAt: Temporal.Instant.from("2026-06-12T10:45:00Z"),
          }),
        ],
      },
    });

    expect(summary.wait).toMatchObject({
      sleep: {
        runIds: ["run_sleep_due", "run_sleep_future"],
        dueRunIds: ["run_sleep_due"],
        dueStepIds: ["sleep:due"],
        invalidUntilRunIds: [],
        next: { at: Temporal.Instant.from("2026-06-12T10:15:00Z"), runId: "run_sleep_future" },
      },
      message: {
        runIds: ["run_message_ready", "run_message_timeout"],
        readyRunIds: ["run_message_ready"],
        timedOutRunIds: ["run_message_timeout"],
        readyStepIds: ["message-wait:approval"],
        timedOutStepIds: ["message-wait:timeout"],
        messages: ["approved", "expired"],
      },
      childWorkflow: {
        runIds: ["run_child_done", "run_child_future"],
        terminalRunIds: ["run_child_done"],
        terminalStepIds: ["workflow:done"],
        childRunIds: ["child_done", "child_future"],
        completedChildRunIds: ["child_done"],
        next: { at: Temporal.Instant.from("2026-06-12T10:45:00Z"), runId: "run_child_future" },
      },
    });
  });

  test("treats messages recorded after a wait timeout as timed out", () => {
    const now = Temporal.Instant.from("2026-06-12T10:00:00Z");

    const messageWaitStarted = {
      kind: "message_wait_started",
      timestamp: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      stepId: "message-wait:late",
      stepName: "late",
      count: 1,
      messageId: "approved",
      timeoutAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
    } satisfies EventRecord;

    const lateMessageSent = {
      kind: "message_sent",
      timestamp: Temporal.Instant.from("2026-06-12T09:45:00Z"),
      messageId: "approved",
      payload: { accepted: true },
      waiterStepIds: ["message-wait:late"],
    } satisfies EventRecord;

    const summary = summarizeRecovery({
      runs: [],
      now: now,
      inputs: {
        eventsByRunId: new Map([["run_message_late", [messageWaitStarted, lateMessageSent]]]),
        messageWaitAttempts: [
          stepAttempt("run_message_late", "message-wait:late", "late", "message-wait", {
            messageId: "approved",
            timeoutAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          }),
        ],
      },
    });

    expect(summary.wait.message).toMatchObject({
      readyRunIds: [],
      timedOutRunIds: ["run_message_late"],
      timedOutStepIds: ["message-wait:late"],
    });
  });
});

function runRecord(
  id: string,
  status: RunRecord["status"],
  patch: Partial<RunRecord> = {},
): RunRecord {
  const timestamp = Temporal.Instant.from("2026-06-12T09:00:00Z");

  return {
    id,
    namespace: "default",
    workflowName: "summary",
    status,
    input: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastTransitionAt: timestamp,
    lastTransitionReason:
      status === "running" ? "claimed" : status === "failed" ? "failed" : "created",
    ...patch,
  };
}

function stepAttempt(
  runId: string,
  stepId: string,
  stepName: string,
  kind: StepAttemptRecord["kind"],
  patch: Partial<StepAttemptRecord> = {},
): StepAttemptRecord {
  const timestamp = Temporal.Instant.from("2026-06-12T09:00:00Z");

  return {
    runId,
    stepId,
    stepName,
    kind,
    status: "running",
    attempt: 1,
    createdAt: timestamp,
    startedAt: timestamp,
    ...patch,
  };
}
