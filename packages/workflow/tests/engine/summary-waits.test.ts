import { describe, expect, test } from "vitest";

import type { WorkflowStepAttemptRecord } from "../../src/types/step-attempts.ts";

import { summarizeWorkflowRuns } from "../../src/engine/summary.ts";
import { createWorkflowRunMessageWaitSummaryReducer } from "../../src/engine/summary/run-message-waits.ts";
import { createWorkflowRunSleepWaitSummaryReducer } from "../../src/engine/summary/run-sleeps.ts";

describe("workflow run wait activity summary reducer", () => {
  test("summarizes active sleep and message wait attempts", () => {
    const sleepDuration = Temporal.Duration.from({ minutes: 15 });
    const sleepA = [
      stepAttempt("run_sleep_a", "sleep:first", "first-sleep", "sleep", {
        attempt: 2,
        until: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        duration: sleepDuration,
      }),
    ];
    const sleepB = [
      stepAttempt("run_sleep_b", "sleep:second", "second-sleep", "sleep", {
        until: Temporal.Instant.from("2026-06-12T10:45:00Z"),
      }),
    ];
    const waitA = [
      stepAttempt("run_wait_a", "message-wait:first", "first-wait", "message-wait", {
        messageId: "first.received",
        timeoutAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
      }),
    ];
    const waitB = [
      stepAttempt("run_wait_b", "message-wait:second", "second-wait", "message-wait", {
        attempt: 3,
        messageId: "second.received",
        timeoutAt: Temporal.Instant.from("2026-06-12T10:50:00Z"),
      }),
    ];
    const summary = summarizeWorkflowRuns({
      runs: [],
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runningSleeps: [
        { runId: "run_sleep_a", attempts: sleepA },
        { runId: "run_sleep_b", attempts: sleepB },
      ],
      runningMessageWaits: [
        { runId: "run_wait_a", attempts: waitA },
        { runId: "run_wait_b", attempts: waitB },
      ],
    });

    expect(summary).toMatchObject({
      sleep: {
        activeSleeps: 2,
        activeSleepRuns: 2,
        sleepRunIds: ["run_sleep_a", "run_sleep_b"],
        sleepStepIds: ["sleep:first", "sleep:second"],
        sleepAttemptKeys: ["run_sleep_a:run:sleep:first:2", "run_sleep_b:run:sleep:second:1"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        nextWakeAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        nextWakingRunId: "run_sleep_a",
        nextWakingStepId: "sleep:first",
        nextWakingAttemptKey: "run_sleep_a:run:sleep:first:2",
        nextWakingDuration: sleepDuration,
      },
      messageId: {
        activeWaits: 2,
        activeWaitRuns: 2,
        waitRunIds: ["run_wait_a", "run_wait_b"],
        waitStepIds: ["message-wait:first", "message-wait:second"],
        waitAttemptKeys: [
          "run_wait_a:run:message-wait:first:1",
          "run_wait_b:run:message-wait:second:3",
        ],
        messages: ["first.received", "second.received"],
        oldestWaitStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        nextWaitTimeoutAt: Temporal.Instant.from("2026-06-12T10:50:00Z"),
        nextWaitTimeoutRunId: "run_wait_b",
        nextWaitTimeoutStepId: "message-wait:second",
        nextWaitTimeoutAttemptKey: "run_wait_b:run:message-wait:second:3",
      },
    });
  });
});

describe("workflow run sleep wait summary reducer", () => {
  test("summarizes active sleep attempts", () => {
    const sleepDuration = Temporal.Duration.from({ minutes: 15 });
    const reducer = createWorkflowRunSleepWaitSummaryReducer();

    reducer.addAttempt(
      "run_sleep_b",
      stepAttempt("run_sleep_b", "sleep:second", "second-sleep", "sleep", {
        until: Temporal.Instant.from("2026-06-12T10:45:00Z"),
      }),
    );
    reducer.addAttempt(
      "run_sleep_a",
      stepAttempt("run_sleep_a", "sleep:first", "first-sleep", "sleep", {
        attempt: 2,
        until: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        duration: sleepDuration,
      }),
    );

    expect(reducer.finish()).toEqual({
      sleep: {
        activeSleeps: 2,
        activeSleepRuns: 2,
        sleepRunIds: ["run_sleep_a", "run_sleep_b"],
        sleepStepIds: ["sleep:first", "sleep:second"],
        sleepAttemptKeys: ["run_sleep_a:run:sleep:first:2", "run_sleep_b:run:sleep:second:1"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        nextWakeAt: Temporal.Instant.from("2026-06-12T10:30:00Z"),
        nextWakingRunId: "run_sleep_a",
        nextWakingStepId: "sleep:first",
        nextWakingAttemptKey: "run_sleep_a:run:sleep:first:2",
        nextWakingDuration: sleepDuration,
      },
    });
  });

  test("omits sleep summary when no active sleeps are present", () => {
    const reducer = createWorkflowRunSleepWaitSummaryReducer();

    expect(reducer.finish()).toEqual({});
  });

  test("does not report a next wake owner when active sleeps have no wake time", () => {
    const reducer = createWorkflowRunSleepWaitSummaryReducer();

    reducer.addAttempt(
      "run_sleep",
      stepAttempt("run_sleep", "sleep:active", "active-sleep", "sleep"),
    );

    expect(reducer.finish()).toEqual({
      sleep: {
        activeSleeps: 1,
        activeSleepRuns: 1,
        sleepRunIds: ["run_sleep"],
        sleepStepIds: ["sleep:active"],
        sleepAttemptKeys: ["run_sleep:run:sleep:active:1"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      },
    });
  });
});

describe("workflow run message wait summary reducer", () => {
  test("summarizes active message wait attempts", () => {
    const reducer = createWorkflowRunMessageWaitSummaryReducer();

    reducer.addAttempt(
      "run_wait_a",
      stepAttempt("run_wait_a", "message-wait:first", "first-wait", "message-wait", {
        messageId: "first.received",
        timeoutAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
      }),
    );
    reducer.addAttempt(
      "run_wait_b",
      stepAttempt("run_wait_b", "message-wait:second", "second-wait", "message-wait", {
        attempt: 3,
        messageId: "second.received",
        timeoutAt: Temporal.Instant.from("2026-06-12T10:50:00Z"),
      }),
    );

    expect(reducer.finish()).toEqual({
      messageId: {
        activeWaits: 2,
        activeWaitRuns: 2,
        waitRunIds: ["run_wait_a", "run_wait_b"],
        waitStepIds: ["message-wait:first", "message-wait:second"],
        waitAttemptKeys: [
          "run_wait_a:run:message-wait:first:1",
          "run_wait_b:run:message-wait:second:3",
        ],
        messages: ["first.received", "second.received"],
        oldestWaitStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        nextWaitTimeoutAt: Temporal.Instant.from("2026-06-12T10:50:00Z"),
        nextWaitTimeoutRunId: "run_wait_b",
        nextWaitTimeoutStepId: "message-wait:second",
        nextWaitTimeoutAttemptKey: "run_wait_b:run:message-wait:second:3",
      },
    });
  });

  test("omits message wait summary when no active waits are present", () => {
    const reducer = createWorkflowRunMessageWaitSummaryReducer();

    expect(reducer.finish()).toEqual({});
  });

  test("does not report a next timeout owner when active waits have no timeout", () => {
    const reducer = createWorkflowRunMessageWaitSummaryReducer();

    reducer.addAttempt(
      "run_wait",
      stepAttempt("run_wait", "message-wait:approval", "approval", "message-wait", {
        messageId: "approval.received",
      }),
    );

    expect(reducer.finish()).toEqual({
      messageId: {
        activeWaits: 1,
        activeWaitRuns: 1,
        waitRunIds: ["run_wait"],
        waitStepIds: ["message-wait:approval"],
        waitAttemptKeys: ["run_wait:run:message-wait:approval:1"],
        messages: ["approval.received"],
        oldestWaitStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      },
    });
  });
});

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
