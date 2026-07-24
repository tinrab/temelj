import { describe, expect, test } from "vitest";

import type { EventRecord } from "../../src/types/events.ts";
import type { WorkflowRunRecord } from "../../src/types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../src/types/step-attempts.ts";

import { createWorkflowRecoveryChildWorkflowWaitSummaryReducer } from "../../src/engine/summary/recovery-child-workflow-waits.ts";
import { createWorkflowRecoveryMessageWaitSummaryReducer } from "../../src/engine/summary/recovery-message-waits.ts";
import { createWorkflowRecoverySleepWaitSummaryReducer } from "../../src/engine/summary/recovery-sleep-waits.ts";
import { createWorkflowRecoveryWaitSummaryReducer } from "../../src/engine/summary/recovery-waits.ts";

describe("workflow recovery wait summary reducers", () => {
  test("summarizes recovery sleep waits independently", () => {
    const reducer = createWorkflowRecoverySleepWaitSummaryReducer(
      Temporal.Instant.from("2026-06-12T10:00:00Z"),
    );

    reducer.addAttempts([
      stepAttempt("run_sleep_due", "sleep:due", "due", "sleep", {
        until: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      }),
      stepAttempt("run_sleep_future", "sleep:future", "future", "sleep", {
        until: Temporal.Instant.from("2026-06-12T10:15:00Z"),
      }),
      stepAttempt("run_sleep_invalid", "sleep:invalid", "invalid", "sleep"),
    ]);

    expect(reducer.finish()).toEqual({
      active: 3,
      due: 2,
      runIds: ["run_sleep_due", "run_sleep_future", "run_sleep_invalid"],
      dueRunIds: ["run_sleep_due", "run_sleep_invalid"],
      dueStepIds: ["sleep:due", "sleep:invalid"],
      invalidUntilRunIds: ["run_sleep_invalid"],
      nextWakeAt: Temporal.Instant.from("2026-06-12T10:15:00Z"),
      nextWakeRunId: "run_sleep_future",
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
    const reducer = createWorkflowRecoveryMessageWaitSummaryReducer(
      new Map([["run_message_ready", [messageWaitStarted, messageSent]]]),
      Temporal.Instant.from("2026-06-12T10:00:00Z"),
    );

    reducer.addAttempts([
      stepAttempt("run_message_ready", "message-wait:approval", "approval", "message-wait", {
        messageId: "approved",
        timeoutAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
      stepAttempt("run_message_timeout", "message-wait:timeout", "timeout", "message-wait", {
        messageId: "expired",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
      }),
    ]);

    expect(reducer.finish()).toMatchObject({
      active: 2,
      ready: 1,
      timedOut: 1,
      runIds: ["run_message_ready", "run_message_timeout"],
      readyRunIds: ["run_message_ready"],
      timedOutRunIds: ["run_message_timeout"],
      readyStepIds: ["message-wait:approval"],
      timedOutStepIds: ["message-wait:timeout"],
      messages: ["approved", "expired"],
    });
  });

  test("summarizes recovery child workflow waits independently", () => {
    const reducer = createWorkflowRecoveryChildWorkflowWaitSummaryReducer(
      [
        runRecord("child_done", "completed"),
        runRecord("child_failed", "failed"),
        runRecord("child_future", "running", {
          leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        }),
      ],
      Temporal.Instant.from("2026-06-12T10:00:00Z"),
    );

    reducer.addAttempts([
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
    ]);

    expect(reducer.finish()).toMatchObject({
      active: 4,
      terminal: 2,
      missing: 1,
      timedOut: 0,
      runIds: ["run_child_done", "run_child_failed", "run_child_future", "run_child_missing"],
      terminalRunIds: ["run_child_done", "run_child_failed"],
      missingRunIds: ["run_child_missing"],
      terminalStepIds: ["workflow:done", "workflow:failed"],
      missingStepIds: ["workflow:missing"],
      childRunIds: ["child_done", "child_failed", "child_future"],
      completedChildRunIds: ["child_done"],
      failedChildRunIds: ["child_failed"],
      nextTimeoutAt: Temporal.Instant.from("2026-06-12T10:45:00Z"),
      nextTimeoutRunId: "run_child_future",
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

    const reducer = createWorkflowRecoveryWaitSummaryReducer(
      {
        childRuns: [
          runRecord("child_done", "completed"),
          runRecord("child_future", "running", {
            leaseExpiresAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
          }),
        ],
        eventsByRunId: new Map([["run_message_ready", [messageWaitStarted, messageSent]]]),
      },
      now,
    );
    reducer.addSleepAttempts([
      stepAttempt("run_sleep_due", "sleep:due", "due", "sleep", {
        until: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      }),
      stepAttempt("run_sleep_future", "sleep:future", "future", "sleep", {
        until: Temporal.Instant.from("2026-06-12T10:15:00Z"),
      }),
    ]);
    reducer.addMessageWaitAttempts([
      stepAttempt("run_message_ready", "message-wait:approval", "approval", "message-wait", {
        messageId: "approved",
        timeoutAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
      }),
      stepAttempt("run_message_timeout", "message-wait:timeout", "timeout", "message-wait", {
        messageId: "expired",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:45:00Z"),
      }),
    ]);
    reducer.addChildWorkflowAttempts([
      stepAttempt("run_child_done", "workflow:done", "done", "workflow", {
        childRunId: "child_done",
      }),
      stepAttempt("run_child_future", "workflow:future", "future", "workflow", {
        childRunId: "child_future",
        timeoutAt: Temporal.Instant.from("2026-06-12T10:45:00Z"),
      }),
    ]);

    expect(reducer.finish()).toMatchObject({
      sleep: {
        active: 2,
        due: 1,
        runIds: ["run_sleep_due", "run_sleep_future"],
        dueRunIds: ["run_sleep_due"],
        dueStepIds: ["sleep:due"],
        invalidUntilRunIds: [],
        nextWakeAt: Temporal.Instant.from("2026-06-12T10:15:00Z"),
        nextWakeRunId: "run_sleep_future",
      },
      message: {
        active: 2,
        ready: 1,
        timedOut: 1,
        runIds: ["run_message_ready", "run_message_timeout"],
        readyRunIds: ["run_message_ready"],
        timedOutRunIds: ["run_message_timeout"],
        readyStepIds: ["message-wait:approval"],
        timedOutStepIds: ["message-wait:timeout"],
        messages: ["approved", "expired"],
      },
      childWorkflow: {
        active: 2,
        terminal: 1,
        missing: 0,
        timedOut: 0,
        runIds: ["run_child_done", "run_child_future"],
        terminalRunIds: ["run_child_done"],
        terminalStepIds: ["workflow:done"],
        childRunIds: ["child_done", "child_future"],
        completedChildRunIds: ["child_done"],
        nextTimeoutAt: Temporal.Instant.from("2026-06-12T10:45:00Z"),
        nextTimeoutRunId: "run_child_future",
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

    const reducer = createWorkflowRecoveryWaitSummaryReducer(
      {
        eventsByRunId: new Map([["run_message_late", [messageWaitStarted, lateMessageSent]]]),
      },
      now,
    );
    reducer.addMessageWaitAttempts([
      stepAttempt("run_message_late", "message-wait:late", "late", "message-wait", {
        messageId: "approved",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      }),
    ]);

    expect(reducer.finish().message).toMatchObject({
      active: 1,
      ready: 0,
      timedOut: 1,
      readyRunIds: [],
      timedOutRunIds: ["run_message_late"],
      timedOutStepIds: ["message-wait:late"],
    });
  });
});

function runRecord(
  id: string,
  status: WorkflowRunRecord["status"],
  patch: Partial<WorkflowRunRecord> = {},
): WorkflowRunRecord {
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
  kind: WorkflowStepAttemptRecord["kind"],
  patch: Partial<WorkflowStepAttemptRecord> = {},
): WorkflowStepAttemptRecord {
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
