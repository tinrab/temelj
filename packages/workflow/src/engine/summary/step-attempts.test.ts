import { describe, expect, test } from "vitest";

import type { RunRecord } from "../../types/run.ts";
import type { StepAttemptRecord } from "../../types/step-attempts.ts";

import { summarizeStepAttempts } from "./step-attempts.ts";

describe("workflow step-attempt summary", () => {
  test("summarizes status, kind, and failure buckets", () => {
    const summary = summarizeStepAttempts(
      [
        stepAttempt("run_one", "task:fetch", "fetch", "run", {
          status: "completed",
          attempt: 2,
          finishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        }),
        stepAttempt("run_one", "task:retry", "retry", "run", {
          status: "failed",
          attempt: 3,
          error: { name: "RetryError", message: "retry failed" },
          finishedAt: Temporal.Instant.from("2026-06-12T09:15:00Z"),
        }),
        stepAttempt("run_two", "sleep:wait", "wait", "sleep", {
          status: "failed",
          error: { name: "RetryError", message: "sleep failed" },
          finishedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
        }),
        stepAttempt("run_two", "sleep:active", "active sleep", "sleep", {
          until: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          duration: Temporal.Duration.from({ minutes: 30 }),
          startedAt: Temporal.Instant.from("2026-06-12T09:03:00Z"),
        }),
        stepAttempt("run_three", "workflow:child", "child", "workflow", {
          childRunId: "child_run",
          timeoutAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
          workflowName: "child-workflow",
          workflowVersion: "v1",
          status: "running",
          startedAt: Temporal.Instant.from("2026-06-12T09:05:00Z"),
        }),
        stepAttempt("run_four", "message-wait:approval", "approval", "message-wait", {
          messageId: "approval",
          timeoutAt: Temporal.Instant.from("2026-06-12T09:25:00Z"),
          startedAt: Temporal.Instant.from("2026-06-12T09:02:00Z"),
        }),
      ],
      [
        runRecord("child_run", "waiting", {
          workflowName: "child-workflow",
          workflowVersion: "v1",
          retryReason: "workflow",
          retryAttempt: 2,
          retryAt: Temporal.Instant.from("2026-06-12T09:35:00Z"),
        }),
      ],
    );

    expect(summary).toMatchObject({
      total: 6,
      statusStepIds: {
        running: ["message-wait:approval", "sleep:active", "workflow:child"],
        completed: ["task:fetch"],
        failed: ["sleep:wait", "task:retry"],
        abandoned: [],
      },
      statusAttemptKeys: {
        running: ["run:message-wait:approval:1", "run:sleep:active:1", "run:workflow:child:1"],
        completed: ["run:task:fetch:2"],
        failed: ["run:sleep:wait:1", "run:task:retry:3"],
        abandoned: [],
      },
      kindStepIds: {
        run: ["task:fetch", "task:retry"],
        sleep: ["sleep:active", "sleep:wait"],
        workflow: ["workflow:child"],
        "message-send": [],
        "message-wait": ["message-wait:approval"],
        stream: [],
        deterministic: [],
      },
      kindAttemptKeys: {
        run: ["run:task:fetch:2", "run:task:retry:3"],
        sleep: ["run:sleep:active:1", "run:sleep:wait:1"],
        workflow: ["run:workflow:child:1"],
        "message-send": [],
        "message-wait": ["run:message-wait:approval:1"],
        stream: [],
        deterministic: [],
      },
      failure: {
        stepIds: ["sleep:wait", "task:retry"],
        attemptKeys: ["run:sleep:wait:1", "run:task:retry:3"],
        errors: [
          {
            name: "RetryError",
            stepIds: ["sleep:wait", "task:retry"],
            attemptKeys: ["run:sleep:wait:1", "run:task:retry:3"],
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
          },
        ],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      },
      oldestRunningAt: Temporal.Instant.from("2026-06-12T09:02:00Z"),
      latestFinishedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      childWorkflow: {
        stepIds: ["workflow:child"],
        attemptKeys: ["run:workflow:child:1"],
        childRunIds: ["child_run"],
        workflows: ["child-workflow@v1"],
        childStatus: {
          pending: 0,
          running: 0,
          waiting: 1,
          completed: 0,
          failed: 0,
          canceled: 0,
        },
        retryChildRunIds: ["child_run"],
        childRetry: {
          count: 1,
          highestAttempt: 2,
          reason: { workflow: 1, step: 0, missing_implementation: 0 },
          next: { at: Temporal.Instant.from("2026-06-12T09:35:00Z"), runId: "child_run" },
        },
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:05:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T09:40:00Z"),
          stepId: "workflow:child",
          attemptKey: "run:workflow:child:1",
        },
      },
      message: {
        stepIds: ["message-wait:approval"],
        attemptKeys: ["run:message-wait:approval:1"],
        messages: ["approval"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:02:00Z"),
        next: {
          at: Temporal.Instant.from("2026-06-12T09:25:00Z"),
          stepId: "message-wait:approval",
          attemptKey: "run:message-wait:approval:1",
        },
      },
      sleep: {
        stepIds: ["sleep:active"],
        attemptKeys: ["run:sleep:active:1"],
        next: {
          at: Temporal.Instant.from("2026-06-12T09:30:00Z"),
          stepId: "sleep:active",
          attemptKey: "run:sleep:active:1",
          duration: Temporal.Duration.from({ minutes: 30 }),
        },
      },
    });
  });
});

