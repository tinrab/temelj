import { describe, expect, test } from "vitest";

import type { WorkflowRunRecord } from "../../src/types/run.ts";
import type { WorkflowStepAttemptRecord } from "../../src/types/step-attempts.ts";

import { createWorkflowStepAttemptBucketSummaryReducer } from "../../src/engine/summary/step-attempt-buckets.ts";
import { createWorkflowStepAttemptFailureSummaryReducer } from "../../src/engine/summary/step-attempt-failure.ts";
import { createWorkflowStepAttemptLifecycleSummaryReducer } from "../../src/engine/summary/step-attempt-lifecycle.ts";
import { createWorkflowStepAttemptSummaryReducer } from "../../src/engine/summary/step-attempts.ts";

describe("workflow step-attempt summary reducer", () => {
  test("summarizes status, kind, and failure buckets", () => {
    const reducer = createWorkflowStepAttemptSummaryReducer([
      runRecord("child_run", "waiting", {
        workflowName: "child-workflow",
        workflowVersion: "v1",
        retryReason: "workflow",
        retryAttempt: 2,
        retryAt: Temporal.Instant.from("2026-06-12T09:35:00Z"),
      }),
    ]);
    reducer.addAttempt(
      stepAttempt("run_one", "task:fetch", "fetch", "run", {
        status: "completed",
        attempt: 2,
        finishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
      }),
    );
    reducer.addAttempt(
      stepAttempt("run_one", "task:retry", "retry", "run", {
        status: "failed",
        attempt: 3,
        error: { name: "RetryError", message: "retry failed" },
        finishedAt: Temporal.Instant.from("2026-06-12T09:15:00Z"),
      }),
    );
    reducer.addAttempt(
      stepAttempt("run_two", "sleep:wait", "wait", "sleep", {
        status: "failed",
        error: { name: "RetryError", message: "sleep failed" },
        finishedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      }),
    );
    reducer.addAttempt(
      stepAttempt("run_two", "sleep:active", "active sleep", "sleep", {
        until: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        duration: Temporal.Duration.from({ minutes: 30 }),
        startedAt: Temporal.Instant.from("2026-06-12T09:03:00Z"),
      }),
    );
    reducer.addAttempt(
      stepAttempt("run_three", "workflow:child", "child", "workflow", {
        childRunId: "child_run",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
        workflowName: "child-workflow",
        workflowVersion: "v1",
        status: "running",
        startedAt: Temporal.Instant.from("2026-06-12T09:05:00Z"),
      }),
    );
    reducer.addAttempt(
      stepAttempt("run_four", "message-wait:approval", "approval", "message-wait", {
        messageId: "approval",
        timeoutAt: Temporal.Instant.from("2026-06-12T09:25:00Z"),
        startedAt: Temporal.Instant.from("2026-06-12T09:02:00Z"),
      }),
    );

    expect(reducer.finish()).toMatchObject({
      total: 6,
      status: { running: 3, completed: 1, failed: 2, abandoned: 0 },
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
      kind: {
        run: 2,
        sleep: 2,
        workflow: 1,
        "message-send": 0,
        "message-wait": 1,
        stream: 0,
        deterministic: 0,
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
        total: 2,
        failedStepIds: ["sleep:wait", "task:retry"],
        failedAttemptKeys: ["run:sleep:wait:1", "run:task:retry:3"],
        errors: [
          {
            name: "RetryError",
            count: 2,
            failedStepIds: ["sleep:wait", "task:retry"],
            failedAttemptKeys: ["run:sleep:wait:1", "run:task:retry:3"],
            latestFailedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
          },
        ],
        latestFailedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      },
      oldestRunningAt: Temporal.Instant.from("2026-06-12T09:02:00Z"),
      latestFinishedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
      activeSleepStepIds: ["sleep:active"],
      activeSleepAttemptKeys: ["run:sleep:active:1"],
      nextSleepUntil: Temporal.Instant.from("2026-06-12T09:30:00Z"),
      nextSleepStepId: "sleep:active",
      nextSleepAttemptKey: "run:sleep:active:1",
      nextSleepDuration: Temporal.Duration.from({ minutes: 30 }),
      activeChildWorkflows: {
        total: 1,
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
          total: 1,
          retryRunIds: ["child_run"],
          nextRetryAt: Temporal.Instant.from("2026-06-12T09:35:00Z"),
          nextRetryRunId: "child_run",
          highestAttempt: 2,
          reason: { workflow: 1, step: 0, missing_implementation: 0 },
        },
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:05:00Z"),
        nextTimeoutAt: Temporal.Instant.from("2026-06-12T09:40:00Z"),
        nextTimeoutStepId: "workflow:child",
        nextTimeoutAttemptKey: "run:workflow:child:1",
      },
      activeMessageWaits: {
        total: 1,
        stepIds: ["message-wait:approval"],
        attemptKeys: ["run:message-wait:approval:1"],
        messages: ["approval"],
        oldestStartedAt: Temporal.Instant.from("2026-06-12T09:02:00Z"),
        nextTimeoutAt: Temporal.Instant.from("2026-06-12T09:25:00Z"),
        nextTimeoutStepId: "message-wait:approval",
        nextTimeoutAttemptKey: "run:message-wait:approval:1",
      },
    });
  });
});

