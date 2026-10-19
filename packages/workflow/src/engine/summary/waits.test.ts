import { describe, expect, test } from "vitest";

import type { StepAttemptRecord } from "../../types/step-attempts.ts";

import { summarizeRuns } from "./runs.ts";

describe("workflow run wait activity summary", () => {
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

    const summary = summarizeRuns({
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
        count: 2,
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T10:30:00Z"),
          runId: "run_sleep_a",
          stepId: "sleep:first",
          attemptKey: "run_sleep_a:run:sleep:first:2",
          duration: sleepDuration,
        },
      },
      message: {
        count: 2,
        messages: ["first.received", "second.received"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T10:50:00Z"),
          runId: "run_wait_b",
          stepId: "message-wait:second",
          attemptKey: "run_wait_b:run:message-wait:second:3",
        },
      },
    });
  });
});

describe("workflow run sleep wait summary", () => {
  test("summarizes active sleep attempts", () => {
    const sleepDuration = Temporal.Duration.from({ minutes: 15 });

    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [],
      runningSleeps: [
        {
          runId: "run_sleep_b",
          attempts: [
            stepAttempt("run_sleep_b", "sleep:second", "second-sleep", "sleep", {
              until: Temporal.Instant.from("2026-06-12T10:45:00Z"),
            }),
          ],
        },
        {
          runId: "run_sleep_a",
          attempts: [
            stepAttempt("run_sleep_a", "sleep:first", "first-sleep", "sleep", {
              attempt: 2,
              until: Temporal.Instant.from("2026-06-12T10:30:00Z"),
              duration: sleepDuration,
            }),
          ],
        },
      ],
    });

    expect({ sleep: summary.sleep }).toEqual({
      sleep: {
        count: 2,
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T10:30:00Z"),
          runId: "run_sleep_a",
          stepId: "sleep:first",
          attemptKey: "run_sleep_a:run:sleep:first:2",
          duration: sleepDuration,
        },
      },
    });
  });

  test("omits sleep summary when no active sleeps are present", () => {
    const summary = summarizeRuns({ now: Temporal.Instant.from("2026-06-12T10:00:00Z"), runs: [] });

    expect({ sleep: summary.sleep }).toEqual({});
  });

  test("does not report a next wake owner when active sleeps have no wake time", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [],
      runningSleeps: [
        {
          runId: "run_sleep",
          attempts: [stepAttempt("run_sleep", "sleep:active", "active-sleep", "sleep")],
        },
      ],
    });

    expect({ sleep: summary.sleep }).toEqual({
      sleep: { count: 1, oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z") },
    });
  });
});

describe("workflow run message wait summary", () => {
  test("summarizes active message wait attempts", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [],
      runningMessageWaits: [
        {
          runId: "run_wait_a",
          attempts: [
            stepAttempt("run_wait_a", "message-wait:first", "first-wait", "message-wait", {
              messageId: "first.received",
              timeoutAt: Temporal.Instant.from("2026-06-12T11:00:00Z"),
            }),
          ],
        },
        {
          runId: "run_wait_b",
          attempts: [
            stepAttempt("run_wait_b", "message-wait:second", "second-wait", "message-wait", {
              attempt: 3,
              messageId: "second.received",
              timeoutAt: Temporal.Instant.from("2026-06-12T10:50:00Z"),
            }),
          ],
        },
      ],
    });

    expect({ message: summary.message }).toEqual({
      message: {
        count: 2,
        messages: ["first.received", "second.received"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T10:50:00Z"),
          runId: "run_wait_b",
          stepId: "message-wait:second",
          attemptKey: "run_wait_b:run:message-wait:second:3",
        },
      },
    });
  });

  test("omits message wait summary when no active waits are present", () => {
    const summary = summarizeRuns({ now: Temporal.Instant.from("2026-06-12T10:00:00Z"), runs: [] });

    expect({ message: summary.message }).toEqual({});
  });

  test("does not report a next timeout owner when active waits have no timeout", () => {
    const summary = summarizeRuns({
      now: Temporal.Instant.from("2026-06-12T10:00:00Z"),
      runs: [],
      runningMessageWaits: [
        {
          runId: "run_wait",
          attempts: [
            stepAttempt("run_wait", "message-wait:approval", "approval", "message-wait", {
              messageId: "approval.received",
            }),
          ],
        },
      ],
    });

    expect({ message: summary.message }).toEqual({
      message: {
        count: 1,
        messages: ["approval.received"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      },
    });
  });
});

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