describe("workflow step-attempt bucket summary", () => {
  test("summarizes status and kind buckets by step id and attempt key", () => {
    const summary = summarizeStepAttempts([
      stepAttempt("run_one", "task:completed", "completed", "run", {
        attempt: 2,
        status: "completed",
      }),
      stepAttempt("run_one", "sleep:running", "running", "sleep", {
        status: "running",
      }),
      stepAttempt("run_one", "task:failed", "failed", "run", {
        status: "failed",
      }),
    ]);

    expect({
      statusStepIds: summary.statusStepIds,
      statusAttemptKeys: summary.statusAttemptKeys,
      kindStepIds: summary.kindStepIds,
      kindAttemptKeys: summary.kindAttemptKeys,
    }).toEqual({
      statusStepIds: {
        running: ["sleep:running"],
        completed: ["task:completed"],
        failed: ["task:failed"],
        abandoned: [],
      },
      statusAttemptKeys: {
        running: ["run:sleep:running:1"],
        completed: ["run:task:completed:2"],
        failed: ["run:task:failed:1"],
        abandoned: [],
      },
      kindStepIds: {
        run: ["task:completed", "task:failed"],
        sleep: ["sleep:running"],
        workflow: [],
        "message-send": [],
        "message-wait": [],
        stream: [],
        deterministic: [],
      },
      kindAttemptKeys: {
        run: ["run:task:completed:2", "run:task:failed:1"],
        sleep: ["run:sleep:running:1"],
        workflow: [],
        "message-send": [],
        "message-wait": [],
        stream: [],
        deterministic: [],
      },
    });
  });
});

describe("workflow step-attempt lifecycle summary", () => {
  test("summarizes oldest running and latest finished timestamps", () => {
    const summary = summarizeStepAttempts([
      stepAttempt("run_one", "task:old-running", "old running", "run", {
        startedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        status: "running",
      }),
      stepAttempt("run_one", "task:new-running", "new running", "run", {
        startedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        status: "running",
      }),
      stepAttempt("run_one", "task:finished", "finished", "run", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        status: "completed",
      }),
    ]);

    expect({
      oldestRunningAt: summary.oldestRunningAt,
      latestFinishedAt: summary.latestFinishedAt,
    }).toEqual({
      oldestRunningAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      latestFinishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
    });
  });
});

describe("workflow step-attempt failure summary", () => {
  test("summarizes failed attempts by error name", () => {
    const summary = summarizeStepAttempts([
      stepAttempt("run_one", "task:first", "first", "run", {
        error: { name: "RetryError", message: "first failed" },
        finishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        status: "failed",
      }),
      stepAttempt("run_one", "task:second", "second", "run", {
        error: { name: "RetryError", message: "second failed" },
        finishedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
        status: "failed",
      }),
      stepAttempt("run_one", "task:completed", "completed", "run", {
        status: "completed",
      }),
    ]);

    expect({ failure: summary.failure }).toEqual({
      failure: {
        stepIds: ["task:first", "task:second"],
        attemptKeys: ["run:task:first:1", "run:task:second:1"],
        errors: [
          {
            name: "RetryError",
            stepIds: ["task:first", "task:second"],
            attemptKeys: ["run:task:first:1", "run:task:second:1"],
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
          },
        ],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      },
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