describe("workflow step-attempt bucket summary reducer", () => {
  test("summarizes status and kind buckets by step id and attempt key", () => {
    const reducer = createWorkflowStepAttemptBucketSummaryReducer();

    reducer.addAttempt(
      stepAttempt("run_one", "task:completed", "completed", "run", {
        attempt: 2,
        status: "completed",
      }),
      "run:task:completed:2",
    );
    reducer.addAttempt(
      stepAttempt("run_one", "sleep:running", "running", "sleep", {
        status: "running",
      }),
      "run:sleep:running:1",
    );
    reducer.addAttempt(
      stepAttempt("run_one", "task:failed", "failed", "run", {
        status: "failed",
      }),
      "run:task:failed:1",
    );

    expect(reducer.finish()).toEqual({
      status: { running: 1, completed: 1, failed: 1, abandoned: 0 },
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
      kind: {
        run: 2,
        sleep: 1,
        workflow: 0,
        "message-send": 0,
        "message-wait": 0,
        stream: 0,
        deterministic: 0,
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

describe("workflow step-attempt lifecycle summary reducer", () => {
  test("summarizes oldest running and latest finished timestamps", () => {
    const reducer = createWorkflowStepAttemptLifecycleSummaryReducer();

    reducer.addAttempt(
      stepAttempt("run_one", "task:old-running", "old running", "run", {
        startedAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
        status: "running",
      }),
    );
    reducer.addAttempt(
      stepAttempt("run_one", "task:new-running", "new running", "run", {
        startedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        status: "running",
      }),
    );
    reducer.addAttempt(
      stepAttempt("run_one", "task:finished", "finished", "run", {
        finishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
        status: "completed",
      }),
    );

    expect(reducer.finish()).toEqual({
      oldestRunningAt: Temporal.Instant.from("2026-06-12T09:00:00Z"),
      latestFinishedAt: Temporal.Instant.from("2026-06-12T09:30:00Z"),
    });
  });
});

describe("workflow step-attempt failure summary reducer", () => {
  test("summarizes failed attempts by error name", () => {
    const reducer = createWorkflowStepAttemptFailureSummaryReducer();

    reducer.addAttempt(
      stepAttempt("run_one", "task:first", "first", "run", {
        error: { name: "RetryError", message: "first failed" },
        finishedAt: Temporal.Instant.from("2026-06-12T09:10:00Z"),
        status: "failed",
      }),
      "run:task:first:1",
    );
    reducer.addAttempt(
      stepAttempt("run_one", "task:second", "second", "run", {
        error: { name: "RetryError", message: "second failed" },
        finishedAt: Temporal.Instant.from("2026-06-12T09:20:00Z"),
        status: "failed",
      }),
      "run:task:second:1",
    );
    reducer.addAttempt(
      stepAttempt("run_one", "task:completed", "completed", "run", {
        status: "completed",
      }),
      "run:task:completed:1",
    );

    expect(reducer.finish()).toEqual({
      failure: {
        total: 2,
        failedStepIds: ["task:first", "task:second"],
        failedAttemptKeys: ["run:task:first:1", "run:task:second:1"],
        errors: [
          {
            name: "RetryError",
            count: 2,
            failedStepIds: ["task:first", "task:second"],
            failedAttemptKeys: ["run:task:first:1", "run:task:second:1"],
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
